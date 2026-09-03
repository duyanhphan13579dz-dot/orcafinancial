import { describe, expect, it, vi } from "vitest";

// E2E chuỗi #22: DB rỗng (không có BCTC verified) → loadQuarters rơi xuống
// nhánh finfo + snapshot nguyên văn → toFinancialQuarters (tách Q4 lũy kế) →
// injectSharesOutstanding (14110 ÷ 10) → computeFundamentalAnalytics.
// Đầu ra phải là analytics AVAILABLE với hiệu suất / sức khoẻ / định giá > 0.

vi.mock("../db/pool", () => ({
  getPool: vi.fn(() => ({
    query: vi.fn().mockResolvedValue({ rows: [] }),
  })),
}));

vi.mock("@/lib/market", () => ({
  getQuote: vi.fn(async () => ({ close: 120_000, source: "test" })),
  getHistory: vi.fn(async () => ({ bars: [], source: "test" })),
}));

vi.mock("@/lib/company-service", () => ({
  ensureQuarterlyFinancials: vi.fn(async () => []),
  getProfile: vi.fn(async () => null),
}));

// Giả lập nguồn sống bị chặn: fetchVndirectFinfoFinancialStatements trả về
// quarters dựng từ CHÍNH snapshot nguyên văn trong repo (đường snapshot mà
// connector thật sẽ đi khi live fail).
vi.mock("@/lib/connectors/vndirect-financials", () => ({
  fetchVndirectFinfoFinancialStatements: vi.fn(async () => {
    const { FINFO_STATEMENTS_SNAPSHOT } = await import("@/lib/finfo-snapshot");
    const ratios = await import("@/lib/finfo-ratios");
    const vic = FINFO_STATEMENTS_SNAPSHOT.VIC;
    // fiscalDate → "Qn/yyyy" (đúng dạng FinfoQuarter.period mà
    // toFinancialQuarters parse — connector thật cũng trả dạng này).
    // Values qua CHÍNH các hàm map thật (đơn vị tỷ VND, field named).
    const quarters = Object.keys(vic).map((fiscalDate) => {
      const rows = vic[fiscalDate].map(([modelType, itemCode, numericValue]) => ({
        modelType,
        itemCode,
        numericValue,
      }));
      const parsed = ratios.periodFromReportDate(fiscalDate)!;
      return {
        period: parsed.period,
        fiscalYear: parsed.fiscalYear,
        income: ratios.incomeFromStatementRows(rows as never),
        balance: ratios.balanceFromStatementRows(rows as never),
        cashflow: ratios.cashflowFromStatementRows(rows as never),
      };
    });
    return {
      symbol: "VIC",
      source: "vndirect" as const,
      sourceUrl: "https://dstock.vndirect.com.vn/bao-cao-tai-chinh/VIC",
      quarters,
      urls: [],
      warnings: ["snapshot fallback (test)"],
    };
  }),
}));

import { getFundamentalAnalytics, loadFundamentalInputs } from "@/lib/fundamental-analytics-service";

describe("finfo + snapshot → analytics (e2e, DB rỗng)", () => {
  it("computes performance / health / valuation from statement snapshot", async () => {
    const inputs = await loadFundamentalInputs("VIC");

    expect(inputs.source).toBe("vndirect-finfo");
    expect(inputs.basis).toBe("standalone");

    // Q4/2025 là quý lũy kế không tách được (thiếu Q1–Q3/2025 để trừ) → bị loại.
    const periods = inputs.quarters.map((q) => q.period);
    expect(periods).not.toContain("Q4/2025");
    expect(periods).toContain("Q2/2026");
    expect(periods).toContain("Q1/2026");
    expect(periods).toContain("Q3/2025");

    // Số CP suy từ vốn góp 14110 (77,334.919 tỷ ÷ 10 = 7,733.4919M cp).
    const latest = inputs.quarters.find((q) => q.period === "Q2/2026");
    expect(latest?.income?.sharesOutstanding).toBeCloseTo(7_733.4919, 2);

    const analytics = await getFundamentalAnalytics("VIC");

    expect(analytics.available).toBe(true);
    expect(analytics.statement?.source).toBe("vndirect-finfo");

    // Định giá: EPS LTM > 0 → P/E > 0 tại giá 120.000đ.
    expect(analytics.valuation?.epsLtm).toBeGreaterThan(0);
    const peRow = analytics.valuation?.multiples?.find(
      (m) => m.key === "pe" || m.label.includes("P/E"),
    );
    expect(peRow).toBeDefined();
    expect(peRow?.value).toBeGreaterThan(0);

    // Hiệu suất + sức khoẻ có số thật (không còn toàn "—").
    expect(analytics.performance).toBeTruthy();
    expect(analytics.health?.overall).toBeGreaterThan(0);
  }, 20_000);
});
