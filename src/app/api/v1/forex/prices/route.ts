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

const MEMORY_TTL_MS = 5_000;

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

function getCachedPayload(): ForexPricesPayload | null {
  if (!memoryCache) return null;
  if (Date.now() - memoryCache.createdAt >= MEMORY_TTL_MS) {
    memoryCache = null;
    return null;
  }
  return memoryCache.payload;
}

/** Live Yahoo quotes shaped like DB rows — works with zero DB. */
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

async function loadForexPrices(): Promise<ForexPricesPayload> {
  const cached = getCachedPayload();
  if (cached) return cached;

  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        await ensureMarketTables().catch(() => undefined);
        const freshness = await ensureForexFresh(5_000);
        const prices = await latestForexPrices();
        // Empty DB after ensure → still prefer live Yahoo so UI is not blank
        if (!prices?.length) {
          return liveYahooPrices();
        }
        return { prices, freshness };
      } catch (err) {
        console.warn(
          "[forex_prices] DB path failed, using Yahoo live",
          err instanceof Error ? err.message : err,
        );
        return liveYahooPrices();
      }
    })()
      .then((payload) => {
        memoryCache = { payload, createdAt: Date.now() };
        return payload;
      })
      .finally(() => {
        refreshPromise = null;
      });
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
      "public, s-maxage=5, stale-while-revalidate=30",
    );
    response.headers.set(
      "Vercel-CDN-Cache-Control",
      "public, s-maxage=5, stale-while-revalidate=30",
    );
    return response;
  } catch (err) {
    return handleError(err, "forex_prices");
  }
}
