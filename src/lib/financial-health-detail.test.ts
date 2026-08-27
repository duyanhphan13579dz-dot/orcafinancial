import { describe, expect, it } from "vitest";
import { evaluateHealthDetail } from "./financial-health-detail";
import { calculateDuPont } from "./fundamental";
import { buildFundamentalChart } from "./fundamental-chart";
import { getLatestCompletedQuarter } from "./financial-statements";
import type { FinancialQuarter } from "./financial-statements";

function quarter(): FinancialQuarter {
  return {
    period: "Q4/2025",
    quarter: 4,
    fiscalYear: 2025,
    income: {
      revenue: 1000,
      costOfGoodsSold: 600,
      grossProfit: 400,
      operatingExpenses: 200,
      operatingIncome: 200,
      interestExpense: 20,
      otherIncome: 0,
      pretaxIncome: 180,
      incomeTax: 36,
      netIncome: 144,
      ebitda: 240,
      depreciation: 40,
      eps: 1.44,
      sharesOutstanding: 100,
    },
    balance: {
      cashAndEquivalents: 250,
      shortTermInvestments: 50,
      receivables: 200,
      inventory: 150,
      currentAssets: 600,
      fixedAssets: 800,
      longTermInvestments: 50,
      totalAssets: 1400,
      currentLiabilities: 300,
      shortTermDebt: 50,
      debtDueWithin12m: 50,
      debtMaturityBuckets: { within12m: 50, oneToThreeYears: 250, overThreeYears: 100 },
      longTermDebt: 350,
      totalLiabilities: 650,
      equity: 750,
      retainedEarnings: 500,
      totalLiabilitiesEquity: 1400,
      bookValuePerShare: 7.5,
    },
    cashflow: {
      netIncome: 144,
      depreciation: 40,
      changeWorkingCapital: 10,
      operatingCashFlow: 174,
      capex: 60,
      investingCashFlow: -60,
      debtIssuance: 0,
      dividendsPaid: 72,
      financingCashFlow: -72,
      netChangeCash: 42,
      freeCashFlow: 114,
    },
  };
}

describe("financial health scoring invariants", () => {
  it("keeps the six group weights at 100% and reconstructs overall score", () => {
    const health = evaluateHealthDetail("TEST", [quarter(), { ...quarter(), period: "Q3/2025", quarter: 3 }]);
    const weightSum = health.groups.reduce((sum, group) => sum + group.weight, 0);
    const weightedSum = health.groups.reduce((sum, group) => sum + group.weighted, 0);
    expect(weightSum).toBeCloseTo(1, 10);
    expect(weightedSum).toBeCloseTo(health.overall, 0);
    expect(health.groups.map((group) => group.key)).toEqual(["liquidity", "leverage", "efficiency", "profitability", "growth", "cashflow"]);
  });

  it("calculates DuPont ROE as margin times turnover times equity multiplier", () => {
    const result = calculateDuPont(12, 1.5, 2.2);
    expect(result.roe).toBe(39.6);
    expect(result.description).toContain("12.0%");
    expect(result.description).toContain("39.6%");
  });

  it("uses actual available indicators in the health score instead of neutral 50 fallbacks", () => {
    const health = evaluateHealthDetail("TEST", [quarter()]);
    const cashflow = health.groups.find((group) => group.key === "cashflow");
    expect(cashflow?.indicators.find((indicator) => indicator.key === "cfoToNi")?.score).not.toBeNull();
    expect(cashflow?.indicators.find((indicator) => indicator.key === "workingCapitalIntensity")?.score).not.toBeNull();
  });

  it("does not create an in-progress reporting quarter", () => {
    expect(getLatestCompletedQuarter(new Date(2026, 7, 27))).toEqual({ fiscalYear: 2026, quarter: 2 });
    expect(getLatestCompletedQuarter(new Date(2026, 9, 30))).toEqual({ fiscalYear: 2026, quarter: 3 });
    expect(getLatestCompletedQuarter(new Date(2026, 0, 15))).toEqual({ fiscalYear: 2025, quarter: 4 });
  });

  it("uses the newest-first quarter for Basic comparison cards", () => {
    const newest = quarter();
    const older = { ...quarter(), period: "Q3/2025", quarter: 3, income: { ...quarter().income, netIncome: 40 } };
    const chart = buildFundamentalChart("VNM", [newest, older]);
    const roe = chart.comparisons.find((comparison) => comparison.metric === "roe");
    expect(roe?.company).toBe(chart.quarters[0]?.roePct);
    expect(roe?.company).not.toBe(chart.quarters[1]?.roePct);
  });

  it("maps each Basic chart series from the matching quarter statement", () => {
    const newest = quarter();
    const older = {
      ...quarter(),
      period: "Q3/2025",
      quarter: 3,
      income: {
        ...quarter().income,
        revenue: 820,
        ebitda: 155,
        netIncome: 91,
      },
    };
    const chart = buildFundamentalChart("VNM", [newest, older]);

    expect(chart.quarters.map((row) => row.revenue)).toEqual([1000, 820]);
    expect(chart.quarters.map((row) => row.ebitda)).toEqual([240, 155]);
    expect(chart.quarters.map((row) => row.netIncome)).toEqual([144, 91]);
    expect(new Set(chart.quarters.map((row) => row.shortTag)).size).toBe(2);
  });
});
