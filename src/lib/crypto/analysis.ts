import type { Ohlcv } from "../connectors/core";
import { bollinger, emaSeries, macd, rsi } from "../analysis";
import { detectCandlestickPatterns, detectChartPatterns } from "../technical-patterns";

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
  const ema20Series = emaSeries(closes, 20);
  const ema50Series = emaSeries(closes, 50);
  const ema200Series = closes.length >= 200 ? emaSeries(closes, 200) : [];
  const e20 = last(ema20Series), e50 = last(ema50Series);
  const e200 = ema200Series.length ? last(ema200Series) : null;
  const previousE20 = ema20Series.length > 1 ? ema20Series[ema20Series.length - 2] : null;
  const r = rsi(closes), m = macd(closes), bb = bollinger(closes), a = atr(bars), x = adx(bars);
  const atrPct = a !== null && current > 0 ? (a / current) * 100 : null;
  const momentum5Threshold = Math.max(0.2, (atrPct ?? 0.2) * 1.5);
  const momentum20Threshold = Math.max(0.7, (atrPct ?? 0.2) * 3);
  const momentum50Threshold = Math.max(1.2, (atrPct ?? 0.2) * 5);
  const candles = detectCandlestickPatterns(bars).filter((p) => p.barIndex >= bars.length - 10).slice(-8);
  const charts = detectChartPatterns(bars).slice(-6);
  const return5Pct = closes.length > 5 ? ((current / closes[closes.length - 6]) - 1) * 100 : null;
  const return20Pct = closes.length > 20 ? ((current / closes[closes.length - 21]) - 1) * 100 : null;
  const return50Pct = closes.length > 50 ? ((current / closes[closes.length - 51]) - 1) * 100 : null;
  const bearishStructure = current < e20 && e20 < e50;
  const bullishStructure = current > e20 && e20 > e50;
  let bull = 0, bear = 0; const reasons: string[] = [];

  // RSI is a reversal/context signal, not an automatic LONG trigger. In a
  // confirmed downtrend, oversold RSI means downside pressure is extended;
  // it must not cancel the bearish structure by itself.
  if (r !== null) {
    if (r > 70) {
      bear += 1;
      reasons.push(`RSI ${r.toFixed(1)} ở vùng quá mua`);
    } else if (r < 30) {
      if (bearishStructure || (return5Pct ?? 0) < 0) {
        bear += 0.5;
        reasons.push(`RSI ${r.toFixed(1)} quá bán trong áp lực giảm — chưa xác nhận đảo chiều`);
      } else {
        bull += 1;
        reasons.push(`RSI ${r.toFixed(1)} gần vùng quá bán`);
      }
    }
  }
  if (m) {
    if (m.histogram > 0) { bull += 1; reasons.push("MACD histogram dương"); }
    else if (m.histogram < 0) { bear += 1; reasons.push("MACD histogram âm"); }
  }
  if (bullishStructure) { bull += 2; reasons.push("Giá > EMA20 > EMA50"); }
  else if (bearishStructure) { bear += 2; reasons.push("Giá < EMA20 < EMA50"); }
  else if (current < e20) {
    if (e20 > e50) { bull += 0.5; reasons.push("Giá dưới EMA20 nhưng EMA20 > EMA50 — pullback trong xu hướng tăng"); }
    else { bear += 0.5; reasons.push("Giá dưới EMA20 — cấu trúc chưa đồng thuận hoàn toàn"); }
  }
  else if (current > e20) {
    if (e20 < e50) { bear += 0.5; reasons.push("Giá trên EMA20 nhưng EMA20 < EMA50 — hồi phục trong xu hướng giảm"); }
    else { bull += 0.5; reasons.push("Giá trên EMA20 — cấu trúc chưa đồng thuận hoàn toàn"); }
  }

  if (previousE20 !== null) {
    const emaSlopePct = ((e20 / previousE20) - 1) * 100;
    if (emaSlopePct <= -0.05) { bear += 0.5; reasons.push(`EMA20 dốc xuống ${emaSlopePct.toFixed(2)}%`); }
    else if (emaSlopePct >= 0.05) { bull += 0.5; reasons.push(`EMA20 dốc lên ${emaSlopePct.toFixed(2)}%`); }
  }
  if (return5Pct !== null) {
    if (return5Pct <= -momentum5Threshold) { bear += 0.75; reasons.push(`Động lượng 5 nến giảm ${return5Pct.toFixed(2)}%`); }
    else if (return5Pct >= momentum5Threshold) { bull += 0.75; reasons.push(`Động lượng 5 nến tăng ${return5Pct.toFixed(2)}%`); }
  }
  if (return20Pct !== null) {
    if (return20Pct <= -momentum20Threshold) { bear += 1.25; reasons.push(`Giá giảm ${return20Pct.toFixed(2)}% trong 20 nến`); }
    else if (return20Pct >= momentum20Threshold) { bull += 1.25; reasons.push(`Giá tăng ${return20Pct.toFixed(2)}% trong 20 nến`); }
    else if (bearishStructure && return20Pct < 0) { bear += 0.75; reasons.push(`Xu hướng giảm còn duy trì: dưới EMA20/EMA50 và 20 nến vẫn âm ${return20Pct.toFixed(2)}%`); }
    else if (bullishStructure && return20Pct > 0) { bull += 0.75; reasons.push(`Xu hướng tăng còn duy trì: trên EMA20/EMA50 và 20 nến vẫn dương ${return20Pct.toFixed(2)}%`); }
  }
  if (return50Pct !== null) {
    if (return50Pct <= -momentum50Threshold) { bear += 1; reasons.push(`Giá giảm ${return50Pct.toFixed(2)}% trong 50 nến`); }
    else if (return50Pct >= momentum50Threshold) { bull += 1; reasons.push(`Giá tăng ${return50Pct.toFixed(2)}% trong 50 nến`); }
  }
  if (e200 !== null) { if (current > e200) bull += 1; else bear += 1; }
  if (sentiment > .3) { bull += 1; reasons.push(`Sentiment tích cực ${sentiment.toFixed(2)}`); }
  if (sentiment < -.3) { bear += 1; reasons.push(`Sentiment tiêu cực ${sentiment.toFixed(2)}`); }
  bull += candles.filter((p) => p.type === "bullish").length * .3 + charts.filter((p) => p.type === "bullish").length * .5;
  bear += candles.filter((p) => p.type === "bearish").length * .3 + charts.filter((p) => p.type === "bearish").length * .5;
  const diff = bull - bear;
  const rawRecommendation = diff >= 2 ? "LONG" : diff <= -2 ? "SHORT" : "NEUTRAL";
  const longConfirmation = bullishStructure || (current > e50 && (return20Pct ?? 0) >= 0 && (m?.histogram ?? 0) > 0);
  const shortConfirmation = bearishStructure || (current < e50 && (return20Pct ?? 0) <= 0 && (m?.histogram ?? 0) < 0);
  const recommendation =
    rawRecommendation === "LONG" && !longConfirmation
      ? "NEUTRAL"
      : rawRecommendation === "SHORT" && !shortConfirmation
        ? "NEUTRAL"
        : rawRecommendation;
  if (rawRecommendation !== recommendation) {
    reasons.push(`${rawRecommendation} bị hạ NEUTRAL: thiếu xác nhận phá EMA50/đồng thuận xu hướng`);
  }
  const risk = a ? Math.max(a * 1.5, current * .01) : current * .02;
  const stopLoss = recommendation === "LONG" ? current - risk : recommendation === "SHORT" ? current + risk : null;
  const takeProfit = recommendation === "LONG" ? current + risk * 2 : recommendation === "SHORT" ? current - risk * 2 : null;
  const confidence = Math.min(.92, .5 + Math.abs(diff) * .07 + (x && x > 25 ? .08 : 0));
  return {
    indicators: {
      rsi14: r,
      macd: m?.macd ?? null,
      macdSignal: m?.signal ?? null,
      macdHistogram: m?.histogram ?? null,
      ema20: e20,
      ema50: e50,
      ema200: e200,
      return5Pct,
      return20Pct,
      return50Pct,
      atrPct,
      bullishScore: Number(bull.toFixed(2)),
      bearishScore: Number(bear.toFixed(2)),
      scoreDiff: Number(diff.toFixed(2)),
      bollinger: bb,
      atr14: a,
      adx14: x,
    },
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
