import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchVndirectFinfoFinancialStatements,
  fetchVndirectFinancialStatements,
} from "@/lib/connectors/vndirect-financials";

const FINFO_PAYLOAD = {
  data: [
    {
      code: "HPG",
      fiscalDate: "2025-09-30",
      reportType: "QUARTER",
      modelType: 90,
      revenue: 35000,
      netProfit: 3200,
      profitAfterTax: 3200,
      eps: 950,
    },
    {
      code: "HPG",
      fiscalDate: "2025-09-30",
      reportType: "QUARTER",
      modelType: 2,
      totalAssets: 210000,
      equity: 120000,
      currentAssets: 80000,
      currentLiabilities: 45000,
    },
    {
      code: "HPG",
      fiscalDate: "2025-09-30",
      reportType: "QUARTER",
      modelType: 102,
      operatingCashFlow: 8000,
      freeCashFlow: 4000,
    },
    {
      code: "HPG",
      fiscalDate: "2025-06-30",
      reportType: "QUARTER",
      modelType: 90,
      revenue: 33000,
      netProfit: 3000,
    },
  ],
};

describe("vndirect finfo public BCTC", () => {
  afterEach(() => vi.restoreAllMocks());

  it("gọi đúng endpoint công khai và gộp 3 báo cáo theo kỳ", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      expect(u).toContain("financial_statements");
      expect(u).toContain("code:HPG");
      expect(u).toContain("modelType:2,90,102,412");
      return new Response(JSON.stringify(FINFO_PAYLOAD), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const result = await fetchVndirectFinfoFinancialStatements(
      "HPG",
      4,
      fetchMock as unknown as typeof fetch,
    );
    expect(result.source).toBe("vndirect");
    expect(result.quarters).toHaveLength(2);
    const q3 = result.quarters.find((q) => q.period === "Q3/2025");
    expect(q3).toBeDefined();
    expect(q3!.income.revenue).toBe(35000);
    expect(q3!.income.netIncome).toBe(3200);
    expect(q3!.balance.totalAssets).toBe(210000);
    expect(q3!.balance.equity).toBe(120000);
    expect(q3!.cashflow.operatingCashFlow).toBe(8000);
    expect(result.rawPayload).toBeDefined();
  });

  it("fetchVndirectFinancialStatements ưu tiên finfo công khai khi chưa cấu hình datafeed", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(FINFO_PAYLOAD), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    // chưa set VNDIRECT_DATAFEED_URL → vẫn phải ra số từ finfo
    const combined = await fetchVndirectFinancialStatements("hpg", 4);
    expect(combined.symbol).toBe("HPG");
    expect(combined.source).toBe("vndirect");
    expect(combined.quarters).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it("báo warning khi HTTP lỗi, không bịa số", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 403 }));
    const result = await fetchVndirectFinfoFinancialStatements(
      "HPG",
      4,
      fetchMock as unknown as typeof fetch,
    );
    expect(result.quarters).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("403"))).toBe(true);
  });
});
