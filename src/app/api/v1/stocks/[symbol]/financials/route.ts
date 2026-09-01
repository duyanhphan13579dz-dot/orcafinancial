import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { buildFinancialPeriodSet } from "@/lib/stock-intelligence/canonical";
import { validatePeriods } from "@/lib/stock-intelligence/validation";
import { getStatements } from "@/lib/company-service";
import { getFinancialSourceEvidence } from "@/lib/financial-ingestion";
import { ensureLivePreferredFinancials } from "@/lib/financial-live-ensure";
import type { StatementType } from "@/lib/financial-statements";
import {
  loadCanonicalStatements,
  NormalizedFinancialAdapter,
  type FinancialSourceResult,
} from "@/lib/stock-intelligence/financial-source";

export const dynamic = "force-dynamic";

/**
 * Public financial statements — live verified ingest.
 * Priority: TCBS (company/broker) → Vietstock → configured datafeed.
 * Never synthesizes sector-model numbers.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

  const sp = req.nextUrl.searchParams;
  const typeRaw = sp.get("type") ?? "income";
  const period = (sp.get("period") ?? "quarterly") as "quarterly" | "yearly";
  const limit = Math.min(8, Math.max(1, Number(sp.get("limit") ?? "4") || 4));
  const type = (["income", "balance", "cashflow"] as const).includes(typeRaw as any)
    ? (typeRaw as StatementType)
    : "income";

  try {
    const preferred = await ensureLivePreferredFinancials(symbol, type, limit);
    const [result, sourceEvidence] = await Promise.all([
      getStatements(symbol, type, period, limit),
      getFinancialSourceEvidence(symbol, limit),
    ]);

    let canonical: FinancialSourceResult;
    if (preferred.records.length > 0 && preferred.providerBacked) {
      canonical = await loadCanonicalStatements(
        symbol,
        type,
        limit,
        new NormalizedFinancialAdapter(preferred.records, preferred.source),
      );
    } else {
      const emptyFallback = {
        kind: preferred.source as any,
        async fetch() {
          return [] as any[];
        },
      };
      canonical = await loadCanonicalStatements(symbol, type, limit, emptyFallback as any);
      if (!canonical.actual || canonical.statements.length === 0) {
        canonical = {
          symbol,
          statements: [],
          source: "synthetic",
          actual: false,
          confidence: 0,
          warnings: [
            "Chưa có báo cáo tài chính đã xác minh (verified) cho mã này. Hệ thống không hiển thị số liệu synthetic.",
            ...(preferred.warnings ?? []),
          ],
          quality: {
            actualCount: 0,
            estimateCount: 0,
            targetCount: 0,
            latestPeriod: null,
            sourceTier: "fallback",
          },
        };
      }
    }

    const verifiedOnly = canonical.statements.filter(
      (s) => s.provenance.kind === "actual" && s.provenance.status !== "degraded",
    );
    if (verifiedOnly.length === 0 && canonical.statements.length > 0) {
      const actualish = canonical.statements.filter((s) => s.provenance.kind === "actual");
      if (actualish.length === 0) {
        canonical = {
          ...canonical,
          statements: [],
          actual: false,
          confidence: 0,
          warnings: [
            ...canonical.warnings,
            "Chỉ có estimate/synthetic — public API từ chối trả về (Verified Financial Data policy).",
          ],
          quality: {
            actualCount: 0,
            estimateCount: 0,
            targetCount: 0,
            latestPeriod: null,
            sourceTier: "fallback",
          },
        };
      } else {
        canonical = {
          ...canonical,
          statements: actualish,
          quality: {
            ...canonical.quality,
            actualCount: actualish.length,
            estimateCount: 0,
          },
        };
      }
    }

    const periodLabels = canonical.statements.map((statement) => statement.period.label);

    const fieldsForType = (() => {
      const keys = new Set<string>();
      for (const s of canonical.statements) {
        for (const k of Object.keys(s.data ?? {})) keys.add(k);
      }
      return [...keys];
    })();
    const periodsFromCanonical = canonical.statements.map((s) => ({
      period: s.period.label,
      fiscalYear: s.period.fiscalYear,
      data: s.data as Record<string, number>,
      displayPeriod: s.period.label,
      displayPeriodVi: s.period.label,
    }));
    const uiPeriods =
      result.periods && result.periods.length > 0 ? result.periods : periodsFromCanonical;
    const uiFields = result.fields && result.fields.length > 0 ? result.fields : fieldsForType;

    const latestKind = canonical.statements[0]?.provenance.kind ?? "unavailable";
    const validation = periodLabels.length > 0 ? validatePeriods(periodLabels) : { ok: true, issues: [] as string[] };
    const hasVerified =
      (preferred.providerBacked && preferred.records.length > 0 && canonical.statements.length > 0) ||
      (canonical.statements.length > 0 && canonical.actual);

    return ok(
      {
        ...result,
        periods: hasVerified ? uiPeriods : [],
        fields: hasVerified ? uiFields : result.fields ?? [],
        canonicalStatements: canonical.statements,
        canonicalQuality: canonical.quality,
        sourceResult: {
          source: canonical.source,
          actual: canonical.actual,
          confidence: canonical.confidence,
          warnings: canonical.warnings,
        },
        sourceEvidence,
        status: hasVerified ? "verified" : "unavailable",
      },
      {
        source: hasVerified ? (preferred.providerBacked ? preferred.source : canonical.source) : "none",
        providerBacked: hasVerified && preferred.providerBacked,
        kind: hasVerified ? (preferred.providerBacked ? "provider-actual" : latestKind) : "unavailable",
        confidence: hasVerified ? canonical.confidence : 0,
        financialPeriod: periodLabels.length > 0 ? buildFinancialPeriodSet(periodLabels) : null,
        actualCount: canonical.quality.actualCount,
        estimateCount: 0,
        targetCount: 0,
        validation,
        disclosure: hasVerified
          ? "Bảng lấy từ nguồn provider đã xác minh (ưu tiên TCBS/doanh nghiệp, sau đó Vietstock)."
          : `Chưa có BCTC verified sau khi thử TCBS → Vietstock. ${preferred.warnings?.slice(0, 3).join(" | ") || "Cấu hình TCBS_MCP_ACCESS_TOKEN hoặc VIETSTOCK_DATAFEED_URL."}`,
      },
      { cacheSeconds: 300 },
    );
  } catch (err) {
    return handleError(err, `financials:${symbol}`);
  }
}
