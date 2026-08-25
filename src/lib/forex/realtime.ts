/**
 * Phase 2 — Real-time Forex Engine helpers.
 *
 * - Intelligent refresh intervals per data kind / timeframe
 * - Tick → merge into current candle (no full 300-bar refetch)
 */

import type { Ohlcv } from "@/lib/connectors/core";

/** Candle bucket size in seconds. */
export const TF_BUCKET_SEC: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14_400,
  "1d": 86_400,
  "1w": 604_800,
  "1mo": 2_592_000, // ~30d approximate
  "12mo": 31_536_000,
};

/**
 * Soft / hard TTL for OHLCV network refresh (Phase 2 table).
 * Soft = serve cache, optional bg refresh.
 * Hard = must network (or stale fallback).
 */
export const OHLCV_REFRESH_MS: Record<
  string,
  { soft: number; hard: number; scheduler: number }
> = {
  "1m": { soft: 8_000, hard: 45_000, scheduler: 12_000 },
  "5m": { soft: 20_000, hard: 90_000, scheduler: 25_000 },
  "15m": { soft: 40_000, hard: 180_000, scheduler: 45_000 },
  "1h": { soft: 90_000, hard: 400_000, scheduler: 120_000 },
  "4h": { soft: 300_000, hard: 1_200_000, scheduler: 400_000 },
  "1d": { soft: 600_000, hard: 3_600_000, scheduler: 900_000 },
  "1w": { soft: 1_800_000, hard: 12_000_000, scheduler: 3_600_000 },
  "1mo": { soft: 3_600_000, hard: 24_000_000, scheduler: 6_000_000 },
  "12mo": { soft: 7_200_000, hard: 48_000_000, scheduler: 12_000_000 },
};

/** Live price scheduler / client poll guidance. */
export const PRICE_REFRESH_MS = {
  scheduler: 4_000,
  clientPoll: 5_000,
  memoryTtl: 3_000,
} as const;

export function bucketStartSec(unixSec: number, timeframe: string): number {
  const size = TF_BUCKET_SEC[timeframe] ?? 3600;
  return Math.floor(unixSec / size) * size;
}

export function currentBucketStart(timeframe: string, nowMs = Date.now()): number {
  return bucketStartSec(Math.floor(nowMs / 1000), timeframe);
}

/**
 * Merge a live mid tick into OHLCV series for a given timeframe.
 * - Same bucket as last bar → update high / low / close
 * - New bucket → append candle open=high=low=close=tick
 * - Does not drop history; returns new array reference
 */
export function applyTickToBars(
  bars: Ohlcv[],
  tick: number,
  timeframe: string,
  nowMs = Date.now(),
): Ohlcv[] {
  if (!bars.length || !Number.isFinite(tick) || tick <= 0) return bars;

  const bucket = currentBucketStart(timeframe, nowMs);
  const out = bars.slice();
  const last = out[out.length - 1];
  const lastBucket = bucketStartSec(last.time, timeframe);

  if (lastBucket === bucket) {
    // Update forming candle
    out[out.length - 1] = {
      ...last,
      high: Math.max(last.high, tick, last.open),
      low: Math.min(last.low, tick, last.open),
      close: tick,
    };
    return out;
  }

  if (bucket > lastBucket) {
    // Open new forming candle
    out.push({
      time: bucket,
      open: tick,
      high: tick,
      low: tick,
      close: tick,
      volume: 0,
    });
    return out;
  }

  // Tick "older" than last bar clock — still nudge close for consistency
  out[out.length - 1] = {
    ...last,
    high: Math.max(last.high, tick),
    low: Math.min(last.low, tick),
    close: tick,
  };
  return out;
}

/**
 * Apply the same live tick across all in-memory series for a symbol.
 */
export function applyTickToMemMap(
  mem: Map<string, { bars: Ohlcv[]; source: string; newestMs: number; at: number }>,
  symbol: string,
  tick: number,
  nowMs = Date.now(),
): number {
  const prefix = `${symbol.toUpperCase()}:`;
  let updated = 0;
  for (const [key, entry] of mem) {
    if (!key.startsWith(prefix)) continue;
    const parts = key.split(":");
    const tf = parts[1];
    if (!tf) continue;
    entry.bars = applyTickToBars(entry.bars, tick, tf, nowMs);
    entry.at = nowMs;
    entry.newestMs = nowMs;
    updated += 1;
  }
  return updated;
}

export function getOhlcvPolicy(timeframe: string) {
  return (
    OHLCV_REFRESH_MS[timeframe] ?? {
      soft: 180_000,
      hard: 900_000,
      scheduler: 300_000,
    }
  );
}
