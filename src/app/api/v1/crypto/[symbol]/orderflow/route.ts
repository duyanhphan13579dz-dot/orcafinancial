import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { fetchOrderFlowIntelligence } from "@/lib/crypto/order-flow";
import { getCryptoCoin } from "@/lib/crypto/service";

export const dynamic = "force-dynamic";

/**
 * Phase 2 — Order Flow Intelligence
 * GET /api/v1/crypto/[symbol]/orderflow
 *
 * Order book depth, imbalance, walls, recent trades + whale filter.
 */
export async function GET(
  req: NextRequest,
  c: { params: Promise<{ symbol: string }> },
) {
  const limited = checkRateLimit(req, 150);
  if (limited) return limited;

  const { symbol } = await c.params;
  const base = symbol.toUpperCase().replace(/USDT$/i, "");

  try {
    let volume24h: number | null = null;
    try {
      const detail = await getCryptoCoin(base);
      volume24h =
        detail?.price?.volume24h != null ? Number(detail.price.volume24h) : null;
    } catch {
      /* ignore */
    }

    const data = await fetchOrderFlowIntelligence(base, {
      volume24hUsd: volume24h,
      depthLimit: 20,
      tradeLimit: 50,
    });

    const response = ok(data, {
      timezone: "Asia/Ho_Chi_Minh",
      source: "binance-spot-depth",
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=3, stale-while-revalidate=10",
    );
    return response;
  } catch (e) {
    return handleError(e, `crypto_orderflow:${base}`);
  }
}
