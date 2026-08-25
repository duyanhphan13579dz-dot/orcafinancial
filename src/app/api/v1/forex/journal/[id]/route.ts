import { NextRequest } from "next/server";
import { fail, handleError, ok } from "@/lib/api";
import {
  deleteJournalEntry,
  updateJournalEntry,
  type TradeDirection,
  type TradeEmotion,
  type TradeResult,
} from "@/lib/forex/journal";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!id) return fail("Missing id", 400);
    const body = (await req.json()) as Record<string, unknown>;

    const updated = await updateJournalEntry(id, {
      direction: body.direction
        ? (String(body.direction).toUpperCase() as TradeDirection)
        : undefined,
      entry: body.entry != null ? Number(body.entry) : undefined,
      stopLoss: body.stopLoss !== undefined ? Number(body.stopLoss) : undefined,
      takeProfit:
        body.takeProfit !== undefined ? Number(body.takeProfit) : undefined,
      exitPrice:
        body.exitPrice !== undefined ? Number(body.exitPrice) : undefined,
      leverage: body.leverage != null ? Number(body.leverage) : undefined,
      sizeUnits: body.sizeUnits != null ? Number(body.sizeUnits) : undefined,
      confidence:
        body.confidence !== undefined ? Number(body.confidence) : undefined,
      emotion: body.emotion !== undefined ? (body.emotion as TradeEmotion) : undefined,
      note: body.note !== undefined ? String(body.note) : undefined,
      result: body.result !== undefined ? (body.result as TradeResult) : undefined,
      pnlUsd: body.pnlUsd !== undefined ? Number(body.pnlUsd) : undefined,
      setupQuality:
        body.setupQuality !== undefined ? String(body.setupQuality) : undefined,
    });

    if (!updated) return fail("Not found", 404);
    return ok(updated, { source: "forex-journal" });
  } catch (err) {
    return handleError(err, "forex_journal_update");
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!id) return fail("Missing id", 400);
    await deleteJournalEntry(id);
    return ok({ deleted: true, id }, { source: "forex-journal" });
  } catch (err) {
    return handleError(err, "forex_journal_delete");
  }
}
