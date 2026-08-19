import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { ensureForexFresh, listForexPairs } from "@/lib/forex/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const l = checkRateLimit(req, 120);
  if (l) return l;
  try {
    await ensureForexFresh();
    const q = req.nextUrl.searchParams;
    const pairs = await listForexPairs({
      category: q.get("category") ?? undefined,
      search: q.get("q") ?? undefined,
    });
    return ok({ pairs, count: pairs.length }, { source: "yahoo-finance", timezone: "Asia/Ho_Chi_Minh" });
  } catch (e) {
    return handleError(e, "forex_pairs");
  }
}
