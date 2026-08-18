import type { Ohlcv } from "@/lib/connectors/core";
import { bollinger, emaSeries, macd, rsi } from "@/lib/analysis";
import { detectCandlestickPatterns, detectChartPatterns } from "@/lib/technical-patterns";

function last<T>(a: T[]) { return a[a.length - 1]; }
export function atr(bars: Ohlcv[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const ranges: number[] = [];
  for (let i = 1; i < bars.length; i++) ranges.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close)));
  return ranges.slice(-period).reduce((a, b) => a + b, 0) / period;
}
export function adx(bars: Ohlcv[], period = 14): number | null {
  if (bars.length < period * 2 + 1) return null;
  const tr: number[] = [], plusDm: number[] = [], minusDm: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    tr.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close)));
    const up = bars[i].high - bars[i - 1].high, down = bars[i - 1].low - bars[i].low;
    plusDm.push(up > down && up > 0 ? up : 0); minusDm.push(down > up && down > 0 ? down : 0);
  }
  const dx: number[] = [];
  for (let i = period - 1; i < tr.length; i++) {
    const t = tr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    const p = plusDm.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    const m = minusDm.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    if (!t) continue;
    const pdi = 100 * p / t, mdi = 100 * m / t;
    if (pdi + mdi) dx.push(100 * Math.abs(pdi - mdi) / (pdi + mdi));
  }
  return dx.length >= period ? dx.slice(-period).reduce((a, b) => a + b, 0) / period : null;
}

export interface CryptoTechnicalResult {
  indicators: Record<string, number | null | { upper: number; middle: number; lower: number }>;
  candlestickPatterns: ReturnType<typeof detectCandlestickPatterns>;
  chartPatterns: ReturnType<typeof detectChartPatterns>;
  recommendation: "LONG" | "SHORT" | "NEUTRAL";
  entryPrice: number; stopLoss: number | null; takeProfit: number | null;
  confidence: number; reasons: string[];
}

export function analyzeCrypto(bars: Ohlcv[], sentiment = 0): CryptoTechnicalResult {
  if (bars.length < 30) throw new Error("Insufficient OHLCV data for crypto analysis");
  const closes = bars.map((b) => b.close), current = last(closes);
  const e20 = last(emaSeries(closes, 20)), e50 = last(emaSeries(closes, 50));
  const e200 = closes.length >= 200 ? last(emaSeries(closes, 200)) : null;
  const r = rsi(closes), m = macd(closes), bb = bollinger(closes), a = atr(bars), x = adx(bars);
  const candles = detectCandlestickPatterns(bars).filter((p) => p.barIndex >= bars.length - 10).slice(-8);
  const charts = detectChartPatterns(bars).slice(-6);
  let bull = 0, bear = 0; const reasons: string[] = [];
  if (r !== null) { if (r < 35) { bull += 1; reasons.push(`RSI ${r.toFixed(1)} gần vùng quá bán`); } else if (r > 70) { bear += 1; reasons.push(`RSI ${r.toFixed(1)} ở vùng quá mua`); } }
  if (m) { if (m.histogram > 0) { bull += 1; reasons.push("MACD histogram dương"); } else { bear += 1; reasons.push("MACD histogram âm"); } }
  if (current > e20 && e20 > e50) { bull += 2; reasons.push("Giá > EMA20 > EMA50"); }
  else if (current < e20 && e20 < e50) { bear += 2; reasons.push("Giá < EMA20 < EMA50"); }
  if (e200 !== null) { if (current > e200) bull += 1; else bear += 1; }
  if (sentiment > .3) { bull += 1; reasons.push(`Sentiment tích cực ${sentiment.toFixed(2)}`); }
  if (sentiment < -.3) { bear += 1; reasons.push(`Sentiment tiêu cực ${sentiment.toFixed(2)}`); }
  bull += candles.filter((p) => p.type === "bullish").length * .3 + charts.filter((p) => p.type === "bullish").length * .5;
  bear += candles.filter((p) => p.type === "bearish").length * .3 + charts.filter((p) => p.type === "bearish").length * .5;
  const diff = bull - bear;
  const recommendation = diff >= 2 ? "LONG" : diff <= -2 ? "SHORT" : "NEUTRAL";
  const risk = a ? Math.max(a * 1.5, current * .01) : current * .02;
  const stopLoss = recommendation === "LONG" ? current - risk : recommendation === "SHORT" ? current + risk : null;
  const takeProfit = recommendation === "LONG" ? current + risk * 2 : recommendation === "SHORT" ? current - risk * 2 : null;
  const confidence = Math.min(.92, .5 + Math.abs(diff) * .07 + (x && x > 25 ? .08 : 0));
  return {
    indicators: { rsi14: r, macd: m?.macd ?? null, macdSignal: m?.signal ?? null, macdHistogram: m?.histogram ?? null, ema20: e20, ema50: e50, ema200: e200, bollinger: bb, atr14: a, adx14: x },
    candlestickPatterns: candles, chartPatterns: charts,
    recommendation, entryPrice: current, stopLoss, takeProfit,
    confidence: Number(confidence.toFixed(2)), reasons,
  };
}

const POSITIVE = ["surge", "rally", "bullish", "approval", "adoption", "record high", "inflow", "upgrade", "partnership", "launch", "gain"];
const NEGATIVE = ["hack", "exploit", "bearish", "ban", "lawsuit", "crash", "liquidation", "outflow", "fraud", "scam", "decline", "sell-off"];
export function cryptoSentimentScore(texts: string[]) {
  let score = 0, hits = 0;
  for (const raw of texts) {
    const text = raw.toLowerCase();
    for (const word of POSITIVE) if (text.includes(word)) { score += 1; hits++; }
    for (const word of NEGATIVE) if (text.includes(word)) { score -= 1; hits++; }
  }
  return hits ? Math.max(-1, Math.min(1, score / Math.max(3, Math.sqrt(hits) * 3))) : 0;
}
