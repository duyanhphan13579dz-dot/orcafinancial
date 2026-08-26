import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getStatements } from "@/lib/company-service";
import { getHistory } from "@/lib/market";
import { buildForecastScenarios, type HistoricalFinancialPoint } from "@/lib/stock-intelligence/forecast-engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);
  const years = Math.min(5, Math.max(1, Number(req.nextUrl.searchParams.get("years") ?? "3") || 3));
  try {
    const [income, history] = await Promise.all([
      getStatements(symbol, "income", "quarterly", 8),
      getHistory(symbol, Math.floor(Date.now() / 1000) - 86400 * 400, Math.floor(Date.now() / 1000), "D"),
    ]);
    const historical: HistoricalFinancialPoint[] = income.periods.map((period) => {
      const data = period.data;
      const provenance = { source: "sector-synthetic-v1", retrievedAt: new Date().toISOString(), period: period.period, kind: "estimate" as const, status: "degraded" as const, confidence: 0.45, currency: "VND", unit: "billion VND" };
      return { period: period.period, fiscalYear: period.fiscalYear, revenue: Number(data.revenue ?? 0), ebitda: Number(data.ebitda ?? 0), netIncome: Number(data.netIncome ?? 0), eps: Number(data.eps ?? 0), provenance };
    });
    const currentPrice = history.bars.at(-1)?.close ?? null;
    const result = buildForecastScenarios({ symbol, historical, currentPrice, years });
    return ok(result, {
      source: result.dataConfidence < 0.6 ? "sector-synthetic-v1" : "canonical-financial-source",
      kind: "estimate",
      dataAsOf: historical.at(-1)?.period ?? null,
      forecastPeriods: result.forecast.map((point) => point.period),
      disclaimer: "Forecast là mô hình estimate, không phải guidance của doanh nghiệp. Khi financial source gốc chưa được cấu hình, prediction confidence bị hạ và kết quả phải được xem là degraded.",
    }, { cacheSeconds: 300 });
  } catch (error) {
    return handleError(error, `forecast:${symbol}`);
  }
}
