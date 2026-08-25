import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import {
  ensureForexFresh,
  getForexPair,
  getLiveQuoteContract,
} from "@/lib/forex/service";
import {
  FOREX_CACHE,
  fxCacheGet,
  fxCacheSet,
  quoteKey,
  withBudget,
} from "@/lib/forex/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 6;

export async function GET(
  req: NextRequest,
  c: { params: Promise<{ symbol: string }> },
) {
  const l = checkRateLimit(req, 240);
  if (l) return l;
  const { symbol } = await c.params;
  const sym = symbol.toUpperCase();
  const key = quoteKey(sym);

  try {
    type Payload = {
      pair: unknown;
      quote: unknown;
      price: unknown;
      freshness: unknown;
      source?: string;
    };

    const cached = await fxCacheGet<Payload>(key);
    if (cached?.quote || cached?.price) {
      void ensureForexFresh(8_000).catch(() => undefined);
      const response = ok(
        {
          pair: cached.pair,
          quote: cached.quote,
          price: cached.price,
          freshness: cached.freshness,
        },
        {
          timezone: "Asia/Ho_Chi_Minh",
          source: cached.source,
          cacheHit: "redis",
        },
        { cacheSeconds: 3 },
      );
      response.headers.set("X-Cache-Hit", "redis");
      return response;
    }

    void ensureForexFresh(5_000).catch(() => undefined);

    const [quote, detail] = await withBudget(
      Promise.all([
        getLiveQuoteContract(sym),
        getForexPair(sym),
      ]),
      FOREX_CACHE.softDeadlineMs,
      "forex_price",
    );

    if (!quote && !detail?.price) {
      return fail("Price unavailable", 404);
    }

    const payload: Payload = {
      pair: detail?.pair ?? {
        symbol: sym,
        name: quote?.name ?? sym,
        category: quote?.category ?? "usd_cross",
        baseCurrency: quote?.baseCurrency ?? "",
        quoteCurrency: quote?.quoteCurrency ?? "",
      },
      quote,
      price: quote
        ? {
            price: quote.price,
            bid: quote.bid,
            ask: quote.ask,
            change: quote.change,
            changePercent: quote.changePercent,
            source: quote.source,
            timestamp: quote.timestamp,
            spread: quote.spread,
            spreadPips: quote.spreadPips,
            freshness: quote.freshness,
            ageMs: quote.ageMs,
          }
        : detail?.price,
      freshness: quote
        ? {
            state: quote.freshness,
            ageMs: quote.ageMs,
            timestamp: quote.timestamp,
            source: quote.source,
          }
        : { state: "OFFLINE" as const },
      source: quote?.source,
    };

    await fxCacheSet(key, payload, FOREX_CACHE.quoteTtlMs);

    const response = ok(
      {
        pair: payload.pair,
        quote: payload.quote,
        price: payload.price,
        freshness: payload.freshness,
      },
      {
        timezone: "Asia/Ho_Chi_Minh",
        source: payload.source,
        cacheHit: "miss",
      },
      { cacheSeconds: 3 },
    );
    response.headers.set("X-Cache-Hit", "miss");
    return response;
  } catch (e) {
    return handleError(e, `forex_price:${symbol}`);
  }
}
