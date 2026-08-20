import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import {
  ensureForexFresh,
  latestForexPrices,
} from "@/lib/forex/service";

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
  if (!memoryCache) {
    return null;
  }

  if (Date.now() - memoryCache.createdAt >= MEMORY_TTL_MS) {
    memoryCache = null;
    return null;
  }

  return memoryCache.payload;
}

async function loadForexPrices(): Promise<ForexPricesPayload> {
  const cached = getCachedPayload();

  if (cached) {
    return cached;
  }

  if (!refreshPromise) {
    refreshPromise = (async () => {
      const freshness = await ensureForexFresh(5_000);

      const prices = await latestForexPrices();

      const payload: ForexPricesPayload = {
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
    const payload = await loadForexPrices();

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
    return handleError(err, "forex_prices");
  }
}
