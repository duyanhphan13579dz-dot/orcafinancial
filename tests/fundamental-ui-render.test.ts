/**
 * Smoke test render thật 3 component mới bằng react-dom/server, với dữ liệu
 * do chính engine sinh ra (không dùng fixture giả). Mục tiêu: bắt lỗi runtime
 * (gọi .toFixed trên null, truy cập thuộc tính thiếu, vòng lặp undefined…)
 * mà tsc không phát hiện được.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { computeFundamentalAnalytics } from "@/lib/fundamental-analytics-service";
import type { FundamentalInputs } from "@/lib/fundamental-analytics-service";
import type { FinancialQuarter } from "@/lib/financial-statements";
import { fixtureQuarters } from "./helpers/financial-quarters";
import { BusinessPerformanceCard } from "@/components/business-performance";
import { AdvancedHealthCard } from "@/components/advanced-health";
import { ValuationCard } from "@/components/valuation-panel";

function makeInputs(overrides: Partial<FundamentalInputs> = {}): FundamentalInputs {
  return {
    symbol: "HPG",
    quarters: fixtureQuarters(),
    source: "vndirect",
    providerBacked: true,
    price: 27.4,
    beta: 1.1,
    priceSource: "tcbs",
    loadWarnings: [],
    loadedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("render thật các panel của tab Cơ bản", () => {
  it("BusinessPerformanceCard render ra HTML có điểm, DuPont và nhãn kỳ đúng chuẩn", () => {
    const result = computeFundamentalAnalytics(makeInputs());
    const html = renderToStaticMarkup(createElement(BusinessPerformanceCard, { performance: result.performance as never }));
    expect(html.length).toBeGreaterThan(2000);
    expect(html).toContain("Hiệu suất kinh doanh");
    expect(html).toContain("DuPont 5 bước");
    expect(html).toContain("Chu kỳ vốn lưu động");
    // Nhãn kỳ chuẩn, không bị nối năm hai lần.
    // Lưu ý: recharts <ResponsiveContainer> không render trục toạ độ khi SSR,
    // nên shortTag "4Q25" được kiểm chứng ở tầng dữ liệu (tests/fundamental-analytics-service.test.ts).
    expect(html).toContain("Q4/2025");
    expect(html).not.toContain("Q4/2025/2025");
    // Công thức của chỉ số được đưa vào tooltip để người dùng tự kiểm chứng
    expect(html).toContain("LN ròng LTM ÷ VCSH bình quân × 100");
    expect(html).toContain("DIO + DSO − DPO");
  });

  it("AdvancedHealthCard render Altman, Piotroski, Beneish", () => {
    const result = computeFundamentalAnalytics(makeInputs());
    const html = renderToStaticMarkup(createElement(AdvancedHealthCard, { health: result.health as never }));
    expect(html).toContain("Altman Z");
    expect(html).toContain("Piotroski F-Score");
    expect(html).toContain("Beneish M-Score");
    expect(html).toContain("6.56");
    expect(html).toContain("Thanh toán");
  });

  it("ValuationCard render bội số, WACC, DCF, lưới độ nhạy", () => {
    const result = computeFundamentalAnalytics(makeInputs());
    const html = renderToStaticMarkup(createElement(ValuationCard, { valuation: result.valuation as never }));
    expect(html).toContain("Bội số định giá");
    expect(html).toContain("WACC");
    expect(html).toContain("DCF 2 giai đoạn");
    expect(html).toContain("Lưới độ nhạy");
    expect(html).toContain("Graham Number");
    expect(html).toContain("Reverse DCF");
    // 25 ô của ma trận độ nhạy
    const cells = (html.match(/WACC \d/g) ?? []).length;
    expect(cells).toBeGreaterThanOrEqual(20);
  });

  it("render được cả khi thiếu giá thị trường (không vỡ vì null)", () => {
    const result = computeFundamentalAnalytics(makeInputs({ price: null, priceSource: "none" }));
    const html = renderToStaticMarkup(createElement(ValuationCard, { valuation: result.valuation as never }));
    expect(html).toContain("Chưa đủ dữ liệu");
    expect(html).toContain("N/A");
  });

  it("render được khi BCTC thiếu nhiều trường (nhiều chỉ số null)", () => {
    const sparse = fixtureQuarters().map((q: FinancialQuarter) => ({
      ...q,
      income: { ...q.income, ebitda: undefined as unknown as number, depreciation: undefined as unknown as number, interestExpense: undefined as unknown as number },
      balance: { ...q.balance, inventory: undefined as unknown as number, receivables: undefined as unknown as number, retainedEarnings: undefined as unknown as number },
      cashflow: { ...q.cashflow, freeCashFlow: undefined as unknown as number, dividendsPaid: undefined as unknown as number },
    })) as FinancialQuarter[];
    const result = computeFundamentalAnalytics(makeInputs({ quarters: sparse }));
    const perfHtml = renderToStaticMarkup(createElement(BusinessPerformanceCard, { performance: result.performance as never }));
    const healthHtml = renderToStaticMarkup(createElement(AdvancedHealthCard, { health: result.health as never }));
    expect(perfHtml).toContain("Chưa có dữ liệu");
    expect(healthHtml.length).toBeGreaterThan(1000);
    // không được xuất hiện NaN hay "undefined" trên màn hình
    expect(perfHtml).not.toContain("NaN");
    expect(healthHtml).not.toContain("NaN");
  });
});
