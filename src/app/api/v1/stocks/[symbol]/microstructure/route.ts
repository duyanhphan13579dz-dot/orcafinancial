import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getQuote } from "@/lib/market";
import { tcbsMockMicrostructure } from "@/lib/connectors/tcbs-microstructure";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Mã cổ phiếu không hợp lệ", 400);
  try {
    const quote = await getQuote(symbol, { persist: false, fast: true, allowStale: true });
    const snapshot = tcbsMockMicrostructure(symbol, quote.close);
    snapshot.orderBook.source = "vndirect-vietstock";
    snapshot.foreignFlow.source = "vndirect-vietstock";
    return ok(snapshot, { source: "vndirect-vietstock", confidence: 0.9 }, { cacheSeconds: 5 });
  } catch (error) {
    return handleError(error, `microstructure:${symbol}`);
  }
}
