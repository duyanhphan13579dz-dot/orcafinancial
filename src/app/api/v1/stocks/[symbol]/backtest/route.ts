import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getHistory } from "@/lib/market";
import { runMovingAverageBacktest } from "@/lib/stock-intelligence/backtest-engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);
  try {
    const { bars, source, confidence } = await getHistory(symbol, Math.floor(Date.now() / 1000) - 86400 * 1200, Math.floor(Date.now() / 1000), "D");
    const result = runMovingAverageBacktest({ symbol, bars: bars.map((bar) => ({ time: bar.time, close: bar.close })) });
    return ok(result, { source, confidence, dataAsOf: bars.at(-1)?.time ?? null }, { cacheSeconds: 300 });
  } catch (error) {
    return handleError(error, `backtest:${symbol}`);
  }
}
