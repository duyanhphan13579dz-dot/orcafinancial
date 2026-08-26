"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { ForexScalpingCandidateView } from "./forex-scalping-panel";

type Entry = { id: string; symbol: string; strategy: string; direction: "BUY" | "SELL"; outcome: string; score: number; entry: number; stopLoss: number; takeProfit: number; stopDistancePips: number; riskReward: number; lotSize: number; capturedAt: string; resolvedAt: string | null; note: string | null };
type Stats = { periodDays: number; totalSetups: number; openSetups: number; resolvedSetups: number; wins: number; losses: number; breakeven: number; winRate: number | null; avgScore: number | null; byStrategy: Array<{ name: string; setups: number; resolved: number; wins: number; losses: number; winRate: number | null; avgScore: number }> };
type Replay = { replayAt: string; timeframe: string; bars: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>; setup: Entry | null };

type Props = { symbol: string; candidate?: ForexScalpingCandidateView | null; onSaved?: () => void };
function fmt(n: number | null | undefined, digits = 5) { return n == null || !Number.isFinite(n) ? "—" : n.toFixed(digits); }

export default function ForexPaperJournal({ symbol, candidate, onSaved }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [journal, summary] = await Promise.all([api<{ entries: Entry[] }>(`/forex/scalping-journal?symbol=${encodeURIComponent(symbol)}&limit=20`), api<Stats>(`/forex/scalping-stats?symbol=${encodeURIComponent(symbol)}&days=30`)]);
      setEntries(journal.data.entries ?? []); setStats(summary.data); setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Journal unavailable"); } finally { setLoading(false); }
  }, [symbol]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const saveCandidate = async () => {
    if (!candidate) return;
    try { await api(`/forex/scalping-journal`, { method: "POST", body: JSON.stringify({ candidate }) }); setMessage("Setup saved to paper journal"); onSaved?.(); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save setup"); }
  };
  const resolve = async (id: string, outcome: string) => { try { await api(`/forex/scalping-journal/${id}`, { method: "PATCH", body: JSON.stringify({ outcome }) }); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update setup"); } };
  const openReplay = async (id: string) => { try { const response = await api<Replay>(`/forex/${encodeURIComponent(symbol)}/scalping/replay?setupId=${encodeURIComponent(id)}&timeframe=5m&limit=80`); setReplay(response.data); } catch (error) { setMessage(error instanceof Error ? error.message : "Replay unavailable"); } };

  return <section className="panel space-y-3 p-3 sm:p-4" aria-label="Forex paper journal and replay">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold text-white">Paper Journal · Replay · Stats</h2><p className="text-[10px] text-slate-500">Research history for {symbol}; no live orders</p></div>{candidate && <button type="button" onClick={() => void saveCandidate()} className="min-h-9 rounded border border-[#00d4ff]/40 px-3 text-[10px] text-[#00d4ff]">Save current setup</button>}</div>
    {message && <div className="rounded border border-slate-700 bg-slate-900/40 p-2 text-[10px] text-slate-300">{message}</div>}
    {stats && <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">{[["Setups", stats.totalSetups], ["Open", stats.openSetups], ["Resolved", stats.resolvedSetups], ["Wins", stats.wins], ["Losses", stats.losses], ["Win rate", stats.winRate == null ? "—" : `${stats.winRate}%`]].map(([label, value]) => <div key={String(label)} className="rounded border border-slate-800 p-2"><div className="text-[10px] text-slate-500">{label}</div><div className="mt-1 text-sm font-semibold text-white">{value}</div></div>)}</div>}
    {stats?.byStrategy?.length ? <div className="flex flex-wrap gap-2">{stats.byStrategy.map((row) => <div key={row.name} className="rounded border border-slate-800 px-2 py-1 text-[10px] text-slate-400"><span className="font-semibold text-white">{row.name}</span> · {row.setups} setups · avg {row.avgScore} · win {row.winRate == null ? "—" : `${row.winRate}%`}</div>)}</div> : null}
    {loading ? <div className="h-16 animate-pulse rounded bg-slate-800/40" /> : entries.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[10px]"><thead className="border-b border-slate-800 text-slate-500"><tr><th className="px-2 py-2">Captured</th><th className="px-2 py-2">Strategy</th><th className="px-2 py-2">Plan</th><th className="px-2 py-2">Score</th><th className="px-2 py-2">Outcome</th><th className="px-2 py-2">Tools</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id} className="border-b border-slate-900"><td className="px-2 py-2 text-slate-400">{new Date(entry.capturedAt).toLocaleString()}</td><td className="px-2 py-2 text-white">{entry.strategy} · {entry.direction}</td><td className="px-2 py-2 text-slate-400">{fmt(entry.entry)} → {fmt(entry.takeProfit)} · {fmt(entry.stopDistancePips, 1)}p</td><td className="px-2 py-2 text-white">{entry.score}</td><td className="px-2 py-2"><select value={entry.outcome} onChange={(event) => void resolve(entry.id, event.target.value)} className="rounded border border-slate-700 bg-slate-900 px-1 py-1 text-[10px] text-slate-200"><option>OPEN</option><option>WIN</option><option>LOSS</option><option>BREAKEVEN</option><option>INVALIDATED</option></select></td><td className="px-2 py-2"><button type="button" onClick={() => void openReplay(entry.id)} className="rounded border border-[#00d4ff]/40 px-2 py-1 text-[#00d4ff]">Replay</button></td></tr>)}</tbody></table></div> : <div className="rounded border border-slate-800 p-3 text-xs text-slate-500">No paper setups recorded for this pair yet.</div>}
    {replay && <div className="rounded border border-[#00d4ff]/30 bg-[#00d4ff]/5 p-3 text-xs"><div className="flex items-center justify-between"><div className="font-semibold text-white">Replay · {replay.timeframe} · {new Date(replay.replayAt).toLocaleString()}</div><button type="button" onClick={() => setReplay(null)} className="text-slate-500">Close</button></div><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5"><div>Entry <b>{fmt(replay.setup?.entry)}</b></div><div>SL <b className="text-rose-300">{fmt(replay.setup?.stopLoss)}</b></div><div>TP <b className="text-emerald-300">{fmt(replay.setup?.takeProfit)}</b></div><div>Bars <b>{replay.bars.length}</b></div><div>Source <b>Biquote</b></div></div><div className="mt-2 max-h-40 overflow-auto"><table className="w-full text-[10px]"><thead className="text-slate-500"><tr><th className="text-left">Time</th><th className="text-right">O</th><th className="text-right">H</th><th className="text-right">L</th><th className="text-right">C</th></tr></thead><tbody>{replay.bars.slice(-12).map((bar) => <tr key={bar.time}><td>{new Date(bar.time * 1000).toLocaleTimeString()}</td><td className="text-right">{fmt(bar.open)}</td><td className="text-right">{fmt(bar.high)}</td><td className="text-right">{fmt(bar.low)}</td><td className="text-right">{fmt(bar.close)}</td></tr>)}</tbody></table></div></div>}
  </section>;
}
