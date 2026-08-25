import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { getMarketOverview } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  try {
    const overview = await getMarketOverview();
    return ok(overview, { source: overview.quality.sources.join("+") || "unavailable", confidence: overview.quality.confidence, stale: overview.quality.stale, partial: overview.quality.partial }, { cacheSeconds: 5 });
  } catch (err) {
    return handleError(err, "market_overview");
  }
}
