import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getAuthedUser } from "@/lib/auth/guard";
import { getMarketHeatmap } from "@/lib/heatmap/service";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 180);
  if (limited) return limited;
  const user = await getAuthedUser(req);
  if (!user) return fail("Chưa đăng nhập", 401);
  try {
    const heatmap = await getMarketHeatmap();
    const response = ok(heatmap.items, {
      marketStatus: heatmap.marketStatus,
      timestamp: heatmap.timestamp,
      stats: heatmap.stats,
      dataQuality: heatmap.dataQuality,
      sectors: heatmap.sectors,
      source: "data-engine+price_snapshots",
    });
    response.headers.set(
      "Cache-Control",
      "private, s-maxage=10, stale-while-revalidate=30",
    );
    return response;
  } catch (err) {
    return handleError(err, "market_heatmap");
  }
}
