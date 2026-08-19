import { Redis } from "@upstash/redis";
import { logger } from "@/lib/logger";

/**
 * Shared TTL cache used across all Vercel serverless instances.
 *
 * Why this exists: an in-memory `Map` cache is scoped to a single lambda
 * instance. On Vercel, concurrent/cold-started requests routinely land on
 * different instances, so a plain Map cache barely helps in production —
 * most requests still miss and hit upstream providers directly.
 *
 * This wraps Upstash Redis (REST API — no persistent TCP connection, safe
 * for serverless) as the shared cache, with a local in-memory Map as:
 *   (a) a fallback when UPSTASH_REDIS_REST_URL / _TOKEN aren't set (e.g.
 *       local dev without Redis configured), and
 *   (b) a safety net if Redis calls fail for any reason — a cache outage
 *       must never break a request, it should just behave like a miss.
 */

const localCache = new Map<string, { value: unknown; expiresAt: number }>();

let redis: Redis | null = null;
let redisInitLogged = false;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!redisInitLogged) {
      logger.warn("redis_cache_disabled", {
        reason: "UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN not set — falling back to in-memory cache (not shared across instances)",
      });
      redisInitLogged = true;
    }
    return null;
  }
  redis = new Redis({ url, token });
  return redis;
}

export async function sharedCacheGet<T>(key: string): Promise<T | undefined> {
  const client = getRedis();
  if (client) {
    try {
      const value = await client.get<T>(key);
      if (value !== null && value !== undefined) return value;
      return undefined;
    } catch (err) {
      logger.warn("redis_cache_get_failed", { key, error: err instanceof Error ? err.message : String(err) });
      // fall through to local cache below
    }
  }
  const hit = localCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  return undefined;
}

export async function sharedCacheSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
  const client = getRedis();
  if (client) {
    try {
      await client.set(key, value, { ex: Math.max(1, Math.ceil(ttlMs / 1000)) });
      return;
    } catch (err) {
      logger.warn("redis_cache_set_failed", { key, error: err instanceof Error ? err.message : String(err) });
      // fall through to local cache below
    }
  }
  localCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Whether a shared (cross-instance) cache is actually configured. Used for /system diagnostics. */
export function isSharedCacheConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}
