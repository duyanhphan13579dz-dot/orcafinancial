import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { ensureReportsTable } from "@/db/ensure-reports-table";
import { listRecentReports } from "@/lib/reports/generator";
import { startReportScheduler } from "@/lib/reports/scheduler";

export const dynamic = "force-dynamic";
startReportScheduler();

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 60);
  if (limited) return limited;
  try {
    try {
      await ensureReportsTable();
    } catch {
      // still try list (memory fallback)
    }
    const url = new URL(req.url);
    const limit = Math.min(30, Number(url.searchParams.get("limit") ?? "14"));
    const reports = await listRecentReports(limit);
    return ok({ reports }, { source: "db" });
  } catch (err) {
    // Degrade to empty list rather than blocking the page
    console.error("[list-reports]", err);
    return ok({ reports: [] }, { source: "fallback-empty" });
  }
}
