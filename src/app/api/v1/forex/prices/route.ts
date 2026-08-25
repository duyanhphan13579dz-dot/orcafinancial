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
import {
  FOREX_CACHE,
  fxCacheGet,
  fxCacheSet,
  pricesKey,
  withBudget,
} from "@/lib/forex/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 8;

interface ForexPricesPayload {
  prices: ForexQuoteContract[];
  freshness: Record<string, unknown>;
}

async function liveYahooPrices(): Promise<ForexPricesPayload> {
  const snapshot = await withBudget(
    fetchForexSnapshot(),
    FOREX_CACHE.softDeadlineMs,
    "yahoo_snapshot",
  );
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
    await withBudget(
      ensureMarketTables().catch(() => undefined),
      1_500,
      "ensure_tables",
    ).catch(() => undefined);

    void ensureForexFresh(12_000).catch(() => undefined);

    const rows = await withBudget(
      latestForexPrices(),
      2_500,
      "latest_forex",
    );
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

async function loadForexPrices(): Promise<ForexPricesPayload & { cacheHit?: string }> {
  const key = pricesKey();
  const cached = await fxCacheGet<ForexPricesPayload>(key);
  if (cached?.prices?.length) {
    // Background refresh when cache is older-style payload
    void (async () => {
      try {
        const db = await loadFromDbFast();
        const payload = db ?? (await liveYahooPrices().catch(() => null));
        if (payload?.prices?.length) {
          await fxCacheSet(key, payload, FOREX_CACHE.pricesTtlMs);
        }
      } catch {
        /* ignore bg */
      }
    })();
    return { ...cached, cacheHit: "redis" };
  }

  // Race DB vs Yahoo under hard budget
  const dbP = loadFromDbFast();
  const yahooP = liveYahooPrices().catch(() => null);

  const db = await dbP;
  if (db?.prices?.length) {
    await fxCacheSet(key, db, FOREX_CACHE.pricesTtlMs);
    return { ...db, cacheHit: "db" };
  }

  const yahoo = await withBudget(
    yahooP.then((x) => x ?? Promise.reject(new Error("yahoo_empty"))),
    FOREX_CACHE.hardDeadlineMs,
    "prices_total",
  ).catch(async () => {
    // Last resort: any stale redis with longer key read already failed
    return null;
  });

  if (yahoo?.prices?.length) {
    await fxCacheSet(key, yahoo, FOREX_CACHE.pricesTtlMs);
    return { ...yahoo, cacheHit: "yahoo" };
  }

  // Empty shell — client shows skeleton
  return {
    prices: [],
    freshness: { refreshed: false, source: "empty", count: 0 },
    cacheHit: "none",
  };
}

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 180);
  if (limited) return limited;

  try {
    const payload = await withBudget(
      loadForexPrices(),
      FOREX_CACHE.hardDeadlineMs,
      "forex_prices",
    );
    const { cacheHit, ...data } = payload;
    const response = ok(data, {
      timezone: "Asia/Ho_Chi_Minh",
      cacheHit: cacheHit ?? "unknown",
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=4, stale-while-revalidate=20",
    );
    response.headers.set(
      "Vercel-CDN-Cache-Control",
      "public, s-maxage=4, stale-while-revalidate=20",
    );
    response.headers.set("X-Cache-Hit", String(cacheHit ?? "unknown"));
    return response;
  } catch (err) {
    return handleError(err, "forex_prices");
  }
}
