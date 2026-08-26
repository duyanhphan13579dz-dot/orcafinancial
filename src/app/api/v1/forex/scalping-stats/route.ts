import { NextRequest } from "next/server";
import { handleError, ok } from "@/lib/api";
import { getPaperSetupStats } from "@/lib/forex/scalping-journal";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const days = Math.min(Math.max(Number(sp.get("days") ?? 30), 1), 365);
    const stats = await getPaperSetupStats({ userId: sp.get("userId") ?? undefined, symbol: sp.get("symbol") ?? undefined, days });
    return ok(stats, { source: "forex-scalping-stats", paperOnly: true, executionEnabled: false });
  } catch (error) { return handleError(error, "forex_scalping_stats"); }
}
