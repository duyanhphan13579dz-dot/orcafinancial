import { NextRequest } from "next/server";
import { fail, handleError, ok } from "@/lib/api";
import { createPaperSetup, listPaperSetups, type PaperSetupOutcome } from "@/lib/forex/scalping-journal";
import type { ForexScalpingCandidate } from "@/lib/forex/scalping";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const entries = await listPaperSetups({ userId: sp.get("userId") ?? undefined, symbol: sp.get("symbol") ?? undefined, outcome: (sp.get("outcome") as PaperSetupOutcome) ?? undefined, strategy: sp.get("strategy") ?? undefined, limit: sp.get("limit") ? Number(sp.get("limit")) : 100 });
    return ok({ entries, count: entries.length, paperOnly: true, executionEnabled: false }, { source: "forex-scalping-journal" });
  } catch (error) { return handleError(error, "forex_scalping_journal_list"); }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { userId?: string; candidate?: ForexScalpingCandidate; note?: string | null };
    const candidate = body.candidate;
    if (!candidate || !candidate.symbol || !candidate.direction || !Number.isFinite(candidate.entry) || !Number.isFinite(candidate.stopLoss) || !Number.isFinite(candidate.takeProfit)) return fail("candidate with symbol, direction, entry, stopLoss and takeProfit is required", 400);
    const entry = await createPaperSetup({ userId: body.userId, candidate, note: body.note });
    return ok(entry, { source: "forex-scalping-journal", paperOnly: true, executionEnabled: false });
  } catch (error) { return handleError(error, "forex_scalping_journal_create"); }
}
