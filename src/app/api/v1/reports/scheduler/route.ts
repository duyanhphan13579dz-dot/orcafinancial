import { NextRequest } from "next/server";
import { checkRateLimit, ok } from "@/lib/api";
import { getSchedulerStatus } from "@/lib/reports/scheduler";
import { listRecentReports } from "@/lib/reports/generator";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reports/scheduler
 * Observability endpoint — exposes the live scheduler state (last tick,
 * per-job attempt counts, next target window) so the OPS console can render
 * a "when will the next report fire?" indicator without parsing logs.
 */
export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 60);
  if (limited) return limited;
  const recent = await listRecentReports(20).catch(() => []);
  return ok({ scheduler: getSchedulerStatus(), recentReports: recent });
}
