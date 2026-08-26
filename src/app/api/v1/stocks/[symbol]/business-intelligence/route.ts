import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getProfile, ensureQuarterlyFinancials } from "@/lib/company-service";
import { getBenchmarkForSymbol } from "@/lib/industry-benchmarks";
import { evaluateHealthDetail } from "@/lib/financial-health-detail";
import { getMarketOverview } from "@/lib/market";
import { getStockCommodityImpacts } from "@/lib/commodities/service";
import { buildCrossModuleContext } from "@/lib/stock-intelligence/cross-module-engine";
import { buildBusinessIntelligence } from "@/lib/stock-intelligence/moat-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);
  try {
    const [profile, quarters, market, commodityImpacts] = await Promise.all([getProfile(symbol), ensureQuarterlyFinancials(symbol, 4), getMarketOverview(), getStockCommodityImpacts(symbol).catch(() => [])]);
    const benchmark = getBenchmarkForSymbol(symbol);
    const crossModule = buildCrossModuleContext({ symbol, market, benchmark, commodityImpacts });
    const health = evaluateHealthDetail(symbol, quarters);
    const latest = quarters[0]?.income;
    const intelligence = buildBusinessIntelligence({ profile, benchmark, crossModule, financial: { roe: health.overall, netMargin: latest?.netIncome != null && latest.revenue ? latest.netIncome / latest.revenue : null, revenueGrowth: null, debtRatio: null } });
    return ok(intelligence, { source: "company-profile+sector-benchmark+market-overview+commodity-impact", confidence: intelligence.dataConfidence, partial: intelligence.moat.rating === "insufficient_data", disclaimer: intelligence.disclosure }, { cacheSeconds: 300 });
  } catch (err) {
    return handleError(err, `business-intelligence:${symbol}`);
  }
}
