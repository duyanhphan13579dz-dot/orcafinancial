import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { syncForexOhlcv, getLiveQuoteContract } from "@/lib/forex/service";
import { fetchForexBars } from "@/lib/forex/connectors";
import { applyTickToBars, getOhlcvPolicy } from "@/lib/forex/realtime";
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
export const maxDuration = 8;

export async function GET(
  req: NextRequest,
  c: { params: Promise<{ symbol: string }> },
) {
  const l = checkRateLimit(req, 180);
  if (l) return l;

  const { symbol } = await c.params;
  const sym = symbol.toUpperCase();
  const tf =
    req.nextUrl.searchParams.get("timeframe") ?? defaultTimeframe(sym);
  if (!isValidTimeframe(tf, sym)) {
    return fail(`Invalid timeframe for ${sym}: ${tf}`, 400);
  }

  const limit = Math.min(
    150,
    Math.max(30, Number(req.nextUrl.searchParams.get("limit") ?? 90)),
  );

  const key = ohlcvKey(sym, tf, limit);

  try {
    type Cached = {
      bars: Array<{
        time: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }>;
      source: string;
      quote: Awaited<ReturnType<typeof getLiveQuoteContract>>;
    };

    const cached = await fxCacheGet<Cached>(key);
    if (cached?.bars?.length) {
      // Cheap tick-merge on warm cache
      const q =
        cached.quote ??
        (await getLiveQuoteContract(sym).catch(() => null));
      const bars = q
        ? applyTickToBars(cached.bars, q.price, tf)
        : cached.bars;
      const lastClose = bars[bars.length - 1]?.close ?? null;
      const policy = getOhlcvPolicy(tf);
      const sMax = Math.max(4, Math.min(20, Math.floor(policy.soft / 1000)));

      const response = ok(
        {
          symbol: sym,
          timeframe: tf,
          bars,
          quote: q,
          lastCandleClose: lastClose,
          priceVsCandleDiff:
            q && lastClose != null ? q.price - lastClose : null,
        },
        {
          source: `${cached.source}+cache`,
          timezone: "Asia/Ho_Chi_Minh",
          freshness: q?.freshness,
          ageMs: q?.ageMs,
          cacheHit: "redis",
        },
      );
      response.headers.set(
        "Cache-Control",
        `public, s-maxage=${sMax}, stale-while-revalidate=${sMax * 3}`,
      );
      response.headers.set("X-Cache-Hit", "redis");
      return response;
    }

    let bars;
    let source = "yahoo-forex";
    let quote = null as Awaited<ReturnType<typeof getLiveQuoteContract>>;

    try {
      const d = await withBudget(
        syncForexOhlcv(sym, tf, limit),
        FOREX_CACHE.softDeadlineMs,
        "forex_ohlcv_svc",
      );
      bars = d.bars;
      source = d.source;
      quote = d.quote ?? null;
    } catch (inner) {
      const [live, q] = await Promise.all([
        withBudget(
          fetchForexBars(sym, tf, limit),
          FOREX_CACHE.hardDeadlineMs,
          "yahoo_bars",
        ),
        getLiveQuoteContract(sym).catch(() => null),
      ]);
      bars = q ? applyTickToBars(live.bars, q.price, tf) : live.bars;
      source = `${live.source}-direct${q ? "+tick" : ""}`;
      quote = q;
      console.warn(
        "[forex_ohlcv] service/timeout → Yahoo direct",
        sym,
        tf,
        inner instanceof Error ? inner.message : inner,
      );
    }

    if (!bars?.length) {
      return fail(`Không có dữ liệu chart cho ${sym} (${tf})`, 502);
    }

    await fxCacheSet(
      key,
      { bars, source, quote },
      ohlcvTtlMs(tf),
    );

    const lastClose = bars[bars.length - 1]?.close ?? null;
    const policy = getOhlcvPolicy(tf);
    const sMax = Math.max(4, Math.min(20, Math.floor(policy.soft / 1000)));

    const response = ok(
      {
        symbol: sym,
        timeframe: tf,
        bars,
        quote,
        lastCandleClose: lastClose,
        priceVsCandleDiff:
          quote && lastClose != null ? quote.price - lastClose : null,
      },
      {
        source,
        timezone: "Asia/Ho_Chi_Minh",
        freshness: quote?.freshness,
        ageMs: quote?.ageMs,
        cacheHit: "miss",
      },
    );
    response.headers.set(
      "Cache-Control",
      `public, s-maxage=${sMax}, stale-while-revalidate=${sMax * 3}`,
    );
    response.headers.set("X-Cache-Hit", "miss");
    return response;
  } catch (e) {
    return handleError(e, `forex_ohlcv:${sym}:${tf}`);
  }
}
