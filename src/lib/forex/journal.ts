/**
 * Phase 13 — Trade Journal
 * Persist + query trade logs. Falls back to in-memory if DB unavailable.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { forexJournal } from "./schema";

export type TradeDirection = "BUY" | "SELL";
export type TradeResult = "WIN" | "LOSS" | "BREAKEVEN" | "OPEN";
export type TradeEmotion =
  | "confident"
  | "neutral"
  | "fear"
  | "fomo"
  | "revenge"
  | "greed";

export interface JournalEntry {
  id: string;
  userId: string;
  symbol: string;
  direction: TradeDirection;
  timeframe: string;
  entry: number;
  stopLoss: number | null;
  takeProfit: number | null;
  exitPrice: number | null;
  leverage: number;
  sizeUnits: number;
  confidence: number | null;
  emotion: TradeEmotion | null;
  note: string | null;
  result: TradeResult;
  pnlUsd: number | null;
  rMultiple: number | null;
  setupQuality: string | null;
  tags: string[] | null;
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateJournalInput {
  userId?: string;
  symbol: string;
  direction: TradeDirection;
  timeframe?: string;
  entry: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  exitPrice?: number | null;
  leverage?: number;
  sizeUnits?: number;
  confidence?: number | null;
  emotion?: TradeEmotion | null;
  note?: string | null;
  result?: TradeResult;
  pnlUsd?: number | null;
  setupQuality?: string | null;
  tags?: string[] | null;
}

const memStore = new Map<string, JournalEntry>();
let tablesReady = false;

async function ensureJournalTable() {
  if (tablesReady) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS forex_journal (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar(64) NOT NULL DEFAULT 'anonymous',
        symbol varchar(20) NOT NULL,
        direction varchar(8) NOT NULL,
        timeframe varchar(8) NOT NULL DEFAULT '1h',
        entry double precision NOT NULL,
        stop_loss double precision,
        take_profit double precision,
        exit_price double precision,
        leverage double precision NOT NULL DEFAULT 10,
        size_units double precision NOT NULL DEFAULT 1,
        confidence double precision,
        emotion varchar(20),
        note text,
        result varchar(16),
        pnl_usd double precision,
        r_multiple double precision,
        setup_quality varchar(4),
        tags jsonb,
        opened_at timestamptz NOT NULL DEFAULT now(),
        closed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS forex_journal_user_idx ON forex_journal(user_id);
      CREATE INDEX IF NOT EXISTS forex_journal_symbol_idx ON forex_journal(symbol);
      CREATE INDEX IF NOT EXISTS forex_journal_result_idx ON forex_journal(result);
    `);
    tablesReady = true;
  } catch {
    // DB may be down — mem fallback
  }
}

function computeRMultiple(input: {
  direction: TradeDirection;
  entry: number;
  stopLoss: number | null;
  exitPrice: number | null;
}): number | null {
  const { direction, entry, stopLoss, exitPrice } = input;
  if (stopLoss == null || exitPrice == null) return null;
  const risk = Math.abs(entry - stopLoss);
  if (risk < 1e-12) return null;
  const move =
    direction === "BUY" ? exitPrice - entry : entry - exitPrice;
  return Number((move / risk).toFixed(3));
}

function computePnlUsd(input: {
  direction: TradeDirection;
  entry: number;
  exitPrice: number | null;
  sizeUnits: number;
  leverage: number;
  notionalBase?: number;
}): number | null {
  if (input.exitPrice == null) return null;
  const pct =
    input.direction === "BUY"
      ? (input.exitPrice - input.entry) / input.entry
      : (input.entry - input.exitPrice) / input.entry;
  // Approximate: sizeUnits * $1000 notion per unit * leverage * pct
  const notion = (input.notionalBase ?? 1000) * input.sizeUnits;
  return Number((notion * input.leverage * pct).toFixed(2));
}

function rowToEntry(r: typeof forexJournal.$inferSelect): JournalEntry {
  return {
    id: r.id,
    userId: r.userId,
    symbol: r.symbol,
    direction: r.direction as TradeDirection,
    timeframe: r.timeframe,
    entry: r.entry,
    stopLoss: r.stopLoss ?? null,
    takeProfit: r.takeProfit ?? null,
    exitPrice: r.exitPrice ?? null,
    leverage: r.leverage,
    sizeUnits: r.sizeUnits,
    confidence: r.confidence ?? null,
    emotion: (r.emotion as TradeEmotion) ?? null,
    note: r.note ?? null,
    result: (r.result as TradeResult) ?? "OPEN",
    pnlUsd: r.pnlUsd ?? null,
    rMultiple: r.rMultiple ?? null,
    setupQuality: r.setupQuality ?? null,
    tags: r.tags ?? null,
    openedAt: new Date(r.openedAt).toISOString(),
    closedAt: r.closedAt ? new Date(r.closedAt).toISOString() : null,
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
  };
}

export async function createJournalEntry(
  input: CreateJournalInput,
): Promise<JournalEntry> {
  await ensureJournalTable();
  const userId = input.userId ?? "anonymous";
  const result = input.result ?? (input.exitPrice != null ? "OPEN" : "OPEN");
  const rMultiple = computeRMultiple({
    direction: input.direction,
    entry: input.entry,
    stopLoss: input.stopLoss ?? null,
    exitPrice: input.exitPrice ?? null,
  });
  let pnlUsd = input.pnlUsd ?? null;
  if (pnlUsd == null && input.exitPrice != null) {
    pnlUsd = computePnlUsd({
      direction: input.direction,
      entry: input.entry,
      exitPrice: input.exitPrice,
      sizeUnits: input.sizeUnits ?? 1,
      leverage: input.leverage ?? 10,
    });
  }

  // Auto-result from R if closed
  let finalResult: TradeResult = result;
  if (input.exitPrice != null && (result === "OPEN" || !input.result)) {
    if (rMultiple != null) {
      if (rMultiple > 0.05) finalResult = "WIN";
      else if (rMultiple < -0.05) finalResult = "LOSS";
      else finalResult = "BREAKEVEN";
    }
  }

  try {
    const [row] = await db
      .insert(forexJournal)
      .values({
        userId,
        symbol: input.symbol.toUpperCase(),
        direction: input.direction,
        timeframe: input.timeframe ?? "1h",
        entry: input.entry,
        stopLoss: input.stopLoss ?? null,
        takeProfit: input.takeProfit ?? null,
        exitPrice: input.exitPrice ?? null,
        leverage: input.leverage ?? 10,
        sizeUnits: input.sizeUnits ?? 1,
        confidence: input.confidence ?? null,
        emotion: input.emotion ?? null,
        note: input.note ?? null,
        result: finalResult,
        pnlUsd,
        rMultiple,
        setupQuality: input.setupQuality ?? null,
        tags: input.tags ?? null,
        closedAt: input.exitPrice != null ? new Date() : null,
      })
      .returning();
    const entry = rowToEntry(row);
    memStore.set(entry.id, entry);
    return entry;
  } catch {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const entry: JournalEntry = {
      id,
      userId,
      symbol: input.symbol.toUpperCase(),
      direction: input.direction,
      timeframe: input.timeframe ?? "1h",
      entry: input.entry,
      stopLoss: input.stopLoss ?? null,
      takeProfit: input.takeProfit ?? null,
      exitPrice: input.exitPrice ?? null,
      leverage: input.leverage ?? 10,
      sizeUnits: input.sizeUnits ?? 1,
      confidence: input.confidence ?? null,
      emotion: input.emotion ?? null,
      note: input.note ?? null,
      result: finalResult,
      pnlUsd,
      rMultiple,
      setupQuality: input.setupQuality ?? null,
      tags: input.tags ?? null,
      openedAt: now,
      closedAt: input.exitPrice != null ? now : null,
      createdAt: now,
      updatedAt: now,
    };
    memStore.set(id, entry);
    return entry;
  }
}

export async function updateJournalEntry(
  id: string,
  patch: Partial<CreateJournalInput> & { result?: TradeResult },
): Promise<JournalEntry | null> {
  await ensureJournalTable();

  const existingMem = memStore.get(id);

  try {
    const [cur] = await db
      .select()
      .from(forexJournal)
      .where(eq(forexJournal.id, id))
      .limit(1);
    if (!cur && !existingMem) return null;

    const base = cur ? rowToEntry(cur) : existingMem!;
    const direction = (patch.direction ?? base.direction) as TradeDirection;
    const entry = patch.entry ?? base.entry;
    const stopLoss = patch.stopLoss !== undefined ? patch.stopLoss : base.stopLoss;
    const exitPrice =
      patch.exitPrice !== undefined ? patch.exitPrice : base.exitPrice;
    const rMultiple = computeRMultiple({
      direction,
      entry,
      stopLoss,
      exitPrice,
    });
    let pnlUsd =
      patch.pnlUsd !== undefined
        ? patch.pnlUsd
        : exitPrice != null
          ? computePnlUsd({
              direction,
              entry,
              exitPrice,
              sizeUnits: patch.sizeUnits ?? base.sizeUnits,
              leverage: patch.leverage ?? base.leverage,
            })
          : base.pnlUsd;

    let result = patch.result ?? base.result;
    if (exitPrice != null && (!patch.result || patch.result === "OPEN")) {
      if (rMultiple != null) {
        if (rMultiple > 0.05) result = "WIN";
        else if (rMultiple < -0.05) result = "LOSS";
        else result = "BREAKEVEN";
      }
    }

    if (cur) {
      const [row] = await db
        .update(forexJournal)
        .set({
          direction,
          entry,
          stopLoss,
          takeProfit:
            patch.takeProfit !== undefined ? patch.takeProfit : base.takeProfit,
          exitPrice,
          leverage: patch.leverage ?? base.leverage,
          sizeUnits: patch.sizeUnits ?? base.sizeUnits,
          confidence:
            patch.confidence !== undefined ? patch.confidence : base.confidence,
          emotion: patch.emotion !== undefined ? patch.emotion : base.emotion,
          note: patch.note !== undefined ? patch.note : base.note,
          result,
          pnlUsd,
          rMultiple,
          setupQuality:
            patch.setupQuality !== undefined
              ? patch.setupQuality
              : base.setupQuality,
          closedAt: exitPrice != null ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(forexJournal.id, id))
        .returning();
      const out = rowToEntry(row);
      memStore.set(id, out);
      return out;
    }
  } catch {
    /* mem path */
  }

  if (!existingMem) return null;
  const direction = (patch.direction ?? existingMem.direction) as TradeDirection;
  const entryPx = patch.entry ?? existingMem.entry;
  const stopLoss =
    patch.stopLoss !== undefined ? patch.stopLoss : existingMem.stopLoss;
  const exitPrice =
    patch.exitPrice !== undefined ? patch.exitPrice : existingMem.exitPrice;
  const rMultiple = computeRMultiple({
    direction,
    entry: entryPx,
    stopLoss,
    exitPrice,
  });
  let result = patch.result ?? existingMem.result;
  if (exitPrice != null && (!patch.result || patch.result === "OPEN")) {
    if (rMultiple != null) {
      if (rMultiple > 0.05) result = "WIN";
      else if (rMultiple < -0.05) result = "LOSS";
      else result = "BREAKEVEN";
    }
  }
  const updated: JournalEntry = {
    ...existingMem,
    direction,
    entry: entryPx,
    stopLoss,
    takeProfit:
      patch.takeProfit !== undefined ? patch.takeProfit : existingMem.takeProfit,
    exitPrice,
    leverage: patch.leverage ?? existingMem.leverage,
    sizeUnits: patch.sizeUnits ?? existingMem.sizeUnits,
    confidence:
      patch.confidence !== undefined ? patch.confidence : existingMem.confidence,
    emotion: patch.emotion !== undefined ? patch.emotion : existingMem.emotion,
    note: patch.note !== undefined ? patch.note : existingMem.note,
    result,
    pnlUsd:
      exitPrice != null
        ? computePnlUsd({
            direction,
            entry: entryPx,
            exitPrice,
            sizeUnits: patch.sizeUnits ?? existingMem.sizeUnits,
            leverage: patch.leverage ?? existingMem.leverage,
          })
        : existingMem.pnlUsd,
    rMultiple,
    closedAt: exitPrice != null ? new Date().toISOString() : existingMem.closedAt,
    updatedAt: new Date().toISOString(),
  };
  memStore.set(id, updated);
  return updated;
}

export async function listJournalEntries(opts: {
  userId?: string;
  symbol?: string;
  result?: TradeResult;
  limit?: number;
}): Promise<JournalEntry[]> {
  await ensureJournalTable();
  const limit = Math.min(opts.limit ?? 100, 500);

  try {
    const conditions = [];
    if (opts.userId) conditions.push(eq(forexJournal.userId, opts.userId));
    if (opts.symbol)
      conditions.push(eq(forexJournal.symbol, opts.symbol.toUpperCase()));
    if (opts.result) conditions.push(eq(forexJournal.result, opts.result));

    const rows = await db
      .select()
      .from(forexJournal)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(forexJournal.openedAt))
      .limit(limit);

    const list = rows.map(rowToEntry);
    for (const e of list) memStore.set(e.id, e);
    return list;
  } catch {
    let list = [...memStore.values()];
    if (opts.userId) list = list.filter((e) => e.userId === opts.userId);
    if (opts.symbol)
      list = list.filter((e) => e.symbol === opts.symbol!.toUpperCase());
    if (opts.result) list = list.filter((e) => e.result === opts.result);
    return list
      .sort(
        (a, b) =>
          new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime(),
      )
      .slice(0, limit);
  }
}

export async function deleteJournalEntry(id: string): Promise<boolean> {
  await ensureJournalTable();
  memStore.delete(id);
  try {
    await db.delete(forexJournal).where(eq(forexJournal.id, id));
    return true;
  } catch {
    return memStore.has(id) === false;
  }
}

/** All closed trades for analytics (DB + mem). */
export async function listClosedTrades(userId?: string): Promise<JournalEntry[]> {
  const all = await listJournalEntries({ userId, limit: 500 });
  return all.filter((e) => e.result === "WIN" || e.result === "LOSS" || e.result === "BREAKEVEN");
}
