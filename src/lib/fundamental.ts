/**
 * Fundamental Analyst Module
 *
 * Price-history fallback path (ROADMAP G2/G3):
 * - Mọi chỉ số tài chính CHỈ tính từ BCTC thật (EPS, BVPS, ROE, ROA, ROS,
 *   growth YoY, FCF cho DCF).
 * - Không có BCTC → các chỉ số đó trả null / rating "UNAVAILABLE"; KHÔNG còn
 *   proxy suy từ giá (price/typicalPE) hay CAGR giá cổ phiếu.
 * - Số liệu giá/khối lượng (return, volatility) chỉ là ngữ cảnh THỊ TRƯỜNG.
 *
 * Phase 0: generateQuarterlyFinancials (synthetic) only runs when ALLOW_SYNTHETIC_FINANCIALS is set.
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
  // ROADMAP G2: KHÔNG còn proxy suy từ giá (price/typicalPE, price/typicalPB).
  // Thiếu BCTC → null, đúng nguyên tắc "không bịa số".
  const eps: number | null = latestFinancial?.income.eps ?? null;
  const bvps: number | null = latestFinancial?.balance.bookValuePerShare ?? null;

  const roeProxy = averageEquity > 0 && latestFinancial ? ((latestFinancial.income.netIncome * 4) / averageEquity) * 100 : null;
  const roaProxy = averageAssets > 0 && latestFinancial ? ((latestFinancial.income.netIncome * 4) / averageAssets) * 100 : null;
  const rosProxy = latestFinancial?.income.revenue ? (latestFinancial.income.netIncome / latestFinancial.income.revenue) * 100 : null;

  // ROADMAP G2: growth tính từ BCTC (YoY cùng kỳ quý), không từ giá cổ phiếu.
  const yoyGrowth = (pick: (q: (typeof financialQuarters)[number]) => number | null): number | null => {
    const cur = financialQuarters[0];
    const prev = financialQuarters[4];
    if (!cur || !prev) return null;
    const a = pick(cur);
    const b = pick(prev);
    if (a == null || b == null || b === 0) return null;
    return ((a - b) / Math.abs(b)) * 100;
  };
  const revenueGrowthYoY = yoyGrowth((q) => q.income.revenue ?? null);
  const netIncomeGrowthYoY = yoyGrowth((q) => q.income.netIncome ?? null);
  // Chưa đủ 3 năm FY nên không bịa CAGR — dùng tăng trưởng doanh thu YoY thật.
  const cagr3y = revenueGrowthYoY;

  const dupont =
    latestFinancial && rosProxy != null && averageAssets > 0 && averageEquity > 0
      ? calculateDuPont(
          rosProxy,
          ((latestFinancial.income.revenue ?? 0) * 4) / averageAssets,
          averageAssets / averageEquity,
        )
      : null;

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
    // ROADMAP G2: Financial Health chỉ chấm từ BCTC — không chấm từ giá/khối lượng.
    const naDetail = "Chưa có BCTC verified — không chấm điểm (không dùng proxy giá).";
    financialHealth = {
      overallScore: 0,
      rating: "UNAVAILABLE",
      breakdown: {
        liquidity: { score: 0, detail: naDetail },
        leverage: { score: 0, detail: naDetail },
        profitability: { score: 0, detail: naDetail },
        efficiency: { score: 0, detail: naDetail },
        growth: { score: 0, detail: naDetail },
        cashflow: { score: 0, detail: naDetail },
      },
      indicators: {
        debtEquity: null,
        ebitdaToAssets: null,
        ebitdaToInterest: null,
        fcfToEbit: null,
        currentRatio: null,
        quickRatio: null,
        roe: null,
        roa: null,
        grossMargin: null,
        netMargin: null,
      },
    };
  }

  // ROADMAP G3: P/E = giá ÷ EPS thật; P/B = giá ÷ BVPS thật; thiếu → null.
  const pe = eps !== null && eps > 0 ? currentPrice / eps : null;
  const pb = bvps !== null && bvps > 0 ? currentPrice / bvps : null;
  // FCF thật từ báo cáo lưu chuyển tiền tệ (không còn fcfProxy = eps*0.7).
  const cashflow = latestFinancial?.cashflow;
  const fcfReal =
    cashflow?.freeCashFlow != null
      ? cashflow.freeCashFlow
      : cashflow?.operatingCashFlow != null
        ? cashflow.operatingCashFlow - (cashflow.capex ?? 0)
        : null;
  const dcf =
    fcfReal !== null && fcfReal > 0
      ? dcf3Scenarios(
          fcfReal,
          revenueGrowthYoY !== null ? Math.max(-0.05, Math.min(0.25, revenueGrowthYoY / 100)) : 0.08,
        )
      : null;
  const graham = eps !== null && bvps !== null ? grahamNumber(eps, bvps) : 0;
  // ROADMAP G3: DDM chỉ chạy khi có cổ tức tiền mặt — hiện không có dữ liệu
  // cổ tức trên mỗi CP nên luôn null (không giả định eps*0.35).
  const ddm = null as number | null;
  const revDcfGrowth =
    dcf !== null && fcfReal !== null && fcfReal > 0 ? reverseDcfGrowth(currentPrice, fcfReal) : null;

  const growthNote = `Tăng trưởng YoY (BCTC): doanh thu ${revenueGrowthYoY !== null ? revenueGrowthYoY.toFixed(1) : "—"}%, LNST ${netIncomeGrowthYoY !== null ? netIncomeGrowthYoY.toFixed(1) : "—"}%`;
  const intrinsicValues = [dcf?.base ?? NaN, dcf?.pessimistic ?? NaN, dcf?.optimistic ?? NaN, graham, ddm ?? NaN].filter((v) => v > 0 && Number.isFinite(v));
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
    dcf: dcf !== null ? Number(dcf.base.toFixed(2)) : null,
    multiples: null,
    dividend: ddm !== null ? Number(ddm.toFixed(2)) : null,
    blended: intrinsicValueRange?.mid ?? null,
  };
  const sensitivity =
    dcf !== null && eps !== null
      ? [
          { variable: "wacc" as const, down: Number((dcf.base * 0.88).toFixed(2)), base: Number(dcf.base.toFixed(2)), up: Number((dcf.base * 1.12).toFixed(2)) },
          { variable: "terminalGrowth" as const, down: Number((dcf.base * 0.9).toFixed(2)), base: Number(dcf.base.toFixed(2)), up: Number((dcf.base * 1.1).toFixed(2)) },
          { variable: "pe" as const, down: Number((eps * 10).toFixed(2)), base: Number((eps * (pe ?? 14)).toFixed(2)), up: Number((eps * 18).toFixed(2)) },
        ]
      : [];
  const valuation: ValuationResult = {
    currentPrice,
    pe: pe !== null ? Number(pe.toFixed(2)) : null,
    pb: pb !== null ? Number(pb.toFixed(2)) : null,
    evEbitda: null,
    pcf: null,
    ddm: ddm !== null ? Number(ddm.toFixed(2)) : null,
    dcf:
      dcf !== null
        ? {
            base: Number(dcf.base.toFixed(2)),
            optimistic: Number(dcf.optimistic.toFixed(2)),
            pessimistic: Number(dcf.pessimistic.toFixed(2)),
          }
        : null,
    grahamNumber: graham > 0 ? Number(graham.toFixed(2)) : null,
    reverseDcfGrowth: revDcfGrowth !== null ? Number((revDcfGrowth * 100).toFixed(2)) : null,
    intrinsicValueRange,
    verdictVi,
    targetPriceBridge,
    sensitivity,
    methodology: [
      "P/E = giá ÷ EPS BCTC; P/B = giá ÷ BVPS BCTC; thiếu BCTC → null.",
      "DCF chỉ chạy với FCF thật từ báo cáo lưu chuyển tiền tệ; DDM chỉ khi có cổ tức.",
      growthNote,
      "Sensitivity values are directional scenario outputs, not probability-weighted forecasts.",
    ],
  };

  return {
    symbol,
    currentPrice,
    quarterlyMetrics,
    eps: eps !== null ? Number(eps.toFixed(2)) : null,
    roe: roeProxy !== null ? Number(roeProxy.toFixed(2)) : null,
    roa: roaProxy !== null ? Number(roaProxy.toFixed(2)) : null,
    ros: rosProxy !== null ? Number(rosProxy.toFixed(2)) : null,
    cagr3y: cagr3y !== null ? Number(cagr3y.toFixed(2)) : null,
    dupont,
    financialHealth,
    valuation,
    generatedAt: new Date().toISOString(),
    dataSource: financialQuarters.length
      ? "BCTC từ nguồn được cấu hình; giá/khối lượng từ thị trường."
      : "Không có BCTC verified — chỉ số phụ thuộc BCTC trả null/UNAVAILABLE (không proxy từ giá).",
    disclaimer: "Chỉ số tài chính chỉ tính từ BCTC thật; thiếu dữ liệu thật trả null/unavailable. Không phải lời khuyên đầu tư.",
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
  rawCurrentPrice: number,
): FundamentalReportV2 {
  // Route truyền quote.close theo ĐỒNG; mọi giá trị mỗi CP của engine định giá
  // (DCF/DDM/targetPrice/intrinsicValueRange) theo NGHÌN VND — chuẩn hoá về
  // nghìn để cầu nối giá mục tiêu và marker "vùng giá trị nội tại" trên UI
  // so sánh đúng đơn vị (trước đây lệch ×1000).
  const currentPrice =
    Number.isFinite(rawCurrentPrice) && rawCurrentPrice > 0 ? rawCurrentPrice / 1000 : rawCurrentPrice;
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
