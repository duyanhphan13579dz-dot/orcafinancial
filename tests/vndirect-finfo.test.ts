import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchVndirectFinfoFinancialStatements,
  fetchVndirectFinancialStatements,
} from "@/lib/connectors/vndirect-financials";
import {
  finfoRatiosUrl,
  lastQuarterEnds,
  quarterFromRatioRows,
  type FinfoRatioRow,
} from "@/lib/finfo-ratios";

const TY = 1e9;

function rowsFor(reportDate: string): FinfoRatioRow[] {
  return [
    { ratioCode: "TOTAL_SALES_YD", itemName: "Tổng doanh thu lũy kế", value: 158_332 * TY, reportDate },
    { ratioCode: "NET_SALES_YD", itemName: "Doanh thu thuần lũy kế", value: 156_116 * TY, reportDate },
    { ratioCode: "GROSS_PROFIT_YD", itemName: "Lợi nhuận gộp lũy kế", value: 24_498 * TY, reportDate },
    { ratioCode: "OPERATING_PROFIT_YD", itemName: "Lợi nhuận từ HĐKD lũy kế", value: 17_906 * TY, reportDate },
    { ratioCode: "NET_PROFIT_YD", itemName: "LN ròng lũy kế", value: 15_453 * TY, reportDate },
    { ratioCode: "OPERATING_EBITDA_YD", itemName: "EBITDA hoạt động lũy kế", value: 28_898 * TY, reportDate },
    { ratioCode: "EPS_YD", itemName: "EPS lũy kế", value: 2013.32, reportDate },
    { ratioCode: "TOTAL_ASSETS_AQ", itemName: "Tổng tài sản", value: 257_899 * TY, reportDate },
    { ratioCode: "CURRENT_ASSETS_AQ", itemName: "Tài sản lưu động", value: 103_659 * TY, reportDate },
    { ratioCode: "INVENTORY_AQ", itemName: "Hàng tồn kho", value: 52_828 * TY, reportDate },
    { ratioCode: "OWNERS_EQUITY_AQ", itemName: "Vốn chủ sở hữu", value: 131_220 * TY, reportDate },
    { ratioCode: "TOTAL_CAP_AQ", itemName: "Tổng vốn", value: 257_899 * TY, reportDate },
    { ratioCode: "BVPS_AQ", itemName: "Giá trị sổ sách trên 1 cổ phiếu", value: 16830.38, reportDate },
    { ratioCode: "CFO_YD", itemName: "Dòng tiền từ HĐKD lũy kế", value: 17_366 * TY, reportDate },
  ];
}

function makeFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const u = String(input);
    const m = u.match(/reportDate:(\d{4}-\d{2}-\d{2})/);
    const date = m?.[1] ?? "2025-12-31";
    return new Response(JSON.stringify({ data: rowsFor(date) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("finfo ratios parser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("quarterFromRatioRows đổi đơn vị và suy ra giá vốn/tổng nợ", () => {
    const q = quarterFromRatioRows(rowsFor("2025-12-31"), "2025-12-31");
    expect(q).not.toBeNull();
    expect(q!.period).toBe("Q4/2025");
    expect(q!.income.revenue).toBeCloseTo(158332, 3);
    expect(q!.income.netRevenue).toBeCloseTo(156116, 3);
    expect(q!.income.costOfGoodsSold).toBeCloseTo(156116 - 24498, 3);
    expect(q!.income.netIncome).toBeCloseTo(15453, 3);
    expect(q!.income.eps).toBeCloseTo(2013.32, 2); // giữ nguyên VND cho engine P/E
    expect(q!.balance.totalAssets).toBeCloseTo(257899, 3);
    expect(q!.balance.totalLiabilities).toBeCloseTo(257899 - 131220, 3);
    expect(q!.balance.bookValuePerShare).toBeCloseTo(16830.38, 2);
    expect(q!.cashflow.operatingCashFlow).toBeCloseTo(17366, 3);
  });

  it("fetchVndirectFinfoFinancialStatements gọi đúng endpoint công khai theo từng kỳ", async () => {
    const fetchMock = makeFetch();
    const result = await fetchVndirectFinfoFinancialStatements("hpg", 4, fetchMock as unknown as typeof fetch);
    expect(result.source).toBe("vndirect");
    expect(result.quarters).toHaveLength(4);
    const called = fetchMock.mock.calls.map((c) => String(c[0]));
    for (const d of lastQuarterEnds(4)) {
      expect(called.some((u) => u === finfoRatiosUrl("HPG", d))).toBe(true);
    }
    const latest = result.quarters[0];
    expect(latest.income.revenue).toBeCloseTo(158332, 3);
    expect(result.rawPayload).toBeDefined();
  });

  it("fetchVndirectFinancialStatements ra số từ finfo khi chưa cấu hình datafeed", async () => {
    vi.stubGlobal("fetch", makeFetch());
    const combined = await fetchVndirectFinancialStatements("HPG", 4);
    expect(combined.symbol).toBe("HPG");
    expect(combined.source).toBe("vndirect");
    expect(combined.quarters).toHaveLength(4);
    expect(combined.quarters[0].balance.equity).toBeCloseTo(131220, 3);
  });

  it("HTTP lỗi → quarters rỗng + warning, không bịa số", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 403 }));
    const result = await fetchVndirectFinfoFinancialStatements("HPG", 4, fetchMock as unknown as typeof fetch);
    expect(result.quarters).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("403"))).toBe(true);
  });
});
