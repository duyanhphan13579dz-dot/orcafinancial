/**
 * Phase 7 — Recommendation 2.0 (Trade Setup Engine)
 * Phase 8 — Risk Engine
 * Phase 9 — Leverage & Scenario Simulator
 */

import type { LayerScore } from "./analysis";
import type { MtfResult } from "./mtf";
import type { FxIntelligence } from "./fx-intelligence";

export interface ConfidenceFactor {
  id: string;
  label: string;
  /** Signed contribution in percentage points (e.g. +15, -3) */
  points: number;
  note: string;
}

export interface ConfidenceBreakdown {
  base: number;
  factors: ConfidenceFactor[];
  total: number;
  explanation: string[];
}

export interface RiskMetrics {
  entry: number;
  stopLoss: number | null;
  takeProfit: number | null;
  takeProfit2: number | null;
  /** Absolute price distance entry→SL */
  riskPrice: number | null;
  /** Absolute price distance entry→TP1 */
  rewardPrice: number | null;
  riskPips: number | null;
  rewardPips: number | null;
  reward2Pips: number | null;
  /** reward/risk ; null if no SL */
  riskReward: number | null;
  riskReward2: number | null;
  pipSize: number;
  side: "BUY" | "SELL" | "NEUTRAL";
}

export interface PositionSizeResult {
  capital: number;
  riskPct: number;
  maxLossMoney: number;
  /** Units of base currency (approx) for the risk budget */
  positionUnits: number | null;
  /** Notional ≈ units * entry */
  notional: number | null;
  note: string;
}

export type LeverageRiskTier = "LOW" | "MODERATE" | "HIGH" | "EXTREME";

export interface LeverageScenario {
  leverage: number;
  capital: number;
  notional: number;
  /** P/L if TP1 hits (money) */
  tpPnl: number | null;
  /** P/L if SL hits (money) */
  slPnl: number | null;
  /** Margin used ≈ notional / leverage */
  marginUsed: number;
  /** Illustrative distance-to-wipe as % move against (NOT broker liquidation) */
  illustrativeWipeMovePct: number | null;
  riskTier: LeverageRiskTier;
  warning: string | null;
}

export interface TradeSetup {
  confidenceBreakdown: ConfidenceBreakdown;
  risk: RiskMetrics;
  /** Default position size at 1% risk on $10k — client can recompute */
  defaultPosition: PositionSizeResult;
  leverageScenarios: LeverageScenario[];
  setupQuality: "A" | "B" | "C" | "D";
  setupNote: string;
}

/** Pip size heuristic for FX / metals. */
export function pipSizeFor(symbol: string, price: number): number {
  const s = symbol.toUpperCase();
  if (s.includes("JPY") && !s.includes("VND")) return 0.01;
  if (s.startsWith("XAU") || s.includes("GOLD")) return 0.1;
  if (s.includes("VND") || price > 1000) return 1;
  if (s === "DXY" || price > 50) return 0.01;
  return 0.0001;
}

export function priceToPips(diff: number, pipSize: number): number {
  if (!pipSize) return 0;
  return Math.abs(diff) / pipSize;
}

export function buildRiskMetrics(opts: {
  symbol: string;
  side: "BUY" | "SELL" | "NEUTRAL";
  entry: number;
  stopLoss: number | null;
  takeProfit: number | null;
  takeProfit2?: number | null;
}): RiskMetrics {
  const pipSize = pipSizeFor(opts.symbol, opts.entry);
  const { entry, stopLoss, takeProfit, takeProfit2 = null, side } = opts;

  let riskPrice: number | null = null;
  let rewardPrice: number | null = null;
  let reward2: number | null = null;

  if (stopLoss != null && side !== "NEUTRAL") {
    riskPrice = Math.abs(entry - stopLoss);
  }
  if (takeProfit != null && side !== "NEUTRAL") {
    rewardPrice = Math.abs(takeProfit - entry);
  }
  if (takeProfit2 != null && side !== "NEUTRAL") {
    reward2 = Math.abs(takeProfit2 - entry);
  }

  const riskPips = riskPrice != null ? priceToPips(riskPrice, pipSize) : null;
  const rewardPips = rewardPrice != null ? priceToPips(rewardPrice, pipSize) : null;
  const reward2Pips = reward2 != null ? priceToPips(reward2, pipSize) : null;

  const riskReward =
    riskPrice && riskPrice > 0 && rewardPrice != null ? rewardPrice / riskPrice : null;
  const riskReward2 =
    riskPrice && riskPrice > 0 && reward2 != null ? reward2 / riskPrice : null;

  return {
    entry,
    stopLoss,
    takeProfit,
    takeProfit2,
    riskPrice,
    rewardPrice,
    riskPips: riskPips != null ? Number(riskPips.toFixed(1)) : null,
    rewardPips: rewardPips != null ? Number(rewardPips.toFixed(1)) : null,
    reward2Pips: reward2Pips != null ? Number(reward2Pips.toFixed(1)) : null,
    riskReward: riskReward != null ? Number(riskReward.toFixed(2)) : null,
    riskReward2: riskReward2 != null ? Number(riskReward2.toFixed(2)) : null,
    pipSize,
    side,
  };
}

/**
 * Position size so that SL loss ≈ capital * riskPct.
 * For FX: loss ≈ units * riskPrice  →  units = maxLoss / riskPrice
 */
export function computePositionSize(opts: {
  capital: number;
  riskPct: number;
  entry: number;
  riskPrice: number | null;
}): PositionSizeResult {
  const maxLossMoney = opts.capital * (opts.riskPct / 100);
  if (!opts.riskPrice || opts.riskPrice <= 0 || opts.entry <= 0) {
    return {
      capital: opts.capital,
      riskPct: opts.riskPct,
      maxLossMoney,
      positionUnits: null,
      notional: null,
      note: "Need valid SL distance to size position",
    };
  }
  const units = maxLossMoney / opts.riskPrice;
  const notional = units * opts.entry;
  return {
    capital: opts.capital,
    riskPct: opts.riskPct,
    maxLossMoney: Number(maxLossMoney.toFixed(2)),
    positionUnits: Number(units.toFixed(4)),
    notional: Number(notional.toFixed(2)),
    note: `Risk ${opts.riskPct}% of $${opts.capital.toLocaleString()} = $${maxLossMoney.toFixed(0)} max loss at SL`,
  };
}

function riskTier(leverage: number): LeverageRiskTier {
  if (leverage >= 100) return "EXTREME";
  if (leverage >= 50) return "HIGH";
  if (leverage >= 20) return "MODERATE";
  return "LOW";
}

/**
 * Illustrative leverage scenarios.
 * IMPORTANT: does NOT model broker-specific liquidation (maintenance margin,
 * funding, gaps). wipeMovePct is a rough notional math only.
 */
export function buildLeverageScenarios(opts: {
  capital: number;
  entry: number;
  risk: RiskMetrics;
  leverages?: number[];
}): LeverageScenario[] {
  const leverages = opts.leverages ?? [1, 5, 10, 20, 50, 100, 200];
  const { capital, entry, risk } = opts;
  const riskPctMove =
    risk.riskPrice != null && entry > 0 ? risk.riskPrice / entry : null;
  const rewardPctMove =
    risk.rewardPrice != null && entry > 0 ? risk.rewardPrice / entry : null;

  return leverages.map((leverage) => {
    const notional = capital * leverage;
    const marginUsed = capital; // isolated-style full capital as margin for illustration
    const tpPnl =
      rewardPctMove != null ? Number((notional * rewardPctMove).toFixed(2)) : null;
    const slPnl =
      riskPctMove != null ? Number((-notional * riskPctMove).toFixed(2)) : null;

    // Rough: full capital wiped if adverse move ≈ 1/leverage (ignoring fees/maintenance)
    const illustrativeWipeMovePct = Number(((1 / leverage) * 100).toFixed(3));

    const tier = riskTier(leverage);
    let warning: string | null = null;
    if (leverage >= 100) {
      warning =
        "EXTREME leverage — small adverse moves can wipe capital. Not broker liquidation math.";
    } else if (leverage >= 50) {
      warning = "HIGH leverage — elevated liquidation risk on real brokers.";
    } else if (leverage >= 20) {
      warning = "Moderate leverage — size carefully around news/session opens.";
    }

    return {
      leverage,
      capital,
      notional: Number(notional.toFixed(2)),
      tpPnl,
      slPnl,
      marginUsed: Number(marginUsed.toFixed(2)),
      illustrativeWipeMovePct,
      riskTier: tier,
      warning,
    };
  });
}

function starsFromScore(score: number, side: "BUY" | "SELL" | "NEUTRAL"): string {
  if (side === "NEUTRAL") return "~";
  const abs = Math.abs(score);
  if (abs >= 0.55) return "+++";
  if (abs >= 0.3) return "++";
  if (abs >= 0.15) return "+";
  return "~";
}

/**
 * Phase 7 confidence breakdown — explain the number.
 */
export function buildConfidenceBreakdown(opts: {
  recommendation: "BUY" | "SELL" | "NEUTRAL";
  baseConfidence: number;
  layers: LayerScore[];
  mtf: MtfResult | null;
  fx: FxIntelligence | null;
  regime?: string;
}): ConfidenceBreakdown {
  const factors: ConfidenceFactor[] = [];
  const side = opts.recommendation;
  const dir = side === "BUY" ? 1 : side === "SELL" ? -1 : 0;

  const push = (id: string, label: string, points: number, note: string) => {
    if (Math.abs(points) < 0.5) return;
    factors.push({
      id,
      label,
      points: Number(points.toFixed(1)),
      note,
    });
  };

  // Layer contributions (scaled to ~percentage points)
  for (const l of opts.layers) {
    if (l.role === "modulator") continue;
    const aligned =
      dir === 0
        ? 0
        : dir > 0
          ? l.score
          : -l.score;
    const pts = aligned * 18 * (l.effectiveWeight ?? l.weight) * 4;
    push(
      l.id,
      l.label,
      pts,
      `${starsFromScore(l.score, side)} score ${l.score.toFixed(2)}`,
    );
  }

  if (opts.mtf) {
    const mtfPts =
      dir === 0
        ? 0
        : opts.mtf.overall === (side === "BUY" ? "bullish" : "bearish")
          ? 8 + opts.mtf.alignment * 6
          : opts.mtf.context.includes("conflict")
            ? -10
            : opts.mtf.overall === "neutral"
              ? 0
              : -6;
    push("mtf", "MTF", mtfPts, opts.mtf.summary);
  }

  if (opts.fx) {
    const dxy = opts.fx.dxy;
    if (dxy.pairExpected === "bullish" && side === "BUY") {
      push("dxy", "DXY", 5, dxy.note);
    } else if (dxy.pairExpected === "bearish" && side === "SELL") {
      push("dxy", "DXY", 5, dxy.note);
    } else if (
      (dxy.pairExpected === "bearish" && side === "BUY") ||
      (dxy.pairExpected === "bullish" && side === "SELL")
    ) {
      push("dxy", "DXY", -4, dxy.note);
    }

    const str = opts.fx.pairBiasFromStrength;
    if (str.bias === "bullish" && side === "BUY") push("strength", "Strength", 4, str.note);
    else if (str.bias === "bearish" && side === "SELL")
      push("strength", "Strength", 4, str.note);
    else if (
      (str.bias === "bearish" && side === "BUY") ||
      (str.bias === "bullish" && side === "SELL")
    )
      push("strength", "Strength", -3, str.note);

    if (opts.fx.session.liquidity === "LOW") {
      push("session", "Session", -3, opts.fx.session.label + " thin liquidity");
    } else if (opts.fx.session.id === "overlap") {
      push("session", "Session", 3, "London/NY overlap — high liquidity");
    }
  }

  if (opts.regime === "extreme") push("vol", "Volatility", -8, "Extreme vol regime");
  else if (opts.regime === "high") push("vol", "Volatility", -3, "High vol regime");

  const factorSum = factors.reduce((a, f) => a + f.points, 0);
  // Map to 0-100 scale anchored near baseConfidence*100
  let total = Math.round(opts.baseConfidence * 100);
  // Blend explained factors toward total for transparency without fighting gates
  const explained = 50 + factorSum;
  total = Math.round(total * 0.55 + explained * 0.45);
  total = Math.max(32, Math.min(93, total));

  const explanation = factors
    .slice()
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .map((f) => `${f.points >= 0 ? "+" : ""}${f.points} ${f.label}: ${f.note}`);

  return {
    base: Math.round(opts.baseConfidence * 100),
    factors,
    total,
    explanation,
  };
}

function setupQualityFrom(opts: {
  recommendation: "BUY" | "SELL" | "NEUTRAL";
  confidence: number;
  risk: RiskMetrics;
  mtf: MtfResult | null;
}): { grade: "A" | "B" | "C" | "D"; note: string } {
  if (opts.recommendation === "NEUTRAL") {
    return { grade: "D", note: "No directional setup — wait" };
  }
  const rr = opts.risk.riskReward ?? 0;
  const align = opts.mtf?.alignment ?? 0;
  const conf = opts.confidence;

  if (conf >= 0.75 && rr >= 1.5 && align >= 0.6) {
    return { grade: "A", note: "Strong confluence · favorable R:R · MTF aligned" };
  }
  if (conf >= 0.62 && rr >= 1.2) {
    return { grade: "B", note: "Solid setup — manage size if session/vol elevated" };
  }
  if (conf >= 0.5 && rr >= 1.0) {
    return { grade: "C", note: "Marginal — reduce size or wait for better entry" };
  }
  return { grade: "D", note: "Weak R:R or low confidence — skip or scale way down" };
}

export function buildTradeSetup(opts: {
  symbol: string;
  recommendation: "BUY" | "SELL" | "NEUTRAL";
  confidence: number;
  entry: number;
  stopLoss: number | null;
  takeProfit: number | null;
  takeProfit2?: number | null;
  layers: LayerScore[];
  mtf: MtfResult | null;
  fx: FxIntelligence | null;
  regime?: string;
  capital?: number;
  riskPct?: number;
}): TradeSetup {
  const capital = opts.capital ?? 10_000;
  const riskPct = opts.riskPct ?? 1;

  const risk = buildRiskMetrics({
    symbol: opts.symbol,
    side: opts.recommendation,
    entry: opts.entry,
    stopLoss: opts.stopLoss,
    takeProfit: opts.takeProfit,
    takeProfit2: opts.takeProfit2,
  });

  const confidenceBreakdown = buildConfidenceBreakdown({
    recommendation: opts.recommendation,
    baseConfidence: opts.confidence,
    layers: opts.layers,
    mtf: opts.mtf,
    fx: opts.fx,
    regime: opts.regime,
  });

  const defaultPosition = computePositionSize({
    capital,
    riskPct,
    entry: opts.entry,
    riskPrice: risk.riskPrice,
  });

  const leverageScenarios = buildLeverageScenarios({
    capital,
    entry: opts.entry,
    risk,
  });

  const q = setupQualityFrom({
    recommendation: opts.recommendation,
    confidence: opts.confidence,
    risk,
    mtf: opts.mtf,
  });

  return {
    confidenceBreakdown,
    risk,
    defaultPosition,
    leverageScenarios,
    setupQuality: q.grade,
    setupNote: q.note,
  };
}

/** Client-side recompute helper payload shape. */
export function recomputePositionAndLeverage(opts: {
  symbol: string;
  entry: number;
  stopLoss: number | null;
  takeProfit: number | null;
  takeProfit2?: number | null;
  side: "BUY" | "SELL" | "NEUTRAL";
  capital: number;
  riskPct: number;
  leverages?: number[];
}) {
  const risk = buildRiskMetrics({
    symbol: opts.symbol,
    side: opts.side,
    entry: opts.entry,
    stopLoss: opts.stopLoss,
    takeProfit: opts.takeProfit,
    takeProfit2: opts.takeProfit2,
  });
  const position = computePositionSize({
    capital: opts.capital,
    riskPct: opts.riskPct,
    entry: opts.entry,
    riskPrice: risk.riskPrice,
  });
  const leverageScenarios = buildLeverageScenarios({
    capital: opts.capital,
    entry: opts.entry,
    risk,
    leverages: opts.leverages,
  });
  return { risk, position, leverageScenarios };
}
