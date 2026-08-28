import { describe, expect, it } from "vitest";
import { validateFinancialLlmOutput } from "@/lib/financial-llm-quality";

const facts = [
  { statementType: "income", period: "Q2/2026", fiscalYear: 2026, data: { revenue: 100, grossProfit: 40, ebitda: 25, netIncome: 18 } },
  { statementType: "balance", period: "Q2/2026", fiscalYear: 2026, data: { totalAssets: 200, totalLiabilities: 120, equity: 80, cash: 30 } },
  { statementType: "cashflow", period: "Q2/2026", fiscalYear: 2026, data: { operatingCashFlow: 22, investingCashFlow: -10, financingCashFlow: -5, freeCashFlow: 12 } },
] as const;

describe("financial LLM grounding quality gate", () => {
  it("accepts output whose numbers and periods match normalized facts", () => {
    const result = validateFinancialLlmOutput("financials", {
      incomeStatement: [{ period: "Q2/2026", revenue: 100, grossProfit: 40, ebitda: 25, netIncome: 18 }],
      balanceSheet: [{ period: "Q2/2026", totalAssets: 200, totalLiabilities: 120, equity: 80, cash: 30 }],
      cashFlowStatement: [{ period: "Q2/2026", operatingCashFlow: 22, investingCashFlow: -10, financingCashFlow: -5, freeCashFlow: 12 }],
      notes: ["Số liệu lấy từ kỳ Q2/2026."],
    }, [...facts]);
    expect(result.valid).toBe(true);
    expect(result.score).toBe(100);
  });

  it("rejects a hallucinated number even when the JSON shape is valid", () => {
    const result = validateFinancialLlmOutput("financials", {
      incomeStatement: [{ period: "Q2/2026", revenue: 999, grossProfit: 40, ebitda: 25, netIncome: 18 }],
      balanceSheet: [{ period: "Q2/2026", totalAssets: 200, totalLiabilities: 120, equity: 80, cash: 30 }],
      cashFlowStatement: [{ period: "Q2/2026", operatingCashFlow: 22, investingCashFlow: -10, financingCashFlow: -5, freeCashFlow: 12 }],
      notes: [],
    }, [...facts]);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "ungrounded_number", path: "incomeStatement[0].revenue" }));
  });

  it("rejects an unknown period and balance-sheet mismatch", () => {
    const result = validateFinancialLlmOutput("financials", {
      incomeStatement: [{ period: "Q3/2026", revenue: 100, grossProfit: 40, ebitda: 25, netIncome: 18 }],
      balanceSheet: [{ period: "Q2/2026", totalAssets: 210, totalLiabilities: 120, equity: 80, cash: 30 }],
      cashFlowStatement: [{ period: "Q2/2026", operatingCashFlow: 22, investingCashFlow: -10, financingCashFlow: -5, freeCashFlow: 12 }],
      notes: [],
    }, [...facts]);
    expect(result.valid).toBe(false);
    expect(result.issues.some((item) => item.code === "unknown_period")).toBe(true);
    expect(result.issues.some((item) => item.code === "ungrounded_number")).toBe(true);
    expect(result.issues.some((item) => item.code === "balance_mismatch")).toBe(true);
  });

  it("grounds basic charts against the income facts", () => {
    const result = validateFinancialLlmOutput("basic", {
      overview: "Doanh thu Q2/2026 là 100.",
      positives: ["Biên lợi nhuận dương."],
      risks: ["Cần theo dõi dòng tiền."],
      charts: {
        revenue: [{ period: "Q2/2026", value: 100 }],
        ebitda: [{ period: "Q2/2026", value: 25 }],
        netIncome: [{ period: "Q2/2026", value: 18 }],
      },
    }, [...facts]);
    expect(result.valid).toBe(true);
  });
});
