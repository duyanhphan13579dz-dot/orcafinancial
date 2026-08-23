import { Redis } from "@upstash/redis";
import { logger } from "@/lib/logger";

/**
 * Shared TTL cache across all Vercel serverless instances (Upstash Redis REST).
 *
 * Production: Redis is REQUIRED for 1–3s warm responses. Without it, every
 * cold instance hits upstream vendors → multi-second latency.
 *
 * Local dev: in-memory Map fallback when REDIS_REQUIRED is not forced.
 * Redis outages still fall through to local cache so requests never hard-fail.
 */

const localCache = new Map<string, { value: unknown; expiresAt: number }>();

let redis: Redis | null = null;
let redisInitLogged = false;
let missingLogged = false;

function envFlag(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  return !/^(0|false|no|off)$/i.test(raw);
}

/** Production defaults to required; set REDIS_REQUIRED=0 to allow memory-only. */
export function isRedisRequired(): boolean {
  const prod = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  return envFlag("REDIS_REQUIRED", prod);
}

export function isSharedCacheConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
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
          hint: "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN on Vercel (Production). Free tier: https://upstash.com",
        });
      } else {
        logger.warn("redis_cache_disabled", {
          reason: "UPSTASH env not set — in-memory only (not shared across instances)",
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

/** Call from instrumentation / health — soft assert, never throws. */
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

export async function sharedCacheGet<T>(key: string): Promise<T | undefined> {
  const client = getRedis();
  if (client) {
    try {
      const value = await client.get<T>(key);
      if (value !== null && value !== undefined) {
        // Mirror into local L1 for same-instance speed
        localCache.set(key, { value, expiresAt: Date.now() + 5_000 });
        return value;
      }
      return undefined;
    } catch (err) {
      logger.warn("redis_cache_get_failed", {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const hit = localCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  return undefined;
}

export async function sharedCacheSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
  const client = getRedis();
  // Always keep L1
  localCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (localCache.size > 800) {
    const oldest = localCache.keys().next().value;
    if (oldest) localCache.delete(oldest);
  }
  if (client) {
    try {
      await client.set(key, value, { ex: Math.max(1, Math.ceil(ttlMs / 1000)) });
    } catch (err) {
      logger.warn("redis_cache_set_failed", {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Lightweight ping for /api/health */
export async function pingRedis(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  if (!isSharedCacheConfigured()) {
    return {
      ok: false,
      latencyMs: 0,
      error: isRedisRequired() ? "UPSTASH env missing (required in production)" : "not configured",
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
