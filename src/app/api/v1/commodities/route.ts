import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { getLatestCommodityPrices } from "@/lib/commodities/service";
import { cachedWithStaleFallback } from "@/lib/connectors/core";

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

    const cacheKey = `commodities:board:${group ?? "all"}`;
    const cachedBoard = await cachedWithStaleFallback(cacheKey, 5_000, async () => {
      const prices = await getLatestCommodityPrices();
      return group ? prices.filter((p) => p.group === group) : prices;
    }, { shouldCache: (value) => value.length > 0 });
    const filtered = cachedBoard.value;

    return ok(
      {
        commodities: filtered,
        count: filtered.length,
        timestamp: new Date().toISOString(),
      },
      { source: "commodities-engine", stale: cachedBoard.stale },
      { cacheSeconds: cachedBoard.stale ? 2 : 5 },
    );
  } catch (err) {
    return handleError(err, "commodities_list");
  }
}
