import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCafefFinancialStatements } from "@/lib/connectors/cafef-financials";

describe("cafef financials parser (real {Data:{Data:[]}} envelope)", () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.CAFEF_DATA_URL;

  beforeEach(() => {
    process.env.CAFEF_DATA_URL = "https://s.cafef.vn/Ajax/PageNew/DataHistory/BaoCaoTaiChinh.ashx";
  });
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.CAFEF_DATA_URL;
    else process.env.CAFEF_DATA_URL = originalUrl;
    vi.restoreAllMocks();
  });

  it("unwraps the nested CafeF envelope and parses quarters", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          Data: {
            Data: [
              { year: 2024, quarter: 2, revenue: 15000, netIncome: 2400, totalAssets: 60000 },
              { year: 2024, quarter: 1, revenue: 14000, netIncome: 2100 },
            ],
            TotalCount: 2,
          },
          Success: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const result = await fetchCafefFinancialStatements("VNM", 4);
    expect(result.source).toBe("cafef");
    expect(result.quarters).toHaveLength(2);
    const q2 = result.quarters.find((q) => q.period === "Q2/2024");
    expect(q2).toBeDefined();
    expect(q2!.income.revenue).toBe(15000);
    expect(q2!.income.netIncome).toBe(2400);
    expect(q2!.balance.totalAssets).toBe(60000);
  });

  it("returns empty with a clear warning when CAFEF_DATA_URL is unset", async () => {
    delete process.env.CAFEF_DATA_URL;
    const result = await fetchCafefFinancialStatements("VNM", 4);
    expect(result.quarters).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("CAFEF_DATA_URL"))).toBe(true);
  });
});
