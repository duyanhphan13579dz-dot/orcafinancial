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
  fxCacheGetOrSet,
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

  const fast = req.nextUrl.searchParams.get("fast") === "1";
  const key = `${analysisKey(sym, tf)}:${fast ? "fast" : "full"}`;
  const deadlineMs = fast ? 4_800 : FOREX_CACHE.hardDeadlineMs + 2_000;
  const ttlMs = fast ? 8_000 : FOREX_CACHE.analysisTtlMs;

  try {
    const cached = await fxCacheGetOrSet(
      key,
      ttlMs,
      () =>
        withBudget(
          runForexAnalysis(sym, tf, { fast }),
          deadlineMs,
          fast ? "forex_signal_fast" : "forex_analysis",
        ),
    );

    const response = ok(cached.value, {
      timezone: "Asia/Ho_Chi_Minh",
      cacheHit: cached.hit,
      fast,
    });
    response.headers.set(
      "Cache-Control",
      `public, s-maxage=${fast ? 8 : 15}, stale-while-revalidate=${fast ? 24 : 45}`,
    );
    response.headers.set("X-Cache-Hit", cached.hit);
    return response;
  } catch (e) {
    return handleError(e, `forex_analysis:${symbol}`);
  }
}
