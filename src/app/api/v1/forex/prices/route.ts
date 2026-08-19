import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { ensureForexFresh, latestForexPrices } from "@/lib/forex/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const l = checkRateLimit(req, 180);
  if (l) return l;
  try {
    const freshness = await ensureForexFresh(5000);
    return ok({ prices: await latestForexPrices(), freshness }, { timezone: "Asia/Ho_Chi_Minh" });
  } catch (e) {
    return handleError(e, "forex_prices");
  }
}
