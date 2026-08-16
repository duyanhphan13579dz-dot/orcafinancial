/**
 * Prepares a chart-ready payload for the Fundamental Analyst visual tab.
 * All series are aligned by quarter and annotated with Vietnamese period labels.
 * Industry benchmarks are included so the UI can render comparison overlays.
 */

import { getBenchmarkForSymbol } from "@/lib/industry-benchmarks";
import type { FinancialQuarter } from "@/lib/financial-statements";
import { formatPeriodFromComposite, type PeriodLabels } from "@/lib/format";
import type { HealthDetail } from "@/lib/financial-health-detail";

export interface QuarterChartPoint extends PeriodLabels {
  fiscalYear: number;
  quarter: number;
  revenue: number;
  grossProfit: number;
  ebitda: number;
  netIncome: number;
  eps: number;
  bookValuePerShare: number;
  operatingCashFlow: number;
  freeCashFlow: number;
  roePct: number;
  roaPct: number;
  grossMarginPct: number;
  netMarginPct: number;
  ebitdaMarginPct: number;
  debtEquity: number;
}

export interface IndustryBenchmark {
  sector: string;
  industry: string;
  roePct: number;
  roaPct: number;
  netMarginPct: number;
  grossMarginPct: number;
  ebitdaMarginPct: number;
  debtEquity: number;
  assetTurnover: number;
}

export interface FundamentalChart {
  symbol: string;
  quarters: QuarterChartPoint[];
  industry: IndustryBenchmark;
  health: {
    overall: number;
    rating: string;
    gauge: Array<{ name: string; score: number }>;
  } | null;
  comparisons: Array<{ metric: string; label: string; company: number; industry: number; unit: string }>;
}

export function buildFundamentalChart(
  symbol: string,
  qs: FinancialQuarter[],
  health?: HealthDetail | null,
): FundamentalChart {
  const bench = getBenchmarkForSymbol(symbol);

  const quarters: QuarterChartPoint[] = qs.map((q) => {
    const inc = q.income;
    const bal = q.balance;
    const cf = q.cashflow;
    const roe = bal.equity > 0 ? (inc.netIncome * 4) / bal.equity * 100 : 0;
    const roa = bal.totalAssets > 0 ? (inc.netIncome * 4) / bal.totalAssets * 100 : 0;
    const gm = inc.revenue > 0 ? (inc.grossProfit / inc.revenue) * 100 : 0;
    const nm = inc.revenue > 0 ? (inc.netIncome / inc.revenue) * 100 : 0;
    const em = inc.revenue > 0 ? (inc.ebitda / inc.revenue) * 100 : 0;
    const de = bal.equity > 0 ? bal.totalLiabilities / bal.equity : 0;
    const labels = formatPeriodFromComposite(q.period);
    return {
      ...labels,
      fiscalYear: q.fiscalYear,
      quarter: q.quarter,
      revenue: inc.revenue,
      grossProfit: inc.grossProfit,
      ebitda: inc.ebitda,
      netIncome: inc.netIncome,
      eps: inc.eps,
      bookValuePerShare: bal.bookValuePerShare,
      operatingCashFlow: cf.operatingCashFlow,
      freeCashFlow: cf.freeCashFlow,
      roePct: Number(roe.toFixed(2)),
      roaPct: Number(roa.toFixed(2)),
      grossMarginPct: Number(gm.toFixed(2)),
      netMarginPct: Number(nm.toFixed(2)),
      ebitdaMarginPct: Number(em.toFixed(2)),
      debtEquity: Number(de.toFixed(2)),
    };
  });

  // Industry benchmark expressed in the same units for direct overlay.
  // ROE/ROA from benchmark: we approximate ROE by netMargin × assetTurnover × equityMultiplier.
  const equityMultiplier = 1 / (1 - bench.leverage);
  const benchRoe = bench.netMargin * bench.assetTurnover * equityMultiplier * 100;
  const benchRoa = bench.netMargin * bench.assetTurnover * 100;

  const industry: IndustryBenchmark = {
    sector: bench.sector,
    industry: bench.industry,
    roePct: Number(benchRoe.toFixed(2)),
    roaPct: Number(benchRoa.toFixed(2)),
    netMarginPct: Number((bench.netMargin * 100).toFixed(2)),
    grossMarginPct: Number((bench.grossMargin * 100).toFixed(2)),
    ebitdaMarginPct: Number((bench.operatingMargin * 100 + 4).toFixed(2)), // EBITDA ≈ OPM + D&A
    debtEquity: Number((bench.leverage / (1 - bench.leverage)).toFixed(2)),
    assetTurnover: bench.assetTurnover,
  };

  const latest = quarters[quarters.length - 1];
  const comparisons = latest
    ? [
        { metric: "roe", label: "ROE", company: latest.roePct, industry: industry.roePct, unit: "%" },
        { metric: "roa", label: "ROA", company: latest.roaPct, industry: industry.roaPct, unit: "%" },
        { metric: "netMargin", label: "Biên LN ròng", company: latest.netMarginPct, industry: industry.netMarginPct, unit: "%" },
        { metric: "grossMargin", label: "Biên gộp", company: latest.grossMarginPct, industry: industry.grossMarginPct, unit: "%" },
        { metric: "ebitdaMargin", label: "Biên EBITDA", company: latest.ebitdaMarginPct, industry: industry.ebitdaMarginPct, unit: "%" },
        { metric: "de", label: "Nợ/VCSH", company: latest.debtEquity, industry: industry.debtEquity, unit: "x" },
      ]
    : [];

  return {
    symbol,
    quarters,
    industry,
    health: health
      ? {
          overall: health.overall,
          rating: health.rating,
          gauge: health.groups.map((g) => ({ name: g.label, score: g.score })),
        }
      : null,
    comparisons,
  };
}
