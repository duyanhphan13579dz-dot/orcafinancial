import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchVndirectFinfoFinancialStatements,
  fetchVndirectFinancialStatements,
} from "@/lib/connectors/vndirect-financials";
import {
  finfoRatiosUrl,
  finfoStatementsRangeUrl,
  incomeFromStatementRows,
  balanceFromStatementRows,
  cashflowFromStatementRows,
  quartersFromFinfoRows,
  toFinancialQuarters,
  injectSharesOutstanding,
  FINFO_PARSER_VERSION,
  type FinfoQuarter,
  type FinfoRatioRow,
  type FinfoStatementRow,
} from "@/lib/finfo-ratios";
import { detectStatementBasis } from "@/lib/fundamental-engine";

const TY = 1e9;

/**
 * Giá trị thật của API finfo cho VIC kỳ 2026-06-30 / 2026-03-31 (VND),
 * đối chiếu 1-1 với BCTC HỢP NHẤT chuẩn của người dùng (tỷ VND):
 * LNST hợp nhất Q2 14.764 / Q1 5.611; LNST công ty mẹ 10.003 / 7.276;
 * LNTT 22.169 / 11.537; thiểu số 4.761 / −1.665.
 */
const STATEMENT_FIXTURE: Record<string, Array<[number, number]>> = {
    "2026-06-30": [
      [21000, 1.17964878e14],
      [21001, 1.17936034e14],
      [22100, 9.0454822e13],
      [23100, 2.7481212e13],
      [23110, 1.5274246e13],
      [23800, 2.2168856e13],
      [23003, 1.476396e13],
      [23000, 1.0002615e13],
      [23500, 4.761345e12],
    ],
    "2026-03-31": [
      [21000, 1.04371179e14],
      [21001, 1.04352018e14],
      [22100, 7.8414392e13],
      [23100, 2.5937626e13],
      [23110, 5.084455e12],
      [23800, 1.1536718e13],
      [23003, 5.610779e12],
      [23000, 7.276018e12],
      [23500, -1.665239e12],
    ],
    // FY2025 = giá trị API thật (modelType 2 tại 31/12 = lũy kế cả năm hợp nhất)
    "2025-12-31": [
      [21000, 1.62238595e14],
      [21001, 1.6222662e14],
      [22100, 1.24874331e14],
      [23100, 3.7352289e13],
      [23110, 1.2113489e13],
      [23800, 1.1254075e13],
      [23003, 3.499674e12],
      [23000, 4.671896e12],
      [23500, -1.172222e12],
    ],
    // Giá trị API thật (công bố 2025-10-31) — Q3/2025 VIC lỗ gộp -7.290 tỷ
    "2025-09-30": [
      [21000, 3.9143023e13],
      [21001, 3.9135103e13],
      [22100, 4.6425078e13],
      [23100, -7.289975e12],
      [23110, 4.829457e12],
      [23800, 4.024377e12],
      [23003, 3.025338e12],
      [23000, 6.40184e11],
      [23500, 2.385154e12],
    ],
  };

function vicStatementRows(date: string): FinfoStatementRow[] {
  return (STATEMENT_FIXTURE[date] ?? []).map(([itemCode, numericValue]) => ({
    itemCode,
    numericValue,
    modelType: 2,
    reportType: "QUARTER",
    fiscalDate: date,
  }));
}

function vicRatioRows(date: string): FinfoRatioRow[] {
  if (date === "2026-06-30") {
    return [
      { ratioCode: "CURRENT_ASSETS_AQ", value: 8.25661e14 },
      { ratioCode: "INVENTORY_AQ", value: 2.61745101e14 },
      { ratioCode: "TOTAL_ASSETS_AQ", value: 1.308937567e15 },
      { ratioCode: "OWNERS_EQUITY_AQ", value: 1.8070665e14 },
      // NET_PROFIT_QR là LỢI NHUẬN CÔNG TY MẸ — parser KHÔNG được dùng nó
      { ratioCode: "NET_PROFIT_QR", value: 1.0002615e13 },
      { ratioCode: "CFO_YD", value: 7.6636908e13 },
    ];
  }
  if (date === "2026-03-31") {
    return [
      { ratioCode: "TOTAL_ASSETS_AQ", value: 1.178695e15 },
      { ratioCode: "OWNERS_EQUITY_AQ", value: 1.53704e14 },
      { ratioCode: "CFO_YD", value: 1.823e13 },
    ];
  }
  if (date === "2025-12-31") {
    return [
      { ratioCode: "TOTAL_ASSETS_AQ", value: 1.15e15 },
      { ratioCode: "OWNERS_EQUITY_AQ", value: 1.5e14 },
      { ratioCode: "CFO_YD", value: 3.0e13 },
    ];
  }
  if (date === "2025-09-30") {
    return [
      { ratioCode: "TOTAL_ASSETS_AQ", value: 1.1e15 },
      { ratioCode: "OWNERS_EQUITY_AQ", value: 1.45e14 },
      { ratioCode: "CFO_YD", value: 2.2e13 },
    ];
  }
  if (date === "2025-06-30") {
    return [{ ratioCode: "CFO_YD", value: 1.5e13 }];
  }
  return [];
}

function makeFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const gte = url.match(/fiscalDate:gte:(\d{4}-\d{2}-\d{2})/);
    if (url.includes("/financial_statements") && gte) {
      const from = gte[1];
      const data = Object.keys(STATEMENT_FIXTURE)
        .filter((d) => d >= from)
        .flatMap((d) => vicStatementRows(d));
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const date = url.match(/(?:reportDate|fiscalDate):(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
    const data = url.includes("/financial_statements") ? vicStatementRows(date) : vicRatioRows(date);
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("finfo parser — BCTC hợp nhất (consol-v2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("income lấy từ modelType 2 = HỢP NHẤT, riêng quý (khớp BCTC chuẩn VIC)", () => {
    const income = incomeFromStatementRows(vicStatementRows("2026-06-30"));
    expect(income.totalRevenue).toBeCloseTo(117964.878, 2);
    expect(income.revenue).toBeCloseTo(117936.034, 2);
    expect(income.costOfGoodsSold).toBeCloseTo(90454.822, 2);
    expect(income.grossProfit).toBeCloseTo(27481.212, 2);
    expect(income.operatingIncome).toBeCloseTo(15274.246, 2);
    expect(income.pretaxIncome).toBeCloseTo(22168.856, 2);
    expect(income.netIncome).toBeCloseTo(14763.96, 2); // hợp nhất — KHÔNG phải 10.003
    expect(income.netIncomeParent).toBeCloseTo(10002.615, 2);
    expect(income.minorityInterest).toBeCloseTo(4761.345, 2);
  });

  it("bỏ qua rows ngoài modelType 2/102 (không lẫn cân đối/lưu chuyển)", () => {
    const mixed = [
      ...vicStatementRows("2026-06-30"),
      { itemCode: 11300, numericValue: 3.16214505e14, modelType: 1 } as FinfoStatementRow,
      { itemCode: 23003, numericValue: 9.99e13, modelType: 3 } as FinfoStatementRow,
      { itemCode: 431460, numericValue: 1.4472278e13, modelType: 103 } as FinfoStatementRow,
      { itemCode: 411400, numericValue: 4.97858712e14, modelType: 101 } as FinfoStatementRow,
    ];
    expect(incomeFromStatementRows(mixed).netIncome).toBeCloseTo(14763.96, 2);
  });

  it("ngân hàng (TCB): modelType 102, doanh thu thuần = 421900, lợi nhuận 23xxx", () => {
    const rows: FinfoStatementRow[] = [
      { itemCode: 421900, numericValue: 1.0763002e13, modelType: 102, fiscalDate: "2026-06-30" },
      { itemCode: 23800, numericValue: 9.670016e12, modelType: 102, fiscalDate: "2026-06-30" },
      { itemCode: 23003, numericValue: 7.726642e12, modelType: 102, fiscalDate: "2026-06-30" },
      { itemCode: 23000, numericValue: 7.350059e12, modelType: 102, fiscalDate: "2026-06-30" },
      { itemCode: 23500, numericValue: 3.76583e11, modelType: 102, fiscalDate: "2026-06-30" },
      // nhiễu: cân đối/lưu chuyển ngân hàng không được lẫn vào income
      { itemCode: 411400, numericValue: 1.14958312e14, modelType: 101, fiscalDate: "2026-06-30" },
      { itemCode: 431460, numericValue: 5.8388254e13, modelType: 103, fiscalDate: "2026-06-30" },
    ];
    const income = incomeFromStatementRows(rows);
    expect(income.revenue).toBeCloseTo(10763.002, 2); // khớp NET_SALES_QR ratios
    expect(income.pretaxIncome).toBeCloseTo(9670.016, 2);
    expect(income.netIncome).toBeCloseTo(7726.642, 2);
    expect(income.netIncomeParent).toBeCloseTo(7350.059, 2);
    expect(income.minorityInterest).toBeCloseTo(376.583, 2);
    expect(income.costOfGoodsSold).toBeUndefined(); // bank không có giá vốn
  });

  it("cân đối (model 1): map đủ đề mục, bỏ qua model 2/3, đơn vị tỷ", () => {
    const rows: FinfoStatementRow[] = [
      { itemCode: 11000, numericValue: 8.42400726e14, modelType: 1, fiscalDate: "2026-06-30" },
      { itemCode: 11100, numericValue: 7.6396702e13, modelType: 1, fiscalDate: "2026-06-30" },
      { itemCode: 11300, numericValue: 3.03176023e14, modelType: 1, fiscalDate: "2026-06-30" },
      { itemCode: 11400, numericValue: 2.84664807e14, modelType: 1, fiscalDate: "2026-06-30" },
      { itemCode: 12700, numericValue: 1.309346482e15, modelType: 1, fiscalDate: "2026-06-30" },
      { itemCode: 13000, numericValue: 1.117676877e15, modelType: 1, fiscalDate: "2026-06-30" },
      { itemCode: 13100, numericValue: 7.12265494e14, modelType: 1, fiscalDate: "2026-06-30" },
      { itemCode: 13300, numericValue: 4.05411383e14, modelType: 1, fiscalDate: "2026-06-30" },
      { itemCode: 14000, numericValue: 1.91669605e14, modelType: 1, fiscalDate: "2026-06-30" },
      // nhiễu: cùng mã nhưng khác model không được lẫn vào
      { itemCode: 13000, numericValue: 9.99e15, modelType: 3, fiscalDate: "2026-06-30" },
    ];
    const bal = balanceFromStatementRows(rows);
    expect(bal.cashAndEquivalents).toBeCloseTo(76396.702, 2);
    expect(bal.currentAssets).toBeCloseTo(842400.726, 2);
    expect(bal.totalAssets).toBeCloseTo(1309346.482, 2);
    expect(bal.totalLiabilities).toBeCloseTo(1117676.877, 2);
    expect(bal.equity).toBeCloseTo(191669.605, 2);
    // đẳng thức kế toán từ chính số đã map
    expect(bal.totalLiabilities + bal.equity).toBeCloseTo(bal.totalAssets, 3);
    expect(bal.currentLiabilities + bal.longTermDebt).toBeCloseTo(bal.totalLiabilities, 3);
  });

  it("LCTT (model 3): CFO/capex/đầu tư/cổ tức + debtIssuance = 33300+33400", () => {
    const rows: FinfoStatementRow[] = [
      { itemCode: 32000, numericValue: 2.2519605e13, modelType: 3, fiscalDate: "2026-06-30" },
      { itemCode: 32100, numericValue: -2.4853957e13, modelType: 3, fiscalDate: "2026-06-30" },
      { itemCode: 33000, numericValue: -7.8997377e13, modelType: 3, fiscalDate: "2026-06-30" },
      { itemCode: 33300, numericValue: 1.27119754e14, modelType: 3, fiscalDate: "2026-06-30" },
      { itemCode: 33400, numericValue: -5.5042876e13, modelType: 3, fiscalDate: "2026-06-30" },
      { itemCode: 33600, numericValue: -3.66157e11, modelType: 3, fiscalDate: "2026-06-30" },
      { itemCode: 32000, numericValue: 9.99e15, modelType: 1, fiscalDate: "2026-06-30" }, // nhiễu
    ];
    const cf = cashflowFromStatementRows(rows);
    expect(cf.operatingCashFlow).toBeCloseTo(22519.605, 2);
    expect(cf.capex).toBeCloseTo(-24853.957, 2);
    expect(cf.investingCashFlow).toBeCloseTo(-78997.377, 2);
    expect(cf.dividendsPaid).toBeCloseTo(-366.157, 3);
    expect(cf.debtIssuance).toBeCloseTo(72076.878, 2); // 127.119,754 − 55.042,876
  });

  it("quarter: income hợp nhất + cân đối _AQ + CFO hiệu lũy kế", () => {
    const qs = quartersFromFinfoRows(
      new Map([
        ["2026-06-30", vicRatioRows("2026-06-30")],
        ["2026-03-31", vicRatioRows("2026-03-31")],
      ]),
      new Map([
        ["2026-06-30", vicStatementRows("2026-06-30")],
        ["2026-03-31", vicStatementRows("2026-03-31")],
      ]),
      "quarter",
    );
    const q2 = qs.find((q) => q.period === "Q2/2026")!;
    const q1 = qs.find((q) => q.period === "Q1/2026")!;
    expect(q2.income.netIncome).toBeCloseTo(14763.96, 2);
    expect(q1.income.netIncome).toBeCloseTo(5610.779, 2);
    expect(q1.income.minorityInterest).toBeCloseTo(-1665.239, 2);
    // NET_PROFIT_QR (công ty mẹ) không được dùng cho netIncome
    expect(q2.income.netIncome).not.toBeCloseTo(10002.615, 2);
    // cân đối: số dư thời điểm + tổng nợ suy từ đẳng thức kế toán
    expect(q2.balance.totalAssets).toBeCloseTo(1308937.567, 2);
    expect(q2.balance.totalLiabilities).toBeCloseTo(1308937.567 - 180706.65, 2);
    expect(q2.balance.equity).toBeCloseTo(180706.65, 2);
    // CFO thiếu _QR → hiệu hai số lũy kế đã công bố
    expect(q2.cashflow.operatingCashFlow).toBeCloseTo(76636.908 - 18230, 2);
  });

  it("year: chỉ giữ kỳ 31/12 (modelType 2 tại 31/12 = cả năm hợp nhất)", () => {
    const qs = quartersFromFinfoRows(
      new Map([["2025-09-30", [] as FinfoRatioRow[]]]),
      new Map([
        ["2025-12-31", [{ itemCode: 23003, numericValue: 2.4e13, modelType: 2 } as FinfoStatementRow]],
        ["2025-09-30", [{ itemCode: 23003, numericValue: 1.6e13, modelType: 2 } as FinfoStatementRow]],
      ]),
      "year",
    );
    expect(qs).toHaveLength(1);
    expect(qs[0].period).toBe("Q4/2025");
    expect(qs[0].income.netIncome).toBeCloseTo(24000, 2);
  });

  it("fetch gọi cả /v4/financial_statements lẫn /v4/ratios cho từng quý", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T00:00:00Z"));
    const fetchMock = makeFetch();
    const result = await fetchVndirectFinfoFinancialStatements("VIC", 3, fetchMock as unknown as typeof fetch);
    expect(result.quarters.map((q) => q.period)).toEqual(["Q2/2026", "Q1/2026", "Q4/2025"]);
    const called = fetchMock.mock.calls.map((c) => String(c[0]));
    // KQKD hợp nhất: MỘT truy vấn dải kể từ quý cũ nhất
    expect(called).toContain(finfoStatementsRangeUrl("VIC", "2025-12-31"));
    expect(called.filter((u) => u.includes("/financial_statements"))).toHaveLength(1);
    expect(called).toContain(finfoRatiosUrl("VIC", "2026-06-30"));
    // quý liền trước quý cũ nhất vẫn được gọi (ratios) để tính hiệu lũy kế
    expect(called).toContain(finfoRatiosUrl("VIC", "2025-09-30"));
    const latest = result.quarters[0];
    expect(latest.income.netIncome).toBeCloseTo(14763.96, 2);
    expect(result.quarters[1].income.netIncome).toBeCloseTo(5610.779, 2);
    vi.useRealTimers();
  });

  it("fetchVndirectFinancialStatements vẫn ra số hợp nhất khi chưa cấu hình datafeed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T00:00:00Z"));
    vi.stubGlobal("fetch", makeFetch());
    const combined = await fetchVndirectFinancialStatements("VIC", 2);
    expect(combined.symbol).toBe("VIC");
    expect(combined.quarters).toHaveLength(2);
    expect(combined.quarters[0].income.netIncome).toBeCloseTo(14763.96, 2);
    vi.useRealTimers();
  });

  it("HTTP lỗi + mã KHÔNG có snapshot → quarters rỗng + warning, không bịa số", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 403 }));
    const result = await fetchVndirectFinfoFinancialStatements("HPG", 2, fetchMock as unknown as typeof fetch);
    expect(result.quarters).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("403"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("sao lưu"))).toBe(false);
  });

  it("parser version = consol-v5 (DB phiên bản cũ bị coi là stale và nạp lại)", () => {
    expect(FINFO_PARSER_VERSION).toBe("consol-v5");
  });

  it("rớt request lần đầu ở quý xa → retry lấy đủ, bảng vẫn đủ cột", async () => {
    // fake mỗi Date (để baseDates khớp fixture), giữ setTimeout thật cho retry
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-03T00:00:00Z"));
    const failedOnce = new Set<string>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      // mọi URL quý xa (2025) đều rớt lần đầu — mô phỏng nguồn chặn bùng phát
      if (url.includes("2025") && !failedOnce.has(url)) {
        failedOnce.add(url);
        return new Response("boom", { status: 500 });
      }
      return makeFetch()(input as RequestInfo);
    });
    const result = await fetchVndirectFinfoFinancialStatements("VIC", 4, fetchMock as unknown as typeof fetch);
    // Q2+Q1/2026 + Q4+Q3/2025: retry phải cứu được các quý 2025
    expect(result.quarters.map((q) => q.period)).toEqual(["Q2/2026", "Q1/2026", "Q4/2025", "Q3/2025"]);
    expect(result.quarters[2].income.netIncome).toBeCloseTo(3499.674, 2); // FY2025 = Q4 lũy kế
    vi.useRealTimers();
  });

  it("nguồn sống bị chặn hoàn toàn (403) → VIC lấp bằng bản sao lưu có nhãn", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-03T00:00:00Z"));
    const fetchMock = vi.fn(async () => new Response("blocked", { status: 403 }));
    const result = await fetchVndirectFinfoFinancialStatements("VIC", 4, fetchMock as unknown as typeof fetch);
    expect(result.quarters.map((q) => q.period)).toEqual(["Q2/2026", "Q1/2026", "Q4/2025", "Q3/2025"]);
    expect(result.quarters[0].income.netIncome).toBeCloseTo(14763.96, 2);
    expect(result.quarters[0].income.minorityInterest).toBeCloseTo(4761.345, 2);
    expect(result.quarters[3].income.grossProfit).toBeCloseTo(-7289.975, 2); // lỗ gộp Q3/2025
    // snapshot toàn bộ đề mục: cân đối + LCTT cũng được lấp khi nguồn bị chặn
    expect(result.quarters[0].balance.totalAssets).toBeCloseTo(1309346.482, 2);
    expect(result.quarters[0].balance.equity).toBeCloseTo(191669.605, 2);
    expect(result.quarters[0].balance.cashAndEquivalents).toBeCloseTo(76396.702, 2);
    expect(result.quarters[0].balance.inventory).toBeCloseTo(284664.807, 2);
    expect(result.quarters[0].cashflow.operatingCashFlow).toBeCloseTo(22519.605, 2);
    expect(result.quarters[0].cashflow.capex).toBeCloseTo(-24853.957, 2);
    expect(result.quarters[0].cashflow.debtIssuance).toBeCloseTo(72076.878, 2);
    expect(result.warnings.some((w) => w.includes("sao lưu"))).toBe(true);
    vi.useRealTimers();
  });
});

describe("cầu nối engine Cơ bản — toFinancialQuarters / injectSharesOutstanding", () => {
  const q = (period: string, quarter: number, income: Record<string, number>, balance: Record<string, number> = {}): FinfoQuarter => ({
    period,
    fiscalYear: Number(period.slice(2)),
    reportDate: period,
    income,
    balance,
    cashflow: {},
  });

  it("kỳ 31/12 lũy kế được tách riêng quý = cả năm − (Q1+Q2+Q3)", () => {
    const quarters = [
      q("Q1/2025", 1, { revenue: 28000, netIncome: 900 }),
      q("Q2/2025", 2, { revenue: 30000, netIncome: 1000 }),
      q("Q3/2025", 3, { revenue: 39135.103, netIncome: 2385.154 }),
      q("Q4/2025", 4, { revenue: 162226.62, netIncome: 3499.674 }, { totalAssets: 1118622.625 }),
      q("Q2/2026", 2, { revenue: 117936.034, netIncome: 14763.96 }),
    ];
    const { quarters: out, warnings } = toFinancialQuarters(quarters);
    expect(warnings).toHaveLength(0);
    const q4 = out.find((x) => x.period === "Q4/2025")!;
    expect(q4.quarter).toBe(4);
    expect(q4.income.revenue).toBeCloseTo(162226.62 - 28000 - 30000 - 39135.103, 3);
    expect(q4.income.netIncome).toBeCloseTo(3499.674 - 900 - 1000 - 2385.154, 3);
    expect(q4.balance.totalAssets).toBeCloseTo(1118622.625, 3); // cân đối giữ nguyên
    // chuỗi sau map toàn số riêng quý + khai báo basis → engine không unwind nhầm
    expect(detectStatementBasis(out, "standalone")).toBe("standalone");
  });

  it("thiếu Q1–Q3 cùng năm → loại kỳ 31/12, có cảnh báo (không bịa số riêng quý)", () => {
    const quarters = [
      q("Q3/2025", 3, { revenue: 39135.103 }),
      q("Q4/2025", 4, { revenue: 162226.62 }),
      q("Q2/2026", 2, { revenue: 117936.034 }),
    ];
    const { quarters: out, warnings } = toFinancialQuarters(quarters);
    expect(out.map((x) => x.period)).toEqual(["Q2/2026", "Q3/2025"]);
    expect(warnings.some((w) => w.includes("31/12/2025"))).toBe(true);
  });

  it("số CP lưu hành suy từ vốn góp 14110 (mệnh giá 10.000đ): VIC = 3.880,48 triệu", () => {
    const quarters = [
      q("Q3/2025", 3, {}, { paidInCapital: 38804.764 }),
      q("Q2/2026", 2, {}, { paidInCapital: 77334.919 }),
    ] as unknown as import("@/lib/financial-statements").FinancialQuarter[];
    const noProfile = injectSharesOutstanding(quarters, null);
    expect(noProfile.via).toBe("paidInCapital");
    expect(noProfile.quarters[0].income.sharesOutstanding).toBeCloseTo(3880.4764, 3);
    expect(noProfile.quarters[1].income.sharesOutstanding).toBeCloseTo(7733.4919, 3);
    const withProfile = injectSharesOutstanding(quarters, 5000);
    expect(withProfile.via).toBe("profile");
    expect(withProfile.quarters[0].income.sharesOutstanding).toBe(5000);
  });

  it("snapshot VIC khi nguồn bị chặn → chuỗi riêng quý + số CP cho engine Cơ bản", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-03T00:00:00Z"));
    const fetchMock = vi.fn(async () => new Response("blocked", { status: 403 }));
    const finfo = await fetchVndirectFinfoFinancialStatements("VIC", 12, fetchMock as unknown as typeof fetch);
    const mapped = toFinancialQuarters(finfo.quarters);
    // snapshot có 4 kỳ nhưng thiếu Q1–Q3/2025 → Q4/2025 (lũy kế) bị loại
    expect(mapped.quarters.map((x) => x.period)).toEqual(["Q2/2026", "Q1/2026", "Q3/2025"]);
    const withShares = injectSharesOutstanding(mapped.quarters, null);
    expect(withShares.via).toBe("paidInCapital");
    const q2 = withShares.quarters.find((x) => x.period === "Q2/2026")!;
    expect(q2.income.sharesOutstanding).toBeCloseTo(7733.4919, 3);
    // EPS quý (nghìn VND) = LNST mẹ riêng quý ÷ số CP (triệu)
    expect((q2.income.netIncomeParent ?? 0) / (q2.income.sharesOutstanding ?? 1)).toBeCloseTo(10002.615 / 7733.4919, 3);
    vi.useRealTimers();
  });
});
