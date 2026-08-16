import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import type { Timeframe } from "@/lib/connectors/core";
import { getHistory } from "@/lib/market";

export const dynamic = "force-dynamic";

const TF_MAP: Record<string, Timeframe> = { "1m": "1", "15m": "15", "1h": "60", "1d": "D" };

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

  const sp = req.nextUrl.searchParams;
  const tf = TF_MAP[sp.get("timeframe") ?? "1d"] ?? "D";
  const to = Number(sp.get("to")) || Math.floor(Date.now() / 1000);
  const defaultSpan = tf === "D" ? 86400 * 365 : tf === "60" ? 86400 * 30 : 86400 * 7;
  const from = Number(sp.get("from")) || to - defaultSpan;

  try {
    const { bars, source, confidence } = await getHistory(symbol, from, to, tf);
    return ok({ symbol, timeframe: tf, bars }, { source, confidence, count: bars.length });
  } catch (err) {
    return handleError(err, `history:${symbol}`);
  }
}
