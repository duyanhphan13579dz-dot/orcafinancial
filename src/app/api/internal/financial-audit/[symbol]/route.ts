import { NextRequest, NextResponse } from "next/server";
import { loadPreferredQuarterlyFinancials } from "@/lib/financial-ingestion";
import {
  getSourcePriority,
  toCanonicalVnd,
  validateAccountingIdentities,
  validatePeriodChronology,
  createLineageTrace,
} from "@/lib/financial-canonical-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = process.env.FINANCIAL_AUDIT_SECRET ?? process.env.CRON_SECRET;
  if (!secret) return true; // allow internal dev calls when secret not configured
  const authorization = request.headers.get("authorization");
  const headerSecret = request.headers.get("x-financial-audit-secret");
  return authorization === `Bearer ${secret}` || headerSecret === secret;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { symbol: rawSymbol } = await params;
  const symbol = (rawSymbol || "").trim().toUpperCase();

  if (!symbol || !/^[A-Z0-9]{1,10}$/.test(symbol)) {
    return NextResponse.json({ ok: false, error: "Mã chứng khoán không hợp lệ" }, { status: 400 });
  }

  const startedAt = Date.now();

  try {
    const preferred = await loadPreferredQuarterlyFinancials(symbol, 4);
    const sourcePriority = getSourcePriority(preferred.source);
    const isSynthetic = sourcePriority === 0;

    // Quarters validation
    const chronology = validatePeriodChronology(preferred.quarters);
    const accountingValidations = preferred.quarters.map((q) => {
      const val = validateAccountingIdentities(q.income, q.balance, q.cashflow);
      return {
        period: q.period,
        fiscalYear: q.fiscalYear,
        isValid: val.isValid,
        issues: val.issues,
        details: val.details,
      };
    });

    const lineage = createLineageTrace(
      symbol,
      preferred.source,
      preferred.sourceUrl,
      "CONSOLIDATED"
    );

    // Formatted UI samples (e.g. 38.5 tỷ VND)
    const uiFormatted = preferred.quarters.map((q) => {
      const revenueRaw = q.income?.revenue ?? 0;
      const canonical = toCanonicalVnd(revenueRaw, "billion VND");
      return {
        period: q.period,
        revenueBillionVnd: `${revenueRaw} tỷ VND`,
        canonicalAbsoluteVnd: canonical.canonicalValue.toLocaleString("vi-VN") + " VND",
        netIncomeBillionVnd: `${q.income?.netIncome ?? 0} tỷ VND`,
        totalAssetsBillionVnd: `${q.balance?.totalAssets ?? 0} tỷ VND`,
      };
    });

    return NextResponse.json({
      ok: true,
      symbol,
      auditedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      source: {
        provider: preferred.source,
        providerBacked: preferred.providerBacked,
        sourceUrl: preferred.sourceUrl,
        sourcePriority,
        reportScope: "CONSOLIDATED",
        verificationStatus: preferred.isVerifiedByLLM ? "VERIFIED" : "UNVERIFIED",
        isSynthetic,
      },
      validation: {
        isSynthetic,
        chronologyValid: chronology.isValid,
        chronologyIssues: chronology.issues,
        accountingIdentitiesValid: accountingValidations.every((v) => v.isValid),
        perQuarterValidation: accountingValidations,
      },
      lineage,
      uiFormatted,
      quartersCount: preferred.quarters.length,
      quarters: preferred.quarters,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        symbol,
        error: error instanceof Error ? error.message : "Trace audit failed.",
        durationMs: Date.now() - startedAt,
      },
      { status: 500 }
    );
  }
}
