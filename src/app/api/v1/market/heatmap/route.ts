import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getAuthedUser } from "@/lib/auth/guard";
import { getMarketHeatmap } from "@/lib/heatmap/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 180);
  if (limited) return limited;
  const user = await getAuthedUser(req);
  if (!user) return fail("Chưa đăng nhập", 401);
  try {
    const heatmap = await getMarketHeatmap();
    return ok(heatmap.items, {
      marketStatus: heatmap.marketStatus,
      timestamp: heatmap.timestamp,
      stats: heatmap.stats,
      sectors: heatmap.sectors,
      source: "data-engine+price_snapshots",
    });
  } catch (err) {
    return handleError(err, "market_heatmap");
  }
}
