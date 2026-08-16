import type { Ohlcv } from "@/lib/connectors/core";

export interface ScreenerResult {
  symbol: string;
  score: number;
  classification: string;
  reasons: string[];
  data: any;
}

/**
 * Calculates RS Rating (Relative Strength)
 * Relative performance of a stock compared to the entire universe over 12 months.
 * Formula: Weighted average of 3m (40%), 6m (20%), 9m (20%), 12m (20%) returns.
 */
export function calculateRSRating(universe: { symbol: string; bars: Ohlcv[] }[]): Map<string, number> {
  const scores = universe.map(({ symbol, bars }) => {
    if (bars.length < 252) return { symbol, rawScore: -999 };
    const n = bars.length;
    const p0 = bars[n - 1].close;
    const p3m = bars[n - 63]?.close || bars[0].close;
    const p6m = bars[n - 126]?.close || bars[0].close;
    const p9m = bars[n - 189]?.close || bars[0].close;
    const p12m = bars[0].close;

    const r3m = (p0 - p3m) / p3m;
    const r6m = (p0 - p6m) / p6m;
    const r9m = (p0 - p9m) / p9m;
    const r12m = (p0 - p12m) / p12m;

    const rawScore = (r3m * 40) + (r6m * 20) + (r9m * 20) + (r12m * 20);
    return { symbol, rawScore };
  });

  const sorted = [...scores].sort((a, b) => a.rawScore - b.rawScore);
  const ratingMap = new Map<string, number>();
  
  sorted.forEach((item, index) => {
    const percentile = Math.round((index / (sorted.length - 1)) * 99);
    ratingMap.set(item.symbol, percentile);
  });

  return ratingMap;
}

/**
 * Detects Moving Average trends
 */
export function getMovingAverages(bars: Ohlcv[], periods: number[]): Map<number, number> {
  const result = new Map<number, number>();
  const closes = bars.map(b => b.close);
  
  periods.forEach(p => {
    if (closes.length < p) return;
    const slice = closes.slice(-p);
    const avg = slice.reduce((a, b) => a + b, 0) / p;
    result.set(p, avg);
  });
  
  return result;
}

/**
 * Detects pivots (Swing Highs/Lows)
 */
export function findPivots(bars: Ohlcv[], window = 5): { highs: { i: number; v: number }[]; lows: { i: number; v: number }[] } {
  const highs: { i: number; v: number }[] = [];
  const lows: { i: number; v: number }[] = [];
  const closes = bars.map(b => b.close);

  for (let i = window; i < closes.length - window; i++) {
    const left = closes.slice(i - window, i);
    const right = closes.slice(i + 1, i + window + 1);
    const current = closes[i];

    if (current > Math.max(...left) && current > Math.max(...right)) {
      highs.push({ i, v: current });
    }
    if (current < Math.min(...left) && current < Math.min(...right)) {
      lows.push({ i, v: current });
    }
  }
  return { highs, lows };
}
