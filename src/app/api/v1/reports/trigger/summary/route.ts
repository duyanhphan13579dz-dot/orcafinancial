import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { ensureReportsTable } from "@/db/ensure-reports-table";
import { triggerSummary, vnTodayKey } from "@/lib/reports/generator";
import { getSchedulerStatus } from "@/lib/reports/scheduler";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 30);
  if (limited) return limited;

  const dateStr = req.nextUrl.searchParams.get("date");
  let date: Date | undefined;
  if (dateStr) {
    const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      return new Response(JSON.stringify({ ok: false, error: "date must be YYYY-MM-DD" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 8, 30, 0));
  }

  const startedAt = Date.now();
  try {
    try {
      await ensureReportsTable();
    } catch (e) {
      logger.warn("ensure_reports_table_failed_continuing", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    const result = await triggerSummary(date);
    logger.info("trigger_summary_manual", {
      date: result.date,
      id: result.id,
      persisted: result.persisted,
      llm: (result as { llm?: boolean }).llm,
      latencyMs: Date.now() - startedAt,
    });

    return ok(
      {
        type: result.type,
        date: result.date,
        vnToday: vnTodayKey(),
        id: result.id,
        persisted: result.persisted,
        llm: (result as { llm?: boolean }).llm ?? false,
        html: result.html,
        lengthBytes: result.html.length,
        latencyMs: Date.now() - startedAt,
        scheduler: getSchedulerStatus(),
      },
      { source: "manual-trigger" },
    );
  } catch (err) {
    logger.error("trigger_summary_failed", {
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - startedAt,
    });
    return handleError(err, "trigger_summary");
  }
}
