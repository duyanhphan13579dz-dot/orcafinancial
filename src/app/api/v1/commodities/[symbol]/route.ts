import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import {
  getLatestCommodityPrices,
  getCommodityStockImpacts,
} from "@/lib/commodities/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/commodities/:symbol
 *
 * Returns detailed info for a specific commodity:
 * - Current price
 * - Volatility (day/month/year)
 * - Related stocks impacts
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ symbol: string }> },
) {
  const limited = checkRateLimit(req, 120);
  if (limited) return limited;

  const { symbol } = await ctx.params;
  const upperSymbol = symbol.toUpperCase();

  try {
    // Get all prices and find the specific one
    const allPrices = await getLatestCommodityPrices();
    const commodity = allPrices.find((p) => p.symbol === upperSymbol);

    if (!commodity) {
      return fail(`Commodity ${symbol} not found`, 404);
    }

    // Get stock impacts
    const stockImpacts = await getCommodityStockImpacts(upperSymbol);

    return ok(
      {
        commodity: {
          ...commodity,
          stockImpacts,
        },
        timestamp: new Date().toISOString(),
      },
      {
        cacheSeconds: 10,
      },
    );
  } catch (err) {
    return handleError(err, `commodity_detail:${symbol}`);
  }
}
