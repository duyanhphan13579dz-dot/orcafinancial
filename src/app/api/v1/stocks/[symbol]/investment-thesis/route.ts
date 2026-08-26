import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { analyze } from "@/lib/analysis";
import { ensureQuarterlyFinancials, getProfile } from "@/lib/company-service";
import { evaluateHealthDetail } from "@/lib/financial-health-detail";
import { getBenchmarkForSymbol } from "@/lib/industry-benchmarks";
import { getHistory, getMarketOverview } from "@/lib/market";
import { getStockCommodityImpacts } from "@/lib/commodities/service";
import { buildCrossModuleContext } from "@/lib/stock-intelligence/cross-module-engine";
import { buildBusinessIntelligence } from "@/lib/stock-intelligence/moat-engine";
import { buildForecastScenarios, type HistoricalFinancialPoint } from "@/lib/stock-intelligence/forecast-engine";
import { buildRiskAssessment } from "@/lib/stock-intelligence/risk-engine";
import { buildInvestmentThesis } from "@/lib/stock-intelligence/investment-thesis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);
  try {
    const to = Math.floor(Date.now() / 1000);
    const [profile, quarters, history, market, commodityImpacts] = await Promise.all([
      getProfile(symbol),
      ensureQuarterlyFinancials(symbol, 8),
      getHistory(symbol, to - 86400 * 1200, to, "D"),
      getMarketOverview(),
      getStockCommodityImpacts(symbol).catch(() => []),
    ]);
    if (history.bars.length < 30) return fail(`Insufficient history for ${symbol}`, 422);
    const technical = analyze(symbol, history.bars);
    const health = evaluateHealthDetail(symbol, quarters);
    const benchmark = getBenchmarkForSymbol(symbol);
    const crossModule = buildCrossModuleContext({ symbol, market, benchmark, commodityImpacts });
    const latest = quarters[0]?.income;
    const business = buildBusinessIntelligence({ profile, benchmark, crossModule, financial: { roe: health.overall, netMargin: latest?.revenue ? latest.netIncome / latest.revenue : null } });
    const historical: HistoricalFinancialPoint[] = quarters.map((quarter) => ({ period: quarter.period, fiscalYear: quarter.fiscalYear, revenue: quarter.income.revenue, ebitda: quarter.income.ebitda, netIncome: quarter.income.netIncome, eps: quarter.income.eps, provenance: { source: "sector-synthetic-v1", retrievedAt: new Date().toISOString(), period: quarter.period, kind: "estimate", status: "degraded", confidence: 0.45, currency: "VND", unit: "reported-unit" } }));
    const forecast = buildForecastScenarios({ symbol, historical, currentPrice: technical.lastClose, years: 3 });
    const riskAssessment = buildRiskAssessment({ symbol, price: technical.lastClose, closes: history.bars.map((bar) => bar.close), volumes: history.bars.map((bar) => bar.volume), financialScore: health.overall, valuationScore: forecast.expectedValue != null && technical.lastClose > 0 ? Math.min(100, (forecast.expectedValue / technical.lastClose) * 50) : null });
    const thesis = buildInvestmentThesis({ symbol, recommendation: technical.recommendation, technicalScore: technical.score, fundamentalScore: health.overall, valuationScore: forecast.expectedValue != null && technical.lastClose > 0 ? Math.min(100, (forecast.expectedValue / technical.lastClose) * 50) : null, riskScore: 100 - riskAssessment.overall, crossModule, business, forecastExpectedValue: forecast.expectedValue, currentPrice: technical.lastClose, predictionConfidence: (forecast.predictionConfidence + riskAssessment.predictionConfidence) / 2 });
    return ok({ thesis, business, crossModule, causalChains: crossModule.causalChains, dataAsOf: { price: history.bars.at(-1)?.time ?? null, financial: quarters[0]?.period ?? null, generatedAt: new Date().toISOString() } }, { source: `${history.source}+market-overview+commodity-impact+sector-benchmark`, confidence: thesis.dataConfidence, partial: thesis.stance === "insufficient_data", disclaimer: thesis.disclosure }, { cacheSeconds: 300 });
  } catch (err) {
    return handleError(err, `investment-thesis:${symbol}`);
  }
}
