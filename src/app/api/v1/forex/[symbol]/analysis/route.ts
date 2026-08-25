import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { runForexAnalysis } from "@/lib/forex/service";
import {
  defaultTimeframe,
  isValidTimeframe,
} from "@/lib/forex/timeframes";
import {
  FOREX_CACHE,
  analysisKey,
  fxCacheGet,
  fxCacheSet,
  withBudget,
} from "@/lib/forex/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 12;

export async function GET(
  req: NextRequest,
  c: { params: Promise<{ symbol: string }> },
) {
  const l = checkRateLimit(req, 90);
  if (l) return l;
  const { symbol } = await c.params;
  const sym = symbol.toUpperCase();
  const tf =
    req.nextUrl.searchParams.get("timeframe") ?? defaultTimeframe(sym);
  if (!isValidTimeframe(tf, sym)) {
    return fail(`Invalid timeframe for ${sym}: ${tf}`, 400);
  }

  const key = analysisKey(sym, tf);

  try {
    const cached = await fxCacheGet<Record<string, unknown>>(key);
    if (cached && cached.recommendation) {
      const response = ok(cached, {
        timezone: "Asia/Ho_Chi_Minh",
        cacheHit: "redis",
      });
      response.headers.set(
        "Cache-Control",
        "public, s-maxage=15, stale-while-revalidate=45",
      );
      response.headers.set("X-Cache-Hit", "redis");
      return response;
    }

    const data = await withBudget(
      runForexAnalysis(sym, tf),
      FOREX_CACHE.hardDeadlineMs + 2_000, // analysis can be heavier; hard ~6.5s
      "forex_analysis",
    );

    await fxCacheSet(key, data, FOREX_CACHE.analysisTtlMs);

    const response = ok(data, {
      timezone: "Asia/Ho_Chi_Minh",
      cacheHit: "miss",
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=15, stale-while-revalidate=45",
    );
    response.headers.set("X-Cache-Hit", "miss");
    return response;
  } catch (e) {
    return handleError(e, `forex_analysis:${symbol}`);
  }
}
