import { NextRequest } from "next/server";
import { fail, handleError, ok } from "@/lib/api";
import { fetchBiquoteOhlc } from "@/lib/forex/biquote-websocket";
import { listPaperSetups } from "@/lib/forex/scalping-journal";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await ctx.params;
    const normalized = symbol.toUpperCase();
    const sp = req.nextUrl.searchParams;
    const timeframe = sp.get("timeframe") ?? "5m";
    const setupId = sp.get("setupId");
    const at = Number(sp.get("at"));
    const setup = setupId ? (await listPaperSetups({ symbol: normalized, limit: 500 })).find((item) => item.id === setupId) : undefined;
    const replayAt = Number.isFinite(at) && at > 0 ? at : setup ? Math.floor(Date.parse(setup.capturedAt) / 1000) : 0;
    if (!replayAt) return fail("at or setupId is required", 400);
    const limit = Math.min(Math.max(Number(sp.get("limit") ?? 120), 20), 500);
    const history = await fetchBiquoteOhlc(normalized, timeframe, limit, replayAt + 1);
    return ok({ symbol: normalized, timeframe, replayAt: new Date(replayAt * 1000).toISOString(), bars: history.bars, setup: setup ?? null, source: history.source, paperOnly: true, executionEnabled: false }, { source: "biquote-replay" });
  } catch (error) { return handleError(error, "forex_scalping_replay"); }
}
