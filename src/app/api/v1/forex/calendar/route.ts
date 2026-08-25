import { NextRequest } from "next/server";
import { handleError, ok } from "@/lib/api";
import { buildMacroCalendar, buildMacroContext } from "@/lib/forex/macro";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase() ?? "EURUSD";
    const calendar = buildMacroCalendar();
    const context = buildMacroContext(symbol);
    return ok(
      {
        symbol,
        calendar,
        context,
      },
      { source: "forex-macro-calendar" },
    );
  } catch (err) {
    return handleError(err, "forex_calendar");
  }
}
