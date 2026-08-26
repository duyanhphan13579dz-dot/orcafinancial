import { NextRequest } from "next/server";
import { fail, handleError, ok } from "@/lib/api";
import { deletePaperSetup, updatePaperSetup, type PaperSetupOutcome } from "@/lib/forex/scalping-journal";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as { outcome?: PaperSetupOutcome; note?: string | null };
    const valid: PaperSetupOutcome[] = ["OPEN", "WIN", "LOSS", "BREAKEVEN", "INVALIDATED"];
    if (body.outcome && !valid.includes(body.outcome)) return fail("invalid paper setup outcome", 400);
    const entry = await updatePaperSetup(id, { outcome: body.outcome, note: body.note });
    if (!entry) return fail("paper setup not found", 404);
    return ok(entry, { source: "forex-scalping-journal", paperOnly: true, executionEnabled: false });
  } catch (error) { return handleError(error, "forex_scalping_journal_update"); }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try { const { id } = await ctx.params; await deletePaperSetup(id); return ok({ deleted: true, id, paperOnly: true, executionEnabled: false }, { source: "forex-scalping-journal" }); }
  catch (error) { return handleError(error, "forex_scalping_journal_delete"); }
}
