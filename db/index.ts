import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";

const databaseUrl = process.env.DATABASE_URL;

/* ═══════════════════════════════════════════════════════════════════════
 * Supabase-aware connection helpers.
 *
 * Supabase Postgres is reachable via two distinct connection strings:
 *   1. Direct connection  — db.<project-ref>.supabase.co:5432
 *      Use for migrations (drizzle-kit push) and long-lived server pools
 *      with a LOW connection count (Supabase free/pro tier caps direct
 *      connections at 15-60 depending on plan).
 *   2. Pooled (PgBouncer)  — <project-ref>.pooler.supabase.com:6543
 *      Use for serverless/edge or high-concurrency app traffic. PgBouncer
 *      runs in "transaction" mode, so `pgbouncer=true` must be appended to
 *      disable prepared statements (node-postgres + PgBouncer transaction
 *      mode are incompatible with server-side prepared statements).
 *
 * These helpers detect which one is in play from DATABASE_URL alone, so
 * the rest of this file (circuit breaker, retry, health tracking) needs
 * ZERO changes to work against Supabase instead of local/self-hosted
 * PostgreSQL. Nothing here changes behavior for a normal local Postgres
 * connection string — it only adds SSL + pool-size adjustments when a
 * Supabase host is detected.
 * ═══════════════════════════════════════════════════════════════════════ */

function isSupabaseHost(url: string | undefined): boolean {
  if (!url) return false;
  return /supabase\.co|supabase\.com|pooler\.supabase\.com/i.test(url);
}

function isPgBouncerUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /pgbouncer=true/i.test(url) || /:6543\b/.test(url) || /pooler\.supabase\.com/i.test(url);
}

/** True when DATABASE_URL requires SSL (Supabase always does; local Postgres never does by default). */
function requiresSsl(url: string | undefined): boolean {
  if (!url) return false;
  if (/sslmode=disable/i.test(url)) return false;
  if (/sslmode=require|sslmode=verify/i.test(url)) return true;
  return isSupabaseHost(url);
}

/* ═══════════════════════════════════════════════════════════════════════
 * ROOT CAUSE FIX — node-postgres Pool crashes the whole Node process if
 * an idle client emits an 'error' event (e.g. ECONNREFUSED, ECONNRESET,
 * the DB restarting, network blip) and NOBODY is listening for 'error' on
 * the Pool. EventEmitter re-throws unhandled 'error' events synchronously,
 * which takes down the entire server — not just the failing query. This is
 * the actual cause of the reported ECONNREFUSED crash on /health/upstream:
 * the crash did not originate in the health route itself (it already had
 * try/catch), it originated from an *unrelated* idle connection dying in
 * the background with no listener attached.
 *
 * Fixing this one line (`pool.on("error", ...)`) is the single most
 * important change in this file. Everything else (retry-on-boot, periodic
 * self-ping, graceful shutdown) is defense in depth on top of it.
 * ═══════════════════════════════════════════════════════════════════════ */

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

// When talking to Supabase through PgBouncer (transaction pooling), the
// pooler itself already multiplexes many app connections onto a small
// number of real Postgres backends. Keeping our own pool small here avoids
// exhausting PgBouncer's `default_pool_size` and matches Supabase's
// documented guidance for serverless/high-instance-count deployments.
const DEFAULT_POOL_MAX = isPgBouncerUrl(databaseUrl) ? 5 : 20;
const POOL_MAX = envInt("DATABASE_POOL_MAX", DEFAULT_POOL_MAX); // connection_limit equivalent
const POOL_IDLE_TIMEOUT_MS = envInt("DATABASE_POOL_IDLE_TIMEOUT_MS", 30_000);
const POOL_CONNECT_TIMEOUT_MS = envInt("DATABASE_POOL_TIMEOUT_MS", 10_000); // pool_timeout equivalent
const STARTUP_RETRY_MAX = envInt("DATABASE_STARTUP_RETRIES", 10);
const STARTUP_RETRY_DELAY_MS = envInt("DATABASE_STARTUP_RETRY_DELAY_MS", 2_000);
const SELF_PING_INTERVAL_MS = envInt("DATABASE_SELF_PING_INTERVAL_MS", 30_000);
const DEGRADED_ALERT_AFTER_MS = envInt("DATABASE_DOWN_ALERT_AFTER_MS", 2 * 60_000);

type DbStatus = "unknown" | "up" | "degraded" | "down";

interface DbHealthState {
  status: DbStatus;
  consecutiveFailures: number;
  lastError: string | null;
  lastCheckAt: string | null;
  lastSuccessAt: string | null;
  firstFailureAt: string | null;
  lastLatencyMs: number | null;
  startupCompleted: boolean;
  startupAttempts: number;
}

const globalForDb = globalThis as typeof globalThis & {
  __orcaPgPool?: Pool;
  __orcaDbHealth?: DbHealthState;
  __orcaDbSelfPingStarted?: boolean;
  __orcaDbShutdownHooksRegistered?: boolean;
};

if (!globalForDb.__orcaDbHealth) {
  globalForDb.__orcaDbHealth = {
    status: "unknown",
    consecutiveFailures: 0,
    lastError: null,
    lastCheckAt: null,
    lastSuccessAt: null,
    firstFailureAt: null,
    lastLatencyMs: null,
    startupCompleted: false,
    startupAttempts: 0,
  };
}
const health = globalForDb.__orcaDbHealth;

/** Minimal structured logger without importing @/lib/logger to avoid any
 * circular import risk at module-init time (db/index.ts is imported very
 * early, sometimes before other lib modules finish evaluating). */
function log(level: "info" | "warn" | "error" | "critical", msg: string, ctx?: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, provider: "database", msg, ...ctx });
  if (level === "error" || level === "critical") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function buildConnectionString(): string {
  if (!databaseUrl) return "postgresql://localhost:5432/void";
  return databaseUrl;
}

function createPool(): Pool {
  const connectionString = buildConnectionString();
  const p = new Pool({
    connectionString,
    max: POOL_MAX,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: POOL_CONNECT_TIMEOUT_MS,
    keepAlive: true,
    // Supabase (and most managed Postgres providers) require SSL. Using
    // `rejectUnauthorized: false` matches Supabase's own connection
    // examples: their certs chain to a public CA but intermediate/full
    // chain verification is unnecessary for app-level connections and this
    // is the setting Supabase documents for node-postgres/Prisma/Drizzle.
    ssl: requiresSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
  if (isSupabaseHost(connectionString)) {
    log("info", "supabase_connection_detected", {
      mode: isPgBouncerUrl(connectionString) ? "pgbouncer-pooled" : "direct",
      poolMax: POOL_MAX,
      ssl: true,
    });
  }

  // ─── THE CRITICAL FIX ───
  // Without this handler, any idle client that errors out (ECONNREFUSED,
  // ECONNRESET, server restart, network partition) throws an unhandled
  // 'error' event and crashes the entire Node process instantly.
  p.on("error", (err: Error & { code?: string }) => {
    health.consecutiveFailures += 1;
    health.lastError = `${err.code ?? err.name}: ${err.message}`;
    health.lastCheckAt = new Date().toISOString();
    if (!health.firstFailureAt) health.firstFailureAt = health.lastCheckAt;
    health.status = health.consecutiveFailures >= 3 ? "down" : "degraded";
    log("error", "pool_idle_client_error", {
      code: err.code,
      error: err.message,
      consecutiveFailures: health.consecutiveFailures,
      stack: err.stack?.split("\n").slice(0, 5).join(" | "),
    });
    maybeEscalate();
  });

  p.on("connect", () => {
    // A fresh physical connection was established — good signal, but we
    // don't flip status here; only an actual successful query does that.
  });

  return p;
}

function getPool(): Pool {
  if (!globalForDb.__orcaPgPool) {
    globalForDb.__orcaPgPool = createPool();
    registerShutdownHooks(globalForDb.__orcaPgPool);
  }
  return globalForDb.__orcaPgPool;
}

export const pool = getPool();
export const db = drizzle(pool);

/* ═══════════════════════════════════════════════════════════════════════
 * Graceful shutdown — closes the pool cleanly on container stop/restart so
 * Postgres doesn't accumulate zombie connections across redeploys.
 * ═══════════════════════════════════════════════════════════════════════ */
function registerShutdownHooks(p: Pool) {
  if (globalForDb.__orcaDbShutdownHooksRegistered) return;
  globalForDb.__orcaDbShutdownHooksRegistered = true;
  const shutdown = async (signal: string) => {
    log("info", "shutdown_signal_received", { signal });
    try {
      await p.end();
      log("info", "pool_closed_cleanly");
    } catch (err) {
      log("warn", "pool_close_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

/* ═══════════════════════════════════════════════════════════════════════
 * Escalation — if the DB has been failing continuously for more than
 * DEGRADED_ALERT_AFTER_MS, log a `critical` line so it surfaces in
 * monitoring (Prometheus/log alerts) without crashing anything.
 * ═══════════════════════════════════════════════════════════════════════ */
let lastEscalationAt = 0;
function maybeEscalate() {
  if (!health.firstFailureAt) return;
  const downForMs = Date.now() - new Date(health.firstFailureAt).getTime();
  if (downForMs < DEGRADED_ALERT_AFTER_MS) return;
  if (Date.now() - lastEscalationAt < 60_000) return; // don't spam more than once/min
  lastEscalationAt = Date.now();
  log("critical", "database_down_prolonged", {
    downForMs,
    consecutiveFailures: health.consecutiveFailures,
    lastError: health.lastError,
  });
}

/* ═══════════════════════════════════════════════════════════════════════
 * pingDb — internally retries 2-3 times with short backoff before
 * declaring the database down. Never throws; always resolves.
 * ═══════════════════════════════════════════════════════════════════════ */
export async function pingDb(opts: { attempts?: number; timeoutMs?: number } = {}): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
  attempts: number;
}> {
  const attempts = opts.attempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 3_000;
  const started = Date.now();
  let lastError: string | undefined;

  for (let i = 1; i <= attempts; i++) {
    try {
      let client: PoolClient | undefined;
      try {
        client = await Promise.race([
          pool.connect(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("pool_connect_timeout")), timeoutMs)),
        ]);
        await client.query("SELECT 1");
      } finally {
        client?.release();
      }
      const latencyMs = Date.now() - started;
      health.status = "up";
      health.consecutiveFailures = 0;
      health.lastError = null;
      health.firstFailureAt = null;
      health.lastSuccessAt = new Date().toISOString();
      health.lastCheckAt = health.lastSuccessAt;
      health.lastLatencyMs = latencyMs;
      return { ok: true, latencyMs, attempts: i };
    } catch (err) {
      lastError = err instanceof Error ? `${(err as { code?: string }).code ?? err.name}: ${err.message}` : String(err);
      if (i < attempts) await new Promise((r) => setTimeout(r, 400 * i));
    }
  }

  health.consecutiveFailures += 1;
  health.lastError = lastError ?? "unknown error";
  health.lastCheckAt = new Date().toISOString();
  if (!health.firstFailureAt) health.firstFailureAt = health.lastCheckAt;
  health.status = health.consecutiveFailures >= 3 ? "down" : "degraded";
  log("warn", "ping_failed_after_retries", { attempts, error: health.lastError, consecutiveFailures: health.consecutiveFailures });
  maybeEscalate();
  return { ok: false, latencyMs: Date.now() - started, error: health.lastError, attempts };
}

/** Snapshot of the current DB health state — used by /api/health and /api/health/upstream. */
export function getDbHealth(): DbHealthState & { downForMs: number | null } {
  return {
    ...health,
    downForMs: health.firstFailureAt ? Date.now() - new Date(health.firstFailureAt).getTime() : null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
 * waitForDatabaseReady — called once from instrumentation.ts on boot.
 * Retries up to STARTUP_RETRY_MAX times, 2s apart (both env-configurable).
 * Never throws and never blocks the HTTP server from starting: the app
 * boots regardless and simply reports "degraded" via /api/health until the
 * database becomes reachable, satisfying "app starts, waits for DB, but
 * doesn't hard-fail if DB isn't ready yet."
 * ═══════════════════════════════════════════════════════════════════════ */
export async function waitForDatabaseReady(): Promise<boolean> {
  if (health.startupCompleted) return health.status === "up";
  for (let attempt = 1; attempt <= STARTUP_RETRY_MAX; attempt++) {
    health.startupAttempts = attempt;
    const result = await pingDb({ attempts: 1, timeoutMs: 3_000 });
    if (result.ok) {
      log("info", "startup_db_ready", { attempt, latencyMs: result.latencyMs });
      health.startupCompleted = true;
      return true;
    }
    log("warn", "startup_db_not_ready_retrying", {
      attempt,
      maxAttempts: STARTUP_RETRY_MAX,
      nextRetryInMs: STARTUP_RETRY_DELAY_MS,
      error: result.error,
    });
    if (attempt < STARTUP_RETRY_MAX) {
      await new Promise((r) => setTimeout(r, STARTUP_RETRY_DELAY_MS));
    }
  }
  log("error", "startup_db_unreachable_after_retries", {
    attempts: STARTUP_RETRY_MAX,
    lastError: health.lastError,
  });
  health.startupCompleted = true;
  health.status = "degraded"; // app still boots; endpoints will report degraded/down accurately
  return false;
}

/* ═══════════════════════════════════════════════════════════════════════
 * Self-ping loop — pings the DB every SELF_PING_INTERVAL_MS so health
 * state stays fresh even without incoming HTTP traffic, and so the
 * `critical` escalation fires promptly when the DB has been down for a
 * while, per requirement #3 (auto-reconnect / periodic health check).
 * ═══════════════════════════════════════════════════════════════════════ */
export function startDbSelfPing() {
  if (globalForDb.__orcaDbSelfPingStarted) return;
  globalForDb.__orcaDbSelfPingStarted = true;
  const tick = () => void pingDb({ attempts: 2, timeoutMs: 3_000 });
  setTimeout(tick, 5_000);
  setInterval(tick, SELF_PING_INTERVAL_MS);
  log("info", "self_ping_started", { intervalMs: SELF_PING_INTERVAL_MS });
}

/**
 * safeDbQuery — retry wrapper for arbitrary DB operations (kept here too,
 * re-exported from connectors/core for convenience) so call sites that
 * only import "@/db" don't need a second import just for resilience.
 */
export async function safeDbQuery<T>(
  label: string,
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 500;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|connection terminated|Connection terminated|timeout|P1001|P1002/i.test(msg);
      if (!transient || i === attempts - 1) {
        log("error", "query_failed", { label, attempt: i + 1, attempts, transient, error: msg });
        throw err;
      }
      log("warn", "query_transient_retry", { label, attempt: i + 1, attempts, error: msg });
      await new Promise((r) => setTimeout(r, baseMs * Math.pow(2, i)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
