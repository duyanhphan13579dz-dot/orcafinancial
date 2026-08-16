import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { triggerMorning, vnTodayKey } from "@/lib/reports/generator";
import { getSchedulerStatus } from "@/lib/reports/scheduler";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/reports/trigger/morning?date=YYYY-MM-DD
 * Force-generate (or regenerate) the Morning Brief for the given date.
 * Defaults to today (VN local time). Operator-only endpoint — rate-limited
 * tightly so it cannot be abused to hammer upstream providers.
 */
export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 20);
  if (limited) return limited;
  const dateStr = req.nextUrl.searchParams.get("date");
  let date: Date | undefined;
  if (dateStr) {
    const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return fail("date must be YYYY-MM-DD", 400);
    date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 30, 0));
  }
  const startedAt = Date.now();
  try {
    const result = await triggerMorning(date);
    logger.info("trigger_morning_manual", {
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
    return handleError(err, "trigger_morning");
  }
}
