/**
 * Financial Statement Synthesis Engine
 *
 * Generates internally-consistent quarterly income statements, balance sheets,
 * and cashflow statements calibrated to Vietnamese sector benchmarks and
 * anchored to real observed market data (current price, volume history, returns).
 *
 * All 3 statements are generated together to ensure accounting consistency:
 * - Net income flows from income -> retained earnings on balance sheet
 * - Capex affects PP&E and cashflow from investing
 * - Depreciation is derived from fixed assets
 * - Interest expense is based on debt level and typical rate
 * - FCF = OCF - capex
 *
 * Values are in billions of VND unless stated otherwise.
 * EPS is in VND per share (thousand VND for typical VN price levels).
 */

import type { Ohlcv } from "@/lib/connectors/core";
import { getBenchmarkForSymbol, type SectorBenchmark } from "@/lib/industry-benchmarks";

export interface IncomeData {
  revenue: number;
  costOfGoodsSold: number;
  grossProfit: number;
  operatingExpenses: number;
  operatingIncome: number;
  interestExpense: number;
  otherIncome: number;
  pretaxIncome: number;
  incomeTax: number;
  netIncome: number;
  ebitda: number;
  depreciation: number;
  eps: number;            // VND per share (thousands)
  sharesOutstanding: number; // millions
}

export interface BalanceData {
  cashAndEquivalents: number;
  shortTermInvestments: number;
  receivables: number;
  inventory: number;
  currentAssets: number;
  fixedAssets: number;
  longTermInvestments: number;
  totalAssets: number;
  currentLiabilities: number;
  longTermDebt: number;
  totalLiabilities: number;
  equity: number;
  retainedEarnings: number;
  totalLiabilitiesEquity: number;
  bookValuePerShare: number; // thousands VND
}

export interface CashflowData {
  netIncome: number;
  depreciation: number;
  changeWorkingCapital: number;
  operatingCashFlow: number;
  capex: number;
  investingCashFlow: number;
  debtIssuance: number;
  dividendsPaid: number;
  financingCashFlow: number;
  netChangeCash: number;
  freeCashFlow: number;
}

export interface FinancialQuarter {
  period: string;          // e.g. "Q1/2025"
  quarter: number;         // 1-4
  fiscalYear: number;
  income: IncomeData;
  balance: BalanceData;
  cashflow: CashflowData;
}

// Simple deterministic pseudo-random generator seeded by symbol + quarter for reproducibility
function seededRandom(seedStr: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  };
}

function jitter(rand: () => number, base: number, pct = 0.08): number {
  return base * (1 - pct + rand() * pct * 2);
}

/**
 * Build a full sequence of quarterly financials.
 * Uses real price/volume data to anchor scale and revenue trend.
 */
export function generateQuarterlyFinancials(
  symbol: string,
  bars: Ohlcv[],
  numQuarters = 4,
): FinancialQuarter[] {
  const benchmark = getBenchmarkForSymbol(symbol);
  const closes = bars.map((b) => b.close);
  const avgVol = bars.slice(-60).reduce((s, b) => s + b.volume, 0) / Math.min(60, bars.length);
  const lastPrice = closes[closes.length - 1];

  // Estimate shares outstanding and market cap.
  // VN large caps: 1-5 billion shares, mid: 300M-1B, small: 100-300M.
  const rand = seededRandom(`${symbol}-shares`);
  const sharesMillions = Math.round(300 + rand() * 4200); // 300-4500 million shares (0.3B to 4.5B)
  // lastPrice is in thousands of VND (e.g. 59 = 59,000 VND)
  // marketCap_BillionVND = price_kVND * shares_millions (because kVND * M = billions VND)
  const marketCapBillions = lastPrice * sharesMillions;

  // Annual revenue: derived from market cap, typical P/B and asset turnover.
  // For VN: P/B ≈ 1.5-2.5x book value → assets ≈ marketCap / (PB × (1 - leverage))
  const pbRatio = 1.6;
  const equityRatio = 1 - benchmark.leverage;
  const assetsEst = marketCapBillions / (pbRatio * equityRatio);
  const annualRevenue = assetsEst * benchmark.assetTurnover;
  const quarterlyRevenueBase = annualRevenue / 4;

  const quarters: FinancialQuarter[] = [];
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentQuarter = Math.floor(currentMonth / 3) + 1;
  const currentYear = now.getFullYear();

  // Running state for balance sheet continuity across quarters
  let retainedEarningsStart = assetsEst * 0.1 * (0.8 + rand() * 0.4);
  let cash = assetsEst * benchmark.cashPctAssets * (0.8 + rand() * 0.4);
  let fixedAssetsStart = assetsEst * 0.55;
  let accumulatedDebt = assetsEst * benchmark.leverage * 0.75;

  for (let i = 0; i < numQuarters; i++) {
    const qIndex = currentQuarter - i - 1;
    let year = currentYear;
    let q = qIndex + 1;
    if (q < 1) {
      q += 4;
      year -= 1;
    }
    if (q < 1) {
      q += 4;
      year -= 1;
    }

    const qRand = seededRandom(`${symbol}-${year}-Q${q}`);
    // Quarter-over-quarter growth: use real trailing return from bars if available
    const barsPerQ = Math.floor(bars.length / numQuarters);
    const quarterBars = bars.slice(Math.max(0, bars.length - (i + 1) * barsPerQ), bars.length - i * barsPerQ);
    const qReturn = quarterBars.length >= 2
      ? (quarterBars[quarterBars.length - 1].close - quarterBars[0].close) / quarterBars[0].close
      : 0;
    const growthQ = 0.03 + qReturn * 0.3; // price change correlates partially with revenue
    const revenue = quarterlyRevenueBase * (1 + growthQ) * (1 - i * 0.015); // slight fade for older quarters
    const revenueJ = jitter(qRand, revenue, 0.04);

    // ──── INCOME STATEMENT ────
    const grossProfit = revenueJ * jitter(qRand, benchmark.grossMargin, 0.05);
    const cogs = revenueJ - grossProfit;
    const depreciation = fixedAssetsStart * (benchmark.depreciationPctFA / 4);
    const operatingIncome = grossProfit * jitter(qRand, benchmark.operatingMargin / benchmark.grossMargin, 0.08);
    const operatingExpenses = grossProfit - operatingIncome;
    const interestRate = 0.08 / 4; // ~8% annual interest rate
    const interestExpense = accumulatedDebt * interestRate;
    const otherIncome = revenueJ * 0.005 * (qRand() - 0.3);
    const pretaxIncome = operatingIncome - interestExpense + otherIncome;
    const incomeTax = Math.max(0, pretaxIncome * benchmark.effectiveTaxRate);
    const netIncome = pretaxIncome - incomeTax;
    const ebitda = operatingIncome + depreciation;
    // netIncome in billions VND, shares in millions → (10^9) / (10^6) = 10^3 VND per share → thousands VND per share
    const epsThousands = netIncome / sharesMillions;

    // ──── BALANCE SHEET ────
    const currentAssets = revenueJ / 4 * (1 / benchmark.currentRatio < 1.5 ? benchmark.currentRatio : 1) * jitter(qRand, 1, 0.05);
    const fixedAssets = fixedAssetsStart;
    const inventory = (revenueJ / 4) * (benchmark.inventoryDays / 90); // ~90 days/quarter
    const receivables = (revenueJ / 4) * (benchmark.receivableDays / 90);
    const currentAssetsTotal = cash + receivables + inventory + currentAssets * 0.15;
    const totalAssets = currentAssetsTotal + fixedAssets;
    const currentLiabilities = currentAssetsTotal / jitter(qRand, benchmark.currentRatio || 1.2, 0.05);
    const ltDebt = accumulatedDebt;
    const totalLiabilities = currentLiabilities + ltDebt;
    const equityThisQ = totalAssets - totalLiabilities;
    const retainedEarnings = retainedEarningsStart + netIncome * (1 - benchmark.dividendPayout);
    retainedEarningsStart = retainedEarnings;
    // equity in billions, shares in millions → billions / millions = thousands VND per share
    const bvpsThousands = equityThisQ / sharesMillions;

    // ──── CASHFLOW STATEMENT ────
    const depreciationCF = depreciation;
    const changeWC = netIncome * 0.1 * (qRand() - 0.4);
    const operatingCF = netIncome + depreciationCF - changeWC;
    const capex = revenueJ * benchmark.capexToRevenue * jitter(qRand, 1, 0.2);
    const investingCF = -capex + (qRand() - 0.5) * revenueJ * 0.01;
    const dividends = netIncome * benchmark.dividendPayout;
    const debtChange = (ltDebt > 0 ? (qRand() - 0.5) * 50 : 0);
    const financingCF = debtChange - dividends;
    const netChangeCash = operatingCF + investingCF + financingCF;
    cash = Math.max(cash + netChangeCash, 50);
    fixedAssetsStart = fixedAssets - depreciation + capex;
    accumulatedDebt = ltDebt + debtChange;
    const fcf = operatingCF - capex;

    quarters.push({
      period: `Q${q}/${year}`,
      quarter: q,
      fiscalYear: year,
      income: {
        revenue: Math.round(revenueJ),
        costOfGoodsSold: Math.round(cogs),
        grossProfit: Math.round(grossProfit),
        operatingExpenses: Math.round(operatingExpenses),
        operatingIncome: Math.round(operatingIncome),
        interestExpense: Math.round(interestExpense),
        otherIncome: Math.round(otherIncome),
        pretaxIncome: Math.round(pretaxIncome),
        incomeTax: Math.round(incomeTax),
        netIncome: Math.round(netIncome),
        ebitda: Math.round(ebitda),
        depreciation: Math.round(depreciation),
        eps: Number(epsThousands.toFixed(2)),
        sharesOutstanding: sharesMillions,
      },
      balance: {
        cashAndEquivalents: Math.round(cash),
        shortTermInvestments: Math.round(cash * 0.2 * qRand()),
        receivables: Math.round(receivables),
        inventory: Math.round(inventory),
        currentAssets: Math.round(currentAssetsTotal),
        fixedAssets: Math.round(fixedAssets),
        longTermInvestments: Math.round(totalAssets * 0.04 * qRand()),
        totalAssets: Math.round(totalAssets),
        currentLiabilities: Math.round(currentLiabilities),
        longTermDebt: Math.round(ltDebt),
        totalLiabilities: Math.round(totalLiabilities),
        equity: Math.round(equityThisQ),
        retainedEarnings: Math.round(retainedEarnings),
        totalLiabilitiesEquity: Math.round(totalAssets),
        bookValuePerShare: Number(bvpsThousands.toFixed(2)),
      },
      cashflow: {
        netIncome: Math.round(netIncome),
        depreciation: Math.round(depreciationCF),
        changeWorkingCapital: Math.round(changeWC),
        operatingCashFlow: Math.round(operatingCF),
        capex: Math.round(capex),
        investingCashFlow: Math.round(investingCF),
        debtIssuance: Math.round(debtChange),
        dividendsPaid: Math.round(dividends),
        financingCashFlow: Math.round(financingCF),
        netChangeCash: Math.round(netChangeCash),
        freeCashFlow: Math.round(fcf),
      },
    });
  }

  return quarters;
}

// Mapping between type and the shape returned.
export type StatementType = "income" | "balance" | "cashflow";

export function getStatementFields(type: StatementType): string[] {
  switch (type) {
    case "income":
      return ["revenue", "costOfGoodsSold", "grossProfit", "operatingExpenses", "operatingIncome", "interestExpense", "pretaxIncome", "incomeTax", "netIncome", "ebitda", "eps"];
    case "balance":
      return ["cashAndEquivalents", "shortTermInvestments", "receivables", "inventory", "currentAssets", "fixedAssets", "totalAssets", "currentLiabilities", "longTermDebt", "totalLiabilities", "equity", "retainedEarnings", "bookValuePerShare"];
    case "cashflow":
      return ["operatingCashFlow", "capex", "investingCashFlow", "dividendsPaid", "financingCashFlow", "netChangeCash", "freeCashFlow"];
  }
}
