import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { ensureForexFresh, getForexPair } from "@/lib/forex/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, c: { params: Promise<{ symbol: string }> }) {
  const l = checkRateLimit(req, 120);
  if (l) return l;
  const { symbol } = await c.params;
  try {
    await ensureForexFresh();
    const d = await getForexPair(symbol);
    if (!d) return fail("Forex pair not found", 404);
    return ok(d, { timezone: "Asia/Ho_Chi_Minh" });
  } catch (e) {
    return handleError(e, `forex:${symbol}`);
  }
}
