import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getStatements } from "@/lib/company-service";
import { getHistory } from "@/lib/market";
import { buildForecastScenarios, type HistoricalFinancialPoint } from "@/lib/stock-intelligence/forecast-engine";
import { runMovingAverageBacktest } from "@/lib/stock-intelligence/backtest-engine";
import { buildAiForecast } from "@/lib/stock-intelligence/ai-forecast";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);
  try {
    const now = Math.floor(Date.now() / 1000);
    const [income, history] = await Promise.all([getStatements(symbol, "income", "quarterly", 8), getHistory(symbol, now - 86400 * 1200, now, "D")]);
    const historical: HistoricalFinancialPoint[] = income.periods.map((period) => ({ period: period.period, fiscalYear: period.fiscalYear, revenue: Number(period.data.revenue ?? 0), ebitda: Number(period.data.ebitda ?? 0), netIncome: Number(period.data.netIncome ?? 0), eps: Number(period.data.eps ?? 0), provenance: { source: "sector-synthetic-v1", retrievedAt: new Date().toISOString(), period: period.period, kind: "estimate", status: "degraded", confidence: 0.45, currency: "VND", unit: "billion VND" } }));
    const forecast = buildForecastScenarios({ symbol, historical, currentPrice: history.bars.at(-1)?.close ?? null, years: 3 });
    const backtest = runMovingAverageBacktest({ symbol, bars: history.bars.map((bar) => ({ time: bar.time, close: bar.close })) });
    const result = buildAiForecast({ symbol, forecast, backtest });
    return ok(result, { source: history.source, dataAsOf: history.bars.at(-1)?.time ?? null, historicalAccuracy: result.historicalAccuracy, disclaimer: "AI forecast chỉ được phát hành khi đủ signal history và backtest. Đây là nghiên cứu định lượng, không phải tư vấn đầu tư cá nhân." }, { cacheSeconds: 300 });
  } catch (error) {
    return handleError(error, `ai-forecast:${symbol}`);
  }
}
