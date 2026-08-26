import { Redis } from "@upstash/redis";
import { logger } from "@/lib/logger";

/**
 * Shared TTL cache across Vercel serverless instances (Upstash Redis REST).
 *
 * Layering:
 *  - L1 in-memory Map (same instance, ~0ms)
 *  - L2 Upstash Redis (cross-instance, ~20–80ms)
 *
 * Production: Redis REQUIRED for warm 1–3s responses across instances.
 * Local: memory-only when UPSTASH env missing.
 */

const localCache = new Map<string, { value: unknown; expiresAt: number }>();
const MAX_L1 = 1_200;
const cacheMetrics = { l1Hits: 0, l2Hits: 0, misses: 0, sets: 0, singleFlightJoins: 0, errors: 0, totalReadLatencyMs: 0, reads: 0 };

export function getSharedCacheMetrics() {
  const reads = cacheMetrics.reads;
  return {
    ...cacheMetrics,
    averageReadLatencyMs: reads > 0 ? Number((cacheMetrics.totalReadLatencyMs / reads).toFixed(2)) : 0,
    l1HitRate: reads > 0 ? Number((cacheMetrics.l1Hits / reads).toFixed(4)) : 0,
    l2HitRate: reads > 0 ? Number((cacheMetrics.l2Hits / reads).toFixed(4)) : 0,
    missRate: reads > 0 ? Number((cacheMetrics.misses / reads).toFixed(4)) : 0,
    l1Size: localCache.size,
    redisConfigured: isSharedCacheConfigured(),
  };
}

let redis: Redis | null = null;
let redisInitLogged = false;
let missingLogged = false;

function envFlag(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  return !/^(0|false|no|off)$/i.test(raw);
}

export function isRedisRequired(): boolean {
  const prod = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  return envFlag("REDIS_REQUIRED", prod);
}

export function isSharedCacheConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!missingLogged) {
      missingLogged = true;
      if (isRedisRequired()) {
        logger.error("redis_required_missing", {
          hint: "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN on Vercel",
        });
      } else {
        logger.warn("redis_cache_disabled", {
          reason: "UPSTASH env not set — in-memory only",
        });
      }
    }
    return null;
  }
  redis = new Redis({ url, token });
  if (!redisInitLogged) {
    redisInitLogged = true;
    logger.info("redis_cache_ready", { shared: true });
  }
  return redis;
}

function touchL1(key: string, value: unknown, ttlMs: number) {
  localCache.set(key, { value, expiresAt: Date.now() + Math.max(200, ttlMs) });
  while (localCache.size > MAX_L1) {
    const oldest = localCache.keys().next().value;
    if (oldest === undefined) break;
    localCache.delete(oldest);
  }
}

function readL1<T>(key: string): T | undefined {
  const hit = localCache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    localCache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function assertRedisForProduction(): {
  ok: boolean;
  required: boolean;
  configured: boolean;
  mode: "redis" | "memory";
} {
  const required = isRedisRequired();
  const configured = isSharedCacheConfigured();
  if (required && !configured) {
    logger.error("redis_assert_failed", {
      msg: "Production cache requires Upstash Redis for sub-3s responses",
    });
  }
  return {
    ok: !required || configured,
    required,
    configured,
    mode: configured ? "redis" : "memory",
  };
}

/** L1 first, then Redis L2. */
export async function sharedCacheGet<T>(key: string): Promise<T | undefined> {
  const started = Date.now();
  cacheMetrics.reads += 1;
  const l1 = readL1<T>(key);
  if (l1 !== undefined) {
    cacheMetrics.l1Hits += 1;
    cacheMetrics.totalReadLatencyMs += Date.now() - started;
    return l1;
  }

  const client = getRedis();
  if (client) {
    try {
      const value = await client.get<T>(key);
      if (value !== null && value !== undefined) {
        // Short L1 mirror so next same-instance hit is free
        touchL1(key, value, 4_000);
        cacheMetrics.l2Hits += 1;
        cacheMetrics.totalReadLatencyMs += Date.now() - started;
        return value;
      }
    } catch (err) {
      cacheMetrics.errors += 1;
      logger.warn("redis_cache_get_failed", {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  cacheMetrics.misses += 1;
  cacheMetrics.totalReadLatencyMs += Date.now() - started;
  return undefined;
}

/** Write L1 immediately; Redis set is non-blocking (does not delay response). */
export async function sharedCacheSet<
  T,
>(key: string, value: T, ttlMs: number): Promise<void> {
  touchL1(key, value, ttlMs);
  cacheMetrics.sets += 1;
  const client = getRedis();
  if (!client) return;
  const ex = Math.max(1, Math.ceil(ttlMs / 1000));
  // Fire-and-forget — never await Redis RTT on the hot path
  void client.set(key, value, { ex }).catch((err) => {
    logger.warn("redis_cache_set_failed", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/** Read-through helper with single-flight refresh. */
const inflight = new Map<string, Promise<unknown>>();

export async function sharedCacheGetOrSet<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  opts?: { staleTtlMs?: number },
): Promise<{ value: T; hit: "l1" | "l2" | "miss" }> {
  const cached = await sharedCacheGet<T>(key);
  if (cached !== undefined) {
    return { value: cached, hit: readL1(key) !== undefined ? "l1" : "l2" };
  }

  let pending = inflight.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = (async () => {
      const value = await loader();
      await sharedCacheSet(key, value, ttlMs);
      return value;
    })().finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, pending);
  } else {
    cacheMetrics.singleFlightJoins += 1;
  }

  try {
    const value = await pending;
    return { value, hit: "miss" };
  } catch (err) {
    // Optional stale: extend L1 read window if caller stored longer TTL earlier
    if (opts?.staleTtlMs) {
      const stale = localCache.get(key);
      if (stale) return { value: stale.value as T, hit: "l1" };
    }
    throw err;
  }
}

export async function pingRedis(): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const started = Date.now();
  if (!isSharedCacheConfigured()) {
    return {
      ok: false,
      latencyMs: 0,
      error: isRedisRequired()
        ? "UPSTASH env missing (required in production)"
        : "not configured",
    };
  }
  const client = getRedis();
  if (!client) {
    return { ok: false, latencyMs: Date.now() - started, error: "client init failed" };
  }
  try {
    const probeKey = "orca:health:ping";
    await client.set(probeKey, "1", { ex: 30 });
    const v = await client.get(probeKey);
    return { ok: v === "1" || v === 1, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
