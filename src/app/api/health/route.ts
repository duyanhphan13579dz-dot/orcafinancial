import { allBreakerStatuses, getStaleFlags } from "@/lib/connectors/core";
import { assertRedisForProduction, pingRedis } from "@/lib/connectors/redis-cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 * Aggregate liveness. Redis is required in production for shared cache.
 */
export async function GET() {
  const started = Date.now();
  let dbOk = false;
  let dbLatencyMs = 0;
  let dbError: string | null = null;
  let dbAttempts = 1;
  let dbHealthSnapshot: {
    status: string;
    consecutiveFailures: number;
    downForMs: number | null;
    lastSuccessAt: string | null;
  } | null = null;

  try {
    const { pingDb, getDbHealth } = await import("@/db");
    const result = await pingDb({ attempts: 3, timeoutMs: 3_000 });
    dbOk = result.ok;
    dbLatencyMs = result.latencyMs;
    dbError = result.error ?? null;
    dbAttempts = result.attempts;
    const snap = getDbHealth();
    dbHealthSnapshot = {
      status: snap.status,
      consecutiveFailures: snap.consecutiveFailures,
      downForMs: snap.downForMs,
      lastSuccessAt: snap.lastSuccessAt,
    };
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const redisAssert = assertRedisForProduction();
  const redisPing = await pingRedis();

  let connectors: ReturnType<typeof allBreakerStatuses> = [];
  let stale: ReturnType<typeof getStaleFlags> = [];
  try {
    connectors = allBreakerStatuses();
    stale = getStaleFlags();
  } catch {
    // ignore
  }

  const down = connectors.filter((c) => c.status === "DOWN").length;
  const degraded = connectors.filter((c) => c.status === "DEGRADED").length;

  const redisOk = redisAssert.ok && (redisAssert.configured ? redisPing.ok : !redisAssert.required);
  const ok = dbOk && down === 0 && redisOk;

  const body = {
    ok,
    status: !dbOk
      ? "DB_DOWN"
      : !redisOk
        ? "REDIS_REQUIRED"
        : down > 0
          ? "DEGRADED_UPSTREAM"
          : degraded > 0
            ? "DEGRADED"
            : "OK",
    db: {
      ok: dbOk,
      latencyMs: dbLatencyMs,
      error: dbError,
      attempts: dbAttempts,
      ...(dbHealthSnapshot ?? {}),
    },
    redis: {
      required: redisAssert.required,
      configured: redisAssert.configured,
      mode: redisAssert.mode,
      ok: redisPing.ok,
      latencyMs: redisPing.latencyMs,
      error: redisPing.error ?? null,
    },
    upstream: {
      total: connectors.length,
      up: connectors.filter((c) => c.status === "UP").length,
      degraded,
      down,
      staleFlags: stale.length,
      connectors: connectors.map((c) => ({
        name: c.name,
        status: c.status,
        state: c.state,
        successRate: c.successRate,
        lastError: c.lastError,
        lastSuccessAt: c.lastSuccessAt,
      })),
    },
    stale,
    latencyMs: Date.now() - started,
  };
  return Response.json(body, { status: ok ? 200 : 503 });
}
