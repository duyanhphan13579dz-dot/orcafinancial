import { NextRequest } from "next/server";
import { ok } from "@/lib/api";
import { allBreakerStatuses } from "@/lib/connectors/core";
import { externalSourceStatuses } from "@/lib/connectors/external-sources";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/upstream
 *
 * Returns a flat map of every upstream system the app depends on — the
 * Postgres pool plus each external data connector — with status, latency,
 * and error (if any). Designed to be impossible to crash:
 *
 *   - The database check goes through `pingDb()`, which retries internally
 *     (2–3 attempts with short backoff) before reporting "down", and never
 *     throws (all pg errors are caught inside pingDb).
 *   - This route itself wraps the DB check in an additional try/catch as a
 *     second line of defense, so even an unexpected error in the dynamic
 *     import path degrades gracefully to `{ status: "down", error: ... }`
 *     instead of surfacing a raw 500 / ECONNREFUSED stack trace.
 *   - The actual historical root cause of the ECONNREFUSED crash was an
 *     unhandled 'error' event on the pg Pool itself (see src/db/index.ts
 *     `pool.on("error", ...)`), which took down the whole process before
 *     this route even got a chance to run. That is now fixed at the pool
 *     level, and this route's own try/catch covers everything else.
 */
export async function GET(_req: NextRequest) {
  const upstream: Record<
    string,
    { status: "up" | "down" | "degraded"; latencyMs: number | null; error?: string; lastSuccessAt?: string | null; consecutiveFailures?: number }
  > = {};

  // ── Database (with its own bounded retry + never throws) ──
  try {
    const { pingDb, getDbHealth } = await import("@/db");
    const dbPing = await pingDb({ attempts: 3, timeoutMs: 3_000 });
    const snap = getDbHealth();
    upstream.database = {
      status: dbPing.ok ? "up" : snap.consecutiveFailures >= 3 ? "down" : "degraded",
      latencyMs: dbPing.latencyMs,
      error: dbPing.error,
      lastSuccessAt: snap.lastSuccessAt,
      consecutiveFailures: snap.consecutiveFailures,
    };
  } catch (err) {
    // Absolute last-resort guard — should be unreachable since pingDb()
    // already swallows all errors, but we never want /health/upstream to
    // 500 or crash regardless of what changes upstream in the future.
    upstream.database = {
      status: "down",
      latencyMs: null,
      error: `Database unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ── External connectors (circuit-breaker backed; never throws) ──
  try {
    const breakers = allBreakerStatuses();
    for (const b of breakers) {
      upstream[b.name] = {
        status: b.status === "UP" ? "up" : b.status === "DEGRADED" ? "degraded" : "down",
        latencyMs: b.lastSuccessAt ? Math.max(0, Date.now() - new Date(b.lastSuccessAt).getTime()) : null,
        error: b.lastError ?? undefined,
        lastSuccessAt: b.lastSuccessAt,
      };
    }
  } catch (err) {
    upstream.connectors_registry = {
      status: "down",
      latencyMs: null,
      error: `Connector registry unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ── External market sources (disabled-safe) ──
  try {
    const statuses = await externalSourceStatuses();
    for (const source of statuses) {
      upstream[`source_${source.id}`] = {
        status: source.state === "enabled" ? "up" : source.state === "degraded" ? "degraded" : "down",
        latencyMs: source.latencyMs,
        error: source.error,
        lastSuccessAt: source.lastCheckedAt,
      };
    }
  } catch (err) {
    upstream.external_sources = {
      status: "degraded",
      latencyMs: null,
      error: `External source registry unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ── Supabase (optional) — only reported if credentials are configured,
  // so this is a no-op for deployments still on plain self-hosted Postgres. ──
  try {
    const { isSupabaseConfigured, getSupabaseServerClient } = await import("@/lib/supabase/server");
    if (isSupabaseConfigured()) {
      const client = getSupabaseServerClient();
      const started = Date.now();
      if (client) {
        // Lightweight auth admin call doubles as a connectivity + key-validity check.
        const { error } = await client.auth.getSession();
        upstream.supabase_auth = {
          status: error ? "down" : "up",
          latencyMs: Date.now() - started,
          error: error?.message,
        };
      }
    }
  } catch (err) {
    upstream.supabase_auth = {
      status: "down",
      latencyMs: null,
      error: `Supabase unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const anyDown = Object.values(upstream).some((u) => u.status === "down");
  const anyDegraded = Object.values(upstream).some((u) => u.status === "degraded");
  const aggregate = anyDown ? "down" : anyDegraded ? "degraded" : "up";

  const res = ok({ aggregate, upstream, generatedAt: new Date().toISOString() });
  // Surface 503 at the transport level too (some uptime monitors only look
  // at HTTP status, not body), matching the requirement "database down →
  // 503, not 500".
  if (upstream.database?.status === "down") {
    return Response.json(await res.json(), { status: 503 });
  }
  return res;
}
