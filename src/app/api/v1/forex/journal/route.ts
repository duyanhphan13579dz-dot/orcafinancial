import { NextRequest } from "next/server";
import { fail, handleError, ok } from "@/lib/api";
import {
  createJournalEntry,
  listJournalEntries,
  type TradeDirection,
  type TradeEmotion,
  type TradeResult,
} from "@/lib/forex/journal";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const entries = await listJournalEntries({
      userId: sp.get("userId") ?? undefined,
      symbol: sp.get("symbol") ?? undefined,
      result: (sp.get("result") as TradeResult) ?? undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : 100,
    });
    return ok({ entries, count: entries.length }, { source: "forex-journal" });
  } catch (err) {
    return handleError(err, "forex_journal_list");
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const symbol = String(body.symbol ?? "").toUpperCase();
    const direction = String(body.direction ?? "").toUpperCase() as TradeDirection;
    const entry = Number(body.entry);

    if (!symbol || !Number.isFinite(entry)) {
      return fail("symbol and entry required", 400);
    }
    if (direction !== "BUY" && direction !== "SELL") {
      return fail("direction must be BUY or SELL", 400);
    }

    const created = await createJournalEntry({
      userId: body.userId != null ? String(body.userId) : undefined,
      symbol,
      direction,
      timeframe: body.timeframe != null ? String(body.timeframe) : "1h",
      entry,
      stopLoss: body.stopLoss != null ? Number(body.stopLoss) : null,
      takeProfit: body.takeProfit != null ? Number(body.takeProfit) : null,
      exitPrice: body.exitPrice != null ? Number(body.exitPrice) : null,
      leverage: body.leverage != null ? Number(body.leverage) : 10,
      sizeUnits: body.sizeUnits != null ? Number(body.sizeUnits) : 1,
      confidence: body.confidence != null ? Number(body.confidence) : null,
      emotion: (body.emotion as TradeEmotion) ?? null,
      note: body.note != null ? String(body.note) : null,
      result: (body.result as TradeResult) ?? undefined,
      setupQuality: body.setupQuality != null ? String(body.setupQuality) : null,
      tags: Array.isArray(body.tags) ? (body.tags as string[]) : null,
    });

    return ok(created, { source: "forex-journal" });
  } catch (err) {
    return handleError(err, "forex_journal_create");
  }
}
