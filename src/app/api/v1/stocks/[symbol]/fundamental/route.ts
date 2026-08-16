import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { generateFundamentalReport } from "@/lib/fundamental";
import { getHistory } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

  try {
    const to = Math.floor(Date.now() / 1000);
    const { bars, source, confidence } = await getHistory(symbol, to - 86400 * 1100, to, "D");
    if (bars.length < 60) return fail(`Insufficient history for ${symbol} (${bars.length} bars, need ≥60)`, 422);
    const report = generateFundamentalReport(symbol, bars);
    return ok(report, { source, confidence, barsUsed: bars.length });
  } catch (err) {
    return handleError(err, `fundamental:${symbol}`);
  }
}
