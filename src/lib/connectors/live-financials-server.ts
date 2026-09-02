/**
 * Server-side live financial statement loader.
 *
 * Mirrors the browser `loadLiveFinancialData`, but runs on the Next.js server
 * (route handlers). It is used as a fallback when the DB has no verified rows
 * yet, so the /fundamental-chart and /financial-health-detail routes still
 * return real, published company data whenever the server has outbound
 * internet (Vercel production). In the local sandbox the host has no outbound
 * internet, so server calls resolve to empty and the browser connector takes
 * over — the same split the app already uses for VNDirect/Vietstock.
 *
 * Priority: vnstock (VCI → KBS) → VNDirect → Vietstock.
 */

import { fetchVnstockFinancialStatements } from "@/lib/connectors/vnstock-financials";
import { fetchVndirectFinancialStatements } from "@/lib/connectors/vndirect-financials";
import { fetchVietstockFinancialStatements } from "@/lib/connectors/vietstock-financials";
import type { FinancialQuarter } from "@/lib/financial-statements";

interface QuarterLike {
  period: string;
  fiscalYear: number;
  income: Record<string, number>;
  balance: Record<string, number>;
  cashflow: Record<string, number>;
}

export interface LiveQuarterlyFinancials {
  symbol: string;
  quarters: FinancialQuarter[];
  source: string | null;
  providerBacked: boolean;
  warnings: string[];
}

/** Map a bare quarter (income/balance/cashflow maps) into the canonical shape. */
export function toFinancialQuarter(q: QuarterLike): FinancialQuarter | null {
  const m = /^Q([1-4])\/(\d{4})$/.exec(q.period);
  const quarter = m ? Number(m[1]) : 0;
  const inc = q.income ?? {};
  const bal = q.balance ?? {};
  const cf = q.cashflow ?? {};
  const ocf = cf.operatingCashFlow ?? null;
  const inv = cf.investingCashFlow ?? null;
  const capex = cf.capex ?? null;
  const fcf =
    ocf != null && inv != null ? ocf + inv : ocf != null && capex != null ? ocf - capex : null;
  return {
    period: q.period,
    quarter,
    fiscalYear: q.fiscalYear,
    income: {
      revenue: inc.revenue ?? 0,
      costOfGoodsSold: inc.costOfGoodsSold ?? 0,
      grossProfit: inc.grossProfit ?? 0,
      operatingExpenses: inc.operatingExpenses ?? 0,
      operatingIncome: inc.operatingIncome ?? 0,
      interestExpense: inc.interestExpense ?? 0,
      otherIncome: inc.otherIncome ?? 0,
      pretaxIncome: inc.pretaxIncome ?? 0,
      incomeTax: inc.incomeTax ?? 0,
      netIncome: inc.netIncome ?? 0,
      ebitda: inc.ebitda ?? 0,
      depreciation: inc.depreciation ?? 0,
      eps: inc.eps ?? 0,
      sharesOutstanding: 0,
    },
    balance: {
      cashAndEquivalents: bal.cashAndEquivalents ?? 0,
      shortTermInvestments: bal.shortTermInvestments ?? 0,
      receivables: bal.receivables ?? 0,
      inventory: bal.inventory ?? 0,
      currentAssets: bal.currentAssets ?? 0,
      fixedAssets: bal.fixedAssets ?? 0,
      longTermInvestments: bal.longTermInvestments ?? 0,
      totalAssets: bal.totalAssets ?? 0,
      currentLiabilities: bal.currentLiabilities ?? 0,
      shortTermDebt: bal.shortTermDebt,
      debtDueWithin12m: bal.debtDueWithin12m,
      longTermDebt: bal.longTermDebt ?? 0,
      totalLiabilities: bal.totalLiabilities ?? 0,
      equity: bal.equity ?? 0,
      retainedEarnings: bal.retainedEarnings ?? 0,
      totalLiabilitiesEquity: bal.totalLiabilitiesEquity ?? 0,
      bookValuePerShare: bal.bookValuePerShare ?? 0,
    },
    cashflow: {
      netIncome: cf.netIncome ?? 0,
      depreciation: cf.depreciation ?? 0,
      changeWorkingCapital: 0,
      operatingCashFlow: ocf ?? 0,
      capex: capex ?? 0,
      investingCashFlow: inv ?? 0,
      debtIssuance: 0,
      dividendsPaid: cf.dividendsPaid ?? 0,
      financingCashFlow: cf.financingCashFlow ?? 0,
      netChangeCash: cf.netChangeCash ?? 0,
      freeCashFlow: fcf ?? 0,
    },
  };
}

/**
 * Fetch live financials server-side, trying vnstock → VNDirect → Vietstock.
 * Returns providerBacked=true only when at least one quarter has real figures.
 */
export async function loadLiveQuarterlyFinancials(
  symbol: string,
  limit = 8,
): Promise<LiveQuarterlyFinancials> {
  const sym = symbol.toUpperCase();
  const warnings: string[] = [];

  // vnstock (VCI → KBS) first — the preferred provider (free tier).
  try {
    const result = await fetchVnstockFinancialStatements(sym, limit);
    warnings.push(...result.warnings);
    const quarters = result.quarters
      .map(toFinancialQuarter)
      .filter((q): q is FinancialQuarter => Boolean(q && (q.income.revenue > 0 || q.income.netIncome !== 0 || q.balance.totalAssets > 0)))
      .slice(0, limit);
    if (quarters.length > 0) {
      const source = result.source === "vnstock-kbs" ? "vnstock-kbs" : "vnstock-vci";
      return { symbol: sym, quarters, source, providerBacked: true, warnings };
    }
  } catch (e) {
    warnings.push(`vnstock: ${e instanceof Error ? e.message : String(e)}`);
  }

  // VNDirect (doanh nghiệp)
  try {
    const result = await fetchVndirectFinancialStatements(sym, limit);
    warnings.push(...result.warnings);
    const quarters = result.quarters
      .map(toFinancialQuarter)
      .filter((q): q is FinancialQuarter => Boolean(q && (q.income.revenue > 0 || q.balance.totalAssets > 0)))
      .slice(0, limit);
    if (quarters.length > 0) {
      return { symbol: sym, quarters, source: "vndirect", providerBacked: true, warnings };
    }
  } catch (e) {
    warnings.push(`vndirect: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Vietstock
  try {
    const result = await fetchVietstockFinancialStatements(sym, limit);
    warnings.push(...result.warnings);
    const quarters = result.quarters
      .map(toFinancialQuarter)
      .filter((q): q is FinancialQuarter => Boolean(q && (q.income.revenue > 0 || q.balance.totalAssets > 0)))
      .slice(0, limit);
    if (quarters.length > 0) {
      return { symbol: sym, quarters, source: "vietstock", providerBacked: true, warnings };
    }
  } catch (e) {
    warnings.push(`vietstock: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { symbol: sym, quarters: [], source: null, providerBacked: false, warnings };
}
