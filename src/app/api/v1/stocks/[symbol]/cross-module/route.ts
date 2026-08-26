import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok, fail } from "@/lib/api";
import { getMarketOverview } from "@/lib/market";
import { getBenchmarkForSymbol } from "@/lib/industry-benchmarks";
import { getStockCommodityImpacts, getLatestExchangeRate } from "@/lib/commodities/service";
import { buildCrossModuleContext } from "@/lib/stock-intelligence/cross-module-engine";
import { cachedStockPayload, stockCacheKey } from "@/lib/stock-intelligence/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);
  try {
    const cached = await cachedStockPayload({ key: stockCacheKey("cross-module", symbol), ttlMs: 60_000, staleTtlMs: 10 * 60_000, loader: async () => {
      const [market, commodityImpacts, fxUsdVnd] = await Promise.all([
        getMarketOverview(),
        getStockCommodityImpacts(symbol).catch(() => []),
        getLatestExchangeRate("USD").catch(() => null),
      ]);
      const context = buildCrossModuleContext({ symbol, market, benchmark: getBenchmarkForSymbol(symbol), commodityImpacts, fxUsdVnd });
      return { context, market, fxUsdVnd };
    }});
    const { context, market, fxUsdVnd } = cached.value;
    return ok(context, { source: [...market.quality.sources, "commodity-impact", fxUsdVnd != null ? "exchange-rates" : "fx-unavailable"].join("+"), confidence: context.dataConfidence, stale: market.quality.stale, partial: context.missingModules.length > 0, cache: cached.cache }, { cacheSeconds: 60 });
  } catch (err) {
    return handleError(err, `cross-module:${symbol}`);
  }
}
