import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getFundamentalAnalytics } from "@/lib/fundamental-analytics-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/stocks/:symbol/financial-health-detail
 *
 * Radar 6 trụ cột + kèm thêm khối sức khỏe tài chính nâng cao
 * (Altman Z', Piotroski F-Score, Beneish M-Score) trong `meta.advanced`.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

  try {
    const analytics = await getFundamentalAnalytics(symbol);
    const detail = analytics.healthDetail;
    if (!detail) {
      return ok(
        { symbol, overall: 0, rating: "E", groups: [], summary: "Chưa có BCTC đã xác minh để đánh giá sức khỏe tài chính.", asOfPeriod: "—" },
        { source: analytics.inputs.source, providerBacked: false, kind: "unavailable", warnings: analytics.warnings },
        { cacheSeconds: 300 },
      );
    }
    return ok(
      detail,
      {
        source: analytics.inputs.source,
        providerBacked: analytics.inputs.providerBacked,
        kind: "verified-ltm",
        currentStatePeriod: detail.asOfPeriod,
        quartersUsed: analytics.inputs.quarters,
        statementBasis: analytics.inputs.basis,
        quality: analytics.quality,
        advanced: analytics.health,
        computedInMs: analytics.computedInMs,
      },
      { cacheSeconds: 300 },
    );
  } catch (err) {
    return handleError(err, `financial-health-detail:${symbol}`);
  }
}
