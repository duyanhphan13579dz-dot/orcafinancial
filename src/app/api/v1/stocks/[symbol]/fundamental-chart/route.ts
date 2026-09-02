import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getFundamentalAnalytics } from "@/lib/fundamental-analytics-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/stocks/:symbol/fundamental-chart
 *
 * Dùng chung kết quả đã cache của `getFundamentalAnalytics` nên không phát sinh
 * thêm lượt đọc DB nào khi người dùng mở tab "Cơ bản".
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

  try {
    const analytics = await getFundamentalAnalytics(symbol);
    const chart = analytics.chart;
    if (!chart) {
      return ok(
        { symbol, quarters: [], industry: null, health: null, comparisons: [] },
        {
          source: analytics.inputs.source,
          providerBacked: false,
          warnings: analytics.warnings,
          quarters: 0,
        },
        { cacheSeconds: 300 },
      );
    }
    return ok(
      chart,
      {
        source: analytics.inputs.source,
        providerBacked: analytics.inputs.providerBacked,
        warnings: analytics.warnings,
        quarters: chart.quarters.length,
        statementBasis: analytics.inputs.basis,
        computedInMs: analytics.computedInMs,
      },
      { cacheSeconds: 300 },
    );
  } catch (err) {
    return handleError(err, `fundamental-chart:${symbol}`);
  }
}
