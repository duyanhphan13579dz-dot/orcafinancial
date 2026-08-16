import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { triggerSummary, vnTodayKey } from "@/lib/reports/generator";
import { getSchedulerStatus } from "@/lib/reports/scheduler";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/reports/trigger/summary?date=YYYY-MM-DD
 * Force-generate (or regenerate) the Market Summary for the given date.
 * Defaults to today (VN local time). Useful when the 15:15 automated run
 * was missed (server reboot, upstream hiccup, weekend back-fill, etc.).
 */
export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 20);
  if (limited) return limited;
  const dateStr = req.nextUrl.searchParams.get("date");
  let date: Date | undefined;
  if (dateStr) {
    const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return fail("date must be YYYY-MM-DD", 400);
    // 15:30 VN = 08:30 UTC
    date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 8, 30, 0));
  }
  const startedAt = Date.now();
  try {
    const result = await triggerSummary(date);
    logger.info("trigger_summary_manual", {
      date: result.date,
      id: result.id,
      latencyMs: Date.now() - startedAt,
    });
    return ok(
      {
        type: result.type,
        date: result.date,
        vnToday: vnTodayKey(),
        id: result.id,
        lengthBytes: result.html.length,
        latencyMs: Date.now() - startedAt,
        scheduler: getSchedulerStatus(),
      },
      { source: "manual-trigger" },
    );
  } catch (err) {
    return handleError(err, "trigger_summary");
  }
}
