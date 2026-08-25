import { NextRequest } from "next/server";
import { handleError, ok } from "@/lib/api";
import { buildMacroContextLive } from "@/lib/forex/macro";
import { fetchLiveMacroCalendar } from "@/lib/forex/calendar-providers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const symbol =
      req.nextUrl.searchParams.get("symbol")?.toUpperCase() ?? "EURUSD";
    const impact = req.nextUrl.searchParams.get("impact")?.toUpperCase();

    const [{ events, source }, context] = await Promise.all([
      fetchLiveMacroCalendar(),
      buildMacroContextLive(symbol),
    ]);

    let calendar = events;
    if (impact === "HIGH" || impact === "EXTREME") {
      calendar = events.filter(
        (e) => e.impact === "HIGH" || e.impact === "EXTREME",
      );
    } else if (impact === "MEDIUM") {
      calendar = events.filter(
        (e) =>
          e.impact === "MEDIUM" || e.impact === "HIGH" || e.impact === "EXTREME",
      );
    }

    return ok(
      {
        symbol,
        source,
        calendar,
        context,
      },
      { source: `forex-macro-calendar:${source}` },
    );
  } catch (err) {
    return handleError(err, "forex_calendar");
  }
}
