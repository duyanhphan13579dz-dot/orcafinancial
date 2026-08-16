import { NextRequest } from "next/server";
import { checkRateLimit, fail, ok } from "@/lib/api";
import { logger, recentLogs, type LogLevel } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 120);
  if (limited) return limited;
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider") ?? undefined;
  const level = (url.searchParams.get("level") as LogLevel) ?? undefined;
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));
  try {
    const logs = recentLogs({ provider, level, limit });
    return ok({ logs, count: logs.length });
  } catch (err) {
    logger.error("admin_logs_failed", { error: String(err) });
    return fail("Failed to read logs", 500);
  }
}
