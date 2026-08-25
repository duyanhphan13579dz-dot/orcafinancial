import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import {
  getForexDetailBundle,
  getLiveQuoteContract,
  runForexAnalysis,
  syncForexOhlcv,
} from "@/lib/forex/service";
import {
  defaultTimeframe,
  isValidTimeframe,
} from "@/lib/forex/timeframes";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
    200,
    Math.max(30, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 90),
  );

  // light=1 → quote + bars only (fast path for first paint)
  const light =
    req.nextUrl.searchParams.get("light") === "1" ||
    req.nextUrl.searchParams.get("fast") === "1";

  try {
    if (light) {
      const [quote, ohlcv] = await Promise.all([
        getLiveQuoteContract(sym),
        syncForexOhlcv(sym, timeframe, limit),
      ]);
      if (!quote && !ohlcv) return fail("Forex pair not found", 404);

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
      });
      response.headers.set(
        "Cache-Control",
        "public, s-maxage=8, stale-while-revalidate=30",
      );
      return response;
    }

    const data = await getForexDetailBundle(sym, timeframe, limit);
    const response = ok(data, {
      timezone: "Asia/Ho_Chi_Minh",
      source: data.source,
      freshness: data.quote?.freshness,
      ageMs: data.quote?.ageMs,
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=12, stale-while-revalidate=40",
    );
    return response;
  } catch (error) {
    return handleError(error, `forex_bundle:${symbol}`);
  }
}
