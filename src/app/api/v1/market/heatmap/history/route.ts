import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getHistory } from "@/lib/market";

export const dynamic = "force-dynamic";

const TIMEFRAME_DAYS: Record<string, number> = {
  "1D": 5,
  "1W": 30,
  "1M": 120,
  "3M": 400,
  YTD: 500,
  "1Y": 1100,
};

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 120);
  if (limited) return limited;
  const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase().trim() ?? "";
  const timeframe = (req.nextUrl.searchParams.get("timeframe") ?? "1M").toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);
  if (!(timeframe in TIMEFRAME_DAYS)) return fail("Invalid timeframe", 400);
  try {
    const to = Math.floor(Date.now() / 1000);
    const { bars, source, confidence } = await getHistory(
      symbol,
      to - 86400 * TIMEFRAME_DAYS[timeframe],
      to,
      "D",
    );
    return ok(
      {
        symbol,
        timeframe,
        bars: bars.map((bar) => ({
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        })),
      },
      { source, confidence, timestamp: new Date().toISOString() },
      { cacheSeconds: 30 },
    );
  } catch (err) {
    return handleError(err, `heatmap_history:${symbol}`);
  }
}
