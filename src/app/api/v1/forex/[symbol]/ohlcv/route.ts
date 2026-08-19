import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { syncForexOhlcv } from "@/lib/forex/service";

const V = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, c: { params: Promise<{ symbol: string }> }) {
  const l = checkRateLimit(req, 120);
  if (l) return l;
  const { symbol } = await c.params;
  const tf = req.nextUrl.searchParams.get("timeframe") ?? "1h";
  if (!V.has(tf)) return fail("Invalid timeframe", 400);
  const limit = Math.min(1000, Math.max(20, Number(req.nextUrl.searchParams.get("limit") ?? 300)));
  try {
    const d = await syncForexOhlcv(symbol.toUpperCase(), tf, limit);
    const response = ok(
      { symbol: d.pair.symbol, timeframe: tf, bars: d.bars },
      { source: d.source, timezone: "Asia/Ho_Chi_Minh" },
    );
    // DB-first SWR on server; short CDN cache for repeated chart loads
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=15, stale-while-revalidate=60",
    );
    response.headers.set(
      "CDN-Cache-Control",
      "public, s-maxage=15, stale-while-revalidate=60",
    );
    return response;
  } catch (e) {
    return handleError(e, `forex_ohlcv:${symbol}`);
  }
}
