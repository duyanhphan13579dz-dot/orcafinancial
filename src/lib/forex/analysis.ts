/**
 * Phase 4 — Technical Intelligence Engine
 *
 * Six scoring layers → aggregated recommendation:
 *  1. Trend       (EMA stack, ADX, HH/HL structure)
 *  2. Momentum    (RSI, MACD, ROC)
 *  3. Volatility  (ATR, BB width, regime)
 *  4. Structure   (S/R, breakout, retest, liquidity sweep)
 *  5. Pattern     (candlestick + chart, age-weighted)
 *  6. VolumeProxy (tick vol if any, range expansion, session)
 */

import type { Ohlcv } from "@/lib/connectors/core";
import { bollinger, emaSeries, macd, rsi, supportResistance } from "@/lib/analysis";
import { detectCandlestickPatterns, detectChartPatterns } from "@/lib/technical-patterns";

export type LayerBias = "bullish" | "bearish" | "neutral";

export interface LayerScore {
  id: string;
  label: string;
  /** -1 (strong bear) … +1 (strong bull) */
  score: number;
  bias: LayerBias;
  weight: number;
  detail: string[];
}

function atr(b: Ohlcv[], p = 14): number | null {
  if (b.length < p + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < b.length; i++) {
    tr.push(
      Math.max(
        b[i].high - b[i].low,
        Math.abs(b[i].high - b[i - 1].close),
        Math.abs(b[i].low - b[i - 1].close),
      ),
    );
  }
  return tr.slice(-p).reduce((a, c) => a + c, 0) / p;
}

function adx(b: Ohlcv[], p = 14): number | null {
  if (b.length < p * 2 + 1) return null;
  const tr: number[] = [];
  const pd: number[] = [];
  const md: number[] = [];
  for (let i = 1; i < b.length; i++) {
    tr.push(
      Math.max(
        b[i].high - b[i].low,
        Math.abs(b[i].high - b[i - 1].close),
        Math.abs(b[i].low - b[i - 1].close),
      ),
    );
    const u = b[i].high - b[i - 1].high;
    const d = b[i - 1].low - b[i].low;
    pd.push(u > d && u > 0 ? u : 0);
    md.push(d > u && d > 0 ? d : 0);
  }
  const dx: number[] = [];
  for (let i = p - 1; i < tr.length; i++) {
    const t = tr.slice(i - p + 1, i + 1).reduce((a, c) => a + c, 0);
    const a = pd.slice(i - p + 1, i + 1).reduce((x, c) => x + c, 0);
    const m = md.slice(i - p + 1, i + 1).reduce((x, c) => x + c, 0);
    if (t) {
      const pi = (100 * a) / t;
      const mi = (100 * m) / t;
      if (pi + mi) dx.push((100 * Math.abs(pi - mi)) / (pi + mi));
    }
  }
  return dx.length >= p ? dx.slice(-p).reduce((a, c) => a + c, 0) / p : null;
}

function roc(closes: number[], period = 10): number | null {
  if (closes.length <= period) return null;
  const prev = closes[closes.length - 1 - period];
  if (!prev) return null;
  return ((closes[closes.length - 1] - prev) / prev) * 100;
}

function momentum(closes: number[], period = 10): number | null {
  if (closes.length <= period) return null;
  return closes[closes.length - 1] - closes[closes.length - 1 - period];
}

/** Detect swing highs/lows with lookback `order`. */
function swingStructure(bars: Ohlcv[], order = 3) {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = order; i < bars.length - order; i++) {
    let isH = true;
    let isL = true;
    for (let j = 1; j <= order; j++) {
      if (bars[i].high <= bars[i - j].high || bars[i].high <= bars[i + j].high) isH = false;
      if (bars[i].low >= bars[i - j].low || bars[i].low >= bars[i + j].low) isL = false;
    }
    if (isH) highs.push(bars[i].high);
    if (isL) lows.push(bars[i].low);
  }
  const lastH = highs.slice(-3);
  const lastL = lows.slice(-3);
  let structure: "HH_HL" | "LH_LL" | "mixed" | "unknown" = "unknown";
  if (lastH.length >= 2 && lastL.length >= 2) {
    const hh = lastH[lastH.length - 1] > lastH[lastH.length - 2];
    const hl = lastL[lastL.length - 1] > lastL[lastL.length - 2];
    const lh = lastH[lastH.length - 1] < lastH[lastH.length - 2];
    const ll = lastL[lastL.length - 1] < lastL[lastL.length - 2];
    if (hh && hl) structure = "HH_HL";
    else if (lh && ll) structure = "LH_LL";
    else structure = "mixed";
  }
  return { structure, lastHighs: lastH, lastLows: lastL };
}

function bbWidth(bb: { upper: number; middle: number; lower: number } | null): number | null {
  if (!bb || !bb.middle) return null;
  return (bb.upper - bb.lower) / bb.middle;
}

function volatilityRegime(
  atrVal: number | null,
  closes: number[],
  bbW: number | null,
): "low" | "normal" | "high" | "extreme" {
  if (atrVal == null || !closes.length) return "normal";
  const mid = closes[closes.length - 1];
  const atrPct = atrVal / mid;
  if (bbW != null && bbW < 0.01) return "low";
  if (atrPct > 0.02 || (bbW != null && bbW > 0.04)) return "extreme";
  if (atrPct > 0.012 || (bbW != null && bbW > 0.025)) return "high";
  if (atrPct < 0.004 || (bbW != null && bbW < 0.012)) return "low";
  return "normal";
}

function detectBreakoutRetest(bars: Ohlcv[], sr: { support: number; resistance: number } | null) {
  if (!sr || bars.length < 5) {
    return { breakout: null as "up" | "down" | null, retest: false, sweep: null as "buy" | "sell" | null };
  }
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const eps = last.close * 0.0008;

  let breakout: "up" | "down" | null = null;
  if (prev.close <= sr.resistance && last.close > sr.resistance + eps) breakout = "up";
  if (prev.close >= sr.support && last.close < sr.support - eps) breakout = "down";

  // Retest: touched level then closed back
  let retest = false;
  if (breakout === "up" && last.low <= sr.resistance + eps && last.close > sr.resistance) retest = true;
  if (breakout === "down" && last.high >= sr.support - eps && last.close < sr.support) retest = true;

  // Liquidity sweep: wick beyond S/R then close back inside
  let sweep: "buy" | "sell" | null = null;
  if (last.low < sr.support - eps && last.close > sr.support) sweep = "buy";
  if (last.high > sr.resistance + eps && last.close < sr.resistance) sweep = "sell";

  return { breakout, retest, sweep };
}

/** Rough session activity from bar ranges vs ATR (proxy when no real volume). */
function volumeProxyScore(bars: Ohlcv[], atrVal: number | null): {
  score: number;
  detail: string[];
} {
  const detail: string[] = [];
  if (bars.length < 20) return { score: 0, detail: ["Insufficient bars for volume proxy"] };

  const recent = bars.slice(-20);
  const ranges = recent.map((b) => b.high - b.low);
  const avgRange = ranges.reduce((a, c) => a + c, 0) / ranges.length;
  const lastRange = ranges[ranges.length - 1];
  const expansion = avgRange > 0 ? lastRange / avgRange : 1;

  // Tick volume if provider filled volume field
  const vols = recent.map((b) => b.volume ?? 0);
  const hasVol = vols.some((v) => v > 0);
  let volRatio = 1;
  if (hasVol) {
    const avgV = vols.reduce((a, c) => a + c, 0) / vols.length;
    volRatio = avgV > 0 ? vols[vols.length - 1] / avgV : 1;
    detail.push(`Tick volume ratio ${volRatio.toFixed(2)}x avg20`);
  } else {
    detail.push("No tick volume — using range expansion proxy");
  }

  detail.push(`Range expansion ${expansion.toFixed(2)}x avg20`);
  if (atrVal != null) {
    detail.push(`ATR context ${(atrVal / bars[bars.length - 1].close * 100).toFixed(3)}%`);
  }

  // Score is activity intensity, direction-neutral; mild bias if expansion with close location
  let score = 0;
  const intensity = Math.min(1.5, (expansion + (hasVol ? volRatio : 1)) / 2) - 1;
  score = Math.max(-0.3, Math.min(0.3, intensity * 0.4));

  // Session heuristic: larger ranges often = more liquid session
  if (expansion > 1.4) detail.push("Elevated session activity");
  if (expansion < 0.6) detail.push("Quiet session / compressed range");

  return { score, detail };
}

function biasFromScore(score: number): LayerBias {
  if (score >= 0.2) return "bullish";
  if (score <= -0.2) return "bearish";
  return "neutral";
}

function clamp(n: number, lo = -1, hi = 1) {
  return Math.max(lo, Math.min(hi, n));
}

export function analyzeForex(bars: Ohlcv[]) {
  if (bars.length < 30) throw new Error("Insufficient forex OHLCV data");

  const closes = bars.map((b) => b.close);
  const current = closes.at(-1)!;
  const e20s = emaSeries(closes, 20);
  const e50s = emaSeries(closes, 50);
  const e200s = closes.length >= 200 ? emaSeries(closes, 200) : null;
  const e20 = e20s.at(-1)!;
  const e50 = e50s.at(-1)!;
  const e200 = e200s ? e200s.at(-1)! : null;

  const rr = rsi(closes);
  const mm = macd(closes);
  const bb = bollinger(closes);
  const aa = atr(bars);
  const xx = adx(bars);
  const sr = supportResistance(bars);
  const roc10 = roc(closes, 10);
  const mom10 = momentum(closes, 10);
  const swings = swingStructure(bars);
  const bbW = bbWidth(bb);
  const regime = volatilityRegime(aa, closes, bbW);
  const structEvents = detectBreakoutRetest(bars, sr);

  const candles = detectCandlestickPatterns(bars)
    .filter((p) => p.barIndex >= bars.length - 20)
    .slice(-12);
  const charts = detectChartPatterns(bars).slice(-8);

  // ── 4.1 Trend ──────────────────────────────────────────────
  const trendDetail: string[] = [];
  let trendScore = 0;
  if (current > e20 && e20 > e50) {
    trendScore += 0.45;
    trendDetail.push("EMA stack bullish (price > EMA20 > EMA50)");
  } else if (current < e20 && e20 < e50) {
    trendScore -= 0.45;
    trendDetail.push("EMA stack bearish (price < EMA20 < EMA50)");
  } else {
    trendDetail.push("EMA stack mixed");
  }
  if (e200 != null) {
    if (current > e200) {
      trendScore += 0.2;
      trendDetail.push("Above EMA200");
    } else {
      trendScore -= 0.2;
      trendDetail.push("Below EMA200");
    }
  }
  if (xx != null) {
    if (xx > 25) {
      trendScore *= 1.15;
      trendDetail.push(`ADX ${xx.toFixed(1)} — trend strength OK`);
    } else {
      trendScore *= 0.7;
      trendDetail.push(`ADX ${xx.toFixed(1)} — weak trend`);
    }
  }
  if (swings.structure === "HH_HL") {
    trendScore += 0.25;
    trendDetail.push("Structure HH/HL (uptrend)");
  } else if (swings.structure === "LH_LL") {
    trendScore -= 0.25;
    trendDetail.push("Structure LH/LL (downtrend)");
  } else if (swings.structure === "mixed") {
    trendDetail.push("Structure mixed");
  }
  trendScore = clamp(trendScore);

  // ── 4.2 Momentum ───────────────────────────────────────────
  const momDetail: string[] = [];
  let momScore = 0;
  if (rr != null) {
    if (rr < 30) {
      momScore += 0.35;
      momDetail.push(`RSI ${rr.toFixed(1)} oversold`);
    } else if (rr < 45) {
      momScore += 0.15;
      momDetail.push(`RSI ${rr.toFixed(1)} soft bullish zone`);
    } else if (rr > 70) {
      momScore -= 0.35;
      momDetail.push(`RSI ${rr.toFixed(1)} overbought`);
    } else if (rr > 55) {
      momScore -= 0.1;
      momDetail.push(`RSI ${rr.toFixed(1)} elevated`);
    } else {
      momDetail.push(`RSI ${rr.toFixed(1)} neutral`);
    }
  }
  if (mm) {
    if (mm.histogram > 0 && mm.macd > mm.signal) {
      momScore += 0.3;
      momDetail.push("MACD bullish (hist>0, above signal)");
    } else if (mm.histogram < 0 && mm.macd < mm.signal) {
      momScore -= 0.3;
      momDetail.push("MACD bearish (hist<0, below signal)");
    } else if (mm.histogram > 0) {
      momScore += 0.15;
      momDetail.push("MACD histogram positive");
    } else {
      momScore -= 0.15;
      momDetail.push("MACD histogram negative");
    }
  }
  if (roc10 != null) {
    if (roc10 > 0.15) {
      momScore += 0.2;
      momDetail.push(`ROC(10) ${roc10.toFixed(2)}% up`);
    } else if (roc10 < -0.15) {
      momScore -= 0.2;
      momDetail.push(`ROC(10) ${roc10.toFixed(2)}% down`);
    } else {
      momDetail.push(`ROC(10) ${roc10.toFixed(2)}% flat`);
    }
  }
  if (mom10 != null && current) {
    const momPct = (mom10 / current) * 100;
    if (Math.abs(momPct) > 0.05) {
      momScore += clamp(momPct * 2, -0.15, 0.15);
      momDetail.push(`Momentum(10) ${momPct.toFixed(3)}%`);
    }
  }
  momScore = clamp(momScore);

  // ── 4.3 Volatility ─────────────────────────────────────────
  const volDetail: string[] = [];
  let volScore = 0; // directional bias mild; mainly modulates confidence later
  volDetail.push(`Regime: ${regime}`);
  if (aa != null) {
    volDetail.push(`ATR(14) ${aa.toFixed(5)} (${((aa / current) * 100).toFixed(3)}%)`);
  }
  if (bbW != null) {
    volDetail.push(`BB width ${(bbW * 100).toFixed(2)}%`);
  }
  // Expansion in direction of close vs open of last bar
  const lastBar = bars[bars.length - 1];
  if (regime === "high" || regime === "extreme") {
    if (lastBar.close > lastBar.open) volScore += 0.1;
    else if (lastBar.close < lastBar.open) volScore -= 0.1;
    volDetail.push("High vol — moves less reliable, size down");
  } else if (regime === "low") {
    volDetail.push("Low vol — squeeze / breakout watch");
  }
  volScore = clamp(volScore);

  // ── 4.4 Structure ──────────────────────────────────────────
  const stDetail: string[] = [];
  let stScore = 0;
  if (sr) {
    stDetail.push(`Support ${sr.support.toFixed(5)} · Resistance ${sr.resistance.toFixed(5)}`);
    const nearS = (current - sr.support) / current < 0.0025;
    const nearR = (sr.resistance - current) / current < 0.0025;
    if (nearS) {
      stScore += 0.25;
      stDetail.push("Price near support");
    }
    if (nearR) {
      stScore -= 0.25;
      stDetail.push("Price near resistance");
    }
  }
  if (structEvents.breakout === "up") {
    stScore += 0.35;
    stDetail.push("Breakout above resistance");
  } else if (structEvents.breakout === "down") {
    stScore -= 0.35;
    stDetail.push("Breakout below support");
  }
  if (structEvents.retest) {
    stScore += structEvents.breakout === "up" ? 0.15 : structEvents.breakout === "down" ? -0.15 : 0;
    stDetail.push("Retest of breakout level");
  }
  if (structEvents.sweep === "buy") {
    stScore += 0.3;
    stDetail.push("Liquidity sweep lows (buy-side)");
  } else if (structEvents.sweep === "sell") {
    stScore -= 0.3;
    stDetail.push("Liquidity sweep highs (sell-side)");
  }
  stScore = clamp(stScore);

  // ── 4.5 Pattern ────────────────────────────────────────────
  const patDetail: string[] = [];
  let patScore = 0;
  const lastIdx = bars.length - 1;
  for (const p of candles) {
    const age = lastIdx - p.barIndex;
    const ageW = Math.max(0.3, 1 - age / 20);
    const signed = (p.type === "bullish" ? 1 : p.type === "bearish" ? -1 : 0) * p.reliability * ageW * 0.35;
    patScore += signed;
    if (Math.abs(signed) > 0.05) {
      patDetail.push(`${p.nameVi} (${p.type}, age ${age}, rel ${(p.reliability * 100).toFixed(0)}%)`);
    }
  }
  for (const p of charts) {
    const age = lastIdx - p.endIndex;
    const ageW = Math.max(0.25, 1 - age / 40);
    const signed = (p.type === "bullish" ? 1 : p.type === "bearish" ? -1 : 0) * p.reliability * ageW * 0.45;
    patScore += signed;
    patDetail.push(`${p.nameVi} (${p.type}, age ${age}, rel ${(p.reliability * 100).toFixed(0)}%)`);
  }
  if (!patDetail.length) patDetail.push("No strong recent patterns");
  patScore = clamp(patScore);

  // ── 4.6 Volume proxy ───────────────────────────────────────
  const vp = volumeProxyScore(bars, aa);
  const volProxyScore = clamp(vp.score);

  const layers: LayerScore[] = [
    {
      id: "trend",
      label: "Trend",
      score: Number(trendScore.toFixed(3)),
      bias: biasFromScore(trendScore),
      weight: 0.28,
      detail: trendDetail,
    },
    {
      id: "momentum",
      label: "Momentum",
      score: Number(momScore.toFixed(3)),
      bias: biasFromScore(momScore),
      weight: 0.22,
      detail: momDetail,
    },
    {
      id: "volatility",
      label: "Volatility",
      score: Number(volScore.toFixed(3)),
      bias: biasFromScore(volScore),
      weight: 0.08,
      detail: volDetail,
    },
    {
      id: "structure",
      label: "Structure",
      score: Number(stScore.toFixed(3)),
      bias: biasFromScore(stScore),
      weight: 0.22,
      detail: stDetail,
    },
    {
      id: "pattern",
      label: "Pattern",
      score: Number(patScore.toFixed(3)),
      bias: biasFromScore(patScore),
      weight: 0.15,
      detail: patDetail.slice(0, 6),
    },
    {
      id: "volume",
      label: "Volume proxy",
      score: Number(volProxyScore.toFixed(3)),
      bias: biasFromScore(volProxyScore),
      weight: 0.05,
      detail: vp.detail,
    },
  ];

  const weightSum = layers.reduce((a, l) => a + l.weight, 0);
  const composite =
    layers.reduce((a, l) => a + l.score * l.weight, 0) / (weightSum || 1);

  // Safety gates: never BUY when RSI >= 75, never SELL when RSI <= 25
  let recommendation: "BUY" | "SELL" | "NEUTRAL" =
    composite >= 0.22 ? "BUY" : composite <= -0.22 ? "SELL" : "NEUTRAL";
  if (recommendation === "BUY" && rr != null && rr >= 75) recommendation = "NEUTRAL";
  if (recommendation === "SELL" && rr != null && rr <= 25) recommendation = "NEUTRAL";
  // High vol extreme → dampen to neutral unless structure confirms
  if (regime === "extreme" && Math.abs(composite) < 0.4) recommendation = "NEUTRAL";

  const reasons = layers.flatMap((l) =>
    l.detail.slice(0, 2).map((d) => `[${l.label}] ${d}`),
  );

  // Confidence from agreement + ADX + |composite|
  const aligned = layers.filter((l) =>
    recommendation === "BUY"
      ? l.bias === "bullish"
      : recommendation === "SELL"
        ? l.bias === "bearish"
        : l.bias === "neutral",
  ).length;
  let confidence = 0.45 + Math.abs(composite) * 0.35 + (aligned / layers.length) * 0.15;
  if (xx != null && xx > 25) confidence += 0.05;
  if (regime === "extreme") confidence -= 0.08;
  if (regime === "low" && recommendation !== "NEUTRAL") confidence -= 0.04;
  confidence = Number(Math.min(0.93, Math.max(0.35, confidence)).toFixed(2));

  const risk = aa ? Math.max(aa * 1.5, current * 0.001) : current * 0.005;
  let stopLoss: number | null = null;
  let takeProfit: number | null = null;
  let takeProfit2: number | null = null;

  if (recommendation === "BUY") {
    const structSl = sr ? Math.min(current - risk, sr.support - risk * 0.15) : current - risk;
    stopLoss = structSl;
    takeProfit = current + risk * 2;
    takeProfit2 = current + risk * 3.5;
    if (sr?.resistance && sr.resistance > current) {
      takeProfit = Math.min(takeProfit, sr.resistance);
      takeProfit2 = Math.max(takeProfit2, sr.resistance + risk * 0.5);
    }
  } else if (recommendation === "SELL") {
    const structSl = sr ? Math.max(current + risk, sr.resistance + risk * 0.15) : current + risk;
    stopLoss = structSl;
    takeProfit = current - risk * 2;
    takeProfit2 = current - risk * 3.5;
    if (sr?.support && sr.support < current) {
      takeProfit = Math.max(takeProfit, sr.support);
      takeProfit2 = Math.min(takeProfit2, sr.support - risk * 0.5);
    }
  }

  return {
    indicators: {
      rsi14: rr,
      macd: mm?.macd ?? null,
      macdSignal: mm?.signal ?? null,
      macdHistogram: mm?.histogram ?? null,
      ema20: e20,
      ema50: e50,
      ema200: e200,
      bollinger: bb,
      atr14: aa,
      adx14: xx,
      roc10,
      momentum10: mom10,
      bbWidth: bbW,
      support: sr?.support ?? null,
      resistance: sr?.resistance ?? null,
    },
    layers,
    compositeScore: Number(composite.toFixed(3)),
    marketStructure: swings.structure,
    volatilityRegime: regime,
    structureEvents: structEvents,
    levels: {
      support: sr?.support ?? null,
      resistance: sr?.resistance ?? null,
      entry: current,
      stopLoss,
      takeProfit,
      takeProfit2,
    },
    candlestickPatterns: candles,
    chartPatterns: charts,
    recommendation,
    entryPrice: current,
    stopLoss,
    takeProfit,
    takeProfit2,
    confidence,
    reasons: reasons.slice(0, 10),
    disclaimer: "Tín hiệu định lượng tham khảo, không phải lời khuyên đầu tư.",
  };
}
