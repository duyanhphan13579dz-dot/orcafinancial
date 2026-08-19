import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getCryptoDetailBundle } from "@/lib/crypto/service";

const V = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);
export const dynamic = "force-dynamic";

/**
 * Combined first-paint endpoint: coin + live price + OHLCV + analysis + sentiment.
 * GET /api/v1/crypto/[symbol]/bundle?timeframe=1h&limit=200
 */
export async function GET(
  req: NextRequest,
  c: { params: Promise<{ symbol: string }> },
) {
  const l = checkRateLimit(req, 90);
  if (l) return l;
  const { symbol } = await c.params;
  const tf = req.nextUrl.searchParams.get("timeframe") ?? "1h";
  if (!V.has(tf)) return fail("Invalid timeframe", 400);
  const limit = Math.min(
    1000,
    Math.max(20, Number(req.nextUrl.searchParams.get("limit") ?? 200)),
  );
  try {
    const data = await getCryptoDetailBundle(symbol.toUpperCase(), tf, limit);
    const response = ok(data, {
      timezone: "Asia/Ho_Chi_Minh",
      source: data.source,
    });
    // Short CDN cache — SWR on server already serves DB-first
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=10, stale-while-revalidate=45",
    );
    return response;
  } catch (e) {
    return handleError(e, `crypto_bundle:${symbol}`);
  }
}
