/**
 * Client/server pure helpers to build full indicator series for pro chart.
 */

import { emaSeries } from "@/lib/analysis";
import type { Bar } from "@/components/candle-chart";

export interface LinePoint {
  time: number;
  value: number;
}

export interface HistPoint {
  time: number;
  value: number;
  color?: string;
}

function valid(v: number) {
  return Number.isFinite(v);
}

export function buildEmaSeries(bars: Bar[], period: number): LinePoint[] {
  const closes = bars.map((b) => b.close);
  if (closes.length < period) return [];
  const series = emaSeries(closes, period);
  const out: LinePoint[] = [];
  // skip warm-up: first `period` points are noisy
  for (let i = period - 1; i < bars.length; i++) {
    if (valid(series[i])) out.push({ time: bars[i].time, value: series[i] });
  }
  return out;
}

export function buildBollingerSeries(
  bars: Bar[],
  period = 20,
  mult = 2,
): { upper: LinePoint[]; middle: LinePoint[]; lower: LinePoint[] } {
  const closes = bars.map((b) => b.close);
  const upper: LinePoint[] = [];
  const middle: LinePoint[] = [];
  const lower: LinePoint[] = [];
  if (closes.length < period) return { upper, middle, lower };

  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mid = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    const t = bars[i].time;
    upper.push({ time: t, value: mid + mult * sd });
    middle.push({ time: t, value: mid });
    lower.push({ time: t, value: mid - mult * sd });
  }
  return { upper, middle, lower };
}

/** Wilder RSI series (smoothed). */
export function buildRsiSeries(bars: Bar[], period = 14): LinePoint[] {
  const closes = bars.map((b) => b.close);
  if (closes.length < period + 1) return [];
  const out: LinePoint[] = [];

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;

  const first =
    avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  out.push({ time: bars[period].time, value: first });

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rsi =
      avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    out.push({ time: bars[i].time, value: rsi });
  }
  return out;
}

export function buildMacdSeries(
  bars: Bar[],
): { macd: LinePoint[]; signal: LinePoint[]; histogram: HistPoint[] } {
  const closes = bars.map((b) => b.close);
  const empty = { macd: [] as LinePoint[], signal: [] as LinePoint[], histogram: [] as HistPoint[] };
  if (closes.length < 35) return empty;

  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalFull = emaSeries(macdLine, 9);

  const macd: LinePoint[] = [];
  const signal: LinePoint[] = [];
  const histogram: HistPoint[] = [];

  // start after EMA26 warm-up
  for (let i = 25; i < bars.length; i++) {
    const m = macdLine[i];
    const s = signalFull[i];
    if (!valid(m) || !valid(s)) continue;
    const h = m - s;
    const t = bars[i].time;
    macd.push({ time: t, value: m });
    signal.push({ time: t, value: s });
    histogram.push({
      time: t,
      value: h,
      color: h >= 0 ? "rgba(52, 211, 153, 0.55)" : "rgba(251, 113, 133, 0.55)",
    });
  }
  return { macd, signal, histogram };
}

export function swingSupportResistance(bars: Bar[]): {
  support: number | null;
  resistance: number | null;
} {
  if (bars.length < 20) return { support: null, resistance: null };
  const recent = bars.slice(-60);
  return {
    support: Math.min(...recent.map((b) => b.low)),
    resistance: Math.max(...recent.map((b) => b.high)),
  };
}
