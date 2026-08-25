import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import {
  getForexDetailBundle,
  getLiveQuoteContract,
  syncForexOhlcv,
} from "@/lib/forex/service";
import {
  defaultTimeframe,
  isValidTimeframe,
} from "@/lib/forex/timeframes";
import {
  FOREX_CACHE,
  fxCacheGet,
  fxCacheSet,
  ohlcvKey,
  ohlcvTtlMs,
  withBudget,
} from "@/lib/forex/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ symbol: string }> },
) {
  const rateLimit = checkRateLimit(req, 120);
  if (rateLimit) return rateLimit;

  const { symbol } = await context.params;
  const sym = symbol.toUpperCase();
  const timeframe =
    req.nextUrl.searchParams.get("timeframe") ?? defaultTimeframe(sym);

  if (!isValidTimeframe(timeframe, sym)) {
    return fail(`Invalid timeframe for ${sym}: ${timeframe}`, 400);
  }

  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? 90);
  const limit = Math.min(
    150,
    Math.max(30, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 90),
  );

  const light =
    req.nextUrl.searchParams.get("light") === "1" ||
    req.nextUrl.searchParams.get("fast") === "1";

  try {
    if (light) {
      const oKey = ohlcvKey(sym, timeframe, limit);
      const cached = await fxCacheGet<{
        bars: unknown[];
        source: string;
        quote: unknown;
        pair: unknown;
      }>(oKey);

      if (cached?.bars && (cached.bars as unknown[]).length) {
        const quote =
          (cached.quote as Awaited<ReturnType<typeof getLiveQuoteContract>>) ??
          (await getLiveQuoteContract(sym).catch(() => null));
        const data = {
          pair: cached.pair,
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
            : null,
          quote,
          bars: cached.bars,
          timeframe,
          source: `${cached.source}+cache`,
          analysis: null as null,
          light: true,
        };
        const response = ok(data, {
          timezone: "Asia/Ho_Chi_Minh",
          source: data.source,
          freshness: quote?.freshness,
          ageMs: quote?.ageMs,
          light: true,
          cacheHit: "redis",
        });
        response.headers.set(
          "Cache-Control",
          "public, s-maxage=6, stale-while-revalidate=24",
        );
        response.headers.set("X-Cache-Hit", "redis");
        return response;
      }

      const [quote, ohlcv] = await withBudget(
        Promise.all([
          getLiveQuoteContract(sym),
          syncForexOhlcv(sym, timeframe, limit),
        ]),
        FOREX_CACHE.hardDeadlineMs,
        "bundle_light",
      );

      if (!quote && !ohlcv) return fail("Forex pair not found", 404);

      await fxCacheSet(
        oKey,
        {
          bars: ohlcv.bars,
          source: ohlcv.source,
          quote,
          pair: ohlcv.pair,
        },
        ohlcvTtlMs(timeframe),
      );

      const data = {
        pair: ohlcv.pair,
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
          : null,
        quote,
        bars: ohlcv.bars,
        timeframe,
        source: ohlcv.source,
        analysis: null as null,
        light: true,
      };

      const response = ok(data, {
        timezone: "Asia/Ho_Chi_Minh",
        source: data.source,
        freshness: data.quote?.freshness,
        ageMs: data.quote?.ageMs,
        light: true,
        cacheHit: "miss",
      });
      response.headers.set(
        "Cache-Control",
        "public, s-maxage=6, stale-while-revalidate=24",
      );
      response.headers.set("X-Cache-Hit", "miss");
      return response;
    }

    const data = await withBudget(
      getForexDetailBundle(sym, timeframe, limit),
      FOREX_CACHE.hardDeadlineMs + 2_500,
      "bundle_full",
    );
    const response = ok(data, {
      timezone: "Asia/Ho_Chi_Minh",
      source: data.source,
      freshness: data.quote?.freshness,
      ageMs: data.quote?.ageMs,
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=10, stale-while-revalidate=30",
    );
    return response;
  } catch (error) {
    return handleError(error, `forex_bundle:${symbol}`);
  }
}
