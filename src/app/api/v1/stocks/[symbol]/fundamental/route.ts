import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { buildFundamentalReportFromAnalytics, generateFundamentalReport } from "@/lib/fundamental";
import { getFundamentalAnalytics } from "@/lib/fundamental-analytics-service";
import { getHistory } from "@/lib/market";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/stocks/:symbol/fundamental
 *
 * Ưu tiên số LTM tính từ BCTC đã xác minh (engine v2).
 * Chỉ khi hoàn toàn không có BCTC mới rơi về đường proxy giá/khối lượng (v1)
 * và khi đó P/E, P/B, DCF... được đánh dấu rõ là ước lượng.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

  try {
    const to = Math.floor(Date.now() / 1000);
    const [analytics, history] = await Promise.all([
      getFundamentalAnalytics(symbol),
      getHistory(symbol, to - 86400 * 1100, to, "D").catch(() => null),
    ]);

    const bars = history?.bars ?? [];
    const currentPrice = analytics.inputs.price ?? (bars.length > 0 ? bars[bars.length - 1].close : null);

    if (analytics.available && currentPrice !== null) {
      const report = buildFundamentalReportFromAnalytics(analytics, currentPrice);
      return ok(
        report,
        {
          source: analytics.inputs.source,
          confidence: 0.95,
          engine: report.engineVersion,
          barsUsed: bars.length,
          quarters: analytics.inputs.quarters,
          ltmPeriod: analytics.inputs.ltmPeriod,
          ltmMethod: analytics.inputs.ltmMethod,
          statementBasis: analytics.inputs.basis,
          coverage: report.coverage,
          computedInMs: analytics.computedInMs,
        },
        { cacheSeconds: 300 },
      );
    }

    if (bars.length < 60) {
      return fail(
        `Không có BCTC đã xác minh và lịch sử giá không đủ cho ${symbol} (${bars.length} nến, cần ≥60)`,
        422,
      );
    }

    const report = { ...generateFundamentalReport(symbol, bars), engineVersion: "price-proxy-v1" as const };
    return ok(
      report,
      {
        source: history?.source ?? "market",
        confidence: 0.4,
        engine: "price-proxy-v1",
        barsUsed: bars.length,
        quarters: 0,
        disclosure:
          "Chưa có báo cáo tài chính đã xác minh — P/E, P/B, EPS, DCF ở đây là proxy suy ra từ giá thị trường, KHÔNG phải số liệu BCTC.",
      },
      { cacheSeconds: 300 },
    );
  } catch (err) {
    return handleError(err, `fundamental:${symbol}`);
  }
}
