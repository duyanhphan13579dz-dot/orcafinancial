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
 * Since we don't have financial statement data from the providers in this environment,
 * we derive proxy metrics from price/volume data and publicly observable ratios.
 * All values are clearly labeled as estimates with data source documented.
 *
 * Phase 0: generateQuarterlyFinancials only runs when ALLOW_SYNTHETIC_FINANCIALS is set.
 */

import type { Ohlcv } from "@/lib/connectors/core";
import { generateQuarterlyFinancials } from "@/lib/financial-statements";
import { evaluateHealthDetail, type HealthDetail } from "@/lib/financial-health-detail";

export interface FinancialHealthResult {
  overallScore: number;
  rating: string;
  breakdown: {
    liquidity: { score: number; detail: string };
    leverage: { score: number; detail: string };
    profitability: { score: number; detail: string };
    efficiency: { score: number; detail: string };
    growth: { score: number; detail: string };
    cashflow: { score: number; detail: string };
  };
  indicators: {
    debtEquity: number | null;
    ebitdaToAssets: number | null;
    ebitdaToInterest: number | null;
    fcfToEbit: number | null;
    currentRatio: number | null;
    quickRatio: number | null;
    roe: number | null;
    roa: number | null;
    grossMargin: number | null;
    netMargin: number | null;
  };
}

export interface QuarterlyMetrics {
  quarter: string;
  periodEnd: string;
  avgPrice: number;
  avgVolume: number;
  returnPct: number;
  volatilityPct: number;
  sharpeProxy: number;
}

export interface ValuationResult {
  currentPrice: number;
  pe: number | null;
  pb: number | null;
  evEbitda: number | null;
  pcf: number | null;
  ddm: number | null;
  dcf: { base: number; optimistic: number; pessimistic: number } | null;
  grahamNumber: number | null;
  reverseDcfGrowth: number | null;
  intrinsicValueRange: { low: number; mid: number; high: number } | null;
  verdictVi: string;
  targetPriceBridge: { currentPrice: number; dcf: number | null; multiples: number | null; dividend: number | null; blended: number | null };
  sensitivity: Array<{ variable: "wacc" | "terminalGrowth" | "pe"; down: number; base: number; up: number }>;
  methodology: string[];
}

export interface DuPontResult {
  netProfitMargin: number;
  assetTurnover: number;
  equityMultiplier: number;
  roe: number;
  description: string;
}

export function calculateDuPont(netProfitMarginPct: number, assetTurnover: number, equityMultiplier: number): DuPontResult {
  const roe = netProfitMarginPct * assetTurnover * equityMultiplier;
  return {
    netProfitMargin: netProfitMarginPct,
    assetTurnover,
    equityMultiplier,
    roe: Number(roe.toFixed(2)),
    description: `ROE = biên ròng ${netProfitMarginPct.toFixed(1)}% × vòng quay tài sản ${assetTurnover.toFixed(2)} × đòn bẩy vốn chủ ${equityMultiplier.toFixed(2)} = ${roe.toFixed(1)}% — phân tích nguồn sinh lời`,
  };
}

export interface FundamentalReport {
  symbol: string;
  currentPrice: number;
  quarterlyMetrics: QuarterlyMetrics[];
  eps: number | null;
  roe: number | null;
  roa: number | null;
  ros: number | null;
  cagr3y: number | null;
  dupont: DuPontResult | null;
  financialHealth: FinancialHealthResult;
  valuation: ValuationResult;
  generatedAt: string;
  dataSource: string;
  disclaimer: string;
}

function dcfValue(fcf0: number, growthRate: number, wacc: number, terminalGrowth: number, years: number): number {
  let sum = 0;
  for (let i = 1; i <= years; i++) {
    const fcf = fcf0 * Math.pow(1 + growthRate, i);
    sum += fcf / Math.pow(1 + wacc, i);
  }
  const terminalFcf = fcf0 * Math.pow(1 + growthRate, years) * (1 + terminalGrowth);
  const terminalValue = terminalFcf / (wacc - terminalGrowth);
  sum += terminalValue / Math.pow(1 + wacc, years);
  return sum;
}

function dcf3Scenarios(fcf0: number, baseGrowth: number, wacc = 0.1, terminalGrowth = 0.03): { base: number; optimistic: number; pessimistic: number } {
  return {
    base: dcfValue(fcf0, baseGrowth, wacc, terminalGrowth, 5),
    optimistic: dcfValue(fcf0, baseGrowth + 0.05, wacc - 0.01, terminalGrowth + 0.005, 5),
    pessimistic: dcfValue(fcf0, Math.max(0, baseGrowth - 0.05), wacc + 0.02, terminalGrowth - 0.005, 5),
  };
}

function grahamNumber(eps: number, bvps: number): number {
  if (eps <= 0 || bvps <= 0) return 0;
  return Math.sqrt(22.5 * eps * bvps);
}

function reverseDcfGrowth(price: number, fcf0: number, wacc = 0.1, terminalGrowth = 0.03): number {
  let lo = -0.2;
  let hi = 0.5;
  for (let iter = 0; iter < 80; iter++) {
    const mid = (lo + hi) / 2;
    const val = dcfValue(fcf0, mid, wacc, terminalGrowth, 5);
    if (val < price) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function ddmValue(dividend: number, requiredReturn: number, growthRate: number): number {
  if (requiredReturn <= growthRate) return 0;
  return (dividend * (1 + growthRate)) / (requiredReturn - growthRate);
}

function computeQuarterly(bars: Ohlcv[]): QuarterlyMetrics[] {
  if (bars.length < 60) return [];
  const quarters: QuarterlyMetrics[] = [];
  const recent = bars.slice(-252);
  const qSize = Math.floor(recent.length / 4);
  for (let qi = 0; qi < 4; qi++) {
    const start = qi * qSize;
    const end = qi === 3 ? recent.length : (qi + 1) * qSize;
    const slice = recent.slice(start, end);
    if (slice.length < 10) continue;
    const closes = slice.map((b) => b.close);
    const volumes = slice.map((b) => b.volume);
    const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const returnPct = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
    const rets: number[] = [];
    for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
    const volatilityPct = sd * Math.sqrt(252) * 100;
    const sharpeProxy = volatilityPct > 0 ? returnPct / volatilityPct : 0;
    const lastDate = new Date(slice[slice.length - 1].time * 1000);
    quarters.push({
      quarter: `Q${qi + 1}`,
      periodEnd: lastDate.toISOString().slice(0, 10),
      avgPrice: Number(avgPrice.toFixed(2)),
      avgVolume: Number(avgVolume.toFixed(0)),
      returnPct: Number(returnPct.toFixed(2)),
      volatilityPct: Number(volatilityPct.toFixed(2)),
      sharpeProxy: Number(sharpeProxy.toFixed(3)),
    });
  }
  return quarters;
}

function computeFinancialHealth(bars: Ohlcv[]): FinancialHealthResult {
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const n = closes.length;
  const last20 = closes.slice(-20);
  const mean20 = last20.reduce((a, b) => a + b, 0) / last20.length;
  const cv20 = Math.sqrt(last20.reduce((a, b) => a + (b - mean20) ** 2, 0) / last20.length) / mean20;
  const avgVol = volumes.slice(-60).reduce((a, b) => a + b, 0) / Math.min(60, volumes.length);
  const avgVolRecent = volumes.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, volumes.length);
  const volRatio = avgVol > 0 ? avgVolRecent / avgVol : 1;
  const ret1m = n > 22 ? (closes[n - 1] - closes[n - 23]) / closes[n - 23] : 0;
  const ret3m = n > 66 ? (closes[n - 1] - closes[n - 67]) / closes[n - 67] : 0;
  const ret6m = n > 132 ? (closes[n - 1] - closes[n - 133]) / closes[n - 133] : 0;
  const ret1y = n > 252 ? (closes[n - 1] - closes[n - 253]) / closes[n - 253] : 0;
  const liquidityScore = Math.min(100, Math.max(0, 80 - cv20 * 400));
  const leverageScore = Math.min(100, Math.max(0, volRatio > 1.5 ? 40 : volRatio < 0.5 ? 90 : 65));
  const profitScore = Math.min(100, Math.max(0, 50 + ret3m * 200));
  const efficiencyScore = Math.min(100, Math.max(0, 50 + ret6m * 150));
  const growthScore = Math.min(100, Math.max(0, 50 + ret1y * 100));
  const cashflowScore = Math.min(100, Math.max(0, 50 + ret1m * 300));
  const weights = { liquidity: 0.1, leverage: 0.2, profitability: 0.25, efficiency: 0.15, growth: 0.15, cashflow: 0.15 };
  const overall = Math.round(
    liquidityScore * weights.liquidity +
      leverageScore * weights.leverage +
      profitScore * weights.profitability +
      efficiencyScore * weights.efficiency +
      growthScore * weights.growth +
      cashflowScore * weights.cashflow,
  );
  const rating = overall >= 80 ? "A" : overall >= 60 ? "B" : overall >= 40 ? "C" : overall >= 20 ? "D" : "E";
  return {
    overallScore: overall,
    rating,
    breakdown: {
      liquidity: { score: Math.round(liquidityScore), detail: `CV(20d)=${(cv20 * 100).toFixed(1)}% — biến động giá thấp = thanh khoản ổn` },
      leverage: { score: Math.round(leverageScore), detail: `Vol ratio=${volRatio.toFixed(2)}x — khối lượng ${volRatio > 1.3 ? "tăng (áp lực)" : "ổn định"}` },
      profitability: { score: Math.round(profitScore), detail: `Return 3m=${(ret3m * 100).toFixed(1)}%` },
      efficiency: { score: Math.round(efficiencyScore), detail: `Return 6m=${(ret6m * 100).toFixed(1)}%` },
      growth: { score: Math.round(growthScore), detail: `Return 1y=${(ret1y * 100).toFixed(1)}%` },
      cashflow: { score: Math.round(cashflowScore), detail: `Return 1m=${(ret1m * 100).toFixed(1)}% — dòng tiền ngắn hạn` },
    },
    indicators: {
      debtEquity: null,
      ebitdaToAssets: null,
      ebitdaToInterest: null,
      fcfToEbit: null,
      currentRatio: null,
      quickRatio: null,
      roe: ret1y > 0 ? Number((ret1y * 100).toFixed(1)) : null,
      roa: ret6m > 0 ? Number((ret6m * 100 * 0.6).toFixed(1)) : null,
      grossMargin: null,
      netMargin: null,
    },
  };
}

export function generateFundamentalReport(symbol: string, bars: Ohlcv[]): FundamentalReport {
  const closes = bars.map((b) => b.close);
  const n = closes.length;
  const currentPrice = closes[n - 1];
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) throw new Error(`Invalid price history for ${symbol}`);

  // Phase 0: do not synthesize financial statements unless ALLOW_SYNTHETIC_FINANCIALS is set.
  const quarterlyMetrics = computeQuarterly(bars);
  let financialQuarters: ReturnType<typeof generateQuarterlyFinancials> = [];
  try {
    if (process.env.ALLOW_SYNTHETIC_FINANCIALS === "true" || process.env.ALLOW_SYNTHETIC_FINANCIALS === "1") {
      financialQuarters = generateQuarterlyFinancials(symbol, bars, 8);
    }
  } catch {
    financialQuarters = [];
  }
  const healthDetail: HealthDetail | null = financialQuarters.length ? evaluateHealthDetail(symbol, financialQuarters) : null;

  const latestFinancial = financialQuarters[0];
  const previousFinancial = financialQuarters[1];
  const averageEquity =
    latestFinancial && previousFinancial
      ? (latestFinancial.balance.equity + previousFinancial.balance.equity) / 2
      : (latestFinancial?.balance.equity ?? 0);
  const averageAssets =
    latestFinancial && previousFinancial
      ? (latestFinancial.balance.totalAssets + previousFinancial.balance.totalAssets) / 2
      : (latestFinancial?.balance.totalAssets ?? 0);
  const typicalPE = 14;
  const typicalPB = 2.0;
  const epsProxy = latestFinancial?.income.eps ?? currentPrice / typicalPE;
  const bvpsProxy = latestFinancial?.balance.bookValuePerShare ?? currentPrice / typicalPB;

  const ret1y = n > 252 ? ((closes[n - 1] - closes[n - 253]) / closes[n - 253]) * 100 : null;
  const ret6m = n > 132 ? ((closes[n - 1] - closes[n - 133]) / closes[n - 133]) * 100 : null;
  const roeProxy = averageEquity > 0 && latestFinancial ? ((latestFinancial.income.netIncome * 4) / averageEquity) * 100 : null;
  const roaProxy = averageAssets > 0 && latestFinancial ? ((latestFinancial.income.netIncome * 4) / averageAssets) * 100 : null;
  const rosProxy = latestFinancial?.income.revenue ? (latestFinancial.income.netIncome / latestFinancial.income.revenue) * 100 : null;

  let cagr3y: number | null = null;
  if (n > 756) {
    const priceStart = closes[n - 757];
    cagr3y = (Math.pow(currentPrice / priceStart, 1 / 3) - 1) * 100;
  }

  const netProfitMargin = rosProxy ?? 0;
  const assetTurnover = averageAssets > 0 && latestFinancial ? (latestFinancial.income.revenue * 4) / averageAssets : 0;
  const equityMultiplier = averageEquity > 0 && latestFinancial ? averageAssets / averageEquity : 0;
  const dupont = calculateDuPont(netProfitMargin, assetTurnover, equityMultiplier);

  let financialHealth: FinancialHealthResult;
  if (healthDetail && (healthDetail as any).groups) {
    const hd = healthDetail as any;
    financialHealth = {
      overallScore: hd.overall,
      rating: hd.rating,
      breakdown: Object.fromEntries(
        hd.groups.map((group: any) => [
          group.key,
          { score: group.score, detail: `${group.narrative} Trọng số ${(group.weight * 100).toFixed(0)}%; đóng góp ${group.weighted.toFixed(2)} điểm.` },
        ]),
      ) as FinancialHealthResult["breakdown"],
      indicators: Object.fromEntries(
        hd.groups.flatMap((group: any) => group.indicators.map((indicator: any) => [indicator.key, indicator.value])),
      ) as FinancialHealthResult["indicators"],
    };
  } else {
    financialHealth = computeFinancialHealth(bars);
  }

  const pe = typicalPE;
  const pb = typicalPB;
  const fcfProxy = epsProxy * 0.7;
  const dividendProxy = epsProxy * 0.35;
  const dcf = dcf3Scenarios(fcfProxy, cagr3y !== null ? cagr3y / 100 : 0.08);
  const graham = grahamNumber(epsProxy, bvpsProxy);
  const ddm = ddmValue(dividendProxy, 0.12, cagr3y !== null ? cagr3y / 200 : 0.04);
  const revDcfGrowth = reverseDcfGrowth(currentPrice, fcfProxy);

  const intrinsicValues = [dcf.base, dcf.pessimistic, dcf.optimistic, graham, ddm].filter((v) => v > 0 && Number.isFinite(v));
  const intrinsicValueRange =
    intrinsicValues.length >= 2
      ? {
          low: Number(Math.min(...intrinsicValues).toFixed(2)),
          mid: Number((intrinsicValues.reduce((a, b) => a + b, 0) / intrinsicValues.length).toFixed(2)),
          high: Number(Math.max(...intrinsicValues).toFixed(2)),
        }
      : null;

  let verdictVi: string;
  if (intrinsicValueRange) {
    const ratio = currentPrice / intrinsicValueRange.mid;
    if (ratio < 0.7) verdictVi = "Giá hiện tại thấp hơn đáng kể so với giá trị nội tại ước tính — có thể đang bị ĐỊNH GIÁ THẤP";
    else if (ratio < 0.9) verdictVi = "Giá gần vùng giá trị hợp lý, hơi thấp — cơ hội tích lũy";
    else if (ratio < 1.15) verdictVi = "Giá nằm trong vùng giá trị hợp lý";
    else if (ratio < 1.4) verdictVi = "Giá cao hơn giá trị nội tại ước tính — có thể đang bị ĐỊNH GIÁ CAO";
    else verdictVi = "Giá hiện tại cao hơn nhiều so với ước tính giá trị nội tại — rủi ro cao";
  } else {
    verdictVi = "Không đủ dữ liệu để ước tính giá trị nội tại";
  }

  const targetPriceBridge = {
    currentPrice,
    dcf: Number(dcf.base.toFixed(2)),
    multiples: Number(((epsProxy * pe + bvpsProxy * pb) / 2).toFixed(2)),
    dividend: Number(ddm.toFixed(2)),
    blended: intrinsicValueRange?.mid ?? null,
  };
  const sensitivity = [
    { variable: "wacc" as const, down: Number((dcf.base * 0.88).toFixed(2)), base: Number(dcf.base.toFixed(2)), up: Number((dcf.base * 1.12).toFixed(2)) },
    { variable: "terminalGrowth" as const, down: Number((dcf.base * 0.9).toFixed(2)), base: Number(dcf.base.toFixed(2)), up: Number((dcf.base * 1.1).toFixed(2)) },
    { variable: "pe" as const, down: Number((epsProxy * 10).toFixed(2)), base: Number((epsProxy * pe).toFixed(2)), up: Number((epsProxy * 18).toFixed(2)) },
  ];
  const valuation: ValuationResult = {
    currentPrice,
    pe,
    pb,
    evEbitda: pe * 0.85,
    pcf: pe * 1.1,
    ddm: Number(ddm.toFixed(2)),
    dcf: {
      base: Number(dcf.base.toFixed(2)),
      optimistic: Number(dcf.optimistic.toFixed(2)),
      pessimistic: Number(dcf.pessimistic.toFixed(2)),
    },
    grahamNumber: Number(graham.toFixed(2)),
    reverseDcfGrowth: Number((revDcfGrowth * 100).toFixed(2)),
    intrinsicValueRange,
    verdictVi,
    targetPriceBridge,
    sensitivity,
    methodology: [
      "Blended intrinsic range combines DCF, DDM, Graham and proxy multiples.",
      "P/E, P/B, EPS and FCF inputs remain market-proxy estimates until official filings are available.",
      "Sensitivity values are directional scenario outputs, not probability-weighted forecasts.",
    ],
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
    dupont,
    financialHealth,
    valuation,
    generatedAt: new Date().toISOString(),
    dataSource: financialQuarters.length
      ? "Giá/khối lượng từ thị trường; BCTC dùng synthetic vì ALLOW_SYNTHETIC_FINANCIALS bật (chỉ demo/test)."
      : "Giá/khối lượng từ thị trường; không có BCTC verified — Phase 0 không dùng synthetic.",
    disclaimer: "Các chỉ số tài chính được ước tính từ dữ liệu giá thật. Để có số liệu chính xác, cần báo cáo tài chính chính thức. Không phải lời khuyên đầu tư.",
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * Ánh xạ engine chuẩn (LTM/BCTC verified) → shape FundamentalReport cũ.
 *
 * `generateFundamentalReport` ở trên là đường dự phòng chỉ dùng giá/khối lượng
 * (P/E, P/B mặc định 14x / 2.0x — chỉ là proxy). Khi đã có BCTC đã xác minh,
 * luôn dùng hàm này để số liệu là số THẬT.
 * ════════════════════════════════════════════════════════════════════════ */

import type { BusinessPerformance } from "@/lib/fundamental-performance";
import type { ValuationResult as EngineValuation } from "@/lib/fundamental-valuation";
import type { FundamentalAnalytics } from "@/lib/fundamental-analytics-service";

export interface FundamentalReportV2 extends FundamentalReport {
  /** Phiên bản engine đã sinh báo cáo. */
  engineVersion: "ltm-verified-v2" | "price-proxy-v1";
  asOfPeriod: string;
  dataAvailable: boolean;
  coverage: { computed: number; total: number; pct: number };
  warnings: string[];
}

export function buildFundamentalReportFromAnalytics(
  analytics: FundamentalAnalytics,
  currentPrice: number,
): FundamentalReportV2 {
  const performance: BusinessPerformance | null = analytics.performance;
  const valuation: EngineValuation | null = analytics.valuation;

  const pickMetric = (groupKey: string, metricKey: string) =>
    performance?.groups.find((g) => g.key === groupKey)?.metrics.find((m) => m.key === metricKey)?.value ?? null;

  // EPS LTM (nghìn VND/CP) do engine định giá tính từ LN ròng LTM ÷ số CP lưu hành.
  const eps = valuation?.epsLtm ?? performanceEps(performance);

  const health = analytics.healthDetail;
  const financialHealth: FinancialHealthResult =
    health && health.groups.length > 0
      ? {
          overallScore: health.overall,
          rating: health.rating,
          breakdown: Object.fromEntries(
            health.groups.map((group) => [
              group.key,
              {
                score: group.score,
                detail: `${group.narrative} Trọng số ${(group.weight * 100).toFixed(0)}%; đóng góp ${group.weighted.toFixed(2)} điểm.`,
              },
            ]),
          ) as FinancialHealthResult["breakdown"],
          indicators: Object.fromEntries(
            health.groups.flatMap((group) =>
              group.indicators.map((indicator) => [indicator.key, indicator.value]),
            ),
          ) as FinancialHealthResult["indicators"],
        }
      : {
          overallScore: 0,
          rating: "E",
          breakdown: {} as FinancialHealthResult["breakdown"],
          indicators: {} as unknown as FinancialHealthResult["indicators"],
        };

  const intrinsic = valuation?.targetPrice ?? null;
  const valuationOut: ValuationResult = {
    currentPrice,
    pe: multipleOf(valuation, "pe"),
    pb: multipleOf(valuation, "pb"),
    evEbitda: multipleOf(valuation, "evEbitda"),
    pcf: multipleOf(valuation, "pFcf"),
    ddm: valuation?.ddm.valuePerShare ?? null,
    dcf: valuation?.dcf.available
      ? {
          base: valuation.dcf.scenarios.base ?? 0,
          optimistic: valuation.dcf.scenarios.optimistic ?? 0,
          pessimistic: valuation.dcf.scenarios.pessimistic ?? 0,
        }
      : null,
    grahamNumber: valuation?.grahamNumber ?? null,
    reverseDcfGrowth: valuation?.reverseDcf.impliedGrowthPct ?? null,
    intrinsicValueRange:
      intrinsic && intrinsic.low !== null && intrinsic.mid !== null && intrinsic.high !== null
        ? { low: intrinsic.low, mid: intrinsic.mid, high: intrinsic.high }
        : null,
    verdictVi: valuation?.verdictVi ?? "Chưa có BCTC đã xác minh — không ước tính giá trị nội tại.",
    targetPriceBridge: {
      currentPrice,
      dcf: valuation?.dcf.valuePerShare ?? null,
      multiples: multipleOf(valuation, "pe") !== null && eps !== null ? multipleOf(valuation, "pe")! * eps : null,
      dividend: valuation?.ddm.valuePerShare ?? null,
      blended: intrinsic?.mid ?? null,
    },
    sensitivity: valuation
      ? [
          { variable: "wacc", down: valuation.sensitivity.cells.find((c) => c.wacc === valuation.sensitivity.waccSteps[0] && c.terminalGrowth === valuation.wacc.value)?.valuePerShare ?? 0, base: valuation.dcf.valuePerShare ?? 0, up: valuation.sensitivity.cells.find((c) => c.wacc === valuation.sensitivity.waccSteps[valuation.sensitivity.waccSteps.length - 1] && c.terminalGrowth === valuation.wacc.value)?.valuePerShare ?? 0 },
          { variable: "terminalGrowth", down: valuation.sensitivity.cells.find((c) => c.terminalGrowth === valuation.sensitivity.growthSteps[0] && c.wacc === valuation.wacc.value)?.valuePerShare ?? 0, base: valuation.dcf.valuePerShare ?? 0, up: valuation.sensitivity.cells.find((c) => c.terminalGrowth === valuation.sensitivity.growthSteps[valuation.sensitivity.growthSteps.length - 1] && c.wacc === valuation.wacc.value)?.valuePerShare ?? 0 },
          { variable: "pe", down: valuation.targetPrice.low ?? 0, base: valuation.targetPrice.mid ?? 0, up: valuation.targetPrice.high ?? 0 },
        ]
      : [],
    methodology: valuation?.methodology ?? [],
  };

  const dupont = performance
    ? calculateDuPont(
        performance.dupont3.netProfitMarginPct ?? 0,
        performance.dupont3.assetTurnover ?? 0,
        performance.dupont3.equityMultiplier ?? 0,
      )
    : null;

  return {
    symbol: analytics.symbol,
    currentPrice,
    quarterlyMetrics: [],
    eps,
    roe: pickMetric("returns", "roe"),
    roa: pickMetric("returns", "roa"),
    ros: pickMetric("margin", "netMargin"),
    cagr3y: pickMetric("growth", "revenueCagr"),
    dupont,
    financialHealth,
    valuation: valuationOut,
    generatedAt: analytics.generatedAt,
    dataSource: `BCTC đã xác minh (${analytics.inputs.source}); ${analytics.inputs.quarters} kỳ; LTM theo phương pháp ${analytics.inputs.ltmMethod}; giá từ thị trường.`,
    disclaimer:
      "Số liệu tính từ báo cáo tài chính đã xác minh theo chuẩn LTM (12 tháng gần nhất). Không phải lời khuyên đầu tư.",
    engineVersion: "ltm-verified-v2",
    asOfPeriod: analytics.inputs.ltmPeriod,
    dataAvailable: analytics.available,
    coverage: performance?.coverage ?? { computed: 0, total: 0, pct: 0 },
    warnings: analytics.warnings,
  };
}

function multipleOf(valuation: EngineValuation | null, key: string): number | null {
  if (!valuation) return null;
  return valuation.multiples.find((m) => m.key === key)?.value ?? null;
}

function performanceEps(performance: BusinessPerformance | null): number | null {
  if (!performance) return null;
  const latest = performance.series[0];
  return latest?.eps ?? null;
}
