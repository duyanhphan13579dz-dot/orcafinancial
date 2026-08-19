import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { ensureForexFresh, getForexPair } from "@/lib/forex/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, c: { params: Promise<{ symbol: string }> }) {
  const l = checkRateLimit(req, 180);
  if (l) return l;
  const { symbol } = await c.params;
  try {
    const freshness = await ensureForexFresh(5000);
    const d = await getForexPair(symbol);
    if (!d?.price) return fail("Price unavailable", 404);
    return ok({ ...d, freshness }, { timezone: "Asia/Ho_Chi_Minh" });
  } catch (e) {
    return handleError(e, `forex_price:${symbol}`);
  }
}
