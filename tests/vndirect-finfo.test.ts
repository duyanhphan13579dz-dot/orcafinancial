import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchVndirectFinfoFinancialStatements,
  fetchVndirectFinancialStatements,
} from "@/lib/connectors/vndirect-financials";
import {
  finfoRatiosUrl,
  finfoStatementsRangeUrl,
  incomeFromStatementRows,
  quartersFromFinfoRows,
  FINFO_PARSER_VERSION,
  type FinfoRatioRow,
  type FinfoStatementRow,
} from "@/lib/finfo-ratios";

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

  it("bỏ qua rows không phải modelType 2 (không lẫn bảng cân đối)", () => {
    const mixed = [
      ...vicStatementRows("2026-06-30"),
      { itemCode: 11300, numericValue: 3.16214505e14, modelType: 1 } as FinfoStatementRow,
      { itemCode: 23003, numericValue: 9.99e13, modelType: 3 } as FinfoStatementRow,
    ];
    expect(incomeFromStatementRows(mixed).netIncome).toBeCloseTo(14763.96, 2);
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

  it("parser version = consol-v3 (DB raw-v1/consol-v2 bị coi là stale và nạp lại)", () => {
    expect(FINFO_PARSER_VERSION).toBe("consol-v3");
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
    expect(result.warnings.some((w) => w.includes("sao lưu"))).toBe(true);
    vi.useRealTimers();
  });
});
