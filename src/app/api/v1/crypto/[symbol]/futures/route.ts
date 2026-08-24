import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { fetchFuturesIntelligence } from "@/lib/crypto/futures";
import { getCryptoCoin } from "@/lib/crypto/service";

export const dynamic = "force-dynamic";

/**
 * Phase 1 — Futures Intelligence
 * GET /api/v1/crypto/[symbol]/futures
 *
 * Funding rate, Long/Short ratio, Open Interest + OI×Price setup.
 * Soft-fails individual legs; returns available:false if all fail.
 */
export async function GET(
  req: NextRequest,
  c: { params: Promise<{ symbol: string }> },
) {
  const limited = checkRateLimit(req, 120);
  if (limited) return limited;

  const { symbol } = await c.params;
  const base = symbol.toUpperCase().replace(/USDT$/i, "");

  try {
    let change24h: number | null = null;
    try {
      const detail = await getCryptoCoin(base);
      change24h =
        detail?.price?.change24h != null ? Number(detail.price.change24h) : null;
    } catch {
      /* ignore */
    }

    const data = await fetchFuturesIntelligence(base, change24h);
    const response = ok(data, {
      timezone: "Asia/Ho_Chi_Minh",
      source: "binance-futures",
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=15, stale-while-revalidate=60",
    );
    return response;
  } catch (e) {
    return handleError(e, `crypto_futures:${base}`);
  }
}
