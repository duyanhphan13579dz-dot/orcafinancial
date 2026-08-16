import { sql } from "drizzle-orm";
import { allBreakerStatuses, getStaleFlags } from "@/lib/connectors/core";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Aggregate liveness/readiness probe. Never throws — every dependency is
 * wrapped in try/catch so a database outage or upstream connector failure
 * degrades the reported status instead of crashing the route (or, prior to
 * the pool.on("error") fix in src/db/index.ts, the entire process).
 *
 * HTTP status: 200 when fully healthy, 503 when DB is down or any
 * connector reports DOWN (per requirement: never 500 for a known-degraded
 * dependency).
 */
export async function GET() {
  const started = Date.now();
  let dbOk = false;
  let dbLatencyMs = 0;
  let dbError: string | null = null;
  let dbAttempts = 1;
  let dbHealthSnapshot: { status: string; consecutiveFailures: number; downForMs: number | null; lastSuccessAt: string | null } | null = null;

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
    } as any;
  } catch (err) {
    // Defensive: even if the dynamic import or pingDb itself throws for an
    // unexpected reason, we still return a structured 503 instead of a 500
    // stack trace or (worst case) an unhandled crash.
    dbError = err instanceof Error ? err.message : String(err);
  }

  let connectors: ReturnType<typeof allBreakerStatuses> = [];
  let stale: ReturnType<typeof getStaleFlags> = [];
  try {
    connectors = allBreakerStatuses();
    stale = getStaleFlags();
  } catch {
    // Connector registry should never throw, but guard anyway so /api/health
    // itself is unconditionally crash-proof.
  }

  const down = connectors.filter((c) => c.status === "DOWN").length;
  const degraded = connectors.filter((c) => c.status === "DEGRADED").length;

  const ok = dbOk && down === 0;
  const body = {
    ok,
    status: !dbOk ? "DB_DOWN" : down > 0 ? "DEGRADED_UPSTREAM" : degraded > 0 ? "DEGRADED" : "OK",
    db: {
      ok: dbOk,
      latencyMs: dbLatencyMs,
      error: dbError,
      attempts: dbAttempts,
      ...(dbHealthSnapshot ?? {}),
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
