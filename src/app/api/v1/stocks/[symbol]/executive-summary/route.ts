import { NextRequest } from "next/server";
import { analyze } from "@/lib/analysis";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { ensureQuarterlyFinancials } from "@/lib/company-service";
import { evaluateHealthDetail } from "@/lib/financial-health-detail";
import { generateFundamentalReport } from "@/lib/fundamental";
import { getHistory, getQuote, getNewsSentiment } from "@/lib/market";
import { cached } from "@/lib/connectors/core";
import { buildFinancialPeriodSet, actualProvenance, freshnessStatus } from "@/lib/stock-intelligence/canonical";
import { buildOrcaDecision } from "@/lib/stock-intelligence/decision-engine";
import { validateFinancialQuarters } from "@/lib/stock-intelligence/validation";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);
  try {
    const result = await cached(`executive-summary:${symbol}`, 30_000, async () => {
      const to = Math.floor(Date.now() / 1000);
      const [quote, history, quarters, sentiment] = await Promise.all([
        getQuote(symbol, { persist: true }),
        getHistory(symbol, to - 86400 * 420, to, "D"),
        ensureQuarterlyFinancials(symbol, 4),
        getNewsSentiment(symbol).catch(() => null),
      ]);
      const technical = analyze(symbol, history.bars);
      const fundamental = history.bars.length >= 60 ? generateFundamentalReport(symbol, history.bars) : null;
      const health = evaluateHealthDetail(symbol, quarters);
      const decision = buildOrcaDecision({ symbol, technical, fundamental, health, sentimentScore: sentiment?.sentimentScore ?? null });
      const periodSet = buildFinancialPeriodSet(quarters.map((quarter) => quarter.period));
      const validation = validateFinancialQuarters(quarters);
      const retrievedAt = new Date(quote.time * 1000).toISOString();
      return {
        decision,
        quote,
        dataAsOf: {
          price: actualProvenance(quote.source, new Date(quote.time * 1000).toISOString(), quote.confidence, retrievedAt),
          technical: { source: history.source, retrievedAt: new Date().toISOString(), period: "Daily OHLCV", kind: "actual" as const, status: freshnessStatus(new Date().toISOString()), confidence: history.confidence },
          financial: { source: "sector-synthetic-v1", retrievedAt: new Date().toISOString(), period: periodSet?.latestQuarter.label.replace(/A$/, "E") ?? null, kind: "estimate" as const, status: "degraded" as const, confidence: validation.valid ? 0.45 : 0.25 },
          forecast: { source: "not_available", retrievedAt: new Date().toISOString(), period: null, kind: "estimate" as const, status: "insufficient_data" as const, confidence: 0 },
          targetPrice: { source: fundamental?.valuation?.intrinsicValueRange ? "valuation-engine" : "not_available", retrievedAt: new Date().toISOString(), period: "12M", kind: "target" as const, status: fundamental?.valuation?.intrinsicValueRange ? "fresh" as const : "insufficient_data" as const, confidence: fundamental?.valuation?.intrinsicValueRange ? 0.65 : 0 },
        },
        financialPeriod: periodSet,
        dataConfidence: Math.round(((quote.confidence + history.confidence + (validation.valid ? 0.45 : 0.25)) / 3) * 100) / 100,
        predictionConfidence: decision.predictionConfidence,
        validation,
      };
    });
    return ok(result, { source: "orca-stock-intelligence", modelVersion: result.decision.modelVersion, dataConfidence: result.dataConfidence, predictionConfidence: result.predictionConfidence }, { cacheSeconds: 30 });
  } catch (err) {
    return handleError(err, `executive-summary:${symbol}`);
  }
}
