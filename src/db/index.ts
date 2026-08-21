import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";

const databaseUrl = process.env.DATABASE_URL;

/* ═══════════════════════════════════════════════════════════════════════
 * Supabase / managed Postgres connection helpers.
 *
 * Root cause of DEGRADED + SELF_SIGNED_CERT_IN_CHAIN:
 * node-postgres verifies TLS by default. Supabase (and many managed
 * Postgres providers) present a cert chain that Node's default CA store
 * does not fully trust → OpenSSL error SELF_SIGNED_CERT_IN_CHAIN.
 *
 * Fix: always pass ssl: { rejectUnauthorized: false } when SSL is needed,
 * and strip conflicting sslmode=verify* from the URL so libpq-style flags
 * cannot re-enable verification.
 * ═══════════════════════════════════════════════════════════════════════ */

function isSupabaseHost(url: string | undefined): boolean {
  if (!url) return false;
  return /supabase\.co|supabase\.com|pooler\.supabase\.com/i.test(url);
}

function isPgBouncerUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /pgbouncer=true/i.test(url) || /:6543\b/.test(url) || /pooler\.supabase\.com/i.test(url);
}

function isLocalHost(url: string | undefined): boolean {
  if (!url) return true;
  return /localhost|127\.0\.0\.1|::1/i.test(url);
}

function requiresSsl(url: string | undefined): boolean {
  if (!url) return false;
  if (/sslmode=disable/i.test(url)) return false;
  if (isLocalHost(url) && !/sslmode=require|sslmode=verify|sslmode=no-verify/i.test(url)) {
    return false;
  }
  if (/sslmode=require|sslmode=verify|sslmode=no-verify/i.test(url)) return true;
  if (isSupabaseHost(url)) return true;
  if (process.env.NODE_ENV === "production" && !isLocalHost(url)) return true;
  return false;
}

/** Safe host:port (no password) for logs / health. */
export function getDatabaseEndpointHint(): {
  configured: boolean;
  host: string | null;
  port: string | null;
  pooler: boolean;
  supabase: boolean;
} {
  if (!databaseUrl) {
    return { configured: false, host: null, port: null, pooler: false, supabase: false };
  }
  try {
    const u = new URL(databaseUrl);
    return {
      configured: true,
      host: u.hostname || null,
      port: u.port || null,
      pooler: isPgBouncerUrl(databaseUrl),
      supabase: isSupabaseHost(databaseUrl),
    };
  } catch {
    return {
      configured: true,
      host: "(unparseable)",
      port: null,
      pooler: isPgBouncerUrl(databaseUrl),
      supabase: isSupabaseHost(databaseUrl),
    };
  }
}

function normalizeConnectionString(raw: string): string {
  try {
    const u = new URL(raw);
    if (isPgBouncerUrl(raw) && !u.searchParams.has("pgbouncer")) {
      u.searchParams.set("pgbouncer", "true");
    }
    if (requiresSsl(raw) || isSupabaseHost(raw)) {
      u.searchParams.set("sslmode", "no-verify");
    }
    // Prefer short connect timeout for serverless login UX (overridable via URL)
    if (!u.searchParams.has("connect_timeout")) {
      u.searchParams.set("connect_timeout", "10");
    }
    return u.toString();
  } catch {
    return raw;
  }
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

// Serverless + PgBouncer: keep pool tiny to avoid exhausting Supabase pooler slots
const DEFAULT_POOL_MAX = isPgBouncerUrl(databaseUrl) ? 3 : 10;
const POOL_MAX = envInt("DATABASE_POOL_MAX", DEFAULT_POOL_MAX);
const POOL_IDLE_TIMEOUT_MS = envInt("DATABASE_POOL_IDLE_TIMEOUT_MS", 20_000);
const POOL_CONNECT_TIMEOUT_MS = envInt("DATABASE_POOL_TIMEOUT_MS", 10_000);
const STARTUP_RETRY_MAX = envInt("DATABASE_STARTUP_RETRIES", 5);
const STARTUP_RETRY_DELAY_MS = envInt("DATABASE_STARTUP_RETRY_DELAY_MS", 1_500);
const SELF_PING_INTERVAL_MS = envInt("DATABASE_SELF_PING_INTERVAL_MS", 45_000);
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

function log(level: "info" | "warn" | "error" | "critical", msg: string, ctx?: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, provider: "database", msg, ...ctx });
  if (level === "error" || level === "critical") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function buildConnectionString(): string {
  if (!databaseUrl) return "postgresql://localhost:5432/void";
  return normalizeConnectionString(databaseUrl);
}

function createPool(): Pool {
  const connectionString = buildConnectionString();
  const useSsl = requiresSsl(connectionString) || isSupabaseHost(connectionString);
  const hint = getDatabaseEndpointHint();

  const p = new Pool({
    connectionString,
    max: POOL_MAX,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: POOL_CONNECT_TIMEOUT_MS,
    keepAlive: true,
    allowExitOnIdle: true,
    ssl: useSsl
      ? {
          rejectUnauthorized: false,
        }
      : undefined,
  });

  log("info", "pool_created", {
    host: hint.host,
    port: hint.port,
    supabase: hint.supabase,
    mode: hint.pooler ? "pgbouncer-pooled" : "direct",
    poolMax: POOL_MAX,
    connectTimeoutMs: POOL_CONNECT_TIMEOUT_MS,
    ssl: useSsl,
    hasDatabaseUrl: Boolean(databaseUrl),
  });

  if (!databaseUrl) {
    log("error", "DATABASE_URL_missing", {
      hint: "Set DATABASE_URL on Vercel → Settings → Environment Variables (Production)",
    });
  }

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
    });
    maybeEscalate();
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

let lastEscalationAt = 0;
function maybeEscalate() {
  if (!health.firstFailureAt) return;
  const downForMs = Date.now() - new Date(health.firstFailureAt).getTime();
  if (downForMs < DEGRADED_ALERT_AFTER_MS) return;
  if (Date.now() - lastEscalationAt < 60_000) return;
  lastEscalationAt = Date.now();
  log("critical", "database_down_prolonged", {
    downForMs,
    consecutiveFailures: health.consecutiveFailures,
    lastError: health.lastError,
    endpoint: getDatabaseEndpointHint(),
  });
}

export async function pingDb(opts: { attempts?: number; timeoutMs?: number } = {}): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
  attempts: number;
}> {
  const attempts = opts.attempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 8_000;
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
      lastError =
        err instanceof Error
          ? `${(err as { code?: string }).code ?? err.name}: ${err.message}`
          : String(err);
      if (i < attempts) await new Promise((r) => setTimeout(r, 400 * i));
    }
  }

  health.consecutiveFailures += 1;
  health.lastError = lastError ?? "unknown error";
  health.lastCheckAt = new Date().toISOString();
  if (!health.firstFailureAt) health.firstFailureAt = health.lastCheckAt;
  health.status = health.consecutiveFailures >= 3 ? "down" : "degraded";
  log("warn", "ping_failed_after_retries", {
    attempts,
    error: health.lastError,
    consecutiveFailures: health.consecutiveFailures,
    endpoint: getDatabaseEndpointHint(),
  });
  maybeEscalate();
  return { ok: false, latencyMs: Date.now() - started, error: health.lastError, attempts };
}

export function getDbHealth(): DbHealthState & {
  downForMs: number | null;
  endpoint: ReturnType<typeof getDatabaseEndpointHint>;
} {
  return {
    ...health,
    downForMs: health.firstFailureAt
      ? Date.now() - new Date(health.firstFailureAt).getTime()
      : null,
    endpoint: getDatabaseEndpointHint(),
  };
}

export async function waitForDatabaseReady(): Promise<boolean> {
  if (health.startupCompleted) return health.status === "up";
  for (let attempt = 1; attempt <= STARTUP_RETRY_MAX; attempt++) {
    health.startupAttempts = attempt;
    const result = await pingDb({ attempts: 1, timeoutMs: 8_000 });
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
    endpoint: getDatabaseEndpointHint(),
  });
  health.startupCompleted = true;
  health.status = "degraded";
  return false;
}

export function startDbSelfPing() {
  if (globalForDb.__orcaDbSelfPingStarted) return;
  globalForDb.__orcaDbSelfPingStarted = true;
  const tick = () => void pingDb({ attempts: 2, timeoutMs: 8_000 });
  setTimeout(tick, 5_000);
  setInterval(tick, SELF_PING_INTERVAL_MS);
  log("info", "self_ping_started", { intervalMs: SELF_PING_INTERVAL_MS });
}

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
      const transient =
        /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|connection terminated|Connection terminated|timeout|SELF_SIGNED|CERT|P1001|P1002|password authentication|ENOTFOUND/i.test(
          msg,
        );
      if (!transient || i === attempts - 1) {
        log("error", "query_failed", {
          label,
          attempt: i + 1,
          attempts,
          transient,
          error: msg,
          endpoint: getDatabaseEndpointHint(),
        });
        throw err;
      }
      log("warn", "query_transient_retry", {
        label,
        attempt: i + 1,
        attempts,
        error: msg,
      });
      await new Promise((r) => setTimeout(r, baseMs * Math.pow(2, i)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
