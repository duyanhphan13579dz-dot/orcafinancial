/**
 * Phase 5 — Multi-Timeframe Engine
 *
 * Higher TF sets bias; lower TF times entry / pullback.
 */

import type { Ohlcv } from "@/lib/connectors/core";
import { emaSeries, rsi } from "@/lib/analysis";

export type MtfBias = "bullish" | "bearish" | "neutral" | "pullback";

export interface MtfFrame {
  timeframe: string;
  label: string;
  bias: MtfBias;
  score: number;
  detail: string;
}

export interface MtfResult {
  frames: MtfFrame[];
  overall: MtfBias;
  alignment: number;
  /** e.g. "aligned_bullish" | "htf_bull_ltf_pullback" | "conflict" */
  context: string;
  summary: string;
}

const MTF_STACK = [
  { tf: "1d", label: "1D", weight: 0.3 },
  { tf: "4h", label: "4H", weight: 0.25 },
  { tf: "1h", label: "1H", weight: 0.2 },
  { tf: "15m", label: "15M", weight: 0.15 },
  { tf: "5m", label: "5M", weight: 0.1 },
] as const;

export function mtfStackFor(symbol: string) {
  if (symbol.toUpperCase() === "DXY") {
    return [
      { tf: "1w", label: "1W", weight: 0.3 },
      { tf: "1d", label: "1D", weight: 0.3 },
      { tf: "4h", label: "4H", weight: 0.4 },
    ] as const;
  }
  return MTF_STACK;
}

function clamp(n: number, lo = -1, hi = 1) {
  return Math.max(lo, Math.min(hi, n));
}

/** Lightweight per-TF bias (no full 6-layer — speed for parallel MTF). */
export function biasFromBars(bars: Ohlcv[]): { bias: MtfBias; score: number; detail: string } {
  if (bars.length < 25) {
    return { bias: "neutral", score: 0, detail: "Insufficient bars" };
  }
  const closes = bars.map((b) => b.close);
  const current = closes[closes.length - 1];
  const e20 = emaSeries(closes, 20).at(-1)!;
  const e50 = emaSeries(closes, Math.min(50, closes.length - 1)).at(-1)!;
  const rr = rsi(closes);

  let score = 0;
  const parts: string[] = [];

  if (current > e20 && e20 > e50) {
    score += 0.55;
    parts.push("EMA↑");
  } else if (current < e20 && e20 < e50) {
    score -= 0.55;
    parts.push("EMA↓");
  } else {
    parts.push("EMA~");
  }

  // Slope of EMA20 over last 5 bars
  const e20s = emaSeries(closes, 20);
  if (e20s.length >= 6) {
    const slope = e20s[e20s.length - 1] - e20s[e20s.length - 6];
    const slopePct = slope / current;
    if (slopePct > 0.0005) {
      score += 0.15;
      parts.push("slope+");
    } else if (slopePct < -0.0005) {
      score -= 0.15;
      parts.push("slope-");
    }
  }

  if (rr != null) {
    if (rr < 32) {
      score += 0.2;
      parts.push(`RSI ${rr.toFixed(0)} OS`);
    } else if (rr > 68) {
      score -= 0.2;
      parts.push(`RSI ${rr.toFixed(0)} OB`);
    }
  }

  score = clamp(score);

  // Pullback: HTF-style bullish structure but short-term soft
  let bias: MtfBias =
    score >= 0.22 ? "bullish" : score <= -0.22 ? "bearish" : "neutral";

  // Detect pullback: price still above EMA50 but below EMA20 in uptrend context
  if (current > e50 && current < e20 && score > 0 && score < 0.35) {
    bias = "pullback";
    parts.push("pullback");
  } else if (current < e50 && current > e20 && score < 0 && score > -0.35) {
    bias = "pullback";
    parts.push("bear-rally");
  }

  return { bias, score: Number(score.toFixed(3)), detail: parts.join(" · ") };
}

export function buildMtfResult(
  framesInput: Array<{ timeframe: string; label: string; weight: number; bars: Ohlcv[] | null }>,
): MtfResult {
  const frames: MtfFrame[] = framesInput.map((f) => {
    if (!f.bars || f.bars.length < 25) {
      return {
        timeframe: f.timeframe,
        label: f.label,
        bias: "neutral" as MtfBias,
        score: 0,
        detail: "no data",
      };
    }
    const b = biasFromBars(f.bars);
    return {
      timeframe: f.timeframe,
      label: f.label,
      bias: b.bias,
      score: b.score,
      detail: b.detail,
    };
  });

  // Weighted overall from higher TFs primarily
  let wSum = 0;
  let acc = 0;
  framesInput.forEach((f, i) => {
    const fr = frames[i];
    const signed =
      fr.bias === "bullish"
        ? Math.max(0.25, fr.score)
        : fr.bias === "bearish"
          ? Math.min(-0.25, fr.score)
          : fr.bias === "pullback"
            ? fr.score * 0.4
            : fr.score * 0.2;
    acc += signed * f.weight;
    wSum += f.weight;
  });
  const overallScore = wSum ? acc / wSum : 0;
  const overall: MtfBias =
    overallScore >= 0.18 ? "bullish" : overallScore <= -0.18 ? "bearish" : "neutral";

  // Alignment: fraction of frames matching overall (pullback counts as soft match for HTF)
  const match = frames.filter((fr) => {
    if (overall === "bullish") return fr.bias === "bullish" || fr.bias === "pullback";
    if (overall === "bearish") return fr.bias === "bearish" || fr.bias === "pullback";
    return fr.bias === "neutral";
  }).length;
  const alignment = frames.length ? match / frames.length : 0;

  // Context
  const htf = frames.slice(0, Math.min(2, frames.length));
  const ltf = frames.slice(-2);
  const htfBull = htf.every((f) => f.bias === "bullish" || f.bias === "pullback" || f.score > 0.1);
  const htfBear = htf.every((f) => f.bias === "bearish" || f.bias === "pullback" || f.score < -0.1);
  const ltfPull = ltf.some((f) => f.bias === "pullback" || f.bias === "neutral");
  const ltfOpp =
    (overall === "bullish" && ltf.some((f) => f.bias === "bearish")) ||
    (overall === "bearish" && ltf.some((f) => f.bias === "bullish"));

  let context = "neutral";
  let summary = "Multi-timeframe mixed — wait for clarity";

  if (overall === "bullish" && alignment >= 0.6) {
    if (ltfPull && htfBull) {
      context = "htf_bull_ltf_pullback";
      summary = "Higher TF bullish · lower TF pullback — watch for long entry";
    } else if (ltfOpp) {
      context = "htf_bull_ltf_conflict";
      summary = "HTF bullish but LTF bearish — wait / reduce size";
    } else {
      context = "aligned_bullish";
      summary = "Multi-timeframe aligned bullish";
    }
  } else if (overall === "bearish" && alignment >= 0.6) {
    if (ltfPull && htfBear) {
      context = "htf_bear_ltf_pullback";
      summary = "Higher TF bearish · lower TF rally — watch for short entry";
    } else if (ltfOpp) {
      context = "htf_bear_ltf_conflict";
      summary = "HTF bearish but LTF bullish — wait / reduce size";
    } else {
      context = "aligned_bearish";
      summary = "Multi-timeframe aligned bearish";
    }
  } else if (htfBull && ltfOpp) {
    context = "conflict";
    summary = "HTF/LTF conflict — prefer wait";
  }

  return {
    frames,
    overall,
    alignment: Number(alignment.toFixed(3)),
    context,
    summary,
  };
}
