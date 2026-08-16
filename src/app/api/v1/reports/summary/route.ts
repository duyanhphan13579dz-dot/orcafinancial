import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { generateMarketSummary, getStoredReport } from "@/lib/reports/generator";
import { startReportScheduler } from "@/lib/reports/scheduler";

export const dynamic = "force-dynamic";
startReportScheduler();

function parseDate(dateStr: string | null): Date {
  if (!dateStr) return new Date();
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 8, 0, 0));
}

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 60);
  if (limited) return limited;
  try {
    const d = parseDate(req.nextUrl.searchParams.get("date"));
    const dateKey = d.toISOString().slice(0, 10);
    let html = await getStoredReport("summary", dateKey);
    if (!html) {
      const gen = await generateMarketSummary(d);
      html = gen.html;
    }
    return ok({ date: dateKey, type: "summary", html }, { source: "orca-report-engine" });
  } catch (err) {
    return handleError(err, "summary-report");
  }
}
