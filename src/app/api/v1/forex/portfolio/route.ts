import { NextRequest } from "next/server";
import { fail, handleError, ok } from "@/lib/api";
import {
  closePosition,
  getPortfolioSnapshot,
  openPosition,
  type OpenPositionInput,
} from "@/lib/forex/portfolio";
import type { TradeDirection, TradeEmotion } from "@/lib/forex/journal";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId") ?? undefined;
    const snap = await getPortfolioSnapshot(userId);
    return ok(snap, { source: "forex-portfolio" });
  } catch (err) {
    return handleError(err, "forex_portfolio_get");
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action ?? "open").toLowerCase();

    if (action === "close") {
      const id = String(body.id ?? "");
      if (!id) return fail("id required to close", 400);
      const closed = await closePosition(
        id,
        body.exitPrice != null ? Number(body.exitPrice) : undefined,
      );
      if (!closed) return fail("Position not found", 404);
      return ok(closed, { source: "forex-portfolio" });
    }

    const symbol = String(body.symbol ?? "").toUpperCase();
    const direction = String(body.direction ?? "").toUpperCase() as TradeDirection;
    const entry = Number(body.entry);
    if (!symbol || !Number.isFinite(entry)) {
      return fail("symbol and entry required", 400);
    }
    if (direction !== "BUY" && direction !== "SELL") {
      return fail("direction must be BUY or SELL", 400);
    }

    const input: OpenPositionInput = {
      userId: body.userId != null ? String(body.userId) : undefined,
      symbol,
      direction,
      entry,
      stopLoss: body.stopLoss != null ? Number(body.stopLoss) : null,
      takeProfit: body.takeProfit != null ? Number(body.takeProfit) : null,
      leverage: body.leverage != null ? Number(body.leverage) : 10,
      sizeUnits: body.sizeUnits != null ? Number(body.sizeUnits) : 1,
      notionalUsd: body.notionalUsd != null ? Number(body.notionalUsd) : 1000,
      note: body.note != null ? String(body.note) : null,
      emotion: (body.emotion as TradeEmotion) ?? null,
      confidence: body.confidence != null ? Number(body.confidence) : null,
      timeframe: body.timeframe != null ? String(body.timeframe) : "1h",
      addToJournal: body.addToJournal !== false,
    };

    const pos = await openPosition(input);
    return ok(pos, { source: "forex-portfolio" });
  } catch (err) {
    return handleError(err, "forex_portfolio_post");
  }
}
