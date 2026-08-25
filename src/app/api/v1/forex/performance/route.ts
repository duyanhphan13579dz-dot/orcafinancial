import { NextRequest } from "next/server";
import { handleError, ok } from "@/lib/api";
import { buildPerformanceReport } from "@/lib/forex/performance";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId") ?? undefined;
    const report = await buildPerformanceReport(userId);
    return ok(report, { source: "forex-performance" });
  } catch (err) {
    return handleError(err, "forex_performance");
  }
}
