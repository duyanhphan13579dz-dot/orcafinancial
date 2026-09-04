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
    // ĐƠN VỊ GIÁ: quote là đồng, engine định giá là nghìn VND → P/E phải ở
    // thang hợp lý (giá 120.000đ / EPS ~5,3 nghìn ≈ 22,8 lần), không ×1000.
    expect(peRow?.value).toBeGreaterThan(10);
    expect(peRow?.value).toBeLessThan(60);
    // Vốn hoá = 120.000đ × 7.733,49M cp ≈ 928.019 tỷ VND.
    expect(analytics.valuation?.marketCapBillionVnd).toBeGreaterThan(900_000);
    expect(analytics.valuation?.marketCapBillionVnd).toBeLessThan(960_000);

    // Hiệu suất + sức khoẻ có số thật (không còn toàn "—").
    expect(analytics.performance).toBeTruthy();
    expect(analytics.health?.overall).toBeGreaterThan(0);

    // Thuế suất hiệu dụng LTM suy từ LNTT − LNST (finfo không tách dòng thuế).
    const perfMetrics = (analytics.performance?.groups ?? []).flatMap((g) => g.metrics);
    const taxRate = perfMetrics.find((m) => m.key === "effectiveTaxRate");
    expect(taxRate?.value).toBeCloseTo(39.55, 0);

    // economicSpread = ROIC(%) − 12 (điểm %) — không còn lệch đơn vị ×100.
    const roic = perfMetrics.find((m) => m.key === "roic")?.value;
    const spread = perfMetrics.find((m) => m.key === "economicSpread")?.value;
    expect(roic).not.toBeNull();
    expect(spread).toBeCloseTo((roic as number) - 12, 1);
    expect(Math.abs(spread as number)).toBeLessThan(60);

    // Altman Z' tính được nhờ LN giữ lại suy từ VCSH − vốn góp.
    expect(analytics.health?.altman?.zScore).not.toBeNull();
    expect(analytics.health?.altman?.verdictVi).toContain("VCSH − vốn góp");
  }, 20_000);
});

describe("reconciliation: đầu ra tab Cơ bản == đầu vào bảng Tài chính", () => {
  // Quy trình Fundamental analyst: data-engine hiển thị BCTC finfo ở tab Tài
  // chính rồi snapshot CHÍNH bộ số đó để tính toán — nên mọi ô của tab Cơ bản
  // (biểu đồ doanh thu, LTM, EPS…) phải khớp từng dòng snapshot, không được
  // lệch (vụ VIC: bảng 117.936,034 mà biểu đồ từng lấy nguồn DB khác ~113k).
  it("chart / statement-source / valuation đồng nhất với snapshot finfo", async () => {
    const TY = 1e9;
    const REV_Q2 = 1.17936034e14 / TY; // 117.936,034 tỷ — ô 21001 Q2/2026
    const NI_Q2 = 1.476396e13 / TY; // 14.763,96 tỷ — ô 23003 Q2/2026
    const REV_Q1 = 1.04352018e14 / TY;
    const NI_Q1 = 5.610779e12 / TY;
    const SHARES = 7.7334919e13 / TY / 10; // 14110 ÷ 10 = 7.733,4919 triệu cp

    const inputs = await loadFundamentalInputs("VIC");
    const q26 = inputs.quarters.find((q) => q.period === "Q2/2026")!;
    expect(q26.income.revenue).toBeCloseTo(REV_Q2, 1);
    expect(q26.income.netIncome).toBeCloseTo(NI_Q2, 1);

    const analytics = await getFundamentalAnalytics("VIC");
    expect(analytics.available).toBe(true);

    // 1) Bảng nguồn trong tab Cơ bản (StatementSourceCard) == snapshot.
    const row = analytics.statement!.rows.find((r) => r.period === "Q2/2026")!;
    expect(row.revenue).toBeCloseTo(REV_Q2, 1);
    expect(row.netIncome).toBeCloseTo(NI_Q2, 1);

    // 2) Cột biểu đồ doanh thu (RevenueProfitChart) == ô bảng Tài chính.
    const chartQ = analytics.chart!.quarters.find((q) => q.shortTag === "2Q26")!;
    expect(chartQ.revenue).toBeCloseTo(REV_Q2, 1);
    expect(chartQ.netIncome).toBeCloseTo(NI_Q2, 1);

    // 3) LTM nội suy đúng từ 2 quý 2026 đang hiển thị (YTD × 2).
    expect(analytics.statement!.ltm!.revenue).toBeCloseTo((REV_Q1 + REV_Q2) * 2, 0);
    expect(analytics.statement!.ltm!.netIncome).toBeCloseTo((NI_Q1 + NI_Q2) * 2, 0);

    // 4) EPS/P/E suy từ chính LTM và số CP ở trên — không nguồn nào khác.
    const epsExpected = ((NI_Q1 + NI_Q2) * 2) / SHARES;
    expect(analytics.valuation!.epsLtm).toBeCloseTo(epsExpected, 2);
    const pe = analytics.valuation!.multiples.find((m) => m.key === "pe")!;
    expect(pe.value).toBeCloseTo(120 / epsExpected, 1); // giá 120.000đ = 120 nghìn
  }, 20_000);
});
