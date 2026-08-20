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

    /*
     * listForexPairs() currently has a TypeScript inference issue
     * caused by the cache typing inside forex/service.ts.
     *
     * Normalize the result here so this route remains type-safe
     * without changing the existing Forex service logic.
     */
    const pairList = Array.isArray(pairs) ? pairs : [];

    return ok(
      {
        pairs: pairList,
        count: pairList.length,
      },
      {
        source: "yahoo-finance",
        timezone: "Asia/Ho_Chi_Minh",
      },
      {
        cacheSeconds: 60,
      },
    );
  } catch (e) {
    return handleError(e, "forex_pairs");
  }
}