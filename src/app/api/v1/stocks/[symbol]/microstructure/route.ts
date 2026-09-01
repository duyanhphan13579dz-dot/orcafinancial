import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getQuote } from "@/lib/market";

export const dynamic = "force-dynamic";

/**
 * Microstructure endpoint.
 * Returns structured unavailable payload until a microstructure provider is configured.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

  try {
    await getQuote(symbol, { persist: false, fast: true, allowStale: true }).catch(() => null);
    const unavailable = {
      symbol,
      orderBook: {
        bids: [],
        asks: [],
        bidValue: 0,
        askValue: 0,
        imbalancePct: null,
        spread: null,
        status: "unavailable" as const,
        source: "none",
        confidence: 0,
        updatedAt: 0,
      },
      foreignFlow: {
        buyValue: null,
        sellValue: null,
        netValue: null,
        buyVolume: null,
        sellVolume: null,
        foreignRoomPct: null,
        status: "unavailable" as const,
        source: "none",
        confidence: 0,
        updatedAt: 0,
      },
      generatedAt: Date.now() / 1000,
    };
    return ok(unavailable, { source: "none", confidence: 0 }, { cacheSeconds: 5 });
  } catch (error) {
    return handleError(error, `microstructure:${symbol}`);
  }
}
