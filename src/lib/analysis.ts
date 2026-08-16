import type { Ohlcv } from "@/lib/connectors/core";

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

export function macd(closes: number[]): { macd: number; signal: number; histogram: number } | null {
  if (closes.length < 35) return null;
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = emaSeries(macdLine.slice(-60), 9);
  const m = macdLine[macdLine.length - 1];
  const s = signalLine[signalLine.length - 1];
  return { macd: m, signal: s, histogram: m - s };
}

export function bollinger(closes: number[], period = 20): { upper: number; middle: number; lower: number } | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mid + 2 * sd, middle: mid, lower: mid - 2 * sd };
}

export function supportResistance(bars: Ohlcv[]): { support: number; resistance: number } | null {
  if (bars.length < 20) return null;
  const recent = bars.slice(-60);
  return {
    support: Math.min(...recent.map((b) => b.low)),
    resistance: Math.max(...recent.map((b) => b.high)),
  };
}

export type Recommendation = "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell";

export interface AnalysisResult {
  symbol: string;
  lastClose: number;
  changePct1d: number | null;
  changePct1m: number | null;
  volumeVsAvg20: number | null;
  rsi14: number | null;
  macd: { macd: number; signal: number; histogram: number } | null;
  sma20: number | null;
  sma50: number | null;
  bollinger: { upper: number; middle: number; lower: number } | null;
  supportResistance: { support: number; resistance: number } | null;
  volatilityPct: number | null;
  maxDrawdownPct: number | null;
  recommendation: Recommendation;
  score: number;
  confidence: number;
  reasons: string[];
}

export function analyze(symbol: string, bars: Ohlcv[]): AnalysisResult {
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const last = closes[closes.length - 1];
  const prev = closes.length > 1 ? closes[closes.length - 2] : null;
  const monthAgo = closes.length > 22 ? closes[closes.length - 23] : null;

  const r = rsi(closes);
  const m = macd(closes);
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const bb = bollinger(closes);
  const sr = supportResistance(bars);
  const avgVol20 = sma(volumes, 20);
  const lastVol = volumes[volumes.length - 1];

  // Daily returns volatility (annualized approximation, %)
  let volatility: number | null = null;
  if (closes.length > 21) {
    const rets = [];
    for (let i = closes.length - 21; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
    volatility = sd * Math.sqrt(252) * 100;
  }

  // Max drawdown over the window
  let peak = -Infinity;
  let maxDd = 0;
  for (const c of closes) {
    peak = Math.max(peak, c);
    maxDd = Math.max(maxDd, (peak - c) / peak);
  }

  const reasons: string[] = [];
  let score = 0;
  let signals = 0;

  if (r !== null) {
    signals++;
    if (r < 30) { score += 2; reasons.push(`RSI(14) = ${r.toFixed(1)} — vùng quá bán, khả năng hồi phục`); }
    else if (r < 45) { score += 1; reasons.push(`RSI(14) = ${r.toFixed(1)} — trung tính thiên tích cực`); }
    else if (r > 70) { score -= 2; reasons.push(`RSI(14) = ${r.toFixed(1)} — vùng quá mua, rủi ro điều chỉnh`); }
    else if (r > 55) { score -= 0.5; reasons.push(`RSI(14) = ${r.toFixed(1)} — động lượng cao`); }
    else { reasons.push(`RSI(14) = ${r.toFixed(1)} — trung tính`); }
  }

  if (m !== null) {
    signals++;
    if (m.histogram > 0 && m.macd > 0) { score += 1.5; reasons.push("MACD dương và trên đường tín hiệu — xu hướng tăng"); }
    else if (m.histogram > 0) { score += 1; reasons.push("MACD cắt lên đường tín hiệu — tín hiệu tích cực"); }
    else if (m.histogram < 0 && m.macd < 0) { score -= 1.5; reasons.push("MACD âm và dưới đường tín hiệu — xu hướng giảm"); }
    else { score -= 0.5; reasons.push("MACD dưới đường tín hiệu — động lượng yếu"); }
  }

  if (s20 !== null && s50 !== null) {
    signals++;
    if (last > s20 && s20 > s50) { score += 1.5; reasons.push(`Giá trên SMA20 (${s20.toFixed(2)}) và SMA20 > SMA50 — cấu trúc tăng`); }
    else if (last < s20 && s20 < s50) { score -= 1.5; reasons.push(`Giá dưới SMA20 (${s20.toFixed(2)}) và SMA20 < SMA50 — cấu trúc giảm`); }
    else { reasons.push("Giá dao động quanh các đường trung bình — chưa rõ xu hướng"); }
  }

  if (bb !== null) {
    signals++;
    if (last <= bb.lower * 1.01) { score += 1; reasons.push("Giá chạm dải Bollinger dưới — khả năng hồi kỹ thuật"); }
    else if (last >= bb.upper * 0.99) { score -= 1; reasons.push("Giá chạm dải Bollinger trên — áp lực chốt lời"); }
  }

  if (avgVol20 !== null && avgVol20 > 0) {
    signals++;
    const ratio = lastVol / avgVol20;
    if (ratio > 1.5 && prev !== null && last > prev) { score += 1; reasons.push(`Khối lượng gấp ${ratio.toFixed(1)}x trung bình 20 phiên kèm giá tăng — dòng tiền vào`); }
    else if (ratio > 1.5 && prev !== null && last < prev) { score -= 1; reasons.push(`Khối lượng gấp ${ratio.toFixed(1)}x trung bình kèm giá giảm — áp lực bán mạnh`); }
  }

  const normalized = signals > 0 ? score / (signals * 1.5) : 0;
  let recommendation: Recommendation = "Hold";
  if (normalized > 0.5) recommendation = "Strong Buy";
  else if (normalized > 0.2) recommendation = "Buy";
  else if (normalized < -0.5) recommendation = "Strong Sell";
  else if (normalized < -0.2) recommendation = "Sell";

  const confidence = Math.min(0.95, 0.5 + Math.abs(normalized) * 0.4 + Math.min(signals, 5) * 0.02);

  return {
    symbol,
    lastClose: last,
    changePct1d: prev !== null ? ((last - prev) / prev) * 100 : null,
    changePct1m: monthAgo !== null ? ((last - monthAgo) / monthAgo) * 100 : null,
    volumeVsAvg20: avgVol20 !== null && avgVol20 > 0 ? lastVol / avgVol20 : null,
    rsi14: r,
    macd: m,
    sma20: s20,
    sma50: s50,
    bollinger: bb,
    supportResistance: sr,
    volatilityPct: volatility,
    maxDrawdownPct: maxDd * 100,
    recommendation,
    score: Number(normalized.toFixed(3)),
    confidence: Number(confidence.toFixed(2)),
    reasons,
  };
}
