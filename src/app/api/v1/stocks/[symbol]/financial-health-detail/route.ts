import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { ensureQuarterlyFinancials } from "@/lib/company-service";
import { loadLiveQuarterlyFinancials } from "@/lib/connectors/live-financials-server";
import { evaluateHealthDetail } from "@/lib/financial-health-detail";
import { buildDataQualitySnapshot, validateFinancialQuarters } from "@/lib/stock-intelligence/validation";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

  try {
    // Prefer verified DB rows; fall back to live company feeds when empty so
    // the health detail stays populated before ingestion has run.
    let qs = await ensureQuarterlyFinancials(symbol, 8);
    const source = qs.length > 0 ? "verified-db" : "live";
    if (qs.length === 0) {
      const live = await loadLiveQuarterlyFinancials(symbol, 8);
      qs = live.quarters;
    }

    const detail = evaluateHealthDetail(symbol, qs);
    const validation = validateFinancialQuarters(qs);
    const quality = buildDataQualitySnapshot(qs, validation, { expectedPeriods: 8, staleAfterDays: 120 });
    return ok(
      detail,
      { source, kind: qs.length > 0 ? "actual" : "estimate", currentStatePeriod: detail.asOfPeriod, quartersUsed: qs.length, validation, quality },
      { cacheSeconds: 300 },
    );
  } catch (err) {
    return handleError(err, `financial-health-detail:${symbol}`);
  }
}
