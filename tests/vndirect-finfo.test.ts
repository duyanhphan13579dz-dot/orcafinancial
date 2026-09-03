import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchVndirectFinfoFinancialStatements,
  fetchVndirectFinancialStatements,
} from "@/lib/connectors/vndirect-financials";
import {
  finfoRatiosUrl,
  lastQuarterEnds,
  prevQuarterEnd,
  quartersFromRatioRows,
  type FinfoRatioRow,
} from "@/lib/finfo-ratios";

const TY = 1e9;

/** VIC Q1+Q2/2026 lấy từ đối chiếu BCTC chuẩn của người dùng (tỷ VND). */
function vicRows(date: string): FinfoRatioRow[] {
  if (date === "2026-06-30") {
    return [
      { ratioCode: "TOTAL_SALES_QR", value: 117_965 * TY },
      { ratioCode: "NET_SALES_QR", value: 117_936 * TY },
      { ratioCode: "COGS_QR", value: 90_455 * TY },
      { ratioCode: "GROSS_PROFIT_QR", value: 27_481 * TY },
      // OPERATING_PROFIT_QR cố tình thiếu → phải suy từ hiệu lũy kế
      { ratioCode: "OPERATING_PROFIT_YD", value: 20_359 * TY },
      { ratioCode: "NET_PROFIT_QR", value: 10_003 * TY },
      { ratioCode: "EPS_YD", value: 2242.22 },
      { ratioCode: "TOTAL_ASSETS_AQ", value: 1_308_938 * TY },
      { ratioCode: "OWNERS_EQUITY_AQ", value: 180_707 * TY },
      { ratioCode: "TOTAL_CAP_AQ", value: 1_308_938 * TY },
      { ratioCode: "CFO_YD", value: 76_637 * TY },
    ];
  }
  if (date === "2026-03-31") {
    return [
      { ratioCode: "NET_SALES_QR", value: 104_352 * TY },
      { ratioCode: "OPERATING_PROFIT_YD", value: 5_084 * TY },
      { ratioCode: "EPS_YD", value: 940 },
      { ratioCode: "TOTAL_ASSETS_AQ", value: 1_178_695 * TY },
      { ratioCode: "OWNERS_EQUITY_AQ", value: 153_704 * TY },
      { ratioCode: "TOTAL_CAP_AQ", value: 1_178_695 * TY },
      { ratioCode: "CFO_YD", value: 18_230 * TY },
    ];
  }
  return [];
}

function makeFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const m = String(input).match(/reportDate:(\d{4}-\d{2}-\d{2})/);
    return new Response(JSON.stringify({ data: vicRows(m?.[1] ?? "") }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("finfo ratios parser — số riêng quý", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("quarter: _QR dùng thẳng, thiếu _QR lấy hiệu lũy kế, Q1 = lũy kế", () => {
    const rowsByDate = new Map([
      ["2026-06-30", vicRows("2026-06-30")],
      ["2026-03-31", vicRows("2026-03-31")],
    ]);
    const qs = quartersFromRatioRows(rowsByDate, "quarter");
    const q2 = qs.find((q) => q.period === "Q2/2026")!;
    const q1 = qs.find((q) => q.period === "Q1/2026")!;
    expect(q2.income.revenue).toBeCloseTo(117936, 3); // NET_SALES_QR
    expect(q2.income.totalRevenue).toBeCloseTo(117965, 3);
    expect(q2.income.costOfGoodsSold).toBeCloseTo(90455, 3);
    expect(q2.income.grossProfit).toBeCloseTo(27481, 3);
    // thiếu _QR → hiệu hai số _YD đã công bố: 20,359 − 5,084
    expect(q2.income.operatingIncome).toBeCloseTo(15275, 0);
    expect(q2.income.netIncome).toBeCloseTo(10003, 3);
    expect(q2.income.eps).toBeCloseTo(2242.22 - 940, 1);
    expect(q2.cashflow.operatingCashFlow).toBeCloseTo(76637 - 18230, 0);
    expect(q1.income.operatingIncome).toBeCloseTo(5084, 3); // Q1 = _YD
    expect(q1.income.eps).toBeCloseTo(940, 1);
    // cân đối: số dư thời điểm + tổng nợ suy từ đẳng thức kế toán
    expect(q2.balance.totalAssets).toBeCloseTo(1308938, 3);
    expect(q2.balance.totalLiabilities).toBeCloseTo(1308938 - 180707, 3);
    expect(q2.balance.equity).toBeCloseTo(180707, 3);
  });

  it("year: chỉ giữ kỳ 31/12 và dùng lũy kế", () => {
    const rowsByDate = new Map([
      ["2025-12-31", [{ ratioCode: "NET_SALES_YD", value: 162_227 * TY } as FinfoRatioRow]],
      ["2025-09-30", [{ ratioCode: "NET_SALES_YD", value: 100_000 * TY } as FinfoRatioRow]],
    ]);
    const qs = quartersFromRatioRows(rowsByDate, "year");
    expect(qs).toHaveLength(1);
    expect(qs[0].period).toBe("Q4/2025");
    expect(qs[0].income.revenue).toBeCloseTo(162227, 3);
  });

  it("fetchVndirectFinfoFinancialStatements gọi thêm quý liền trước để lấy hiệu", async () => {
    const fetchMock = makeFetch();
    const result = await fetchVndirectFinfoFinancialStatements("VIC", 2, fetchMock as unknown as typeof fetch);
    expect(result.quarters).toHaveLength(2);
    const called = fetchMock.mock.calls.map((c) => String(c[0]));
    const [d1, d2] = lastQuarterEnds(2);
    expect(called).toContain(finfoRatiosUrl("VIC", d1));
    expect(called).toContain(finfoRatiosUrl("VIC", d2));
    expect(called).toContain(finfoRatiosUrl("VIC", prevQuarterEnd(d1)!));
    const latest = result.quarters[0];
    expect(latest.income.revenue).toBeCloseTo(117936, 3);
  });

  it("fetchVndirectFinancialStatements vẫn ra số riêng quý khi chưa cấu hình datafeed", async () => {
    vi.stubGlobal("fetch", makeFetch());
    const combined = await fetchVndirectFinancialStatements("VIC", 2);
    expect(combined.symbol).toBe("VIC");
    expect(combined.quarters).toHaveLength(2);
    expect(combined.quarters[0].income.netIncome).toBeCloseTo(10003, 3);
  });

  it("HTTP lỗi → quarters rỗng + warning, không bịa số", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 403 }));
    const result = await fetchVndirectFinfoFinancialStatements("VIC", 2, fetchMock as unknown as typeof fetch);
    expect(result.quarters).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("403"))).toBe(true);
  });
});
