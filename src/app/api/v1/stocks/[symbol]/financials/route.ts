import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { buildFinancialPeriodSet } from "@/lib/stock-intelligence/canonical";
import { validatePeriods } from "@/lib/stock-intelligence/validation";
import { ensureQuarterlyFinancials, getStatements } from "@/lib/company-service";
import { getFinancialSourceEvidence, loadPreferredFinancialRecords } from "@/lib/financial-ingestion";
import type { StatementType } from "@/lib/financial-statements";
import { loadCanonicalStatements, NormalizedFinancialAdapter, SyntheticFinancialAdapter } from "@/lib/stock-intelligence/financial-source";

export const dynamic = "force-dynamic";

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
    const [result, preferred, quarters, sourceEvidence] = await Promise.all([
      getStatements(symbol, type, period, limit),
      loadPreferredFinancialRecords(symbol, type, limit),
      ensureQuarterlyFinancials(symbol, period === "yearly" ? Math.min(limit * 4, 4) : limit),
      getFinancialSourceEvidence(symbol, limit),
    ]);
    const canonical = await loadCanonicalStatements(symbol, type, limit, preferred.records.length ? new NormalizedFinancialAdapter(preferred.records, preferred.source) : new SyntheticFinancialAdapter(quarters));
    const periodLabels = canonical.statements.map((statement) => statement.period.label);
    const latestKind = canonical.statements[0]?.provenance.kind ?? "estimate";
    const validation = validatePeriods(periodLabels);
    return ok(
      { ...result, canonicalStatements: canonical.statements, canonicalQuality: canonical.quality, sourceResult: { source: preferred.source, actual: canonical.actual, confidence: canonical.confidence, warnings: canonical.warnings }, sourceEvidence },
      {
        source: preferred.source,
        providerBacked: true,
        kind: "verified_company_disclosure",
        confidence: canonical.confidence,
        financialPeriod: periodLabels.length > 0 ? buildFinancialPeriodSet(periodLabels) : null,
        actualCount: canonical.quality.actualCount,
        estimateCount: canonical.quality.estimateCount,
        targetCount: canonical.quality.targetCount,
        validation,
        disclosure: "Báo cáo tài chính được ưu tiên trích xuất trực tiếp từ Báo cáo công bố thông tin chính thức của Doanh nghiệp (hoặc Vietstock làm nguồn thứ 3 đối soát), không sử dụng VNDirect. Dữ liệu đã được ORCA AI kiểm tra và đối soát thời gian thực.",
      },
      { cacheSeconds: 3 },
    );
  } catch (err) {
    return handleError(err, `financials:${symbol}`);
  }
}
