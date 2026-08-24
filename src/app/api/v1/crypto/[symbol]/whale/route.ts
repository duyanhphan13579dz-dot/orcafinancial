import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { getCryptoCoin } from "@/lib/crypto/service";
import { fetchWhaleLiquidationIntelligence } from "@/lib/crypto/whale-engine";

export const dynamic = "force-dynamic";

/**
 * Phase 3 — Whale & Liquidation Intelligence
 * GET /api/v1/crypto/[symbol]/whale
 */
export async function GET(
  req: NextRequest,
  c: { params: Promise<{ symbol: string }> },
) {
  const limited = checkRateLimit(req, 60);
  if (limited) return limited;

  const { symbol } = await c.params;
  const base = symbol.toUpperCase().replace(/USDT$/i, "");

  try {
    let volume24h: number | null = null;
    let change24h: number | null = null;
    try {
      const detail = await getCryptoCoin(base);
      volume24h =
        detail?.price?.volume24h != null ? Number(detail.price.volume24h) : null;
      change24h =
        detail?.price?.change24h != null ? Number(detail.price.change24h) : null;
    } catch {
      /* ignore */
    }

    const data = await fetchWhaleLiquidationIntelligence(base, {
      volume24hUsd: volume24h,
      change24h,
    });

    const response = ok(data, {
      timezone: "Asia/Ho_Chi_Minh",
      source: "binance-aggTrades+futures-estimate",
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=20, stale-while-revalidate=60",
    );
    return response;
  } catch (e) {
    return handleError(e, `crypto_whale:${base}`);
  }
}
