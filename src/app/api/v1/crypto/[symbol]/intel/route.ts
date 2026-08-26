import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { getCryptoIntelSnapshot } from "@/lib/crypto/intel-snapshot";

export const dynamic = "force-dynamic";

/**
 * Batched intel for detail page (1 request replaces 3).
 * GET /api/v1/crypto/[symbol]/intel
 */
export async function GET(
  req: NextRequest,
  c: { params: Promise<{ symbol: string }> },
) {
  const limited = checkRateLimit(req, 60);
  if (limited) return limited;

  const { symbol } = await c.params;
  const base = symbol.toUpperCase().replace(/USDT$/i, "");
  const includeOrderFlow = req.nextUrl.searchParams.get("orderflow") !== "0";

  try {
    const data = await getCryptoIntelSnapshot(base, { includeOrderFlow });
    const response = ok(data, {
      timezone: "Asia/Ho_Chi_Minh",
      source: data.cacheHit ? "memory-cache" : "binance-live",
      cacheHit: data.cacheHit,
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=4, stale-while-revalidate=20",
    );
    return response;
  } catch (e) {
    return handleError(e, `crypto_intel:${base}`);
  }
}
