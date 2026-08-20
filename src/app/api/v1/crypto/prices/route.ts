import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { ensureMarketTables } from "@/db/ensure-market-tables";
import {
  ensureCryptoFresh,
  latestCryptoPrices,
} from "@/lib/crypto/service";

export const dynamic = "force-dynamic";

const MEMORY_TTL_MS = 5_000;

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

function getCachedPayload(): CryptoPricesPayload | null {
  if (!memoryCache) {
    return null;
  }

  if (Date.now() - memoryCache.createdAt >= MEMORY_TTL_MS) {
    memoryCache = null;
    return null;
  }

  return memoryCache.payload;
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

async function loadCryptoPrices(
  limit: number,
): Promise<CryptoPricesPayload> {
  const cached = getCachedPayload();

  if (cached) {
    return cached;
  }

  if (!refreshPromise) {
    refreshPromise = (async () => {
      await ensureTablesOnce();

      const freshness = await ensureCryptoFresh();

      const prices = await latestCryptoPrices(limit);

      const payload: CryptoPricesPayload = {
        prices,
        freshness,
      };

      memoryCache = {
        payload,
        createdAt: Date.now(),
      };

      return payload;
    })().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 180);

  if (limited) {
    return limited;
  }

  try {
    const requestedLimit = Number(
      req.nextUrl.searchParams.get("limit") ?? 50,
    );

    const limit = Math.min(
      100,
      Math.max(
        1,
        Number.isFinite(requestedLimit)
          ? Math.floor(requestedLimit)
          : 50,
      ),
    );

    const payload = await loadCryptoPrices(limit);

    const response = ok(
      payload,
      {
        timezone: "Asia/Ho_Chi_Minh",
      },
    );

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
    return handleError(err, "crypto_prices");
  }
}
