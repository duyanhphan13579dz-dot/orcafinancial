import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { reports } from "@/db/schema";
import { ensureReportsTable } from "@/db/ensure-reports-table";
import { logger } from "@/lib/logger";
import type { ReportMetadata, ReportType } from "./report-contract";

interface MemRow {
  type: ReportType;
  date: string;
  title: string;
  html: string;
  metadata: ReportMetadata;
  createdAt: Date;
  id?: number;
}

const mem = new Map<string, MemRow>();
function key(type: ReportType, date: string) { return `${type}:${date}`; }

export async function persistReport(
  type: ReportType,
  dateKey: string,
  html: string,
  title: string,
  metadata: ReportMetadata,
): Promise<{ id: number | null; persisted: boolean; metadata: ReportMetadata }> {
  mem.set(key(type, dateKey), { type, date: dateKey, title, html, metadata, createdAt: new Date() });
  try {
    await ensureReportsTable();
    const res = await db.insert(reports).values({
      type,
      reportDate: dateKey,
      contentHtml: html,
      title,
      metadata: metadata as unknown as Record<string, unknown>,
      reportId: metadata.reportId,
      version: metadata.version,
    }).onConflictDoUpdate({
      target: [reports.type, reports.reportDate],
      set: { contentHtml: html, title, metadata: metadata as unknown as Record<string, unknown>, reportId: metadata.reportId, version: metadata.version },
    }).returning({ id: reports.id });
    const id = res[0]?.id ?? null;
    const row = mem.get(key(type, dateKey));
    if (row && id != null) row.id = id;
    return { id, persisted: true, metadata };
  } catch (err) {
    logger.error("report_persist_failed", { type, date: dateKey, error: err instanceof Error ? err.message : String(err) });
    return { id: null, persisted: false, metadata };
  }
}

export async function getStoredReport(type: ReportType, dateKey: string): Promise<{ html: string; metadata: ReportMetadata | null } | null> {
  try {
    await ensureReportsTable();
    const rows = await db.select({ contentHtml: reports.contentHtml, metadata: reports.metadata }).from(reports)
      .where(and(eq(reports.type, type), eq(reports.reportDate, dateKey))).limit(1);
    if (rows[0]?.contentHtml) return { html: rows[0].contentHtml, metadata: (rows[0].metadata as ReportMetadata | null) ?? null };
  } catch (err) {
    logger.warn("report_get_db_failed", { type, date: dateKey, error: err instanceof Error ? err.message : String(err) });
  }
  const row = mem.get(key(type, dateKey));
  return row ? { html: row.html, metadata: row.metadata } : null;
}

export async function listRecentReports(limit = 14): Promise<Array<{ type: ReportType; date: string; title: string; createdAt: Date; metadata: ReportMetadata | null }>> {
  try {
    await ensureReportsTable();
    const rows = await db.select({ type: reports.type, date: reports.reportDate, title: reports.title, createdAt: reports.createdAt, metadata: reports.metadata })
      .from(reports).orderBy(desc(reports.reportDate), desc(reports.createdAt)).limit(limit);
    return rows as Array<{ type: ReportType; date: string; title: string; createdAt: Date; metadata: ReportMetadata | null }>;
  } catch (err) {
    logger.warn("report_list_db_failed", { error: err instanceof Error ? err.message : String(err) });
    return [...mem.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit)
      .map((r) => ({ type: r.type, date: r.date, title: r.title, createdAt: r.createdAt, metadata: r.metadata }));
  }
}
