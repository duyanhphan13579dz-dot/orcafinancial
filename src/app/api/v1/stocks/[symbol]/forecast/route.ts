import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { ensureQuarterlyFinancials, getStatements } from "@/lib/company-service";
import { getHistory } from "@/lib/market";
import { buildForecastScenarios, type HistoricalFinancialPoint } from "@/lib/stock-intelligence/forecast-engine";
import { loadCanonicalStatements, SyntheticFinancialAdapter } from "@/lib/stock-intelligence/financial-source";
import { targetProvenance } from "@/lib/stock-intelligence/canonical";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);
  const years = Math.min(5, Math.max(1, Number(req.nextUrl.searchParams.get("years") ?? "3") || 3));
  try {
    const [income, fallbackQuarters, history] = await Promise.all([
      getStatements(symbol, "income", "quarterly", 8),
      ensureQuarterlyFinancials(symbol, 8),
      getHistory(symbol, Math.floor(Date.now() / 1000) - 86400 * 400, Math.floor(Date.now() / 1000), "D"),
    ]);
    const canonical = await loadCanonicalStatements(symbol, "income", 8, new SyntheticFinancialAdapter(fallbackQuarters));
    const historical: HistoricalFinancialPoint[] = canonical.statements.map((statement) => {
      const data = statement.data as Record<string, unknown>;
      const number = (value: unknown) => typeof value === "number" ? value : Number(value ?? 0);
      return { period: statement.period.label, fiscalYear: statement.period.fiscalYear, revenue: number(data.revenue), ebitda: number(data.ebitda), netIncome: number(data.netIncome), eps: number(data.eps), provenance: statement.provenance };
    }).filter((point) => [point.revenue, point.ebitda, point.netIncome, point.eps].every(Number.isFinite));
    const currentPrice = history.bars.at(-1)?.close ?? null;
    const result = buildForecastScenarios({ symbol, historical, currentPrice, years });
    const targetMeta = result.targetPrice == null ? null : targetProvenance("orca-forecast-engine-v1", `FY${new Date().getFullYear() + years}T`, result.predictionConfidence, { currency: "VND", unit: "price" });
    return ok({ ...result, targetProvenance: targetMeta }, {
      source: canonical.source,
      kind: "estimate",
      historicalKind: canonical.actual ? "actual" : "estimate",
      targetKind: result.targetPrice == null ? null : "target",
      dataAsOf: historical.at(-1)?.period ?? null,
      forecastPeriods: result.forecast.map((point) => point.period),
      sourceQuality: canonical.quality,
      disclosure: "Forecast periods là estimate; target price/fair value là target output của model. Khi financial source gốc chưa được cấu hình, historical inputs là estimate/degraded và prediction confidence bị hạ.",
    }, { cacheSeconds: 300 });
  } catch (error) {
    return handleError(error, `forecast:${symbol}`);
  }
}
