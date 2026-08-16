/**
 * Technical Analyst — candlestick pattern detection & chart pattern detection.
 * Pure functions operating on Ohlcv bars; no external dependencies.
 */

import type { Ohlcv } from "@/lib/connectors/core";

/* ═══════════════════════════════════════════════════════════════════════
   CANDLESTICK PATTERNS (single, dual, triple candle)
   ═══════════════════════════════════════════════════════════════════════ */

export interface CandlePattern {
  name: string;
  nameVi: string;
  type: "bullish" | "bearish" | "neutral";
  barIndex: number;      // index in the input array where the pattern completes
  time: number;          // unix timestamp of that bar
  reliability: number;   // 0–1 subjective pattern reliability
  description: string;
}

function bodySize(b: Ohlcv): number { return Math.abs(b.close - b.open); }
function upperWick(b: Ohlcv): number { return b.high - Math.max(b.open, b.close); }
function lowerWick(b: Ohlcv): number { return Math.min(b.open, b.close) - b.low; }
function isBullish(b: Ohlcv): boolean { return b.close > b.open; }
function isBearish(b: Ohlcv): boolean { return b.close < b.open; }
function range(b: Ohlcv): number { return b.high - b.low || 0.001; }
function midpoint(b: Ohlcv): number { return (b.open + b.close) / 2; }

function avgBody(bars: Ohlcv[], end: number, n = 10): number {
  let sum = 0;
  const start = Math.max(0, end - n);
  for (let i = start; i < end; i++) sum += bodySize(bars[i]);
  return sum / Math.max(1, end - start);
}

export function detectCandlestickPatterns(bars: Ohlcv[]): CandlePattern[] {
  const patterns: CandlePattern[] = [];
  if (bars.length < 5) return patterns;

  // Only scan the most recent 60 bars for relevance
  const start = Math.max(3, bars.length - 60);

  for (let i = start; i < bars.length; i++) {
    const c = bars[i];
    const p1 = bars[i - 1];
    const p2 = i >= 2 ? bars[i - 2] : null;
    const body = bodySize(c);
    const uw = upperWick(c);
    const lw = lowerWick(c);
    const rng = range(c);
    const ab = avgBody(bars, i);

    // ── Doji ──
    if (body / rng < 0.1 && rng > 0) {
      patterns.push({
        name: "Doji", nameVi: "Doji", type: "neutral", barIndex: i, time: c.time,
        reliability: 0.5,
        description: "Giá mở và đóng gần bằng nhau — sự do dự của thị trường, tín hiệu đảo chiều tiềm năng.",
      });
    }

    // ── Dragonfly Doji ──
    if (body / rng < 0.1 && lw > rng * 0.6 && uw < rng * 0.1) {
      patterns.push({
        name: "Dragonfly Doji", nameVi: "Doji Chuồn Chuồn", type: "bullish", barIndex: i, time: c.time,
        reliability: 0.6,
        description: "Doji với bóng dưới dài — phe mua đẩy giá lên từ vùng thấp, tín hiệu đảo chiều tăng.",
      });
    }

    // ── Gravestone Doji ──
    if (body / rng < 0.1 && uw > rng * 0.6 && lw < rng * 0.1) {
      patterns.push({
        name: "Gravestone Doji", nameVi: "Doji Bia Mộ", type: "bearish", barIndex: i, time: c.time,
        reliability: 0.6,
        description: "Doji với bóng trên dài — phe bán kiểm soát, tín hiệu đảo chiều giảm.",
      });
    }

    // ── Hammer ──
    if (lw >= body * 2 && uw < body * 0.5 && body > ab * 0.3 && isBearish(p1)) {
      patterns.push({
        name: "Hammer", nameVi: "Nến Búa", type: "bullish", barIndex: i, time: c.time,
        reliability: 0.65,
        description: "Thân nhỏ + bóng dưới dài sau downtrend — tín hiệu đảo chiều tăng mạnh.",
      });
    }

    // ── Inverted Hammer ──
    if (uw >= body * 2 && lw < body * 0.5 && body > ab * 0.3 && isBearish(p1)) {
      patterns.push({
        name: "Inverted Hammer", nameVi: "Búa Ngược", type: "bullish", barIndex: i, time: c.time,
        reliability: 0.55,
        description: "Thân nhỏ + bóng trên dài sau downtrend — nến đảo chiều tăng tiềm năng.",
      });
    }

    // ── Shooting Star ──
    if (uw >= body * 2 && lw < body * 0.5 && body > ab * 0.3 && isBullish(p1)) {
      patterns.push({
        name: "Shooting Star", nameVi: "Sao Băng", type: "bearish", barIndex: i, time: c.time,
        reliability: 0.65,
        description: "Thân nhỏ + bóng trên dài sau uptrend — phe bán ép giá xuống, cảnh báo đảo chiều giảm.",
      });
    }

    // ── Hanging Man ──
    if (lw >= body * 2 && uw < body * 0.5 && body > ab * 0.3 && isBullish(p1)) {
      patterns.push({
        name: "Hanging Man", nameVi: "Người Treo Cổ", type: "bearish", barIndex: i, time: c.time,
        reliability: 0.6,
        description: "Hình dạng giống Hammer nhưng xuất hiện sau uptrend — cảnh báo đảo chiều giảm.",
      });
    }

    // ── Bullish Engulfing ──
    if (isBearish(p1) && isBullish(c) && c.open <= p1.close && c.close >= p1.open && body > bodySize(p1) * 1.2) {
      patterns.push({
        name: "Bullish Engulfing", nameVi: "Nhấn Chìm Tăng", type: "bullish", barIndex: i, time: c.time,
        reliability: 0.75,
        description: "Nến tăng bao trùm hoàn toàn nến giảm trước đó — tín hiệu đảo chiều tăng mạnh.",
      });
    }

    // ── Bearish Engulfing ──
    if (isBullish(p1) && isBearish(c) && c.open >= p1.close && c.close <= p1.open && body > bodySize(p1) * 1.2) {
      patterns.push({
        name: "Bearish Engulfing", nameVi: "Nhấn Chìm Giảm", type: "bearish", barIndex: i, time: c.time,
        reliability: 0.75,
        description: "Nến giảm bao trùm hoàn toàn nến tăng trước đó — tín hiệu đảo chiều giảm mạnh.",
      });
    }

    // ── Bullish Harami ──
    if (isBearish(p1) && isBullish(c) && c.open >= p1.close && c.close <= p1.open && body < bodySize(p1) * 0.5) {
      patterns.push({
        name: "Bullish Harami", nameVi: "Harami Tăng", type: "bullish", barIndex: i, time: c.time,
        reliability: 0.55,
        description: "Nến tăng nhỏ nằm trong thân nến giảm lớn — có thể báo hiệu đảo chiều tăng.",
      });
    }

    // ── Bearish Harami ──
    if (isBullish(p1) && isBearish(c) && c.open <= p1.close && c.close >= p1.open && body < bodySize(p1) * 0.5) {
      patterns.push({
        name: "Bearish Harami", nameVi: "Harami Giảm", type: "bearish", barIndex: i, time: c.time,
        reliability: 0.55,
        description: "Nến giảm nhỏ nằm trong thân nến tăng lớn — có thể báo hiệu đảo chiều giảm.",
      });
    }

    // ── Morning Star (triple) ──
    if (p2 && isBearish(p2) && bodySize(p1) < avgBody(bars, i) * 0.4 && isBullish(c) && c.close > midpoint(p2)) {
      patterns.push({
        name: "Morning Star", nameVi: "Sao Mai", type: "bullish", barIndex: i, time: c.time,
        reliability: 0.80,
        description: "Nến giảm lớn → nến thân nhỏ (do dự) → nến tăng lớn — mẫu đảo chiều tăng mạnh 3 nến.",
      });
    }

    // ── Evening Star (triple) ──
    if (p2 && isBullish(p2) && bodySize(p1) < avgBody(bars, i) * 0.4 && isBearish(c) && c.close < midpoint(p2)) {
      patterns.push({
        name: "Evening Star", nameVi: "Sao Hôm", type: "bearish", barIndex: i, time: c.time,
        reliability: 0.80,
        description: "Nến tăng lớn → nến thân nhỏ (do dự) → nến giảm lớn — mẫu đảo chiều giảm mạnh 3 nến.",
      });
    }

    // ── Three White Soldiers ──
    if (p2 && isBullish(p2) && isBullish(p1) && isBullish(c)
        && p1.close > p2.close && c.close > p1.close
        && bodySize(p2) > ab * 0.5 && bodySize(p1) > ab * 0.5 && body > ab * 0.5) {
      patterns.push({
        name: "Three White Soldiers", nameVi: "Ba Chàng Lính", type: "bullish", barIndex: i, time: c.time,
        reliability: 0.75,
        description: "Ba nến tăng liên tiếp với thân lớn — xu hướng tăng mạnh.",
      });
    }

    // ── Three Black Crows ──
    if (p2 && isBearish(p2) && isBearish(p1) && isBearish(c)
        && p1.close < p2.close && c.close < p1.close
        && bodySize(p2) > ab * 0.5 && bodySize(p1) > ab * 0.5 && body > ab * 0.5) {
      patterns.push({
        name: "Three Black Crows", nameVi: "Ba Con Quạ", type: "bearish", barIndex: i, time: c.time,
        reliability: 0.75,
        description: "Ba nến giảm liên tiếp với thân lớn — xu hướng giảm mạnh.",
      });
    }

    // ── Spinning Top ──
    if (body / rng < 0.3 && body > 0 && uw > body * 0.8 && lw > body * 0.8) {
      patterns.push({
        name: "Spinning Top", nameVi: "Con Quay", type: "neutral", barIndex: i, time: c.time,
        reliability: 0.4,
        description: "Thân nhỏ với bóng trên và dưới gần bằng nhau — thị trường do dự.",
      });
    }

    // ── Marubozu ──
    if (uw < rng * 0.02 && lw < rng * 0.02 && body > ab * 1.5) {
      patterns.push({
        name: isBullish(c) ? "Bullish Marubozu" : "Bearish Marubozu",
        nameVi: isBullish(c) ? "Marubozu Tăng" : "Marubozu Giảm",
        type: isBullish(c) ? "bullish" : "bearish",
        barIndex: i, time: c.time,
        reliability: 0.70,
        description: isBullish(c)
          ? "Nến tăng không có bóng — phe mua kiểm soát hoàn toàn phiên."
          : "Nến giảm không có bóng — phe bán kiểm soát hoàn toàn phiên.",
      });
    }
  }

  return patterns;
}


/* ═══════════════════════════════════════════════════════════════════════
   CHART PATTERNS (price structure patterns over many bars)
   ═══════════════════════════════════════════════════════════════════════ */

export interface ChartPattern {
  name: string;
  nameVi: string;
  type: "bullish" | "bearish" | "neutral";
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  reliability: number;
  target: number | null;       // price target if breakout
  description: string;
}

/** Find local maxima/minima (swing points) */
function findSwings(closes: number[], order = 5): { highs: [number, number][]; lows: [number, number][] } {
  const highs: [number, number][] = []; // [index, value]
  const lows: [number, number][] = [];
  for (let i = order; i < closes.length - order; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= order; j++) {
      if (closes[i] <= closes[i - j] || closes[i] <= closes[i + j]) isHigh = false;
      if (closes[i] >= closes[i - j] || closes[i] >= closes[i + j]) isLow = false;
    }
    if (isHigh) highs.push([i, closes[i]]);
    if (isLow) lows.push([i, closes[i]]);
  }
  return { highs, lows };
}

function pctDiff(a: number, b: number): number { return Math.abs(a - b) / Math.max(a, b, 0.001); }

export function detectChartPatterns(bars: Ohlcv[]): ChartPattern[] {
  if (bars.length < 40) return [];
  const patterns: ChartPattern[] = [];
  const closes = bars.map((b) => b.close);
  const recent = bars.slice(-120);
  const recentCloses = recent.map((b) => b.close);
  const offset = bars.length - recent.length;
  const { highs, lows } = findSwings(recentCloses, 4);

  // ── Double Top ──
  for (let i = 0; i < highs.length - 1; i++) {
    const [i1, h1] = highs[i];
    const [i2, h2] = highs[i + 1];
    if (i2 - i1 < 8 || i2 - i1 > 60) continue;
    if (pctDiff(h1, h2) < 0.03) {
      // Find neckline (lowest low between the two peaks)
      const neckline = Math.min(...recentCloses.slice(i1, i2 + 1));
      const patternHeight = ((h1 + h2) / 2) - neckline;
      const currentPrice = recentCloses[recentCloses.length - 1];
      if (currentPrice < neckline * 1.01) {
        patterns.push({
          name: "Double Top", nameVi: "Hai Đỉnh", type: "bearish",
          startIndex: i1 + offset, endIndex: i2 + offset,
          startTime: recent[i1].time, endTime: recent[i2].time,
          reliability: 0.70,
          target: neckline - patternHeight,
          description: `Hai đỉnh gần bằng nhau tại ~${h1.toFixed(1)} — giá đã phá neckline ${neckline.toFixed(1)}, mục tiêu giảm ~${(neckline - patternHeight).toFixed(1)}.`,
        });
      }
    }
  }

  // ── Double Bottom ──
  for (let i = 0; i < lows.length - 1; i++) {
    const [i1, l1] = lows[i];
    const [i2, l2] = lows[i + 1];
    if (i2 - i1 < 8 || i2 - i1 > 60) continue;
    if (pctDiff(l1, l2) < 0.03) {
      const neckline = Math.max(...recentCloses.slice(i1, i2 + 1));
      const patternHeight = neckline - (l1 + l2) / 2;
      const currentPrice = recentCloses[recentCloses.length - 1];
      if (currentPrice > neckline * 0.99) {
        patterns.push({
          name: "Double Bottom", nameVi: "Hai Đáy", type: "bullish",
          startIndex: i1 + offset, endIndex: i2 + offset,
          startTime: recent[i1].time, endTime: recent[i2].time,
          reliability: 0.70,
          target: neckline + patternHeight,
          description: `Hai đáy gần bằng nhau tại ~${l1.toFixed(1)} — giá vượt neckline ${neckline.toFixed(1)}, mục tiêu tăng ~${(neckline + patternHeight).toFixed(1)}.`,
        });
      }
    }
  }

  // ── Head and Shoulders ──
  if (highs.length >= 3) {
    for (let i = 0; i < highs.length - 2; i++) {
      const [i1, h1] = highs[i];
      const [i2, h2] = highs[i + 1];
      const [i3, h3] = highs[i + 2];
      // Head must be the highest
      if (h2 > h1 && h2 > h3 && pctDiff(h1, h3) < 0.05 && i3 - i1 > 15) {
        const neckline = Math.min(
          ...recentCloses.slice(i1, i2 + 1),
          ...recentCloses.slice(i2, i3 + 1),
        );
        const patternHeight = h2 - neckline;
        const currentPrice = recentCloses[recentCloses.length - 1];
        if (currentPrice < neckline * 1.02) {
          patterns.push({
            name: "Head and Shoulders", nameVi: "Vai Đầu Vai", type: "bearish",
            startIndex: i1 + offset, endIndex: i3 + offset,
            startTime: recent[i1].time, endTime: recent[i3].time,
            reliability: 0.80,
            target: neckline - patternHeight,
            description: `Vai trái ${h1.toFixed(1)}, đầu ${h2.toFixed(1)}, vai phải ${h3.toFixed(1)} — neckline ~${neckline.toFixed(1)}. Nếu phá vỡ, mục tiêu giảm ~${(neckline - patternHeight).toFixed(1)}.`,
          });
        }
      }
    }
  }

  // ── Inverse Head and Shoulders ──
  if (lows.length >= 3) {
    for (let i = 0; i < lows.length - 2; i++) {
      const [i1, l1] = lows[i];
      const [i2, l2] = lows[i + 1];
      const [i3, l3] = lows[i + 2];
      if (l2 < l1 && l2 < l3 && pctDiff(l1, l3) < 0.05 && i3 - i1 > 15) {
        const neckline = Math.max(
          ...recentCloses.slice(i1, i2 + 1),
          ...recentCloses.slice(i2, i3 + 1),
        );
        const patternHeight = neckline - l2;
        const currentPrice = recentCloses[recentCloses.length - 1];
        if (currentPrice > neckline * 0.98) {
          patterns.push({
            name: "Inverse Head and Shoulders", nameVi: "Vai Đầu Vai Ngược", type: "bullish",
            startIndex: i1 + offset, endIndex: i3 + offset,
            startTime: recent[i1].time, endTime: recent[i3].time,
            reliability: 0.80,
            target: neckline + patternHeight,
            description: `Vai trái ${l1.toFixed(1)}, đầu ${l2.toFixed(1)}, vai phải ${l3.toFixed(1)} — neckline ~${neckline.toFixed(1)}. Nếu vượt, mục tiêu tăng ~${(neckline + patternHeight).toFixed(1)}.`,
          });
        }
      }
    }
  }

  // ── Ascending Triangle ──
  if (highs.length >= 2 && lows.length >= 2) {
    const recentHighs = highs.slice(-4);
    const recentLows = lows.slice(-4);
    const flatTop = recentHighs.every(([, v]) => pctDiff(v, recentHighs[0][1]) < 0.02);
    const risingBottom = recentLows.length >= 2 && recentLows[recentLows.length - 1][1] > recentLows[0][1] * 1.02;
    if (flatTop && risingBottom && recentHighs.length >= 2) {
      const resistance = recentHighs.reduce((s, [, v]) => s + v, 0) / recentHighs.length;
      const support = recentLows[recentLows.length - 1][1];
      patterns.push({
        name: "Ascending Triangle", nameVi: "Tam Giác Tăng", type: "bullish",
        startIndex: recentLows[0][0] + offset, endIndex: recentHighs[recentHighs.length - 1][0] + offset,
        startTime: recent[recentLows[0][0]]?.time ?? 0, endTime: recent[recentHighs[recentHighs.length - 1][0]]?.time ?? 0,
        reliability: 0.65,
        target: resistance + (resistance - support),
        description: `Kháng cự phẳng ~${resistance.toFixed(1)} với đáy tăng dần — breakout tăng tiềm năng, mục tiêu ~${(resistance + (resistance - support)).toFixed(1)}.`,
      });
    }
  }

  // ── Descending Triangle ──
  if (highs.length >= 2 && lows.length >= 2) {
    const recentHighs = highs.slice(-4);
    const recentLows = lows.slice(-4);
    const flatBottom = recentLows.every(([, v]) => pctDiff(v, recentLows[0][1]) < 0.02);
    const fallingTop = recentHighs.length >= 2 && recentHighs[recentHighs.length - 1][1] < recentHighs[0][1] * 0.98;
    if (flatBottom && fallingTop && recentLows.length >= 2) {
      const support = recentLows.reduce((s, [, v]) => s + v, 0) / recentLows.length;
      const resistance = recentHighs[0][1];
      patterns.push({
        name: "Descending Triangle", nameVi: "Tam Giác Giảm", type: "bearish",
        startIndex: recentHighs[0][0] + offset, endIndex: recentLows[recentLows.length - 1][0] + offset,
        startTime: recent[recentHighs[0][0]]?.time ?? 0, endTime: recent[recentLows[recentLows.length - 1][0]]?.time ?? 0,
        reliability: 0.65,
        target: support - (resistance - support),
        description: `Hỗ trợ phẳng ~${support.toFixed(1)} với đỉnh giảm dần — breakout giảm tiềm năng, mục tiêu ~${(support - (resistance - support)).toFixed(1)}.`,
      });
    }
  }

  // ── Cup and Handle (simplified) ──
  if (lows.length >= 3 && recentCloses.length > 40) {
    // Look for a U-shape: high → low → recovery near previous high
    const earlyHigh = Math.max(...recentCloses.slice(0, 15));
    const cupLow = Math.min(...recentCloses.slice(10, 40));
    const lateHigh = Math.max(...recentCloses.slice(Math.max(30, recentCloses.length - 15)));
    if (cupLow < earlyHigh * 0.88 && lateHigh > earlyHigh * 0.95) {
      const depth = earlyHigh - cupLow;
      patterns.push({
        name: "Cup and Handle", nameVi: "Cốc Tay Cầm", type: "bullish",
        startIndex: offset, endIndex: bars.length - 1,
        startTime: recent[0].time, endTime: recent[recent.length - 1].time,
        reliability: 0.70,
        target: earlyHigh + depth,
        description: `Mẫu hình cốc: đỉnh trái ~${earlyHigh.toFixed(1)}, đáy cốc ~${cupLow.toFixed(1)}, phục hồi ~${lateHigh.toFixed(1)} — mục tiêu breakout ~${(earlyHigh + depth).toFixed(1)}.`,
      });
    }
  }

  return patterns;
}
