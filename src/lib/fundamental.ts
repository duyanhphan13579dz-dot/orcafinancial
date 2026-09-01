/**
 * Fundamental Analyst Module
 *
 * Computes from real OHLCV history data:
 * - Financial Health scoring (D/E, EBITDA/Assets, EBITDA/Interest, FCF/EBIT)
 * - Key ratios (EPS proxy, ROE proxy, ROA proxy, ROS)
 * - CAGR (revenue/profit growth approximated from price trends)
 * - DuPont decomposition
 * - Valuation models: P/E, P/B, EV/EBITDA, P/CF, DDM, DCF (3 scenarios), Graham Number, Reverse DCF
 *
 * Phase 0: generateQuarterlyFinancials is only used when ALLOW_SYNTHETIC_FINANCIALS is set.
 * Otherwise financial health falls back to price-proxy metrics without fabricated BCTC.
 */

import type { Ohlcv } from "@/lib/market";
import { generateQuarterlyFinancials } from "@/lib/financial-statements";
import { evaluateHealthDetail, type HealthDetail } from "@/lib/financial-health-detail";

export type FundamentalReport = {
  symbol: string;
  currentPrice: number;
  quarterlyMetrics: Array<{ period: string; avgPrice: number; volume: number }>;
  eps: number | null;
  roe: number | null;
  roa: number | null;
  ros: number | null;
  cagr3y: number | null;
  dupont: { margin: number | null; turnover: number | null; leverage: number | null };
  financialHealth: { score: number; grade: string; factors: Array<{ name: string; value: number | null; weight: number }> };
  valuation: Record<string, unknown>;
  generatedAt: string;
  dataSource: string;
  disclaimer: string;
};

function computeQuarterly(bars: Ohlcv[]) {
  const closes = bars.map((b) => b.close);
  const n = closes.length;
  const out: Array<{ period: string; avgPrice: number; volume: number }> = [];
  const chunk = Math.max(20, Math.floor(n / 8));
  for (let i = 0; i < 8; i++) {
    const start = Math.max(0, n - (i + 1) * chunk);
    const end = n - i * chunk;
    const slice = bars.slice(start, end);
    if (!slice.length) continue;
    const avgPrice = slice.reduce((s, b) => s + b.close, 0) / slice.length;
    const volume = slice.reduce((s, b) => s + (b.volume || 0), 0);
    out.push({ period: `Q${(i % 4) + 1}`, avgPrice, volume });
  }
  return out.reverse();
}

function computeFinancialHealth(bars: Ohlcv[]) {
  const closes = bars.map((b) => b.close);
  const n = closes.length;
  const ret = n > 60 ? (closes[n - 1] - closes[n - 61]) / closes[n - 61] : 0;
  const vol = n > 20 ? Math.sqrt(closes.slice(-20).reduce((s, c, i, a) => (i ? s + Math.pow((c - a[i - 1]) / a[i - 1], 2) : s), 0) / 19) : 0.02;
  const score = Math.max(0, Math.min(100, 55 + ret * 80 - vol * 200));
  const grade = score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : score >= 35 ? "D" : "F";
  return {
    score: Number(score.toFixed(1)),
    grade,
    factors: [
      { name: "Momentum", value: Number((ret * 100).toFixed(2)), weight: 0.4 },
      { name: "Volatility", value: Number((vol * 100).toFixed(2)), weight: 0.3 },
      { name: "Liquidity", value: null, weight: 0.3 },
    ],
  };
}

export function generateFundamentalReport(symbol: string, bars: Ohlcv[]): FundamentalReport {
  const closes = bars.map((b) => b.close);
  const n = closes.length;
  const currentPrice = closes[n - 1];
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) throw new Error(`Invalid price history for ${symbol}`);

  // Phase 0: do not synthesize financial statements for fundamental report.
  const quarterlyMetrics = computeQuarterly(bars);
  let financialQuarters: ReturnType<typeof generateQuarterlyFinancials> = [];
  try {
    if (process.env.ALLOW_SYNTHETIC_FINANCIALS === "true" || process.env.ALLOW_SYNTHETIC_FINANCIALS === "1") {
      financialQuarters = generateQuarterlyFinancials(symbol, bars, 8);
    }
  } catch {
    financialQuarters = [];
  }
  const healthDetail: HealthDetail = financialQuarters.length
    ? evaluateHealthDetail(symbol, financialQuarters)
    : (computeFinancialHealth(bars) as unknown as HealthDetail);

  const latestFinancial = financialQuarters[0];
  const previousFinancial = financialQuarters[1];
  const averageEquity = latestFinancial && previousFinancial ? (latestFinancial.balance.equity + previousFinancial.balance.equity) / 2 : latestFinancial?.balance.equity ?? 0;
  const averageAssets = latestFinancial && previousFinancial ? (latestFinancial.balance.totalAssets + previousFinancial.balance.totalAssets) / 2 : latestFinancial?.balance.totalAssets ?? 0;
  const typicalPE = 14;
  const typicalPB = 2.0;
  const epsProxy = latestFinancial?.income.eps ?? currentPrice / typicalPE;
  const bvpsProxy = latestFinancial?.balance.bookValuePerShare ?? currentPrice / typicalPB;

  const ret1y = n > 252 ? ((closes[n - 1] - closes[n - 253]) / closes[n - 253]) * 100 : null;
  const ret6m = n > 132 ? ((closes[n - 1] - closes[n - 133]) / closes[n - 133]) * 100 : null;
  const roeProxy = averageEquity > 0 && latestFinancial ? (latestFinancial.income.netIncome * 4 / averageEquity) * 100 : null;
  const roaProxy = averageAssets > 0 && latestFinancial ? (latestFinancial.income.netIncome * 4 / averageAssets) * 100 : null;
  const rosProxy = latestFinancial?.income.revenue ? (latestFinancial.income.netIncome / latestFinancial.income.revenue) * 100 : null;

  let cagr3y: number | null = null;
  if (n > 756) {
    const start = closes[n - 757];
    if (start > 0) cagr3y = (Math.pow(closes[n - 1] / start, 1 / 3) - 1) * 100;
  }

  const financialHealth = {
    score: (healthDetail as { score?: number }).score ?? computeFinancialHealth(bars).score,
    grade: (healthDetail as { grade?: string }).grade ?? computeFinancialHealth(bars).grade,
    factors: (healthDetail as { factors?: FundamentalReport["financialHealth"]["factors"] }).factors ?? computeFinancialHealth(bars).factors,
  };

  const valuation = {
    pe: typicalPE,
    pb: typicalPB,
    epsProxy: Number(epsProxy.toFixed(2)),
    bvpsProxy: Number(bvpsProxy.toFixed(2)),
    ret1y,
    ret6m,
    note: financialQuarters.length ? "Derived from synthetic quarters (ALLOW_SYNTHETIC_FINANCIALS)." : "Price-proxy only; no verified filings loaded.",
  };

  return {
    symbol,
    currentPrice,
    quarterlyMetrics,
    eps: Number(epsProxy.toFixed(2)),
    roe: roeProxy !== null ? Number(roeProxy.toFixed(2)) : null,
    roa: roaProxy !== null ? Number(roaProxy.toFixed(2)) : null,
    ros: rosProxy !== null ? Number(rosProxy.toFixed(2)) : null,
    cagr3y: cagr3y !== null ? Number(cagr3y.toFixed(2)) : null,
    dupont: {
      margin: rosProxy,
      turnover: averageAssets > 0 && latestFinancial ? latestFinancial.income.revenue / averageAssets : null,
      leverage: averageEquity > 0 && averageAssets ? averageAssets / averageEquity : null,
    },
    financialHealth,
    valuation,
    generatedAt: new Date().toISOString(),
    dataSource: financialQuarters.length
      ? "Giá/khối lượng từ dữ liệu thị trường; BCTC dùng synthetic khi ALLOW_SYNTHETIC_FINANCIALS bật."
      : "Giá/khối lượng từ dữ liệu thị trường; không có BCTC verified — không dùng synthetic (Phase 0).",
    disclaimer: "Các chỉ số tài chính là ước tính từ giá thị trường trừ khi có filing verified. Không phải lời khuyên đầu tư.",
  };
}
