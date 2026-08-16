import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getHistory } from "@/lib/market";
import { detectCandlestickPatterns, detectChartPatterns } from "@/lib/technical-patterns";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

  const timeframe = req.nextUrl.searchParams.get("timeframe") ?? "D";
  const tf = ({"1d": "D", "1h": "60", "15m": "15"} as Record<string, string>)[timeframe] ?? "D";

  try {
    const to = Math.floor(Date.now() / 1000);
    const span = tf === "D" ? 86400 * 400 : tf === "60" ? 86400 * 60 : 86400 * 14;
    const { bars, source, confidence } = await getHistory(symbol, to - span, to, tf as "D" | "60" | "15" | "1");
    if (bars.length < 20) return fail(`Insufficient data for pattern detection (${bars.length} bars)`, 422);

    const candlestick = detectCandlestickPatterns(bars);
    const chart = detectChartPatterns(bars);

    // Only return patterns from the last 20 bars for candlestick, all for chart
    const recentCandlestick = candlestick.filter((p) => p.barIndex >= bars.length - 20);

    return ok(
      {
        symbol,
        timeframe: tf,
        candlestickPatterns: recentCandlestick,
        chartPatterns: chart,
        totalCandlestickDetected: candlestick.length,
        barsAnalyzed: bars.length,
      },
      { source, confidence },
    );
  } catch (err) {
    return handleError(err, `technical:${symbol}`);
  }
}
