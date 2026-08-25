import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { syncForexOhlcv, getLiveQuoteContract } from "@/lib/forex/service";
import { fetchForexBars } from "@/lib/forex/connectors";
import { applyTickToBars, getOhlcvPolicy } from "@/lib/forex/realtime";
import {
  defaultTimeframe,
  isValidTimeframe,
} from "@/lib/forex/timeframes";

export const dynamic = "force-dynamic";
export const maxDuration = 8;

const HARD_MS = 2_800;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}_timeout`)), ms),
    ),
  ]);
}

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
    200,
    Math.max(40, Number(req.nextUrl.searchParams.get("limit") ?? 120)),
  );

  try {
    let bars;
    let source = "yahoo-forex";
    let quote = null as Awaited<ReturnType<typeof getLiveQuoteContract>>;

    try {
      const d = await withTimeout(
        syncForexOhlcv(sym, tf, limit),
        HARD_MS,
        "forex_ohlcv_svc",
      );
      bars = d.bars;
      source = d.source;
      quote = d.quote ?? null;
    } catch (inner) {
      const [live, q] = await Promise.all([
        withTimeout(fetchForexBars(sym, tf, limit), HARD_MS, "yahoo_bars"),
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

    const lastClose = bars[bars.length - 1]?.close ?? null;
    const policy = getOhlcvPolicy(tf);
    // CDN: shorter for lower TF so tick-merged candles reach clients
    const sMax = Math.max(5, Math.min(30, Math.floor(policy.soft / 1000)));

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
      },
    );
    response.headers.set(
      "Cache-Control",
      `public, s-maxage=${sMax}, stale-while-revalidate=${sMax * 3}`,
    );
    response.headers.set(
      "Vercel-CDN-Cache-Control",
      `public, s-maxage=${sMax}, stale-while-revalidate=${sMax * 3}`,
    );
    return response;
  } catch (e) {
    return handleError(e, `forex_ohlcv:${sym}:${tf}`);
  }
}
