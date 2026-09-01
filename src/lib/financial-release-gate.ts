/**
 * Phase 4 — Testing & Release Controls / Go-live checklist
 * Master Plan §XIV
 */
import { isSyntheticSource, SOURCE_PRIORITY } from "@/lib/financial-source-priority";
import {
  validateAccountingIdentities,
  validatePeriod,
  validateUnit,
  validatePeriodChronology,
} from "@/lib/financial-validation-engine";
import {
  GOLDEN_METRICS,
  GOLDEN_SYMBOLS,
  compareGoldenMetric,
  goldenRegressionSummary,
} from "@/lib/golden-dataset";
import { ensureFinancialIngestionTables } from "@/db/ensure-financial-ingestion-tables";
import { db } from "@/db";
import { financialNormalizedFacts } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export interface GateCheck {
  id: string;
  title: string;
  ok: boolean;
  severity: "blocker" | "warning" | "info";
  detail: string;
}

export interface ReleaseGateResult {
  ok: boolean;
  phase: "phase4";
  checkedAt: string;
  checks: GateCheck[];
  blockers: string[];
  warnings: string[];
  golden: ReturnType<typeof goldenRegressionSummary> & { filledExpected: number; total: number };
  recommendation: string;
  durationMs: number;
}

function envFlagTrue(name: string): boolean {
  const v = process.env[name];
  return v === "true" || v === "1";
}

function countFromExecute(result: { rows: Array<Record<string, unknown>> }): number {
  const row = result.rows[0];
  if (!row) return 0;
  const c = row.c;
  return typeof c === "number" ? c : Number(c ?? 0);
}

export async function runFinancialReleaseGate(options?: {
  symbol?: string;
  skipDb?: boolean;
}): Promise<ReleaseGateResult> {
  const started = Date.now();
  const checks: GateCheck[] = [];

  const allowSynthetic = envFlagTrue("ALLOW_SYNTHETIC_FINANCIALS");
  checks.push({
    id: "no_synthetic_env",
    title: "ALLOW_SYNTHETIC_FINANCIALS tắt trên production",
    ok: !allowSynthetic,
    severity: "blocker",
    detail: allowSynthetic
      ? "ALLOW_SYNTHETIC_FINANCIALS đang bật — tắt trước go-live"
      : "Synthetic generation disabled by env (Phase 0)",
  });

  checks.push({
    id: "source_priority_model",
    title: "Source priority model",
    ok: SOURCE_PRIORITY.OFFICIAL_FILING > SOURCE_PRIORITY.SYNTHETIC,
    severity: "blocker",
    detail: `OFFICIAL=${SOURCE_PRIORITY.OFFICIAL_FILING} > SYNTHETIC=${SOURCE_PRIORITY.SYNTHETIC}`,
  });

  const acc = validateAccountingIdentities({
    income: { revenue: 100, costOfGoodsSold: 40, grossProfit: 60 },
    balance: { totalAssets: 200, totalLiabilities: 80, equity: 120 },
  });
  checks.push({
    id: "accounting_validation",
    title: "Accounting validation engine",
    ok: acc.ok,
    severity: "blocker",
    detail: acc.ok ? `checked: ${acc.checked.join(", ")}` : acc.issues.map((i) => i.message).join("; "),
  });

  const per = validatePeriod("Q1/2025", 2025);
  const chrono = validatePeriodChronology(["Q2/2025", "Q1/2025", "Q4/2024"]);
  checks.push({
    id: "period_validation",
    title: "Period validation",
    ok: per.ok && chrono.ok,
    severity: "blocker",
    detail: per.ok && chrono.ok ? "format + chronology OK" : [...per.issues, ...chrono.issues].map((i) => i.message).join("; "),
  });

  const unit = validateUnit(38500, "BILLION_VND");
  checks.push({
    id: "unit_validation",
    title: "Unit validation (canonical VND)",
    ok: unit.ok,
    severity: "blocker",
    detail: unit.ok ? "toCanonicalVnd path OK" : unit.issues.map((i) => i.message).join("; "),
  });

  const filledExpected = GOLDEN_METRICS.filter((m) => m.expectedValue != null).length;
  checks.push({
    id: "golden_dataset_defined",
    title: "Golden dataset defined",
    ok: GOLDEN_METRICS.length > 0 && GOLDEN_SYMBOLS.length > 0,
    severity: "blocker",
    detail: `${GOLDEN_METRICS.length} metrics, ${GOLDEN_SYMBOLS.length} symbols, ${filledExpected} expected values filled`,
  });
  checks.push({
    id: "golden_expected_filled",
    title: "Golden expected values filled from filings",
    ok: filledExpected > 0,
    severity: "warning",
    detail:
      filledExpected > 0
        ? `${filledExpected} metrics have expected values`
        : "Chưa điền expectedValue — regression gate chỉ structural cho đến khi fill từ BCTC",
  });

  checks.push({
    id: "synthetic_detector",
    title: "Synthetic source detector",
    ok: isSyntheticSource("sector-synthetic-v2") && !isSyntheticSource("vietstock"),
    severity: "blocker",
    detail: "isSyntheticSource discriminates synthetic vs vietstock",
  });

  if (!options?.skipDb) {
    try {
      await ensureFinancialIngestionTables();
      const synStmt = await db.execute(sql`
        SELECT COUNT(*)::int AS c FROM financial_statements
        WHERE source ILIKE '%synthetic%' OR COALESCE(is_synthetic, false) = true
      `);
      const syntheticInStatements = countFromExecute(synStmt);

      const synFacts = await db.execute(sql`
        SELECT COUNT(*)::int AS c FROM financial_normalized_facts
        WHERE source ILIKE '%synthetic%' OR COALESCE(is_synthetic, false) = true
      `);
      const syntheticInFacts = countFromExecute(synFacts);

      const verFacts = await db.execute(sql`
        SELECT COUNT(*)::int AS c FROM financial_normalized_facts
        WHERE quality_status = 'accepted' AND verification_status = 'verified'
          AND COALESCE(is_synthetic, false) = false
      `);
      const verifiedFactCount = countFromExecute(verFacts);

      checks.push({
        id: "db_no_synthetic_statements",
        title: "DB financial_statements không còn synthetic",
        ok: syntheticInStatements === 0,
        severity: "warning",
        detail: `${syntheticInStatements} synthetic rows in financial_statements`,
      });
      checks.push({
        id: "db_no_synthetic_facts",
        title: "DB normalized facts không còn synthetic active",
        ok: syntheticInFacts === 0,
        severity: "warning",
        detail: `${syntheticInFacts} synthetic rows in financial_normalized_facts`,
      });
      checks.push({
        id: "db_has_verified_facts",
        title: "DB có verified accepted facts",
        ok: verifiedFactCount > 0,
        severity: "warning",
        detail: `${verifiedFactCount} verified accepted facts`,
      });

      const symbol = (options?.symbol ?? "HPG").toUpperCase();
      const rows = await db
        .select()
        .from(financialNormalizedFacts)
        .where(eq(financialNormalizedFacts.symbol, symbol))
        .limit(20);
      const goldenRows = GOLDEN_METRICS.filter((g) => g.symbol === symbol).map((g) => {
        const match = rows.find((r) => r.period === g.period && r.statementType === g.statementType);
        const data = (match?.data ?? {}) as Record<string, number>;
        return compareGoldenMetric(g, match ? (data[g.metric] ?? null) : null, match?.unit ?? undefined);
      });
      const gsum = goldenRegressionSummary(goldenRows);
      checks.push({
        id: "golden_regression_symbol",
        title: `Golden regression (${symbol})`,
        ok: gsum.fail === 0,
        severity: filledExpected > 0 ? "blocker" : "info",
        detail: `pass=${gsum.pass} fail=${gsum.fail} skip=${gsum.skip}`,
      });
    } catch (e) {
      checks.push({
        id: "db_connectivity",
        title: "DB connectivity for release gate",
        ok: false,
        severity: "warning",
        detail: e instanceof Error ? e.message : "DB check failed",
      });
    }
  } else {
    checks.push({
      id: "db_skipped",
      title: "DB checks skipped",
      ok: true,
      severity: "info",
      detail: "skipDb=true",
    });
  }

  const structuralGolden = GOLDEN_METRICS.map((g) => compareGoldenMetric(g, g.expectedValue, g.expectedUnit));
  const golden = {
    ...goldenRegressionSummary(structuralGolden),
    filledExpected,
    total: GOLDEN_METRICS.length,
  };

  const blockers = checks.filter((c) => !c.ok && c.severity === "blocker").map((c) => c.id);
  const warnings = checks.filter((c) => !c.ok && c.severity === "warning").map((c) => c.id);
  const ok = blockers.length === 0;

  let recommendation: string;
  if (!ok) {
    recommendation = `Blockers: ${blockers.join(", ")}. Không deploy production financial surface cho đến khi clear.`;
  } else if (warnings.length > 0) {
    recommendation = `Gate pass với warnings: ${warnings.join(", ")}. Nên cleanup synthetic + fill golden trước marketing verified.`;
  } else {
    recommendation = "Release gate PASS — checklist go-live đạt mức kỹ thuật.";
  }

  return {
    ok,
    phase: "phase4",
    checkedAt: new Date().toISOString(),
    checks,
    blockers,
    warnings,
    golden,
    recommendation,
    durationMs: Date.now() - started,
  };
}
