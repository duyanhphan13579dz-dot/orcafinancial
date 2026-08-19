import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getForexDetailBundle } from "@/lib/forex/service";

const V = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);
export const dynamic = "force-dynamic";

/**
 * Combined first-paint endpoint: pair + live price + OHLCV + analysis in one round-trip.
 * GET /api/v1/forex/[symbol]/bundle?timeframe=1h&limit=300
 */
export async function GET(req: NextRequest, c: { params: Promise<{ symbol: string }> }) {
  const l = checkRateLimit(req, 90);
  if (l) return l;
  const { symbol } = await c.params;
  const tf = req.nextUrl.searchParams.get("timeframe") ?? "1h";
  if (!V.has(tf)) return fail("Invalid timeframe", 400);
  const limit = Math.min(1000, Math.max(20, Number(req.nextUrl.searchParams.get("limit") ?? 300)));
  try {
    const data = await getForexDetailBundle(symbol.toUpperCase(), tf, limit);
    return ok(data, { timezone: "Asia/Ho_Chi_Minh", source: data.source });
  } catch (e) {
    return handleError(e, `forex_bundle:${symbol}`);
  }
}
