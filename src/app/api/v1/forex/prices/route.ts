import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { ensureMarketTables } from "@/db/ensure-market-tables";
import { ensureForexFresh, latestForexPrices } from "@/lib/forex/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const l = checkRateLimit(req, 180);
  if (l) return l;
  try {
    await ensureMarketTables();
    const freshness = await ensureForexFresh(5000);
    const response = ok(
      { prices: await latestForexPrices(), freshness },
      { timezone: "Asia/Ho_Chi_Minh" },
    );
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=5, stale-while-revalidate=20",
    );
    return response;
  } catch (e) {
    return handleError(e, "forex_prices");
  }
}
