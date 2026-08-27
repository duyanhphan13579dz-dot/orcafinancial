import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { financialStatements, jobLogs } from "@/db/schema";
import { getLatestCompletedQuarter } from "@/lib/financial-statements";

const FILING_SOURCES = new Set(["filing", "fmp", "professional", "daloopa", "fiscal-ai"]);
const SYNTHETIC_PREFIX = "sector-synthetic-";

type FinancialRow = typeof financialStatements.$inferSelect;
export type CleanupIssueCode = "future_period" | "missing_filing_source" | "legacy_synthetic" | "invalid_period";

export interface FinancialCleanupIssue {
  id: number;
  symbol: string;
  type: string;
  period: string;
  fiscalYear: number;
  source: string;
  confidence: number;
  updatedAt: string;
  code: CleanupIssueCode;
  removable: boolean;
  reason: string;
}

export interface FinancialCleanupResult {
  ok: boolean;
  dryRun: boolean;
  checkedAt: string;
  expectedLatest: string;
  scannedRows: number;
  issueCount: number;
  removableCount: number;
  deletedCount: number;
  backupJobId: number | null;
  issues: FinancialCleanupIssue[];
}

function quarterNumber(period: string): number | null {
  const match = /^Q([1-4])$/i.exec(period.trim());
  return match ? Number(match[1]) : null;
}

function isAfterExpected(row: Pick<FinancialRow, "period" | "fiscalYear">, expected: { fiscalYear: number; quarter: number }): boolean {
  const quarter = quarterNumber(row.period);
  if (quarter == null) return false;
  return row.fiscalYear > expected.fiscalYear || (row.fiscalYear === expected.fiscalYear && quarter > expected.quarter);
}

function sourceIsFiling(source: string): boolean {
  const normalized = source.trim().toLowerCase();
  return FILING_SOURCES.has(normalized) || normalized.includes("filing") || normalized.includes("professional");
}

function sourceIsSynthetic(source: string): boolean {
  return source.trim().toLowerCase().startsWith(SYNTHETIC_PREFIX);
}

export function classifyFinancialRow(row: Pick<FinancialRow, "id" | "symbol" | "type" | "period" | "fiscalYear" | "source" | "confidence" | "updatedAt">, expected = getLatestCompletedQuarter()): FinancialCleanupIssue[] {
  const issues: FinancialCleanupIssue[] = [];
  const base = {
    id: row.id,
    symbol: row.symbol,
    type: row.type,
    period: row.period,
    fiscalYear: row.fiscalYear,
    source: row.source,
    confidence: row.confidence,
    updatedAt: row.updatedAt.toISOString(),
  };
  const quarter = quarterNumber(row.period);
  if (quarter == null) {
    issues.push({ ...base, code: "invalid_period", removable: sourceIsSynthetic(row.source), reason: "Kỳ báo cáo không đúng định dạng Q1–Q4." });
    return issues;
  }
  const future = isAfterExpected(row, expected);
  if (future) {
    issues.push({ ...base, code: "future_period", removable: sourceIsSynthetic(row.source), reason: `Vượt quá kỳ đã hoàn tất Q${expected.quarter}/${expected.fiscalYear}.` });
  }
  if (!sourceIsFiling(row.source)) {
    issues.push({ ...base, code: "missing_filing_source", removable: false, reason: "Không có provenance filing/professional; không được coi là actual." });
  }
  if (row.source.trim().toLowerCase() === "sector-synthetic-v1") {
    issues.push({ ...base, code: "legacy_synthetic", removable: true, reason: "Bản ghi synthetic đời cũ, cần loại khỏi database để không trộn với mô hình hiện hành." });
  }
  return issues;
}

export async function scanFinancialData(symbols?: string[]): Promise<{ rows: FinancialRow[]; issues: FinancialCleanupIssue[]; expectedLatest: string }> {
  const rows = await db
    .select()
    .from(financialStatements)
    .where(symbols?.length ? inArray(financialStatements.symbol, symbols) : undefined)
    .orderBy(desc(financialStatements.fiscalYear), desc(financialStatements.period), desc(financialStatements.id));
  const expected = getLatestCompletedQuarter();
  const issues = rows.flatMap((row) => classifyFinancialRow(row, expected));
  return { rows, issues, expectedLatest: `Q${expected.quarter}/${expected.fiscalYear}` };
}

export async function runFinancialDataCleanup(options: { symbols?: string[]; dryRun?: boolean } = {}): Promise<FinancialCleanupResult> {
  const startedAt = Date.now();
  const dryRun = options.dryRun !== false;
  const scanned = await scanFinancialData(options.symbols);
  const removableIds = [...new Set(scanned.issues.filter((issue) => issue.removable).map((issue) => issue.id))];
  let deletedCount = 0;
  let backupJobId: number | null = null;

  if (!dryRun && removableIds.length > 0) {
    const backupRows = scanned.rows.filter((row) => removableIds.includes(row.id));
    const backup = JSON.stringify({ version: 1, createdAt: new Date().toISOString(), rows: backupRows });
    const backupLog = await db.insert(jobLogs).values({
      job: "financial-data-cleanup-backup",
      status: "backup",
      detail: backup,
      durationMs: Date.now() - startedAt,
    }).returning({ id: jobLogs.id });
    backupJobId = backupLog[0]?.id ?? null;
    const deleted = await db.delete(financialStatements).where(and(inArray(financialStatements.id, removableIds))).returning({ id: financialStatements.id });
    deletedCount = deleted.length;
  }

  const result: FinancialCleanupResult = {
    ok: !scanned.issues.some((issue) => issue.code === "future_period" && !issue.removable),
    dryRun,
    checkedAt: new Date().toISOString(),
    expectedLatest: scanned.expectedLatest,
    scannedRows: scanned.rows.length,
    issueCount: scanned.issues.length,
    removableCount: removableIds.length,
    deletedCount,
    backupJobId,
    issues: scanned.issues,
  };
  await db.insert(jobLogs).values({
    job: "financial-data-cleanup",
    status: result.ok ? "ok" : "error",
    detail: JSON.stringify(result),
    durationMs: Date.now() - startedAt,
  });
  return result;
}
