import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getForexDetailBundle } from "@/lib/forex/service";
import {
  defaultTimeframe,
  isValidTimeframe,
} from "@/lib/forex/timeframes";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ symbol: string }> },
) {
  const rateLimit = checkRateLimit(req, 90);
  if (rateLimit) return rateLimit;

  const { symbol } = await context.params;
  const sym = symbol.toUpperCase();
  const timeframe =
    req.nextUrl.searchParams.get("timeframe") ?? defaultTimeframe(sym);

  if (!isValidTimeframe(timeframe, sym)) {
    return fail(`Invalid timeframe for ${sym}: ${timeframe}`, 400);
  }

  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? 120);
  const limit = Math.min(
    300,
    Math.max(20, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 120),
  );

  try {
    const data = await getForexDetailBundle(sym, timeframe, limit);
    const response = ok(data, {
      timezone: "Asia/Ho_Chi_Minh",
      source: data.source,
      freshness: data.quote?.freshness,
      ageMs: data.quote?.ageMs,
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=10, stale-while-revalidate=45",
    );
    return response;
  } catch (error) {
    return handleError(error, `forex_bundle:${symbol}`);
  }
}
