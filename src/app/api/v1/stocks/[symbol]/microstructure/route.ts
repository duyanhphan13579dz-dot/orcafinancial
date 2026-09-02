import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getQuote } from "@/lib/market";
import { getVndirectMicrostructure } from "@/lib/connectors/vndirect-realtime";
import { logger } from "@/lib/logger";

const log = logger;

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * Microstructure endpoint — order book + foreign flow pulled directly from the
 * VNDirect real-time WebSocket feed (BA / SP messages).
 * Falls back to a structured unavailable payload when VNDirect is unreachable.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

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

  try {
    // Warm the quote cache so the overview quote / microstructure agree on the
    // latest match price while the realtime book is fetched.
    await getQuote(symbol, { persist: false, fast: true, allowStale: true }).catch(() => null);
    const snapshot = await getVndirectMicrostructure(symbol);
    return ok(snapshot, { source: snapshot.orderBook.source, confidence: snapshot.orderBook.confidence }, { cacheSeconds: 4 });
  } catch (error) {
    log.warn("microstructure_unavailable", {
      symbol,
      error: error instanceof Error ? error.message : String(error),
    });
    return ok(unavailable, { source: "none", confidence: 0 }, { cacheSeconds: 5 });
  }
}
