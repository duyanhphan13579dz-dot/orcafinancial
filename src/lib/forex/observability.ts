/**
 * Phase 17 — Observability & Production Hardening
 *
 * In-process metrics for provider latency, errors, cache hits, analysis timing.
 * Survives hot reload via globalThis; suitable for Vercel serverless instances.
 */

export type ComponentStatus = "healthy" | "degraded" | "down" | "unknown";

interface CounterBucket {
  success: number;
  error: number;
  latencySumMs: number;
  latencyCount: number;
  lastLatencyMs: number | null;
  lastError: string | null;
  lastAt: number | null;
}

interface CacheBucket {
  hits: number;
  misses: number;
}

const globalObs = globalThis as typeof globalThis & {
  __orcaForexObs?: {
    providers: Map<string, CounterBucket>;
    caches: Map<string, CacheBucket>;
    analysis: CounterBucket;
    ohlcvFreshnessMs: number[];
    startedAt: number;
  };
};

function store() {
  if (!globalObs.__orcaForexObs) {
    globalObs.__orcaForexObs = {
      providers: new Map(),
      caches: new Map(),
      analysis: emptyCounter(),
      ohlcvFreshnessMs: [],
      startedAt: Date.now(),
    };
  }
  return globalObs.__orcaForexObs;
}

function emptyCounter(): CounterBucket {
  return {
    success: 0,
    error: 0,
    latencySumMs: 0,
    latencyCount: 0,
    lastLatencyMs: null,
    lastError: null,
    lastAt: null,
  };
}

function getProvider(name: string): CounterBucket {
  const s = store();
  let b = s.providers.get(name);
  if (!b) {
    b = emptyCounter();
    s.providers.set(name, b);
  }
  return b;
}

function getCache(name: string): CacheBucket {
  const s = store();
  let b = s.caches.get(name);
  if (!b) {
    b = { hits: 0, misses: 0 };
    s.caches.set(name, b);
  }
  return b;
}

export function recordProviderSuccess(name: string, latencyMs: number) {
  const b = getProvider(name);
  b.success += 1;
  b.latencySumMs += latencyMs;
  b.latencyCount += 1;
  b.lastLatencyMs = latencyMs;
  b.lastAt = Date.now();
}

export function recordProviderError(name: string, error: string, latencyMs?: number) {
  const b = getProvider(name);
  b.error += 1;
  if (latencyMs != null) {
    b.latencySumMs += latencyMs;
    b.latencyCount += 1;
    b.lastLatencyMs = latencyMs;
  }
  b.lastError = error.slice(0, 200);
  b.lastAt = Date.now();
}

export function recordCacheHit(name: string) {
  getCache(name).hits += 1;
}

export function recordCacheMiss(name: string) {
  getCache(name).misses += 1;
}

export function recordAnalysisTiming(ok: boolean, latencyMs: number, error?: string) {
  const b = store().analysis;
  if (ok) b.success += 1;
  else {
    b.error += 1;
    b.lastError = error?.slice(0, 200) ?? null;
  }
  b.latencySumMs += latencyMs;
  b.latencyCount += 1;
  b.lastLatencyMs = latencyMs;
  b.lastAt = Date.now();
}

export function recordOhlcvFreshness(ageMs: number) {
  const arr = store().ohlcvFreshnessMs;
  arr.push(ageMs);
  if (arr.length > 50) arr.shift();
}

/** Timed wrapper for provider calls. */
export async function withProviderTiming<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now();
  try {
    const result = await fn();
    recordProviderSuccess(name, Date.now() - t0);
    return result;
  } catch (err) {
    recordProviderError(
      name,
      err instanceof Error ? err.message : String(err),
      Date.now() - t0,
    );
    throw err;
  }
}

function avgLatency(b: CounterBucket): number | null {
  if (!b.latencyCount) return null;
  return Math.round(b.latencySumMs / b.latencyCount);
}

function successRate(b: CounterBucket): number | null {
  const total = b.success + b.error;
  if (!total) return null;
  return Number(((b.success / total) * 100).toFixed(1));
}

function statusFromBucket(
  b: CounterBucket,
  opts: { maxLatencyMs?: number; minSuccessPct?: number; staleMs?: number } = {},
): ComponentStatus {
  const total = b.success + b.error;
  if (!total && !b.lastAt) return "unknown";
  const rate = successRate(b);
  const avg = avgLatency(b);
  const stale =
    opts.staleMs != null && b.lastAt != null
      ? Date.now() - b.lastAt > opts.staleMs
      : false;
  if (stale) return "degraded";
  if (rate != null && rate < (opts.minSuccessPct ?? 80)) return "down";
  if (rate != null && rate < 95) return "degraded";
  if (avg != null && opts.maxLatencyMs != null && avg > opts.maxLatencyMs)
    return "degraded";
  return "healthy";
}

export interface ForexHealthReport {
  asOf: string;
  overall: ComponentStatus;
  uptimeMs: number;
  components: {
    priceFeed: ComponentStatus;
    ohlcv: ComponentStatus;
    analysis: ComponentStatus;
    macro: ComponentStatus;
    cache: ComponentStatus;
  };
  providers: Array<{
    name: string;
    successRate: number | null;
    avgLatencyMs: number | null;
    lastLatencyMs: number | null;
    success: number;
    error: number;
    lastError: string | null;
    status: ComponentStatus;
  }>;
  caches: Array<{
    name: string;
    hits: number;
    misses: number;
    hitRate: number | null;
  }>;
  analysis: {
    successRate: number | null;
    avgLatencyMs: number | null;
    lastLatencyMs: number | null;
    status: ComponentStatus;
  };
  ohlcv: {
    sampleCount: number;
    avgFreshnessMs: number | null;
    maxFreshnessMs: number | null;
    status: ComponentStatus;
  };
}

export function getForexHealthReport(): ForexHealthReport {
  const s = store();
  const providers = [...s.providers.entries()].map(([name, b]) => ({
    name,
    successRate: successRate(b),
    avgLatencyMs: avgLatency(b),
    lastLatencyMs: b.lastLatencyMs,
    success: b.success,
    error: b.error,
    lastError: b.lastError,
    status: statusFromBucket(b, { maxLatencyMs: 3000, minSuccessPct: 70 }),
  }));

  const caches = [...s.caches.entries()].map(([name, b]) => {
    const total = b.hits + b.misses;
    return {
      name,
      hits: b.hits,
      misses: b.misses,
      hitRate: total ? Number(((b.hits / total) * 100).toFixed(1)) : null,
    };
  });

  const priceNames = providers.filter((p) =>
    /yahoo|snapshot|quote|price|pipeline/i.test(p.name),
  );
  const ohlcvNames = providers.filter((p) => /ohlcv|bars|history/i.test(p.name));
  const macroNames = providers.filter((p) => /macro|calendar|ff|finnhub/i.test(p.name));

  const worst = (list: ComponentStatus[]): ComponentStatus => {
    if (list.includes("down")) return "down";
    if (list.includes("degraded")) return "degraded";
    if (list.includes("healthy")) return "healthy";
    return "unknown";
  };

  const analysisStatus = statusFromBucket(s.analysis, {
    maxLatencyMs: 15_000,
    minSuccessPct: 70,
  });

  const fresh = s.ohlcvFreshnessMs;
  const avgFresh = fresh.length
    ? Math.round(fresh.reduce((a, b) => a + b, 0) / fresh.length)
    : null;
  const maxFresh = fresh.length ? Math.max(...fresh) : null;
  const ohlcvStatus: ComponentStatus =
    maxFresh != null && maxFresh > 30 * 60_000
      ? "degraded"
      : ohlcvNames.length
        ? worst(ohlcvNames.map((p) => p.status))
        : avgFresh != null
          ? "healthy"
          : "unknown";

  const cacheHit =
    caches.length > 0
      ? caches.reduce((s, c) => s + (c.hitRate ?? 0), 0) / caches.length
      : null;
  const cacheStatus: ComponentStatus =
    cacheHit == null ? "unknown" : cacheHit < 20 ? "degraded" : "healthy";

  const components = {
    priceFeed: priceNames.length
      ? worst(priceNames.map((p) => p.status))
      : "unknown",
    ohlcv: ohlcvStatus,
    analysis: analysisStatus,
    macro: macroNames.length
      ? worst(macroNames.map((p) => p.status))
      : "unknown",
    cache: cacheStatus,
  };

  const overall = worst(Object.values(components));

  return {
    asOf: new Date().toISOString(),
    overall,
    uptimeMs: Date.now() - s.startedAt,
    components,
    providers,
    caches,
    analysis: {
      successRate: successRate(s.analysis),
      avgLatencyMs: avgLatency(s.analysis),
      lastLatencyMs: s.analysis.lastLatencyMs,
      status: analysisStatus,
    },
    ohlcv: {
      sampleCount: fresh.length,
      avgFreshnessMs: avgFresh,
      maxFreshnessMs: maxFresh,
      status: ohlcvStatus,
    },
  };
}
