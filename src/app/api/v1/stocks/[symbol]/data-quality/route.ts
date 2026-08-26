import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { ensureQuarterlyFinancials } from "@/lib/company-service";
import { validateFinancialQuarters, buildDataQualitySnapshot } from "@/lib/stock-intelligence/validation";

export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol.toUpperCase();
  const limited = checkRateLimit(req, 30);
  if (limited) return limited;
  try {
    const quarters = await ensureQuarterlyFinancials(symbol, 8);
    const validation = validateFinancialQuarters(quarters);
    const quality = buildDataQualitySnapshot(quarters, validation, { expectedPeriods: 8, staleAfterDays: 120 });
    return ok({ symbol, quality, source: "financial-period-engine", generatedAt: new Date().toISOString() }, {
      source: "financial-period-engine",
      kind: "current-state",
      confidence: quality.reconciliation.status === "pass" ? 0.8 : 0.55,
      stale: quality.freshness.stale,
    }, { cacheSeconds: 120 });
  } catch (err) {
    return handleError(err, `stock-data-quality:${symbol}`);
  }
}
