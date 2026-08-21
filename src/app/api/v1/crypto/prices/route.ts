import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { ensureMarketTables } from "@/db/ensure-market-tables";
import {
  ensureCryptoFresh,
  latestCryptoPrices,
} from "@/lib/crypto/service";
import { fetchBinanceTickers } from "@/lib/crypto/connectors";

export const dynamic = "force-dynamic";

/** Soft in-process cache — list page can re-hit within this window without DB. */
const MEMORY_TTL_MS = 15_000;
/** Stale cache still served while background refresh runs. */
const MEMORY_HARD_TTL_MS = 60_000;

const STABLES = new Set([
  "USDT", "USDC", "FDUSD", "TUSD", "DAI", "BUSD", "USDE", "USD1", "PYUSD",
]);

interface CryptoPricesPayload {
  prices: unknown[];
  freshness: unknown;
}

interface MemoryCacheEntry {
  payload: CryptoPricesPayload;
  createdAt: number;
}

let memoryCache: MemoryCacheEntry | null = null;
let marketTablesPromise: Promise<unknown> | null = null;
let refreshPromise: Promise<CryptoPricesPayload> | null = null;

function getCachedPayload(allowStale = false): CryptoPricesPayload | null {
  if (!memoryCache) return null;
  const age = Date.now() - memoryCache.createdAt;
  if (age < MEMORY_TTL_MS) return memoryCache.payload;
  if (allowStale && age < MEMORY_HARD_TTL_MS) return memoryCache.payload;
  if (age >= MEMORY_HARD_TTL_MS) memoryCache = null;
  return null;
}

async function ensureTablesOnce() {
  if (!marketTablesPromise) {
    marketTablesPromise = ensureMarketTables().catch((error) => {
      marketTablesPromise = null;
      throw error;
    });
  }
  return marketTablesPromise;
}

/** Direct Binance 24hr tickers — no DB required. */
async function liveBinancePrices(limit: number): Promise<CryptoPricesPayload> {
  const tickers = await fetchBinanceTickers();
  const prices = tickers
    .filter((t) => !STABLES.has(t.symbol.toUpperCase()))
    .slice(0, limit)
    .map((t) => ({
      symbol: t.symbol,
      name: t.symbol,
      logoUrl: null,
      marketCapRank: null,
      price: t.price,
      priceVnd: null,
      volume24h: t.volume24h,
      marketCap: t.marketCap,
      change24h: t.change24h,
      source: t.source,
      timestamp: t.timestamp.toISOString(),
    }));
  return {
    prices,
    freshness: { refreshed: true, source: "binance-live", live: true },
  };
}

async function loadFromDb(limit: number): Promise<CryptoPricesPayload | null> {
  try {
    await ensureTablesOnce().catch(() => undefined);
    // Soft freshness: only schedule background sync, do not block on full market ingest
    void ensureCryptoFresh(20_000).catch(() => undefined);
    const prices = await latestCryptoPrices(limit);
    if (!prices?.length) return null;
    return {
      prices,
      freshness: { refreshed: false, source: "db-cache" },
    };
  } catch {
    return null;
  }
}

async function loadCryptoPrices(limit: number): Promise<CryptoPricesPayload> {
  const fresh = getCachedPayload(false);
  if (fresh) return fresh;

  // Serve slightly stale memory while one refresh is in flight
  const stale = getCachedPayload(true);

  if (!refreshPromise) {
    refreshPromise = (async () => {
      const fromDb = await loadFromDb(limit);
      if (fromDb) return fromDb;

      // Cold path: live Binance, then background DB warm
      const live = await liveBinancePrices(limit);
      void ensureCryptoFresh(0).catch(() => undefined);
      return live;
    })()
      .then((payload) => {
        memoryCache = { payload, createdAt: Date.now() };
        return payload;
      })
      .catch(async (err) => {
        console.warn("[crypto_prices] refresh failed", err);
        if (stale) return stale;
        return liveBinancePrices(limit);
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  if (stale) {
    // Don't wait — return stale immediately; refresh runs in background
    void refreshPromise;
    return stale;
  }

  return refreshPromise;
}

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 180);
  if (limited) return limited;

  try {
    const requestedLimit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
    const limit = Math.min(
      100,
      Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 50),
    );

    const payload = await loadCryptoPrices(limit);
    const response = ok(payload, { timezone: "Asia/Ho_Chi_Minh" });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=10, stale-while-revalidate=60",
    );
    response.headers.set(
      "Vercel-CDN-Cache-Control",
      "public, s-maxage=10, stale-while-revalidate=60",
    );
    return response;
  } catch (err) {
    return handleError(err, "crypto_prices");
  }
}
