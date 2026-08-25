"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Envelope<T> {
  data: T;
  meta?: Record<string, unknown>;
  error?: string;
}

interface CacheEntry {
  data: unknown;
  meta: Record<string, unknown> | null;
  fetchedAt: number;
}

const DEFAULT_SOFT_TTL_MS = 15_000;
const DEFAULT_HARD_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 80;
/** Agent chat can take up to ~50s server-side; client must wait longer than that. */
const DEFAULT_FETCH_TIMEOUT_MS = 55_000;

const responseCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<Envelope<unknown>>>();

function touchCache(key: string, entry: CacheEntry) {
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

function mapNetworkError(err: unknown, status?: number): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/abort|timeout/i.test(msg)) {
    return new Error(
      "Yêu cầu quá lâu (timeout). Thử lại sau vài giây — server có thể đang lấy dữ liệu thị trường.",
    );
  }
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return new Error(
      "Không nhận được phản hồi từ server (Failed to fetch). Thường do timeout/deploy hoặc mất kết nối. Thử lại sau 5–10 giây.",
    );
  }
  if (status === 504 || status === 502) {
    return new Error(`Máy chủ quá tải (HTTP ${status}). Thử lại sau vài giây.`);
  }
  return err instanceof Error ? err : new Error(msg);
}

async function readEnvelope<T>(res: Response): Promise<Envelope<T>> {
  const text = await res.text();
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error(res.ok ? "Empty response" : `HTTP ${res.status}`);
  }

  try {
    return JSON.parse(trimmed) as Envelope<T>;
  } catch {
    const snippet = trimmed.replace(/\s+/g, " ").slice(0, 160);
    if (!res.ok) {
      throw new Error(
        snippet.startsWith("An error") || snippet.startsWith("<!DOCTYPE")
          ? `Máy chủ lỗi (HTTP ${res.status}). Thử lại sau khi deploy xong hoặc kiểm tra Vercel logs.`
          : `HTTP ${res.status}: ${snippet}`,
      );
    }
    throw new Error(`Phản hồi không phải JSON: ${snippet}`);
  }
}

export async function api<T>(
  path: string,
  init?: RequestInit & { skipCache?: boolean; timeoutMs?: number },
): Promise<Envelope<T>> {
  const method = (init?.method ?? "GET").toUpperCase();
  const skipCache = init?.skipCache || method !== "GET";
  const timeoutMs =
    init?.timeoutMs ??
    (path.includes("/agent/chat") ? DEFAULT_FETCH_TIMEOUT_MS : 30_000);

  if (!skipCache) {
    const existing = inflight.get(path);
    if (existing) return existing as Promise<Envelope<T>>;
  }

  const run = (async (): Promise<Envelope<T>> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`/api/v1${path}`, {
        ...init,
        credentials: "include",
        cache: skipCache ? "no-store" : init?.cache ?? "default",
        signal: controller.signal,
      });
      const json = await readEnvelope<T>(res);
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);

      if (!skipCache) {
        touchCache(path, {
          data: json.data,
          meta: json.meta ?? null,
          fetchedAt: Date.now(),
        });
      }
      return json;
    } catch (err) {
      throw mapNetworkError(err);
    } finally {
      clearTimeout(timer);
    }
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
  softTtlMs?: number;
  hardTtlMs?: number;
  enabled?: boolean;
  timeoutMs?: number;
};

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
  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  const load = useCallback(
    async (opts?: { background?: boolean }) => {
      const p = pathRef.current;
      if (!p) return;

      const background = opts?.background === true;
      if (background) setIsValidating(true);
      else if (!readCache(p, hardTtl)) setLoading(true);

      try {
        const env = await api<T>(p, options.timeoutMs ? { timeoutMs: options.timeoutMs } : undefined);
        if (pathRef.current !== p) return;
        setData(env.data);
        setMeta(env.meta ?? null);
        setError(null);
      } catch (err) {
        if (pathRef.current !== p) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (pathRef.current === p) {
          setLoading(false);
          setIsValidating(false);
        }
      }
    },
    [hardTtl, options.timeoutMs],
  );

  useEffect(() => {
    if (!path || !enabled) {
      // Reset loading when a consumer disables polling or clears its path.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
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
