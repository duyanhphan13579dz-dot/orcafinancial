"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";

type Row = {
  symbol: string;
  signal: "BUY" | "SELL" | "WAIT";
  state: string;
  blockers: string[];
  dataQuality: { score: number; ok: boolean };
  bestCandidate: { strategy: string; direction: "BUY" | "SELL"; score: number; stopDistancePips: number; riskRewardAfterCosts: number; hardBlocks: string[] } | null;
};

type Envelope = { results: Row[]; generatedAt: string; paperOnly: true; executionEnabled: false };

function signalLabel(signal: Row["signal"]): string { return signal === "BUY" ? "Mua" : signal === "SELL" ? "Bán" : "Chờ"; }
function stateLabel(state: string): string { return ({ QUALIFIED: "Đạt điều kiện", TRIGGERED: "Đã kích hoạt", HALTED: "Tạm dừng", WATCH_ONLY: "Chỉ theo dõi", DISCOVERED: "Đã phát hiện" } as Record<string, string>)[state] ?? state; }
function signalTone(signal: Row["signal"]) { return signal === "BUY" ? "text-emerald-300" : signal === "SELL" ? "text-rose-300" : "text-slate-300"; }
function stateTone(row: Row) { return row.state === "QUALIFIED" || row.state === "TRIGGERED" ? "text-emerald-300" : row.state === "HALTED" ? "text-rose-300" : "text-amber-300"; }

export default function ForexScalpingBoard() {
  const [data, setData] = useState<Envelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBlocked, setShowBlocked] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try { const response = await api<Envelope>("/forex/scalping", { timeoutMs: 18_000 }); if (active) { setData(response.data); setError(null); } }
      catch (err) { if (active) setError(err instanceof Error ? err.message : "Không tải được bảng scalping"); }
      finally { if (active) setLoading(false); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const rows = useMemo(() => (data?.results ?? []).filter((row) => showBlocked || row.state !== "HALTED"), [data, showBlocked]);
  const ready = rows.filter((row) => row.state === "QUALIFIED" || row.state === "TRIGGERED").length;
  const watch = rows.filter((row) => row.state === "WATCH_ONLY" || row.state === "DISCOVERED").length;

  return <section className="panel space-y-3 p-3 sm:p-4" aria-label="Bảng scalping forex">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="font-semibold text-white">Bảng scalping forex</h2><span className="rounded border border-amber-700/50 bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-300">CHỈ MÔ PHỎNG</span></div><p className="mt-0.5 text-[10px] text-slate-500">M15 bối cảnh · M5 xác nhận · M1 kích hoạt · ưu tiên Biquote</p></div><div className="text-right text-[10px] text-slate-500">{data?.generatedAt ? `cập nhật ${new Date(data.generatedAt).toLocaleTimeString("vi-VN")}` : loading ? "đang quét…" : "—"}</div></div>
    <div className="grid grid-cols-3 gap-2 text-[10px]"><div className="rounded border border-slate-800 p-2"><span className="text-slate-500">Cặp</span><div className="mt-1 text-sm font-semibold text-white">{rows.length}</div></div><div className="rounded border border-emerald-900/40 bg-emerald-500/5 p-2"><span className="text-slate-500">Sẵn sàng</span><div className="mt-1 text-sm font-semibold text-emerald-300">{ready}</div></div><div className="rounded border border-amber-900/40 bg-amber-500/5 p-2"><span className="text-slate-500">Theo dõi</span><div className="mt-1 text-sm font-semibold text-amber-300">{watch}</div></div></div>
    {error && <div className="rounded border border-rose-800/50 bg-rose-500/5 p-2 text-xs text-rose-300">{error}</div>}
    {loading && !data ? <div className="h-24 animate-pulse rounded bg-slate-800/40" /> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-[11px]"><thead className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-2 py-2">Cặp</th><th className="px-2 py-2">Tín hiệu</th><th className="px-2 py-2">M15–M5–M1</th><th className="px-2 py-2">Điểm</th><th className="px-2 py-2">Rủi ro</th><th className="px-2 py-2">Thao tác</th></tr></thead><tbody>{rows.map((row) => <tr key={row.symbol} className="border-b border-slate-900/80"><td className="px-2 py-2"><Link href={`/forex/${row.symbol}`} className="font-semibold text-white hover:text-[#00d4ff]">{row.symbol}</Link><div className="text-[9px] text-slate-600">chất lượng {row.dataQuality.score}/15</div></td><td className={`px-2 py-2 font-bold ${signalTone(row.signal)}`}>{signalLabel(row.signal)}</td><td className="px-2 py-2"><span className={stateTone(row)}>{stateLabel(row.state)}</span><div className="max-w-[210px] truncate text-[9px] text-slate-500">{row.bestCandidate?.strategy ?? "Chưa có thiết lập"}</div></td><td className="px-2 py-2 font-mono text-white">{row.bestCandidate?.score ?? "—"}</td><td className="px-2 py-2 text-slate-400">{row.bestCandidate ? `${row.bestCandidate.stopDistancePips.toFixed(1)}p · R:R ${row.bestCandidate.riskRewardAfterCosts.toFixed(2)}` : row.blockers[0] ?? "—"}</td><td className="px-2 py-2"><Link href={`/forex/${row.symbol}`} className="rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-[#00d4ff]/50 hover:text-[#00d4ff]">Mở chi tiết</Link></td></tr>)}</tbody></table></div>}
    <button type="button" onClick={() => setShowBlocked((value) => !value)} className="text-[10px] text-slate-500 hover:text-slate-300">{showBlocked ? "Ẩn cặp tạm dừng" : "Hiện cặp tạm dừng"}</button>
  </section>;
}
