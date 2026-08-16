// Structured JSON logger with severity levels and in-memory ring buffer
// for operational dashboards. No external dependency; survives hot reloads via globalThis.

export type LogLevel = "debug" | "info" | "warn" | "error" | "critical";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  critical: 50,
};

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  [k: string]: unknown;
}

const globalForLog = globalThis as typeof globalThis & {
  __orcaLogRing?: LogEntry[];
  __orcaLogCursor?: number;
};
const RING_SIZE = 500;
if (!globalForLog.__orcaLogRing) {
  globalForLog.__orcaLogRing = new Array(RING_SIZE);
  globalForLog.__orcaLogCursor = 0;
}
const ring = globalForLog.__orcaLogRing!;

function pushRing(entry: LogEntry) {
  const idx = (globalForLog.__orcaLogCursor ?? 0) % RING_SIZE;
  ring[idx] = entry;
  globalForLog.__orcaLogCursor = idx + 1;
}

export function recentLogs(opts: { level?: LogLevel; limit?: number; provider?: string } = {}): LogEntry[] {
  const minW = opts.level ? LEVEL_WEIGHT[opts.level] : 0;
  const cursor = globalForLog.__orcaLogCursor ?? 0;
  const collected: LogEntry[] = [];
  for (let i = 0; i < RING_SIZE; i++) {
    const e = ring[(cursor - 1 - i + RING_SIZE * 2) % RING_SIZE];
    if (!e) continue;
    if (LEVEL_WEIGHT[e.level] < minW) continue;
    if (opts.provider && typeof e.provider === "string" && e.provider !== opts.provider) continue;
    collected.push(e);
    if (opts.limit && collected.length >= opts.limit) break;
  }
  return collected;
}

function write(level: LogLevel, msg: string, ctx?: Record<string, unknown>) {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(ctx ?? {}),
  };
  pushRing(entry);
  const line = JSON.stringify(entry);
  if (level === "critical" || level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug" && process.env.LOG_DEBUG !== "1") return;
  else console.log(line);
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => write("debug", msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => write("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => write("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => write("error", msg, ctx),
  critical: (msg: string, ctx?: Record<string, unknown>) => write("critical", msg, ctx),
};

/** Build a child logger bound to a provider context. */
export function forProvider(provider: string) {
  const bind = (ctx?: Record<string, unknown>) => ({ ...(ctx ?? {}), provider });
  return {
    debug: (msg: string, ctx?: Record<string, unknown>) => write("debug", msg, bind(ctx)),
    info: (msg: string, ctx?: Record<string, unknown>) => write("info", msg, bind(ctx)),
    warn: (msg: string, ctx?: Record<string, unknown>) => write("warn", msg, bind(ctx)),
    error: (msg: string, ctx?: Record<string, unknown>) => write("error", msg, bind(ctx)),
    critical: (msg: string, ctx?: Record<string, unknown>) => write("critical", msg, bind(ctx)),
  };
}
