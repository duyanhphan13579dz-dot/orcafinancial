import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { fetchOrderBookSnapshot } from "@/lib/crypto/order-flow";

export const dynamic = "force-dynamic";
export const maxDuration = 8;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ symbol: string }> },
) {
  const limited = checkRateLimit(req, 60);
  if (limited) return limited;
  const { symbol } = await ctx.params;
  const base = symbol.trim().toUpperCase().replace(/USDT$/i, "");
  if (!/^[A-Z0-9]{2,15}$/.test(base)) {
    return new Response(JSON.stringify({ error: "Invalid symbol" }), { status: 400 });
  }
  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? 1000);
  const limit = Math.min(1000, Math.max(100, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 1000));

  try {
    const snapshot = await fetchOrderBookSnapshot(base, limit);
    const response = ok(snapshot, {
      source: "binance-spot-depth-snapshot",
      sequence: snapshot.lastUpdateId ?? null,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return handleError(error, `crypto_orderbook_snapshot:${base}`);
  }
}
