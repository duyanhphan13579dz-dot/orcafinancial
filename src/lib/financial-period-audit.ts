import { desc } from "drizzle-orm";
import { db } from "@/db";
import { financialStatements, jobLogs } from "@/db/schema";
import { getLatestCompletedQuarter, type FinancialQuarter } from "@/lib/financial-statements";
import { ensureQuarterlyFinancials } from "@/lib/company-service";
import { loadCanonicalStatements, SyntheticFinancialAdapter } from "@/lib/stock-intelligence/financial-source";
import { logger } from "@/lib/logger";

export interface FinancialPeriodAuditIssue {
  code: "future_period" | "missing_latest" | "incomplete_quarter" | "degraded_source";
  symbol: string;
  period: string;
  message: string;
  severity: "error" | "warning";
}

export interface FinancialPeriodAuditResult {
  ok: boolean;
  checkedAt: string;
  expectedLatest: string;
  symbols: string[];
  checkedSymbols: number;
  issues: FinancialPeriodAuditIssue[];
  sourceSummary: { actual: number; estimate: number; fallback: number };
}

function periodTuple(quarter: number, fiscalYear: number): [number, number] {
  return [fiscalYear, quarter];
}

function isAfter(a: [number, number], b: [number, number]): boolean {
  return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
}

function expectedPeriodLabel(): string {
  const latest = getLatestCompletedQuarter();
  return `Q${latest.quarter}/${latest.fiscalYear}`;
}

function configuredSymbols(): string[] {
  return (process.env.FINANCIAL_AUDIT_SYMBOLS ?? "VNM,HPG,FPT,VCB")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 100);
}

async function auditSymbol(symbol: string, expected: [number, number], issues: FinancialPeriodAuditIssue[]): Promise<"actual" | "estimate" | "fallback"> {
  let quarters: FinancialQuarter[] = [];
  try {
    quarters = await ensureQuarterlyFinancials(symbol, 4);
  } catch (error) {
    issues.push({ code: "missing_latest", symbol, period: expectedPeriodLabel(), message: `Không tải được dữ liệu tài chính: ${error instanceof Error ? error.message : String(error)}`, severity: "error" });
    return "fallback";
  }

  const latest = quarters[0];
  if (!latest) {
    issues.push({ code: "missing_latest", symbol, period: expectedPeriodLabel(), message: "Không có kỳ tài chính để kiểm tra.", severity: "error" });
    return "fallback";
  }

  const latestTuple = periodTuple(latest.quarter, latest.fiscalYear);
  if (isAfter(latestTuple, expected)) {
    issues.push({ code: "future_period", symbol, period: latest.period, message: `${latest.period} vượt quá kỳ đã hoàn tất ${expectedPeriodLabel()} và không được hiển thị như số liệu đã có.`, severity: "error" });
  }
  if (latestTuple[0] < expected[0] || (latestTuple[0] === expected[0] && latestTuple[1] < expected[1])) {
    issues.push({ code: "missing_latest", symbol, period: latest.period, message: `Dữ liệu mới nhất mới là ${latest.period}; cần xác minh provider có công bố kỳ ${expectedPeriodLabel()} hay chưa.`, severity: "warning" });
  }
  for (const quarter of quarters) {
    if (isAfter(periodTuple(quarter.quarter, quarter.fiscalYear), expected)) {
      issues.push({ code: "future_period", symbol, period: quarter.period, message: `Loại kỳ tương lai ${quarter.period} khỏi dữ liệu hiển thị.`, severity: "error" });
    }
  }

  const canonical = await loadCanonicalStatements(symbol, "income", 4, new SyntheticFinancialAdapter(quarters));
  if (!canonical.actual || canonical.quality.sourceTier === "fallback") {
    issues.push({ code: "degraded_source", symbol, period: canonical.quality.latestPeriod ?? latest.period, message: "Provider actual chưa khả dụng; dữ liệu đang ở trạng thái estimate/degraded và không được gọi là audited actual.", severity: "warning" });
    return "fallback";
  }
  return canonical.quality.actualCount > 0 ? "actual" : "estimate";
}

export async function runFinancialPeriodAudit(symbols = configuredSymbols()): Promise<FinancialPeriodAuditResult> {
  const latest = getLatestCompletedQuarter();
  const expected: [number, number] = [latest.fiscalYear, latest.quarter];
  const issues: FinancialPeriodAuditIssue[] = [];
  const sourceSummary = { actual: 0, estimate: 0, fallback: 0 };

  for (const symbol of symbols) {
    const source = await auditSymbol(symbol, expected, issues);
    sourceSummary[source] += 1;
  }

  try {
    const futureRows = await db
      .select({ symbol: financialStatements.symbol, period: financialStatements.period, fiscalYear: financialStatements.fiscalYear, source: financialStatements.source })
      .from(financialStatements)
      .orderBy(desc(financialStatements.fiscalYear), desc(financialStatements.period));
    for (const row of futureRows) {
      const quarter = Number.parseInt(row.period.replace(/^Q/i, ""), 10);
      if (Number.isFinite(quarter) && isAfter([row.fiscalYear, quarter], expected)) {
        issues.push({ code: "future_period", symbol: row.symbol, period: `Q${quarter}/${row.fiscalYear}`, message: `DB còn bản ghi kỳ tương lai từ ${row.source}; service phải loại bản ghi này trước khi trả về UI.`, severity: "error" });
      }
    }
  } catch (error) {
    logger.warn("financial_period_audit_db_unavailable", { error: String(error) });
  }

  const result: FinancialPeriodAuditResult = {
    ok: !issues.some((issue) => issue.severity === "error"),
    checkedAt: new Date().toISOString(),
    expectedLatest: expectedPeriodLabel(),
    symbols,
    checkedSymbols: symbols.length,
    issues,
    sourceSummary,
  };

  try {
    await db.insert(jobLogs).values({
      job: "financial-period-audit",
      status: result.ok ? "ok" : "error",
      detail: JSON.stringify(result),
      durationMs: 0,
    });
  } catch (error) {
    logger.warn("financial_period_audit_log_failed", { error: String(error) });
  }
  return result;
}
