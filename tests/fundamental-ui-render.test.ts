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
import { BusinessPerformanceCard } from "@/components/business-performance";
import { AdvancedHealthCard } from "@/components/advanced-health";
import { ValuationCard } from "@/components/valuation-panel";

const SHARES = 350;

function quarter(year: number, q: number, revenue: number): FinancialQuarter {
  const grossProfit = revenue * 0.33;
  const ebitda = revenue * 0.19;
  const depreciation = ebitda * 0.3;
  const operatingIncome = ebitda - depreciation;
  const interestExpense = operatingIncome * 0.12;
  const pretaxIncome = operatingIncome - interestExpense;
  const incomeTax = pretaxIncome * 0.2;
  const netIncome = pretaxIncome - incomeTax;
  const receivables = revenue * 0.2;
  const inventory = revenue * 0.14;
  const currentAssets = receivables + inventory + revenue * 0.09;
  const currentLiabilities = currentAssets / 1.4;
  const totalAssets = revenue * 3.4;
  const longTermDebt = totalAssets * 0.24;
  const equity = totalAssets * 0.52;
  const totalLiabilities = totalAssets - equity;
  const operatingCashFlow = netIncome + depreciation;
  const capex = revenue * 0.055;

  return {
    period: `Q${q}/${year}`,
    quarter: q,
    fiscalYear: year,
    income: {
      revenue,
      costOfGoodsSold: revenue - grossProfit,
      grossProfit,
      operatingExpenses: grossProfit - operatingIncome,
      operatingIncome,
      interestExpense,
      otherIncome: 0,
      pretaxIncome,
      incomeTax,
      netIncome,
      ebitda,
      depreciation,
      eps: Number((netIncome / SHARES).toFixed(3)),
      sharesOutstanding: SHARES,
    },
    balance: {
      cashAndEquivalents: revenue * 0.08,
      shortTermInvestments: revenue * 0.02,
      receivables,
      inventory,
      currentAssets,
      fixedAssets: totalAssets - currentAssets,
      longTermInvestments: 0,
      totalAssets,
      currentLiabilities,
      shortTermDebt: currentLiabilities * 0.28,
      debtDueWithin12m: currentLiabilities * 0.28,
      debtMaturityBuckets: {
        within12m: currentLiabilities * 0.28,
        oneToThreeYears: longTermDebt * 0.45,
        overThreeYears: longTermDebt * 0.55,
      },
      longTermDebt,
      totalLiabilities,
      equity,
      retainedEarnings: equity * 0.42,
      totalLiabilitiesEquity: totalAssets,
      bookValuePerShare: Number((equity / SHARES).toFixed(3)),
    },
    cashflow: {
      netIncome,
      depreciation,
      changeWorkingCapital: 0,
      operatingCashFlow,
      capex,
      investingCashFlow: -capex,
      debtIssuance: 0,
      dividendsPaid: netIncome * 0.4,
      financingCashFlow: -netIncome * 0.4,
      netChangeCash: operatingCashFlow - capex - netIncome * 0.4,
      freeCashFlow: operatingCashFlow - capex,
    },
  };
}

function dataset(): FinancialQuarter[] {
  const rows: Array<[number, number, number]> = [
    [2024, 1, 15200],
    [2024, 2, 17400],
    [2024, 3, 16100],
    [2024, 4, 19800],
    [2025, 1, 16800],
    [2025, 2, 19100],
    [2025, 3, 17600],
    [2025, 4, 21500],
  ];
  return rows.map(([y, q, r]) => quarter(y, q, r)).reverse();
}

function makeInputs(overrides: Partial<FundamentalInputs> = {}): FundamentalInputs {
  return {
    symbol: "HPG",
    quarters: dataset(),
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
    const sparse = dataset().map((q) => ({
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
