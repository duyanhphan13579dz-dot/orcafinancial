import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { loadPreferredQuarterlyFinancials } from "@/lib/financial-ingestion";
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
    const preferred = await loadPreferredQuarterlyFinancials(symbol, 8);
    const qs = preferred.quarters;
    const detail = evaluateHealthDetail(symbol, qs);
    const validation = validateFinancialQuarters(qs);
    const quality = buildDataQualitySnapshot(qs, validation, { expectedPeriods: 8, staleAfterDays: 120 });

    return ok(
      {
        ...detail,
        sourceInfo: {
          source: preferred.source,
          sourceUrl: preferred.sourceUrl,
          auditedAt: preferred.auditedAt,
          isVerifiedByLLM: preferred.isVerifiedByLLM,
          verificationNote: preferred.verificationNote,
        },
      },
      {
        source: preferred.source,
        sourceUrl: preferred.sourceUrl,
        kind: "verified_company_disclosure",
        currentStatePeriod: detail.asOfPeriod,
        quartersUsed: qs.length,
        validation,
        quality,
      },
      { cacheSeconds: 60 }
    );
  } catch (err) {
    return handleError(err, `financial-health-detail:${symbol}`);
  }
}
