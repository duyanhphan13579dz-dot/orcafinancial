import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { getLatestCommodityPrices } from "@/lib/commodities/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/commodities
 *
 * Latest prices for active commodities (optional ?group= filter).
 */
export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 120);
  if (limited) return limited;

  try {
    const url = new URL(req.url);
    const group = url.searchParams.get("group") || undefined;

    const prices = await getLatestCommodityPrices();

    const filtered = group
      ? prices.filter((p) => p.group === group)
      : prices;

    return ok(
      {
        commodities: filtered,
        count: filtered.length,
        timestamp: new Date().toISOString(),
      },
      { source: "commodities-engine" },
      { cacheSeconds: 5 },
    );
  } catch (err) {
    return handleError(err, "commodities_list");
  }
}
