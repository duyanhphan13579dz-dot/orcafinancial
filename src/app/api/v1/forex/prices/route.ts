import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { ensureMarketTables } from "@/db/ensure-market-tables";
import {
  ensureForexFresh,
  latestForexPrices,
} from "@/lib/forex/service";
import { fetchForexSnapshot } from "@/lib/forex/connectors";
import { FOREX_BY_SYMBOL } from "@/lib/forex/data";

export const dynamic = "force-dynamic";

const MEMORY_TTL_MS = 12_000;
const MEMORY_HARD_TTL_MS = 45_000;

interface ForexPricesPayload {
  prices: unknown[];
  freshness: unknown;
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

async function liveYahooPrices(): Promise<ForexPricesPayload> {
  const snapshot = await fetchForexSnapshot();
  const prices = snapshot.quotes.map((q) => {
    const def = FOREX_BY_SYMBOL.get(q.symbol);
    return {
      symbol: q.symbol,
      name: def?.name ?? q.symbol,
      category: def?.category ?? "usd_cross",
      baseCurrency: def?.baseCurrency ?? "",
      quoteCurrency: def?.quoteCurrency ?? "",
      price: q.price,
      bid: q.bid,
      ask: q.ask,
      change: q.change,
      changePercent: q.changePercent,
      source: snapshot.source,
      timestamp: q.timestamp.toISOString?.() ?? new Date(q.timestamp).toISOString(),
    };
  });
  return {
    prices,
    freshness: {
      refreshed: true,
      source: snapshot.source,
      live: true,
    },
  };
}

async function loadFromDb(): Promise<ForexPricesPayload | null> {
  try {
    await ensureMarketTables().catch(() => undefined);
    // Non-blocking: kick refresh if stale, never wait for full Yahoo multi-pair sync here
    void ensureForexFresh(15_000).catch(() => undefined);
    const prices = await latestForexPrices();
    if (!prices?.length) return null;
    return {
      prices,
      freshness: { refreshed: false, source: "db-cache" },
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
      const fromDb = await loadFromDb();
      if (fromDb) return fromDb;
      const live = await liveYahooPrices();
      // Warm DB in background after live response path
      void ensureForexFresh(0).catch(() => undefined);
      return live;
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

  return refreshPromise;
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
