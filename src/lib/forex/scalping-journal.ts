import { pool } from "@/db";
import type { ForexScalpingCandidate, ForexScalpingResult } from "./scalping";

export type PaperSetupOutcome = "OPEN" | "WIN" | "LOSS" | "BREAKEVEN" | "INVALIDATED";

export interface PaperSetupEntry {
  id: string;
  userId: string;
  symbol: string;
  strategy: string;
  direction: "BUY" | "SELL";
  state: string;
  outcome: PaperSetupOutcome;
  score: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  stopDistancePips: number;
  riskReward: number;
  lotSize: number;
  reasons: string[];
  blockers: string[];
  snapshot: ForexScalpingCandidate;
  capturedAt: string;
  resolvedAt: string | null;
  note: string | null;
}

export interface CreatePaperSetupInput {
  userId?: string;
  candidate: ForexScalpingCandidate;
  note?: string | null;
}

const memory = new Map<string, PaperSetupEntry>();
let tableReady = false;

async function ensureTable() {
  if (tableReady) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS forex_scalping_setups (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar(64) NOT NULL DEFAULT 'anonymous',
        symbol varchar(20) NOT NULL,
        strategy varchar(32) NOT NULL,
        direction varchar(8) NOT NULL,
        state varchar(32) NOT NULL,
        outcome varchar(20) NOT NULL DEFAULT 'OPEN',
        score double precision NOT NULL,
        entry double precision NOT NULL,
        stop_loss double precision NOT NULL,
        take_profit double precision NOT NULL,
        stop_distance_pips double precision NOT NULL,
        risk_reward double precision NOT NULL,
        lot_size double precision NOT NULL DEFAULT 0,
        reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
        blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
        snapshot jsonb NOT NULL,
        captured_at timestamptz NOT NULL DEFAULT now(),
        resolved_at timestamptz,
        note text
      );
      CREATE INDEX IF NOT EXISTS forex_scalping_setups_symbol_idx ON forex_scalping_setups(symbol);
      CREATE INDEX IF NOT EXISTS forex_scalping_setups_strategy_idx ON forex_scalping_setups(strategy);
      CREATE INDEX IF NOT EXISTS forex_scalping_setups_captured_idx ON forex_scalping_setups(captured_at);
    `);
    tableReady = true;
  } catch {
    // Development and paper environments can operate from memory.
  }
}

function fromRow(row: Record<string, unknown>): PaperSetupEntry {
  return {
    id: String(row.id), userId: String(row.user_id ?? "anonymous"), symbol: String(row.symbol), strategy: String(row.strategy), direction: String(row.direction) as "BUY" | "SELL", state: String(row.state), outcome: String(row.outcome ?? "OPEN") as PaperSetupOutcome, score: Number(row.score), entry: Number(row.entry), stopLoss: Number(row.stop_loss), takeProfit: Number(row.take_profit), stopDistancePips: Number(row.stop_distance_pips), riskReward: Number(row.risk_reward), lotSize: Number(row.lot_size), reasons: Array.isArray(row.reasons) ? row.reasons as string[] : [], blockers: Array.isArray(row.blockers) ? row.blockers as string[] : [], snapshot: row.snapshot as ForexScalpingCandidate, capturedAt: new Date(String(row.captured_at)).toISOString(), resolvedAt: row.resolved_at ? new Date(String(row.resolved_at)).toISOString() : null, note: row.note ? String(row.note) : null,
  };
}

function fromCandidate(candidate: ForexScalpingCandidate, userId: string, note?: string | null): PaperSetupEntry {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), userId, symbol: candidate.symbol, strategy: candidate.strategy, direction: candidate.direction, state: candidate.state, outcome: "OPEN", score: candidate.score, entry: candidate.entry, stopLoss: candidate.stopLoss, takeProfit: candidate.takeProfit, stopDistancePips: candidate.stopDistancePips, riskReward: candidate.riskRewardAfterCosts, lotSize: candidate.risk.lotSize, reasons: candidate.reasons, blockers: candidate.hardBlocks, snapshot: candidate, capturedAt: now, resolvedAt: null, note: note ?? null };
}

export async function createPaperSetup(input: CreatePaperSetupInput): Promise<PaperSetupEntry> {
  await ensureTable();
  const entry = fromCandidate(input.candidate, input.userId ?? "anonymous", input.note);
  try {
    await pool.query(`INSERT INTO forex_scalping_setups (id,user_id,symbol,strategy,direction,state,outcome,score,entry,stop_loss,take_profit,stop_distance_pips,risk_reward,lot_size,reasons,blockers,snapshot,captured_at,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18,$19)`, [entry.id, entry.userId, entry.symbol, entry.strategy, entry.direction, entry.state, entry.outcome, entry.score, entry.entry, entry.stopLoss, entry.takeProfit, entry.stopDistancePips, entry.riskReward, entry.lotSize, JSON.stringify(entry.reasons), JSON.stringify(entry.blockers), JSON.stringify(entry.snapshot), entry.capturedAt, entry.note]);
  } catch {
    memory.set(entry.id, entry);
    return entry;
  }
  memory.set(entry.id, entry);
  return entry;
}

export async function listPaperSetups(opts: { userId?: string; symbol?: string; outcome?: PaperSetupOutcome; strategy?: string; limit?: number } = {}): Promise<PaperSetupEntry[]> {
  await ensureTable();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  try {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => { params.push(value); clauses.push(`${sql} $${params.length}`); };
    if (opts.userId) add("user_id =", opts.userId);
    if (opts.symbol) add("symbol =", opts.symbol.toUpperCase());
    if (opts.outcome) add("outcome =", opts.outcome);
    if (opts.strategy) add("strategy =", opts.strategy);
    params.push(limit);
    const result = await pool.query(`SELECT * FROM forex_scalping_setups ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY captured_at DESC LIMIT $${params.length}`, params);
    const rows = result.rows.map(fromRow);
    rows.forEach((row) => memory.set(row.id, row));
    return rows;
  } catch {
    let rows = [...memory.values()];
    if (opts.userId) rows = rows.filter((row) => row.userId === opts.userId);
    if (opts.symbol) rows = rows.filter((row) => row.symbol === opts.symbol!.toUpperCase());
    if (opts.outcome) rows = rows.filter((row) => row.outcome === opts.outcome);
    if (opts.strategy) rows = rows.filter((row) => row.strategy === opts.strategy);
    return rows.sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt)).slice(0, limit);
  }
}

export async function updatePaperSetup(id: string, patch: { outcome?: PaperSetupOutcome; note?: string | null }): Promise<PaperSetupEntry | null> {
  await ensureTable();
  const current = memory.get(id) ?? (await listPaperSetups({ limit: 500 })).find((row) => row.id === id);
  if (!current) return null;
  const next: PaperSetupEntry = { ...current, outcome: patch.outcome ?? current.outcome, note: patch.note !== undefined ? patch.note : current.note, resolvedAt: patch.outcome && patch.outcome !== "OPEN" ? new Date().toISOString() : current.resolvedAt };
  try { await pool.query("UPDATE forex_scalping_setups SET outcome=$1,note=$2,resolved_at=$3 WHERE id=$4", [next.outcome, next.note, next.resolvedAt, id]); } catch { /* memory fallback */ }
  memory.set(id, next);
  return next;
}

export async function deletePaperSetup(id: string): Promise<boolean> {
  await ensureTable();
  memory.delete(id);
  try { await pool.query("DELETE FROM forex_scalping_setups WHERE id=$1", [id]); } catch { /* memory fallback */ }
  return true;
}

export async function getPaperSetupStats(opts: { userId?: string; symbol?: string; days?: number } = {}) {
  const entries = await listPaperSetups({ userId: opts.userId, symbol: opts.symbol, limit: 500 });
  const since = Date.now() - (opts.days ?? 30) * 86_400_000;
  const filtered = entries.filter((entry) => Date.parse(entry.capturedAt) >= since);
  const resolved = filtered.filter((entry) => entry.outcome === "WIN" || entry.outcome === "LOSS" || entry.outcome === "BREAKEVEN");
  const wins = resolved.filter((entry) => entry.outcome === "WIN").length;
  const losses = resolved.filter((entry) => entry.outcome === "LOSS").length;
  const breakeven = resolved.filter((entry) => entry.outcome === "BREAKEVEN").length;
  const by = (key: "strategy" | "symbol") => Object.entries(filtered.reduce<Record<string, { setups: number; resolved: number; wins: number; losses: number; avgScore: number }>>((acc, entry) => { const k = entry[key]; const item = acc[k] ?? { setups: 0, resolved: 0, wins: 0, losses: 0, avgScore: 0 }; item.setups += 1; item.avgScore += entry.score; if (entry.outcome !== "OPEN" && entry.outcome !== "INVALIDATED") item.resolved += 1; if (entry.outcome === "WIN") item.wins += 1; if (entry.outcome === "LOSS") item.losses += 1; acc[k] = item; return acc; }, {})).map(([name, value]) => ({ name, setups: value.setups, resolved: value.resolved, wins: value.wins, losses: value.losses, winRate: value.resolved ? Number((value.wins / value.resolved * 100).toFixed(1)) : null, avgScore: Number((value.avgScore / value.setups).toFixed(1)) }));
  return { periodDays: opts.days ?? 30, totalSetups: filtered.length, openSetups: filtered.filter((entry) => entry.outcome === "OPEN").length, resolvedSetups: resolved.length, wins, losses, breakeven, winRate: resolved.length ? Number((wins / resolved.length * 100).toFixed(1)) : null, avgScore: filtered.length ? Number((filtered.reduce((sum, entry) => sum + entry.score, 0) / filtered.length).toFixed(1)) : null, byStrategy: by("strategy"), bySymbol: by("symbol"), generatedAt: new Date().toISOString(), paperOnly: true as const };
}

export async function createSetupFromResult(result: ForexScalpingResult, userId?: string) { return result.bestCandidate ? createPaperSetup({ userId, candidate: result.bestCandidate }) : null; }
