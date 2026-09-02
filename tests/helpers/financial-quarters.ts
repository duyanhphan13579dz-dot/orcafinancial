/**
 * Bộ dữ liệu BCTC dựng tay dùng chung cho các test của engine fundamental.
 *
 * Đặc điểm cố ý:
 *  • Có TÍNH MÙA VỤ (Q4 đỉnh, Q3 trũng) — nếu doanh thu tăng đều đều thì
 *    detectStatementBasis sẽ phân loại nhầm số riêng quý thành luỹ kế.
 *  • Đủ 8 quý (2 năm) để có LTM sum-4q và LTM kỳ trước cho tăng trưởng YoY.
 *  • Mọi trường được suy ra nhất quán từ doanh thu (gross → EBITDA → EBIT →
 *    LNTT → LNST) để các test có thể kiểm chứng công thức bằng số học.
 */
import type { FinancialQuarter } from "@/lib/financial-statements";

export const FIXTURE_SHARES_MILLIONS = 350;

export function fixtureQuarter(year: number, q: number, revenue: number): FinancialQuarter {
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
      eps: Number((netIncome / FIXTURE_SHARES_MILLIONS).toFixed(3)),
      sharesOutstanding: FIXTURE_SHARES_MILLIONS,
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
      bookValuePerShare: Number((equity / FIXTURE_SHARES_MILLIONS).toFixed(3)),
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

/** 8 quý có tính mùa vụ, sắp xếp newest-first như dữ liệu thật trả về. */
export function fixtureQuarters(): FinancialQuarter[] {
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
  return rows.map(([y, q, r]) => fixtureQuarter(y, q, r)).reverse();
}
