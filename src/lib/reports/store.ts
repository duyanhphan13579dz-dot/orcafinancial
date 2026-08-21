import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { reports } from "@/db/schema";
import { ensureReportsTable } from "@/db/ensure-reports-table";
import { logger } from "@/lib/logger";
import type { ReportType } from "./generator";

interface MemRow {
  type: ReportType;
  date: string;
  title: string;
  html: string;
  createdAt: Date;
  id?: number;
}

/** Process-local fallback when DB is briefly unavailable. */
const mem = new Map<string, MemRow>();

function key(type: ReportType, date: string) {
  return `${type}:${date}`;
}

export async function persistReport(
  type: ReportType,
  dateKey: string,
  html: string,
  title: string,
  metadata: Record<string, unknown>,
): Promise<{ id: number | null; persisted: boolean }> {
  mem.set(key(type, dateKey), {
    type,
    date: dateKey,
    title,
    html,
    createdAt: new Date(),
  });

  try {
    await ensureReportsTable();
    const res = await db
      .insert(reports)
      .values({ type, reportDate: dateKey, contentHtml: html, title, metadata })
      .onConflictDoUpdate({
        target: [reports.type, reports.reportDate],
        set: {
          contentHtml: html,
          title,
          metadata,
          createdAt: sql`now()`,
        },
      })
      .returning({ id: reports.id });

    const id = res[0]?.id ?? null;
    if (id != null) {
      const row = mem.get(key(type, dateKey));
      if (row) row.id = id;
    }
    return { id, persisted: true };
  } catch (err) {
    logger.error("report_persist_failed", {
      type,
      date: dateKey,
      error: err instanceof Error ? err.message : String(err),
    });
    // Still usable via memory for this process / response payload
    return { id: null, persisted: false };
  }
}

export async function getStoredReport(
  type: ReportType,
  dateKey: string,
): Promise<string | null> {
  try {
    await ensureReportsTable();
    const rows = await db
      .select({ contentHtml: reports.contentHtml })
      .from(reports)
      .where(and(eq(reports.type, type), eq(reports.reportDate, dateKey)))
      .limit(1);
    if (rows[0]?.contentHtml) return rows[0].contentHtml;
  } catch (err) {
    logger.warn("report_get_db_failed", {
      type,
      date: dateKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return mem.get(key(type, dateKey))?.html ?? null;
}

export async function listRecentReports(
  limit = 14,
): Promise<Array<{ type: ReportType; date: string; title: string; createdAt: Date }>> {
  try {
    await ensureReportsTable();
    const rows = await db
      .select({
        type: reports.type,
        date: reports.reportDate,
        title: reports.title,
        createdAt: reports.createdAt,
      })
      .from(reports)
      .orderBy(desc(reports.reportDate), desc(reports.createdAt))
      .limit(limit);
    return rows as Array<{
      type: ReportType;
      date: string;
      title: string;
      createdAt: Date;
    }>;
  } catch (err) {
    logger.warn("report_list_db_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [...mem.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((r) => ({
        type: r.type,
        date: r.date,
        title: r.title,
        createdAt: r.createdAt,
      }));
  }
}
