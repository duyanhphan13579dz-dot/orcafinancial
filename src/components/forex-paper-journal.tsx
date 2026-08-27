"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { ForexScalpingCandidateView } from "./forex-scalping-panel";
import ForexVisualReplay, { type VisualReplayData } from "./forex-visual-replay";

type Entry = { id: string; symbol: string; strategy: string; direction: "BUY" | "SELL"; outcome: string; score: number; entry: number; stopLoss: number; takeProfit: number; stopDistancePips: number; riskReward: number; lotSize: number; capturedAt: string; resolvedAt: string | null; note: string | null };
type Stats = { periodDays: number; totalSetups: number; openSetups: number; resolvedSetups: number; wins: number; losses: number; breakeven: number; winRate: number | null; avgScore: number | null; byStrategy: Array<{ name: string; setups: number; resolved: number; wins: number; losses: number; winRate: number | null; avgScore: number }> };
type Replay = VisualReplayData & { setup: Entry | null };

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
    } catch (error) { setMessage(error instanceof Error ? error.message : "Không thể tải nhật ký"); } finally { setLoading(false); }
  }, [symbol]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const saveCandidate = async () => {
    if (!candidate) return;
    try { await api(`/forex/scalping-journal`, { method: "POST", body: JSON.stringify({ candidate }) }); setMessage("Đã lưu vào nhật ký mô phỏng"); onSaved?.(); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Không thể lưu thiết lập"); }
  };
  const resolve = async (id: string, outcome: string) => { try { await api(`/forex/scalping-journal/${id}`, { method: "PATCH", body: JSON.stringify({ outcome }) }); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Không thể cập nhật thiết lập"); } };
  const openReplay = async (id: string) => { try { const response = await api<Replay>(`/forex/${encodeURIComponent(symbol)}/scalping/replay?setupId=${encodeURIComponent(id)}&timeframe=5m&limit=80`); setReplay(response.data); } catch (error) { setMessage(error instanceof Error ? error.message : "Không thể tải phát lại"); } };

  return <section className="panel space-y-3 p-3 sm:p-4" aria-label="Nhật ký mô phỏng và phát lại forex">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold text-white">Nhật ký mô phỏng · Phát lại · Thống kê</h2><p className="text-[10px] text-slate-500">Lịch sử phân tích {symbol}; không có lệnh thật</p></div>{candidate && <button type="button" onClick={() => void saveCandidate()} className="min-h-9 rounded border border-[#00d4ff]/40 px-3 text-[10px] text-[#00d4ff]">Lưu thiết lập hiện tại</button>}</div>
    {message && <div className="rounded border border-slate-700 bg-slate-900/40 p-2 text-[10px] text-slate-300">{message}</div>}
    {stats && <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">{[["Thiết lập", stats.totalSetups], ["Đang mở", stats.openSetups], ["Đã xử lý", stats.resolvedSetups], ["Thắng", stats.wins], ["Thua", stats.losses], ["Tỷ lệ thắng", stats.winRate == null ? "—" : `${stats.winRate}%`]].map(([label, value]) => <div key={String(label)} className="rounded border border-slate-800 p-2"><div className="text-[10px] text-slate-500">{label}</div><div className="mt-1 text-sm font-semibold text-white">{value}</div></div>)}</div>}
    {stats?.byStrategy?.length ? <div className="flex flex-wrap gap-2">{stats.byStrategy.map((row) => <div key={row.name} className="rounded border border-slate-800 px-2 py-1 text-[10px] text-slate-400"><span className="font-semibold text-white">{row.name}</span> · {row.setups} thiết lập · TB {row.avgScore} · thắng {row.winRate == null ? "—" : `${row.winRate}%`}</div>)}</div> : null}
    {loading ? <div className="h-16 animate-pulse rounded bg-slate-800/40" /> : entries.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[10px]"><thead className="border-b border-slate-800 text-slate-500"><tr><th className="px-2 py-2">Thời điểm</th><th className="px-2 py-2">Chiến lược</th><th className="px-2 py-2">Kế hoạch</th><th className="px-2 py-2">Điểm</th><th className="px-2 py-2">Kết quả</th><th className="px-2 py-2">Công cụ</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id} className="border-b border-slate-900"><td className="px-2 py-2 text-slate-400">{new Date(entry.capturedAt).toLocaleString()}</td><td className="px-2 py-2 text-white">{entry.strategy} · {entry.direction}</td><td className="px-2 py-2 text-slate-400">{fmt(entry.entry)} → {fmt(entry.takeProfit)} · {fmt(entry.stopDistancePips, 1)}p</td><td className="px-2 py-2 text-white">{entry.score}</td><td className="px-2 py-2"><select value={entry.outcome} onChange={(event) => void resolve(entry.id, event.target.value)} className="rounded border border-slate-700 bg-slate-900 px-1 py-1 text-[10px] text-slate-200"><option>OPEN</option><option>WIN</option><option>LOSS</option><option>BREAKEVEN</option><option>INVALIDATED</option></select></td><td className="px-2 py-2"><button type="button" onClick={() => void openReplay(entry.id)} className="rounded border border-[#00d4ff]/40 px-2 py-1 text-[#00d4ff]">Phát lại</button></td></tr>)}</tbody></table></div> : <div className="rounded border border-slate-800 p-3 text-xs text-slate-500">Chưa có thiết lập mô phỏng nào được ghi nhận cho cặp này.</div>}
    {replay && <ForexVisualReplay data={replay} onClose={() => setReplay(null)} />}
  </section>;
}
