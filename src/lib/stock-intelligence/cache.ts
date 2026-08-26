import { sharedCacheGetOrSet } from "@/lib/connectors/redis-cache";

export interface StockCacheMeta { key: string; hit: "l1" | "l2" | "miss"; generatedAt: string; ttlMs: number; staleTtlMs: number; }

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_STALE_TTL_MS = 10 * 60_000;

export async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), timeoutMs); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function cachedStockPayload<T>(opts: { key: string; loader: () => Promise<T>; ttlMs?: number; staleTtlMs?: number }): Promise<{ value: T; cache: StockCacheMeta }> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const staleTtlMs = opts.staleTtlMs ?? DEFAULT_STALE_TTL_MS;
  const result = await sharedCacheGetOrSet(opts.key, ttlMs, opts.loader, { staleTtlMs });
  return { value: result.value, cache: { key: opts.key, hit: result.hit, generatedAt: new Date().toISOString(), ttlMs, staleTtlMs } };
}

export function stockCacheKey(namespace: string, symbol: string, version = "v1"): string { return `stock-intelligence:${version}:${namespace}:${symbol.toUpperCase()}`; }
