import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { runForexAnalysis } from "@/lib/forex/service";
import {
  defaultTimeframe,
  isValidTimeframe,
} from "@/lib/forex/timeframes";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  c: { params: Promise<{ symbol: string }> },
) {
  const l = checkRateLimit(req, 60);
  if (l) return l;
  const { symbol } = await c.params;
  const sym = symbol.toUpperCase();
  const tf =
    req.nextUrl.searchParams.get("timeframe") ?? defaultTimeframe(sym);
  if (!isValidTimeframe(tf, sym)) {
    return fail(`Invalid timeframe for ${sym}: ${tf}`, 400);
  }
  try {
    return ok(await runForexAnalysis(sym, tf), {
      timezone: "Asia/Ho_Chi_Minh",
    });
  } catch (e) {
    return handleError(e, `forex_analysis:${symbol}`);
  }
}
