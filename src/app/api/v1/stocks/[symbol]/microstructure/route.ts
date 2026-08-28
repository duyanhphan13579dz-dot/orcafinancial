import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getQuote } from "@/lib/market";
import { isMicrostructureMockEnabled, tcbsMockMicrostructure, type StockMicrostructureSnapshot } from "@/lib/connectors/tcbs-microstructure";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Mã cổ phiếu không hợp lệ", 400);
  try {
    if (!isMicrostructureMockEnabled()) {
      const unavailable: StockMicrostructureSnapshot = {
        symbol,
        orderBook: { bids: [], asks: [], bidValue: 0, askValue: 0, imbalancePct: null, spread: null, status: "unavailable", source: "tcbs-market-data", confidence: 0, updatedAt: 0 },
        foreignFlow: { buyValue: null, sellValue: null, netValue: null, buyVolume: null, sellVolume: null, foreignRoomPct: null, status: "unavailable", source: "tcbs-market-data", confidence: 0, updatedAt: 0 },
        generatedAt: Date.now() / 1000,
      };
      return ok(unavailable, { source: "tcbs-market-data", confidence: 0 }, { cacheSeconds: 5 });
    }
    const quote = await getQuote(symbol, { persist: false, fast: true, allowStale: true });
    const snapshot = tcbsMockMicrostructure(symbol, quote.close);
    return ok(snapshot, { source: snapshot.orderBook.source, confidence: snapshot.orderBook.confidence }, { cacheSeconds: 5 });
  } catch (error) {
    return handleError(error, `microstructure:${symbol}`);
  }
}
