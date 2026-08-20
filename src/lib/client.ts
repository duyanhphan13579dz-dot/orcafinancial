"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Envelope<T> {
  data: T;
  meta?: Record<string, unknown>;
  error?: string;
}

/* ═══════════════════════════════════════════════════════════════════════
 * Client-side SWR cache
 *
 * Root cause of slow page switches: every page is "use client", api()
 * always used cache:"no-store", and usePoll reset loading=true with no
 * retained data. Navigating crypto → forex → crypto refetched everything.
 *
 * Fix: module-level Map shared across route mounts. On revisit we paint
 * cached data immediately (loading=false if cache hit) and revalidate in
 * the background when soft TTL expires.
 * ═══════════════════════════════════════════════════════════════════════ */

interface CacheEntry {
  data: unknown;
  meta: Record<string, unknown> | null;
  fetchedAt: number;
}

/** Soft TTL — serve from memory, refresh in background when older. */
const DEFAULT_SOFT_TTL_MS = 15_000;
/** Hard TTL — drop entry and force a blocking fetch. */
const DEFAULT_HARD_TTL_MS = 5 * 60_000;
/** Cap memory growth (FIFO eviction by insertion order via Map). */
const MAX_CACHE_ENTRIES = 80;

const responseCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<Envelope<unknown>>>();

function touchCache(key: string, entry: CacheEntry) {
  // Re-insert to keep Map insertion order = LRU-ish for eviction
  responseCache.delete(key);
  responseCache.set(key, entry);
  while (responseCache.size > MAX_CACHE_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest === undefined) break;
    responseCache.delete(oldest);
  }
}

function readCache(path: string, hardTtlMs = DEFAULT_HARD_TTL_MS): CacheEntry | null {
  const hit = responseCache.get(path);
  if (!hit) return null;
  if (Date.now() - hit.fetchedAt > hardTtlMs) {
    responseCache.delete(path);
    return null;
  }
  return hit;
}

/** Invalidate one path or all (e.g. after logout). */
export function invalidateApiCache(pathPrefix?: string) {
  if (!pathPrefix) {
    responseCache.clear();
    return;
  }
  for (const key of [...responseCache.keys()]) {
    if (key.startsWith(pathPrefix) || key.includes(pathPrefix)) {
      responseCache.delete(key);
    }
  }
}

/** Frontend only ever talks to our backend API (never external sources directly). */
export async function api<T>(
  path: string,
  init?: RequestInit & { skipCache?: boolean },
): Promise<Envelope<T>> {
  const method = (init?.method ?? "GET").toUpperCase();
  const skipCache = init?.skipCache || method !== "GET";

  if (!skipCache) {
    const existing = inflight.get(path);
    if (existing) return existing as Promise<Envelope<T>>;
  }

  const run = (async (): Promise<Envelope<T>> => {
    // Prefer browser HTTP cache when server sets Cache-Control; still
    // layer our memory cache on top for instant SPA navigations.
    const res = await fetch(`/api/v1${path}`, {
      ...init,
      // GET: allow browser/CDN cache; mutations stay no-store
      cache: skipCache ? "no-store" : init?.cache ?? "default",
    });
    const json = (await res.json()) as Envelope<T>;
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);

    if (!skipCache) {
      touchCache(path, {
        data: json.data,
        meta: json.meta ?? null,
        fetchedAt: Date.now(),
      });
    }
    return json;
  })();

  if (!skipCache) {
    inflight.set(path, run as Promise<Envelope<unknown>>);
    try {
      return await run;
    } finally {
      inflight.delete(path);
    }
  }

  return run;
}

export type UsePollOptions = {
  /** Soft TTL before background revalidate (default 15s). */
  softTtlMs?: number;
  /** Hard TTL before cache is discarded (default 5min). */
  hardTtlMs?: number;
  /** When false, do not poll on an interval — one-shot + manual refresh. */
  enabled?: boolean;
};

/**
 * Poll a backend endpoint with client SWR.
 *
 * - Cache hit → paint immediately (no loading flash)
 * - Soft TTL expired → show stale data + background refresh
 * - Hard TTL / miss → loading until first response
 */
export function usePoll<T>(
  path: string | null,
  intervalMs = 15_000,
  options: UsePollOptions = {},
) {
  const softTtl = options.softTtlMs ?? Math.min(intervalMs, DEFAULT_SOFT_TTL_MS);
  const hardTtl = options.hardTtlMs ?? DEFAULT_HARD_TTL_MS;
  const enabled = options.enabled !== false;

  const cached = path ? readCache(path, hardTtl) : null;

  const [data, setData] = useState<T | null>(() => (cached ? (cached.data as T) : null));
  const [meta, setMeta] = useState<Record<string, unknown> | null>(() =>
    cached ? cached.meta : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !cached);
  const [isValidating, setIsValidating] = useState(false);

  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(
    async (opts?: { background?: boolean }) => {
      const p = pathRef.current;
      if (!p) return;

      const background = opts?.background === true;
      if (background) setIsValidating(true);
      else if (!readCache(p, hardTtl)) setLoading(true);

      try {
        const env = await api<T>(p);
        // Ignore stale responses if path changed mid-flight
        if (pathRef.current !== p) return;
        setData(env.data);
        setMeta(env.meta ?? null);
        setError(null);
      } catch (err) {
        if (pathRef.current !== p) return;
        // Keep showing cached data on transient errors
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (pathRef.current === p) {
          setLoading(false);
          setIsValidating(false);
        }
      }
    },
    [hardTtl],
  );

  useEffect(() => {
    if (!path || !enabled) {
      setLoading(false);
      return;
    }

    const hit = readCache(path, hardTtl);
    if (hit) {
      setData(hit.data as T);
      setMeta(hit.meta);
      setLoading(false);
      setError(null);
      const age = Date.now() - hit.fetchedAt;
      if (age > softTtl) {
        void load({ background: true });
      }
    } else {
      setData(null);
      setMeta(null);
      setLoading(true);
      void load({ background: false });
    }

    if (intervalMs <= 0) return;

    const timer = setInterval(() => {
      void load({ background: true });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [path, intervalMs, enabled, softTtl, hardTtl, load]);

  return {
    data,
    meta,
    error,
    loading,
    isValidating,
    refresh: () => load({ background: !!data }),
  };
}

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtVol(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function changeColor(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || Math.abs(pct) < 0.005) return "text-amber-400";
  return pct > 0 ? "text-emerald-400" : "text-rose-400";
}

export function fmtPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

export function timeAgo(dateStr: string | Date): string {
  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}
