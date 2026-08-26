/**
 * Forex-specific Redis + memory cache keys and TTLs.
 * Target end-to-end API latency: 3–5s cold, <1s warm.
 */

import {
  sharedCacheGet,
  sharedCacheSet,
  sharedCacheGetOrSet,
} from "@/lib/connectors/redis-cache";
import { getOhlcvPolicy } from "./realtime";

export const FOREX_CACHE = {
  /** Snapshot of all pair prices */
  pricesTtlMs: 4_000,
  pricesStaleMs: 12_000,
  /** Single symbol quote */
  quoteTtlMs: 3_000,
  /** Analysis payload (heavier) */
  analysisTtlMs: 18_000,
  /** Hard wall-clock for upstream network in route handlers */
  hardDeadlineMs: 3_800,
  /** Soft deadline for preferred path before fallback */
  softDeadlineMs: 3_100,
} as const;

export function pricesKey() {
  return "fx:v2:prices";
}

export function quoteKey(symbol: string) {
  return `fx:v2:q:${symbol.toUpperCase()}`;
}

export function ohlcvKey(symbol: string, tf: string, limit: number, before?: number) {
  return `fx:v2:ohlcv:${symbol.toUpperCase()}:${tf}:${limit}:${before ?? "latest"}`;
}

export function analysisKey(symbol: string, tf: string) {
  return `fx:v2:an:${symbol.toUpperCase()}:${tf}`;
}

export function ohlcvTtlMs(timeframe: string): number {
  const soft = getOhlcvPolicy(timeframe).soft;
  // Cap Redis TTL so ticks stay reasonably fresh
  return Math.min(soft, 90_000);
}

export async function fxCacheGet<T>(key: string): Promise<T | undefined> {
  return sharedCacheGet<T>(key);
}

export async function fxCacheSet<T>(key: string, value: T, ttlMs: number) {
  return sharedCacheSet(key, value, ttlMs);
}

export async function fxCacheGetOrSet<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
) {
  return sharedCacheGetOrSet(key, ttlMs, loader);
}

export function withBudget<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms),
    ),
  ]);
}
