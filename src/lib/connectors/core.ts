import { forProvider, logger, recentLogs } from "@/lib/logger";
import { sharedCacheGet, sharedCacheSet } from "@/lib/connectors/redis-cache";

export type Timeframe = "1" | "15" | "60" | "D";

export interface Ohlcv {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  symbol: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  prevClose: number | null;
  changePct: number | null;
  source: string;
  confidence: number;
}

export interface SymbolInfo {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  source: string;
}

export interface NewsItem {
  guid: string;
  title: string;
  link: string;
  description: string;
  imageUrl: string | null;
  sourceName: string;
  publishedAt: Date;
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public meta?: Record<string, unknown>,
  ) {
    super(`[${provider}] ${message}`);
  }
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const CONNECTOR_CONFIG = {
  failureThreshold: envInt("CIRCUIT_BREAKER_THRESHOLD", 5),
  cooldownMs: envInt("CIRCUIT_BREAKER_TIMEOUT", 60_000),
  retryAttempts: envInt("CONNECTOR_RETRY_ATTEMPTS", 3),
  retryBaseMs: envInt("CONNECTOR_RETRY_BASE_MS", 1000),
  fetchTimeoutMs: envInt("CONNECTOR_FETCH_TIMEOUT_MS", 10_000),
  staleAfterMs: envInt("CONNECTOR_STALE_AFTER_MS", 15 * 60_000),
  degradedAfterMs: envInt("CONNECTOR_DEGRADED_AFTER_MS", 5 * 60_000),
};

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private lastError: string | null = null;
  private lastErrorClass: string | null = null;
  private lastSuccessAt = 0;
  private lastAttemptAt = 0;
  private lastDownAt: number | null = null;
  private cumulativeDowntimeMs = 0;
  private totalCalls = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;
  private readonly startedAt = Date.now();

  constructor(
    public readonly name: string,
    private failureThreshold = CONNECTOR_CONFIG.failureThreshold,
    private cooldownMs = CONNECTOR_CONFIG.cooldownMs,
  ) {}

  get state(): "closed" | "open" | "half-open" {
    if (this.openedAt === 0) return "closed";
    if (Date.now() - this.openedAt > this.cooldownMs) return "half-open";
    return "open";
  }

  get status3(): "UP" | "DEGRADED" | "DOWN" {
    if (this.state === "open") return "DOWN";
    const sinceSuccess = this.lastSuccessAt === 0 ? Infinity : Date.now() - this.lastSuccessAt;
    if (sinceSuccess > CONNECTOR_CONFIG.staleAfterMs) return "DOWN";
    if (sinceSuccess > CONNECTOR_CONFIG.degradedAfterMs) return "DEGRADED";
    if (this.failures > 0) return "DEGRADED";
    return "UP";
  }

  get uptimeMs(): number {
    const now = Date.now();
    let down = this.cumulativeDowntimeMs;
    if (this.openedAt !== 0) down += now - this.openedAt;
    return Math.max(0, now - this.startedAt - down);
  }

  get successRate(): number {
    return this.totalCalls === 0 ? 1 : this.totalSuccesses / this.totalCalls;
  }

  status() {
    return {
      name: this.name,
      state: this.state,
      status: this.status3,
      consecutiveFailures: this.failures,
      lastError: this.lastError,
      lastErrorClass: this.lastErrorClass,
      lastSuccessAt: this.lastSuccessAt ? new Date(this.lastSuccessAt).toISOString() : null,
      lastAttemptAt: this.lastAttemptAt ? new Date(this.lastAttemptAt).toISOString() : null,
      lastDownAt: this.lastDownAt ? new Date(this.lastDownAt).toISOString() : null,
      cumulativeDowntimeMs: this.cumulativeDowntimeMs + (this.openedAt ? Date.now() - this.openedAt : 0),
      uptimeMs: this.uptimeMs,
      totalCalls: this.totalCalls,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      successRate: Number(this.successRate.toFixed(3)),
      startedAt: new Date(this.startedAt).toISOString(),
      threshold: this.failureThreshold,
      cooldownMs: this.cooldownMs,
    };
  }

  reset() {
    this.failures = 0;
    this.openedAt = 0;
    this.lastError = null;
    this.lastErrorClass = null;
    this.lastDownAt = null;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls += 1;
    this.lastAttemptAt = Date.now();
    if (this.state === "open") {
      this.totalFailures += 1;
      throw new ProviderError(this.name, "circuit open (cooling down)", { state: "open" });
    }
    try {
      const result = await fn();
      const wasOpen = this.openedAt !== 0;
      this.failures = 0;
      if (wasOpen) this.cumulativeDowntimeMs += Date.now() - this.openedAt;
      this.openedAt = 0;
      this.lastSuccessAt = Date.now();
      this.totalSuccesses += 1;
      return result;
    } catch (err) {
      this.failures += 1;
      this.totalFailures += 1;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.lastErrorClass = err instanceof Error ? err.name : "Unknown";
      if (this.failures >= this.failureThreshold && this.openedAt === 0) {
        this.openedAt = Date.now();
        this.lastDownAt = this.openedAt;
        logger.warn("circuit_opened", {
          provider: this.name,
          failures: this.failures,
          error: this.lastError,
          errorClass: this.lastErrorClass,
          cooldownMs: this.cooldownMs,
        });
      }
      throw err;
    }
  }
}

const breakers = new Map<string, CircuitBreaker>();
export function getBreaker(name: string): CircuitBreaker {
  let b = breakers.get(name);
  if (!b) {
    b = new CircuitBreaker(name);
    breakers.set(name, b);
  }
  return b;
}
export function allBreakerStatuses() {
  return [...breakers.values()].map((b) => b.status());
}
export function resetBreaker(name: string) {
  breakers.get(name)?.reset();
}

export interface StaleFlag {
  key: string;
  kind: string;
  symbol: string | null;
  since: string;
  reason: string;
}

const staleMap = new Map<string, StaleFlag>();

export function markStale(kind: string, symbol: string | null, reason: string) {
  const key = `${kind}:${symbol ?? "*"}`;
  staleMap.set(key, { key, kind, symbol, since: new Date().toISOString(), reason });
  logger.warn("data_marked_stale", { kind, symbol, reason });
}

export function clearStale(kind: string, symbol: string | null) {
  staleMap.delete(`${kind}:${symbol ?? "*"}`);
}

export function isStale(kind: string, symbol: string | null): StaleFlag | null {
  return staleMap.get(`${kind}:${symbol ?? "*"}`) ?? null;
}

export function getStaleFlags(): StaleFlag[] {
  return [...staleMap.values()];
}

export const DataValidator = {
  ohlcv(b: Partial<Ohlcv>, ctx: { provider: string; symbol?: string }): Ohlcv | null {
    const reasons: string[] = [];
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
    const open = num(b.open);
    const high = num(b.high);
    const low = num(b.low);
    const close = num(b.close);
    const volume = num(b.volume);
    const time = num(b.time);
    if (!Number.isFinite(open)) reasons.push("open missing/NaN");
    if (!Number.isFinite(high)) reasons.push("high missing/NaN");
    if (!Number.isFinite(low)) reasons.push("low missing/NaN");
    if (!Number.isFinite(close)) reasons.push("close missing/NaN");
    if (!Number.isFinite(volume) || volume < 0) reasons.push("volume <0 or missing");
    if (!Number.isFinite(time) || time <= 0) reasons.push("time invalid");
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) reasons.push("non-positive price");
    if (high < low) reasons.push("high<low");
    if (high < Math.max(open, close) - 1e-6) reasons.push("high<max(o,c)");
    if (low > Math.min(open, close) + 1e-6) reasons.push("low>min(o,c)");
    if (reasons.length > 0) {
      logger.warn("validator_rejected_ohlcv", {
        provider: ctx.provider,
        symbol: ctx.symbol,
        reasons,
        raw: { open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, time: b.time },
      });
      return null;
    }
    return { open, high, low, close, volume, time };
  },

  quote(q: Partial<Quote> & { symbol: string; source: string }, ctx: { provider: string }): Quote | null {
    const base = this.ohlcv(q, ctx);
    if (!base) return null;
    if (!q.symbol || q.symbol.length === 0) {
      logger.warn("validator_rejected_quote", { provider: ctx.provider, reason: "missing symbol" });
      return null;
    }
    return {
      ...base,
      symbol: q.symbol,
      prevClose: typeof q.prevClose === "number" && Number.isFinite(q.prevClose) ? q.prevClose : null,
      changePct: typeof q.changePct === "number" && Number.isFinite(q.changePct) ? q.changePct : null,
      source: q.source,
      confidence: typeof q.confidence === "number" ? Math.max(0, Math.min(1, q.confidence)) : 0.9,
    };
  },

  news(n: Partial<NewsItem>, ctx: { provider: string }): NewsItem | null {
    const reasons: string[] = [];
    if (!n.guid || n.guid.length === 0) reasons.push("missing guid");
    if (!n.title || n.title.length === 0) reasons.push("missing title");
    if (!n.link || n.link.length === 0) reasons.push("missing link");
    if (!n.sourceName || n.sourceName.length === 0) reasons.push("missing sourceName");
    if (!n.publishedAt || !(n.publishedAt instanceof Date) || Number.isNaN(n.publishedAt.getTime()))
      reasons.push("invalid publishedAt");
    if (reasons.length > 0) {
      logger.warn("validator_rejected_news", { provider: ctx.provider, reasons, title: n.title?.slice(0, 80) });
      return null;
    }
    return {
      guid: n.guid!,
      title: n.title!,
      link: n.link!,
      description: n.description ?? "",
      imageUrl: n.imageUrl ?? null,
      sourceName: n.sourceName!,
      publishedAt: n.publishedAt!,
    };
  },
};

export interface FetchOpts extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  provider?: string;
  noRetryOnClientError?: boolean;
  captureRawOnError?: boolean;
}

function classifyError(err: unknown, status?: number): { retryable: boolean; code: string; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "Unknown";
  if (name === "AbortError") return { retryable: true, code: "TIMEOUT", message: msg };
  if (name === "TypeError") return { retryable: true, code: "NETWORK", message: msg };
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|EAI_AGAIN|UND_ERR_/i.test(msg))
    return { retryable: true, code: "NETWORK", message: msg };
  if (status !== undefined) {
    if (status >= 500) return { retryable: true, code: `HTTP_${status}`, message: msg };
    if (status === 429) return { retryable: true, code: "HTTP_429", message: msg };
    if (status >= 400) return { retryable: false, code: `HTTP_${status}`, message: msg };
  }
  return { retryable: false, code: name, message: msg };
}

export async function fetchWithRetry(url: string, init: FetchOpts = {}): Promise<Response> {
  const {
    timeoutMs = CONNECTOR_CONFIG.fetchTimeoutMs,
    retries = CONNECTOR_CONFIG.retryAttempts,
    provider = "unknown",
    noRetryOnClientError = true,
    ...rest
  } = init;
  const log = forProvider(provider);

  let lastErr: unknown;
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...rest,
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "application/json, text/xml, application/xml, */*",
          ...(rest.headers ?? {}),
        },
        cache: "no-store",
      });
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      lastStatus = res.status;
      if (!res.ok) {
        const cls = classifyError(new Error(`HTTP ${res.status}`), res.status);
        log.warn("http_non_ok", {
          url,
          method: rest.method ?? "GET",
          status: res.status,
          attempt,
          durationMs,
          retryable: cls.retryable,
        });
        if (!cls.retryable || (noRetryOnClientError && res.status >= 400 && res.status < 500)) {
          throw new ProviderError(provider, `HTTP ${res.status} for ${url}`, { status: res.status, code: cls.code });
        }
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      log.debug("http_ok", {
        url,
        method: rest.method ?? "GET",
        status: res.status,
        attempt,
        durationMs,
      });
      return res;
    } catch (err) {
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      lastErr = err;
      if (err instanceof ProviderError && err.meta?.code && String(err.meta.code).startsWith("HTTP_4")) {
        throw err;
      }
      const cls = classifyError(err, lastStatus);
      log.warn("fetch_attempt_failed", {
        url,
        method: rest.method ?? "GET",
        attempt,
        retries,
        durationMs,
        code: cls.code,
        retryable: cls.retryable,
        error: cls.message.slice(0, 300),
      });
      if (!cls.retryable || attempt === retries) break;
      const base = CONNECTOR_CONFIG.retryBaseMs * Math.pow(2, attempt);
      const jitter = base * 0.2 * (Math.random() * 2 - 1);
      await new Promise((r) => setTimeout(r, Math.round(base + jitter)));
    }
  }

  const finalErr = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  log.error("fetch_all_retries_exhausted", {
    url,
    method: rest.method ?? "GET",
    attempts: retries + 1,
    lastStatus,
    error: finalErr.message.slice(0, 300),
  });
  throw finalErr;
}

export async function readJsonSafe<T = unknown>(res: Response, provider: string, url: string): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const log = forProvider(provider);
    log.error("json_parse_failed", {
      url,
      contentType: res.headers.get("content-type"),
      rawSnippet: text.slice(0, 500),
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ProviderError(provider, `JSON parse failed for ${url}`, { rawSnippet: text.slice(0, 500) });
  }
}

export async function readTextSafe(res: Response, provider: string, url: string): Promise<string> {
  try {
    return await res.text();
  } catch (err) {
    forProvider(provider).error("text_read_failed", {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ProviderError(provider, `text read failed for ${url}`);
  }
}

function isTransientDbError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string })?.code ?? "";
  if (/P1001|P1002|P1008|P1009|P1017|connection terminated|connection refused|connection reset|timeout/i.test(msg))
    return true;
  if (/P1001|P1002|P1008/.test(code)) return true;
  return false;
}

export async function safeDbQuery<T>(
  label: string,
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 800;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || i === attempts - 1) {
        logger.error("db_query_failed", {
          label,
          attempt: i + 1,
          attempts,
          transient: isTransientDbError(err),
          error: err instanceof Error ? err.message : String(err),
          code: (err as { code?: string })?.code,
        });
        throw err;
      }
      logger.warn("db_transient_error_retrying", {
        label,
        attempt: i + 1,
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((r) => setTimeout(r, baseMs * Math.pow(2, i)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** In-flight dedupe: concurrent cached() for same key share one loader. */
const inflightLoaders = new Map<string, Promise<unknown>>();

export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = await sharedCacheGet<T>(key);
  if (hit !== undefined) return hit;

  const existing = inflightLoaders.get(key);
  if (existing) return existing as Promise<T>;

  const promise = (async () => {
    try {
      const value = await loader();
      await sharedCacheSet(key, value, ttlMs);
      return value;
    } finally {
      inflightLoaders.delete(key);
    }
  })();

  inflightLoaders.set(key, promise);
  return promise;
}

const staleShadow = new Map<string, unknown>();
const STALE_SHADOW_MAX = 500;

export async function cachedWithStaleFallback<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<{ value: T; stale: boolean }> {
  const hit = await sharedCacheGet<T>(key);
  if (hit !== undefined) {
    staleShadow.set(key, hit);
    return { value: hit, stale: false };
  }
  try {
    const value = await loader();
    await sharedCacheSet(key, value, ttlMs);
    if (staleShadow.size >= STALE_SHADOW_MAX) staleShadow.delete(staleShadow.keys().next().value as string);
    staleShadow.set(key, value);
    return { value, stale: false };
  } catch (err) {
    const shadow = staleShadow.get(key);
    if (shadow !== undefined) {
      logger.warn("cache_stale_fallback_used", { key, error: err instanceof Error ? err.message : String(err) });
      return { value: shadow as T, stale: true };
    }
    throw err;
  }
}

const rateBuckets = new Map<string, number[]>();
export function rateLimit(key: string, limit = 120, windowMs = 60_000): boolean {
  const now = Date.now();
  const arr = (rateBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    rateBuckets.set(key, arr);
    return false;
  }
  arr.push(now);
  rateBuckets.set(key, arr);
  return true;
}

/** Run async work with limited concurrency (protect upstream rate limits). */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export { recentLogs };
