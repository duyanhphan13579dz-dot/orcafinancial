/**
 * Phase 15 — Portfolio / Open Positions
 */

import { and, desc, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { forexPositions } from "./schema";
import { getLiveQuoteContract } from "./service";
import {
  createJournalEntry,
  type TradeDirection,
  type TradeEmotion,
} from "./journal";

export interface OpenPosition {
  id: string;
  userId: string;
  symbol: string;
  direction: TradeDirection;
  entry: number;
  stopLoss: number | null;
  takeProfit: number | null;
  leverage: number;
  sizeUnits: number;
  notionalUsd: number;
  journalId: string | null;
  note: string | null;
  openedAt: string;
  /** Mark-to-market */
  currentPrice: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  riskUsd: number | null;
}

export interface PortfolioSnapshot {
  asOf: string;
  positions: OpenPosition[];
  metrics: {
    openCount: number;
    totalUnrealizedPnl: number;
    totalNotional: number;
    totalRiskUsd: number;
    avgLeverage: number | null;
    longCount: number;
    shortCount: number;
    maxDrawdownProxy: number;
  };
}

export interface OpenPositionInput {
  userId?: string;
  symbol: string;
  direction: TradeDirection;
  entry: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  leverage?: number;
  sizeUnits?: number;
  notionalUsd?: number;
  note?: string | null;
  emotion?: TradeEmotion | null;
  confidence?: number | null;
  timeframe?: string;
  /** Also write journal OPEN entry */
  addToJournal?: boolean;
}

const memPositions = new Map<string, OpenPosition>();
let tablesReady = false;

async function ensurePositionsTable() {
  if (tablesReady) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS forex_positions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar(64) NOT NULL DEFAULT 'anonymous',
        symbol varchar(20) NOT NULL,
        direction varchar(8) NOT NULL,
        entry double precision NOT NULL,
        stop_loss double precision,
        take_profit double precision,
        leverage double precision NOT NULL DEFAULT 10,
        size_units double precision NOT NULL DEFAULT 1,
        notional_usd double precision NOT NULL DEFAULT 1000,
        journal_id uuid,
        note text,
        opened_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS forex_positions_user_idx ON forex_positions(user_id);
      CREATE INDEX IF NOT EXISTS forex_positions_symbol_idx ON forex_positions(symbol);
    `);
    tablesReady = true;
  } catch {
    /* mem */
  }
}

function mtm(
  direction: TradeDirection,
  entry: number,
  current: number,
  notionalUsd: number,
  leverage: number,
): { pnl: number; pct: number } {
  const pct =
    direction === "BUY"
      ? (current - entry) / entry
      : (entry - current) / entry;
  return {
    pct: Number((pct * 100).toFixed(3)),
    pnl: Number((notionalUsd * leverage * pct).toFixed(2)),
  };
}

function riskUsd(
  direction: TradeDirection,
  entry: number,
  stopLoss: number | null,
  notionalUsd: number,
  leverage: number,
): number | null {
  if (stopLoss == null) return null;
  const pct = Math.abs(entry - stopLoss) / entry;
  return Number((notionalUsd * leverage * pct).toFixed(2));
}

export async function openPosition(input: OpenPositionInput): Promise<OpenPosition> {
  await ensurePositionsTable();
  const userId = input.userId ?? "anonymous";
  let journalId: string | null = null;

  if (input.addToJournal !== false) {
    try {
      const j = await createJournalEntry({
        userId,
        symbol: input.symbol,
        direction: input.direction,
        timeframe: input.timeframe ?? "1h",
        entry: input.entry,
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit,
        leverage: input.leverage,
        sizeUnits: input.sizeUnits,
        confidence: input.confidence,
        emotion: input.emotion,
        note: input.note,
        result: "OPEN",
      });
      journalId = j.id;
    } catch {
      /* optional */
    }
  }

  try {
    const [row] = await db
      .insert(forexPositions)
      .values({
        userId,
        symbol: input.symbol.toUpperCase(),
        direction: input.direction,
        entry: input.entry,
        stopLoss: input.stopLoss ?? null,
        takeProfit: input.takeProfit ?? null,
        leverage: input.leverage ?? 10,
        sizeUnits: input.sizeUnits ?? 1,
        notionalUsd: input.notionalUsd ?? 1000,
        journalId,
        note: input.note ?? null,
      })
      .returning();

    const pos: OpenPosition = {
      id: row.id,
      userId: row.userId,
      symbol: row.symbol,
      direction: row.direction as TradeDirection,
      entry: row.entry,
      stopLoss: row.stopLoss ?? null,
      takeProfit: row.takeProfit ?? null,
      leverage: row.leverage,
      sizeUnits: row.sizeUnits,
      notionalUsd: row.notionalUsd,
      journalId: row.journalId ?? null,
      note: row.note ?? null,
      openedAt: new Date(row.openedAt).toISOString(),
      currentPrice: null,
      unrealizedPnl: null,
      unrealizedPnlPct: null,
      riskUsd: riskUsd(
        row.direction as TradeDirection,
        row.entry,
        row.stopLoss ?? null,
        row.notionalUsd,
        row.leverage,
      ),
    };
    memPositions.set(pos.id, pos);
    return pos;
  } catch {
    const id = crypto.randomUUID();
    const pos: OpenPosition = {
      id,
      userId,
      symbol: input.symbol.toUpperCase(),
      direction: input.direction,
      entry: input.entry,
      stopLoss: input.stopLoss ?? null,
      takeProfit: input.takeProfit ?? null,
      leverage: input.leverage ?? 10,
      sizeUnits: input.sizeUnits ?? 1,
      notionalUsd: input.notionalUsd ?? 1000,
      journalId,
      note: input.note ?? null,
      openedAt: new Date().toISOString(),
      currentPrice: null,
      unrealizedPnl: null,
      unrealizedPnlPct: null,
      riskUsd: riskUsd(
        input.direction,
        input.entry,
        input.stopLoss ?? null,
        input.notionalUsd ?? 1000,
        input.leverage ?? 10,
      ),
    };
    memPositions.set(id, pos);
    return pos;
  }
}

export async function closePosition(
  id: string,
  exitPrice?: number,
): Promise<OpenPosition | null> {
  await ensurePositionsTable();
  let pos = memPositions.get(id) ?? null;

  try {
    const [row] = await db
      .select()
      .from(forexPositions)
      .where(eq(forexPositions.id, id))
      .limit(1);
    if (row) {
      pos = {
        id: row.id,
        userId: row.userId,
        symbol: row.symbol,
        direction: row.direction as TradeDirection,
        entry: row.entry,
        stopLoss: row.stopLoss ?? null,
        takeProfit: row.takeProfit ?? null,
        leverage: row.leverage,
        sizeUnits: row.sizeUnits,
        notionalUsd: row.notionalUsd,
        journalId: row.journalId ?? null,
        note: row.note ?? null,
        openedAt: new Date(row.openedAt).toISOString(),
        currentPrice: exitPrice ?? null,
        unrealizedPnl: null,
        unrealizedPnlPct: null,
        riskUsd: null,
      };
      await db.delete(forexPositions).where(eq(forexPositions.id, id));
    }
  } catch {
    /* mem */
  }

  if (!pos) return null;

  const px =
    exitPrice ??
    (await getLiveQuoteContract(pos.symbol).catch(() => null))?.price ??
    pos.entry;
  const { pnl } = mtm(pos.direction, pos.entry, px, pos.notionalUsd, pos.leverage);

  if (pos.journalId) {
    try {
      const { updateJournalEntry } = await import("./journal");
      await updateJournalEntry(pos.journalId, {
        exitPrice: px,
        pnlUsd: pnl,
      });
    } catch {
      /* */
    }
  }

  memPositions.delete(id);
  return { ...pos, currentPrice: px, unrealizedPnl: pnl };
}

export async function listOpenPositions(userId?: string): Promise<OpenPosition[]> {
  await ensurePositionsTable();
  let list: OpenPosition[] = [];

  try {
    const rows = await db
      .select()
      .from(forexPositions)
      .where(userId ? eq(forexPositions.userId, userId) : undefined)
      .orderBy(desc(forexPositions.openedAt))
      .limit(100);

    list = rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      symbol: row.symbol,
      direction: row.direction as TradeDirection,
      entry: row.entry,
      stopLoss: row.stopLoss ?? null,
      takeProfit: row.takeProfit ?? null,
      leverage: row.leverage,
      sizeUnits: row.sizeUnits,
      notionalUsd: row.notionalUsd,
      journalId: row.journalId ?? null,
      note: row.note ?? null,
      openedAt: new Date(row.openedAt).toISOString(),
      currentPrice: null,
      unrealizedPnl: null,
      unrealizedPnlPct: null,
      riskUsd: riskUsd(
        row.direction as TradeDirection,
        row.entry,
        row.stopLoss ?? null,
        row.notionalUsd,
        row.leverage,
      ),
    }));
  } catch {
    list = [...memPositions.values()].filter(
      (p) => !userId || p.userId === userId,
    );
  }

  // Mark to market
  await Promise.all(
    list.map(async (p) => {
      const q = await getLiveQuoteContract(p.symbol).catch(() => null);
      if (q) {
        const m = mtm(p.direction, p.entry, q.price, p.notionalUsd, p.leverage);
        p.currentPrice = q.price;
        p.unrealizedPnl = m.pnl;
        p.unrealizedPnlPct = m.pct;
      }
      memPositions.set(p.id, p);
    }),
  );

  return list;
}

export async function getPortfolioSnapshot(userId?: string): Promise<PortfolioSnapshot> {
  const positions = await listOpenPositions(userId);
  const totalUnrealizedPnl = positions.reduce(
    (s, p) => s + (p.unrealizedPnl ?? 0),
    0,
  );
  const totalNotional = positions.reduce((s, p) => s + p.notionalUsd, 0);
  const totalRiskUsd = positions.reduce((s, p) => s + (p.riskUsd ?? 0), 0);
  const lev = positions.map((p) => p.leverage);
  const avgLeverage = lev.length
    ? Number((lev.reduce((a, b) => a + b, 0) / lev.length).toFixed(1))
    : null;

  // Proxy drawdown: worst single position unrealized %
  const worst = positions.reduce(
    (w, p) => Math.min(w, p.unrealizedPnlPct ?? 0),
    0,
  );

  return {
    asOf: new Date().toISOString(),
    positions,
    metrics: {
      openCount: positions.length,
      totalUnrealizedPnl: Number(totalUnrealizedPnl.toFixed(2)),
      totalNotional: Number(totalNotional.toFixed(2)),
      totalRiskUsd: Number(totalRiskUsd.toFixed(2)),
      avgLeverage,
      longCount: positions.filter((p) => p.direction === "BUY").length,
      shortCount: positions.filter((p) => p.direction === "SELL").length,
      maxDrawdownProxy: Number(worst.toFixed(2)),
    },
  };
}
