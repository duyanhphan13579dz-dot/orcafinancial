import { describe, expect, it } from "vitest";
import { buildFundamentalChart } from "@/lib/fundamental-chart";
import { evaluateHealthDetail } from "@/lib/financial-health-detail";
import { toFinancialQuarter } from "@/lib/connectors/live-financials-server";
import type { FinancialQuarter } from "@/lib/financial-statements";

/**
 * Verifies that real company financials (as returned by vnstock/VNDirect/Vietstock
 * and mapped into the canonical FinancialQuarter shape) drive the "Cơ bản" tab's
 * performance metrics + the financial-health score — i.e. the overview is NOT
 * stuck at "0 quý / 0/100" when real figures exist.
 *
 * Values below are realistic published magnitudes (VND, converted to billions by
 * the connector) so the maturity/leverage/profitability calcs produce sane results.
 */

type QuarterInput = {
  period: string;
  quarter: number;
  fiscalYear: number;
  income?: Partial<FinancialQuarter["income"]>;
  balance?: Partial<FinancialQuarter["balance"]>;
  cashflow?: Partial<FinancialQuarter["cashflow"]>;
};

function quarter(input: QuarterInput): FinancialQuarter {
  return {
    period: input.period,
    quarter: input.quarter,
    fiscalYear: input.fiscalYear,
    income: { revenue: 0, costOfGoodsSold: 0, grossProfit: 0, operatingExpenses: 0, operatingIncome: 0, interestExpense: 0, otherIncome: 0, pretaxIncome: 0, incomeTax: 0, netIncome: 0, ebitda: 0, depreciation: 0, eps: 0, sharesOutstanding: 0, ...(input.income ?? {}) },
    balance: { cashAndEquivalents: 0, shortTermInvestments: 0, receivables: 0, inventory: 0, currentAssets: 0, fixedAssets: 0, longTermInvestments: 0, totalAssets: 0, currentLiabilities: 0, longTermDebt: 0, totalLiabilities: 0, equity: 0, retainedEarnings: 0, totalLiabilitiesEquity: 0, bookValuePerShare: 0, ...(input.balance ?? {}) },
    cashflow: { netIncome: 0, depreciation: 0, changeWorkingCapital: 0, operatingCashFlow: 0, capex: 0, investingCashFlow: 0, debtIssuance: 0, dividendsPaid: 0, financingCashFlow: 0, netChangeCash: 0, freeCashFlow: 0, ...(input.cashflow ?? {}) },
  };
}

/** Two consecutive quarters (newest first) from a healthy non-financial company. */
function twoQuarters(): FinancialQuarter[] {
  const latest = quarter({
    period: "Q4/2025",
    quarter: 4,
    fiscalYear: 2025,
    income: { revenue: 1600, grossProfit: 640, operatingIncome: 300, interestExpense: 25, ebitda: 360, netIncome: 210, eps: 3.2 },
    balance: { totalAssets: 2800, currentAssets: 1200, currentLiabilities: 700, inventory: 300, receivables: 250, cashAndEquivalents: 400, equity: 1300, totalLiabilities: 1500, longTermDebt: 400, bookValuePerShare: 13000 },
    cashflow: { operatingCashFlow: 320, investingCashFlow: -120, financingCashFlow: -80, freeCashFlow: 200 },
  });
  const prev = quarter({
    period: "Q3/2025",
    quarter: 3,
    fiscalYear: 2025,
    income: { revenue: 1400, grossProfit: 560, operatingIncome: 250, interestExpense: 22, ebitda: 310, netIncome: 180, eps: 2.8 },
    balance: { totalAssets: 2600, currentAssets: 1100, currentLiabilities: 650, inventory: 280, receivables: 230, cashAndEquivalents: 350, equity: 1220, totalLiabilities: 1380, longTermDebt: 380, bookValuePerShare: 12200 },
    cashflow: { operatingCashFlow: 280, investingCashFlow: -100, financingCashFlow: -60, freeCashFlow: 180 },
  });
  return [latest, prev];
}

describe("financial performance & health from real company figures", () => {
  it("builds a non-empty chart (quarters>0) from real financials", () => {
    const qs = twoQuarters();
    const health = evaluateHealthDetail("TEST", qs);
    const chart = buildFundamentalChart("TEST", qs, health);
    expect(chart.quarters.length).toBe(2);
    expect(chart.quarters[0].revenue).toBeGreaterThan(0);
    expect(chart.quarters[0].netMarginPct).toBeGreaterThan(0);
    expect(chart.comparisons.length).toBeGreaterThan(0);
    expect(Number.isFinite(chart.quarters[0].roePct)).toBe(true);
  });

  it("computes a meaningful health score (not 0) from healthy figures", () => {
    const qs = twoQuarters();
    const detail = evaluateHealthDetail("TEST", qs);
    expect(detail.overall).toBeGreaterThan(0);
    expect(detail.groups.length).toBe(6);
    expect(["A", "B", "C", "D", "E"]).toContain(detail.rating);
    expect(detail.asOfPeriod).toBe("Q4/2025");
    // Healthy company → likely C+; assert we never return all-null indicators.
    const scored = detail.groups.flatMap((g) => g.indicators).filter((i) => i.score != null);
    expect(scored.length).toBeGreaterThan(3);
  });

  it("health gauge payload is non-null when data exists", () => {
    const qs = twoQuarters();
    const health = evaluateHealthDetail("TEST", qs);
    const chart = buildFundamentalChart("TEST", qs, health);
    expect(chart.health).not.toBeNull();
    expect(chart.health!.overall).toBeGreaterThan(0);
    expect(chart.health!.gauge.length).toBe(6);
  });
});

describe("toFinancialQuarter (bare connector quarter → canonical shape)", () => {
  it("maps income/balance/cashflow and derives free cash flow", () => {
    const mapped = toFinancialQuarter({
      period: "Q2/2025",
      fiscalYear: 2025,
      income: { revenue: 1000, netIncome: 120 },
      balance: { totalAssets: 2000, equity: 900, totalLiabilities: 1100, bookValuePerShare: 9000 },
      cashflow: { operatingCashFlow: 140, investingCashFlow: -50, freeCashFlow: 90 },
    });
    expect(mapped).not.toBeNull();
    expect(mapped!.period).toBe("Q2/2025");
    expect(mapped!.quarter).toBe(2);
    expect(mapped!.income.revenue).toBe(1000);
    expect(mapped!.balance.totalAssets).toBe(2000);
    // FCF = OCF + investingCashFlow when both present.
    expect(mapped!.cashflow.freeCashFlow).toBe(90);
  });

  it("maps a full-year period to quarter 0 (not a quarterly number)", () => {
    const mapped = toFinancialQuarter({ period: "FY/2024", fiscalYear: 2024, income: { revenue: 4000 }, balance: { totalAssets: 8000 }, cashflow: {} });
    expect(mapped).not.toBeNull();
    expect(mapped!.quarter).toBe(0);
    expect(mapped!.period).toBe("FY/2024");
  });
});
