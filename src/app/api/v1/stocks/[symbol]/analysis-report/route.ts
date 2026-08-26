import { NextRequest, NextResponse } from "next/server";
import { analyze } from "@/lib/analysis";
import { checkRateLimit, fail, handleError } from "@/lib/api";
import { ensureQuarterlyFinancials, getProfile } from "@/lib/company-service";
import { evaluateHealthDetail } from "@/lib/financial-health-detail";
import { getHistory, getMarketOverview, getNews } from "@/lib/market";
import { getBenchmarkForSymbol } from "@/lib/industry-benchmarks";
import { getStockCommodityImpacts } from "@/lib/commodities/service";
import { buildForecastScenarios, type HistoricalFinancialPoint } from "@/lib/stock-intelligence/forecast-engine";
import { runMovingAverageBacktest } from "@/lib/stock-intelligence/backtest-engine";
import { buildNewsIntelligence, type NewsItemInput } from "@/lib/stock-intelligence/news-intelligence";
import { buildRiskAssessment } from "@/lib/stock-intelligence/risk-engine";
import { buildCrossModuleContext } from "@/lib/stock-intelligence/cross-module-engine";
import { buildBusinessIntelligence } from "@/lib/stock-intelligence/moat-engine";
import { buildInvestmentThesis } from "@/lib/stock-intelligence/investment-thesis";
import { renderStockAnalysisPdf } from "@/lib/stock-intelligence/stock-analysis-pdf";
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
    const cached = await cachedStockPayload({
      key: stockCacheKey("analysis-report-pdf-v9", symbol),
      ttlMs: 5 * 60_000,
      staleTtlMs: 30 * 60_000,
      loader: async () => {
        const to = Math.floor(Date.now() / 1000);
        const [profile, quarters, history, newsPayload, market, commodityImpacts] = await Promise.all([
          getProfile(symbol),
          ensureQuarterlyFinancials(symbol, 8),
          getHistory(symbol, to - 86400 * 1200, to, "D"),
          getNews({ page: 1, limit: 100, symbol }),
          getMarketOverview(),
          getStockCommodityImpacts(symbol).catch(() => []),
        ]);
        if (history.bars.length < 30) throw new Error(`Insufficient history for ${symbol} (${history.bars.length} bars)`);
        const technical = analyze(symbol, history.bars);
        const health = evaluateHealthDetail(symbol, quarters);
        const historical: HistoricalFinancialPoint[] = quarters.map((quarter) => ({ period: quarter.period, fiscalYear: quarter.fiscalYear, revenue: quarter.income.revenue, ebitda: quarter.income.ebitda, netIncome: quarter.income.netIncome, eps: quarter.income.eps, provenance: { source: "sector-synthetic-v1", retrievedAt: new Date().toISOString(), period: quarter.period, kind: "estimate", status: "degraded", confidence: 0.45, currency: "VND", unit: "billion VND" } }));
        const forecast = buildForecastScenarios({ symbol, historical, currentPrice: technical.lastClose, years: 3 });
        const dataConfidence = Math.min(history.confidence, history.bars.length >= 120 ? 0.8 : 0.6, historical.length ? 0.45 : 0.2);
        const valuationScore = forecast.expectedValue != null && technical.lastClose > 0 && dataConfidence >= 0.4 ? Math.min(100, (forecast.expectedValue / technical.lastClose) * 50) : null;
        const risk = buildRiskAssessment({ symbol, price: technical.lastClose, closes: history.bars.map((bar) => bar.close), volumes: history.bars.map((bar) => bar.volume), financialScore: health.overall, valuationScore });
        const backtest = runMovingAverageBacktest({ symbol, bars: history.bars.map((bar) => ({ time: bar.time, close: bar.close })) });
        const rawNews = newsPayload.items.map((item) => ({ id: item.id, title: item.title, description: item.description, publishedAt: item.publishedAt.toISOString(), sourceName: item.sourceName, symbols: item.symbols, sentiment: item.sentiment })) satisfies NewsItemInput[];
        const news = buildNewsIntelligence(rawNews, symbol);
        const benchmark = getBenchmarkForSymbol(symbol);
        const crossModule = buildCrossModuleContext({ symbol, market, benchmark, commodityImpacts });
        const business = buildBusinessIntelligence({ profile, benchmark, crossModule, financial: { netMargin: quarters[0]?.income.revenue ? quarters[0].income.netIncome / quarters[0].income.revenue : null, roe: health.overall } });
        const thesis = buildInvestmentThesis({ symbol, recommendation: technical.recommendation, technicalScore: technical.score, fundamentalScore: health.overall, valuationScore, riskScore: 100 - risk.overall, crossModule, business, forecastExpectedValue: forecast.expectedValue, currentPrice: technical.lastClose, predictionConfidence: (forecast.predictionConfidence + risk.predictionConfidence) / 2 });
        const generatedAt = new Date().toISOString();
        const pdf = await renderStockAnalysisPdf({ symbol, generatedAt, profile, quarters, technical, health, forecast, risk, news, backtest, crossModule, business, thesis, priceHistory: history.bars, source: `${history.source} + sector-synthetic-v1 fallback + RSS news`, dataConfidence });
        return { base64: pdf.toString("base64"), source: history.source };
      },
    });
    const pdf = Buffer.from(cached.value.base64, "base64");
    return new NextResponse(pdf as BodyInit, { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="ORCA_${symbol}_BAO_CAO_PHAN_TICH.pdf"`, "Cache-Control": "private, max-age=60, stale-while-revalidate=300", "X-ORCA-Data-Source": cached.value.source, "X-ORCA-Cache": cached.cache.hit } });
  } catch (error) {
    return handleError(error, `analysis-report:${symbol}`);
  }
}
