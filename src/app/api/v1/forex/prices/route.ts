import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { ensureMarketTables } from "@/db/ensure-market-tables";
import {
  ensureForexFresh,
  latestForexPrices,
  mapRowsToContracts,
  syncForexPrices,
} from "@/lib/forex/service";
import { fetchForexSnapshot } from "@/lib/forex/connectors";
import { FOREX_BY_SYMBOL } from "@/lib/forex/data";
import { toQuoteContract } from "@/lib/forex/normalize";
import type { ForexQuoteContract } from "@/lib/forex/types";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const MEMORY_TTL_MS = 12_000;
const MEMORY_HARD_TTL_MS = 45_000;
const HARD_DEADLINE_MS = 12_000;
const DB_BUDGET_MS = 4_000;

interface ForexPricesPayload {
  prices: ForexQuoteContract[];
  freshness: Record<string, unknown>;
}

interface MemoryCacheEntry {
  payload: ForexPricesPayload;
  createdAt: number;
}

let memoryCache: MemoryCacheEntry | null = null;
let refreshPromise: Promise<ForexPricesPayload> | null = null;

function getCachedPayload(allowStale = false): ForexPricesPayload | null {
  if (!memoryCache) return null;
  const age = Date.now() - memoryCache.createdAt;
  if (age < MEMORY_TTL_MS) return memoryCache.payload;
  if (allowStale && age < MEMORY_HARD_TTL_MS) return memoryCache.payload;
  if (age >= MEMORY_HARD_TTL_MS) memoryCache = null;
  return null;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms),
    ),
  ]);
}

async function liveYahooPrices(): Promise<ForexPricesPayload> {
  const snapshot = await withTimeout(fetchForexSnapshot(), 10_000, "yahoo_snapshot");
  // Persist in background so DB path stays warm
  void syncForexPrices().catch(() => undefined);

  const prices = snapshot.quotes.map((q) => {
    const def = FOREX_BY_SYMBOL.get(q.symbol);
    return toQuoteContract(q, {
      name: def?.name,
      category: def?.category,
      baseCurrency: def?.baseCurrency,
      quoteCurrency: def?.quoteCurrency,
      forceDegraded: q.degraded,
    });
  });

  return {
    prices,
    freshness: {
      refreshed: true,
      source: snapshot.source,
      live: true,
      count: prices.length,
    },
  };
}

async function loadFromDbFast(): Promise<ForexPricesPayload | null> {
  try {
    await withTimeout(
      ensureMarketTables().catch(() => undefined),
      2_000,
      "ensure_tables",
    ).catch(() => undefined);

    void ensureForexFresh(15_000).catch(() => undefined);

    const rows = await withTimeout(latestForexPrices(), DB_BUDGET_MS, "latest_forex");
    if (!rows?.length) return null;

    const prices = mapRowsToContracts(rows as Array<Record<string, unknown>>);
    return {
      prices,
      freshness: { refreshed: false, source: "db-cache", count: prices.length },
    };
  } catch {
    return null;
  }
}

async function loadForexPrices(): Promise<ForexPricesPayload> {
  const fresh = getCachedPayload(false);
  if (fresh) return fresh;

  const stale = getCachedPayload(true);

  if (!refreshPromise) {
    refreshPromise = (async () => {
      const dbAttempt = loadFromDbFast();
      const yahooAttempt = liveYahooPrices();

      const db = await dbAttempt;
      if (db) return db;

      return yahooAttempt;
    })()
      .then((payload) => {
        memoryCache = { payload, createdAt: Date.now() };
        return payload;
      })
      .catch(async (err) => {
        console.warn("[forex_prices] refresh failed", err);
        if (stale) return stale;
        return liveYahooPrices();
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  if (stale) {
    void refreshPromise;
    return stale;
  }

  return withTimeout(refreshPromise, HARD_DEADLINE_MS, "forex_prices_total");
}

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 180);
  if (limited) return limited;

  try {
    const payload = await loadForexPrices();
    const response = ok(payload, { timezone: "Asia/Ho_Chi_Minh" });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=10, stale-while-revalidate=45",
    );
    response.headers.set(
      "Vercel-CDN-Cache-Control",
      "public, s-maxage=10, stale-while-revalidate=45",
    );
    return response;
  } catch (err) {
    return handleError(err, "forex_prices");
  }
}
