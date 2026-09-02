import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getFundamentalAnalytics } from "@/lib/fundamental-analytics-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/stocks/:symbol/fundamental-analytics
 *
 * Trả về cùng lúc 3 khối đã tính từ BCTC đã xác minh:
 *   • performance — hiệu suất kinh doanh (5 trụ cột, DuPont 3 & 5 bước)
 *   • health      — sức khỏe tài chính nâng cao (Altman Z', Piotroski F, Beneish M)
 *   • valuation   — định giá (bội số, WACC/CAPM, DCF, FCFE, DDM, Graham, Reverse DCF)
 *
 * Kết quả được cache 10 phút và dùng chung với /fundamental, /fundamental-chart,
 * /financial-health-detail nên mở tab "Cơ bản" chỉ tính một lần.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

  try {
    const analytics = await getFundamentalAnalytics(symbol);
    return ok(
      analytics,
      {
        source: analytics.inputs.source,
        providerBacked: analytics.inputs.providerBacked,
        available: analytics.available,
        quarters: analytics.inputs.quarters,
        statementBasis: analytics.inputs.basis,
        ltmMethod: analytics.inputs.ltmMethod,
        ltmPeriod: analytics.inputs.ltmPeriod,
        computedInMs: analytics.computedInMs,
        warnings: analytics.warnings.slice(0, 8),
        performanceScore: analytics.performance?.overall ?? null,
        healthScore: analytics.health?.overall ?? null,
        valuationRating: analytics.valuation?.rating ?? null,
      },
      { cacheSeconds: 300 },
    );
  } catch (err) {
    return handleError(err, `fundamental-analytics:${symbol}`);
  }
}
