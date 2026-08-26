"use client";

import { useEffect, useMemo, useState } from "react";
import type { Bar } from "@/components/candle-chart";
import { MemoForexProChart } from "@/components/forex-pro-chart";

type ReplayBar = Bar & { tickVolume?: number; isClosed?: boolean };
export type VisualReplayData = {
  replayAt: string;
  timeframe: string;
  bars: ReplayBar[];
  setup?: { entry?: number | null; stopLoss?: number | null; takeProfit?: number | null; direction?: string; strategy?: string } | null;
};

type Props = { data: VisualReplayData; onClose: () => void };

function formatPrice(value: number | null | undefined) { return value == null || !Number.isFinite(value) ? "—" : value.toFixed(value > 100 ? 2 : 5); }
function formatTime(value: number | undefined) { return value ? new Date(value * 1000).toLocaleString() : "—"; }

export default function ForexVisualReplay({ data, onClose }: Props) {
  const bars = useMemo(() => data.bars.filter((bar) => Number.isFinite(bar.time) && Number.isFinite(bar.open) && Number.isFinite(bar.high) && Number.isFinite(bar.low) && Number.isFinite(bar.close)).sort((a, b) => a.time - b.time), [data.bars]);
  const minimum = Math.min(20, Math.max(1, bars.length));
  const [cursor, setCursor] = useState(minimum);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    queueMicrotask(() => {
      setCursor(Math.min(20, Math.max(1, bars.length)));
      setPlaying(false);
    });
  }, [bars.length, data.replayAt]);

  useEffect(() => {
    if (!playing || bars.length === 0) return;
    const timer = window.setInterval(() => setCursor((value) => {
      if (value >= bars.length) { setPlaying(false); return value; }
      return value + 1;
    }), Math.max(120, 1_000 / speed));
    return () => window.clearInterval(timer);
  }, [playing, bars.length, speed]);

  const visibleBars = bars.slice(0, cursor);
  const current = visibleBars.at(-1);
  const progress = bars.length ? Math.round(cursor / bars.length * 100) : 0;
  const levels = useMemo(() => data.setup ? { entry: data.setup.entry ?? null, stopLoss: data.setup.stopLoss ?? null, takeProfit: data.setup.takeProfit ?? null } : null, [data.setup]);

  return <div className="rounded border border-[#00d4ff]/30 bg-slate-950/70 p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="flex items-center gap-2"><h3 className="font-semibold text-white">Visual Replay · {data.timeframe}</h3><span className="rounded border border-amber-700/50 bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-300">PAPER ONLY</span></div><p className="mt-0.5 text-[10px] text-slate-500">Biquote · {data.setup?.strategy ?? "setup snapshot"} · {data.setup?.direction ?? "—"}</p></div><button type="button" onClick={onClose} className="text-xs text-slate-500 hover:text-white">Close</button></div>
    <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-5"><div><span className="text-slate-500">Replay time</span><div className="text-white">{formatTime(current?.time)}</div></div><div><span className="text-slate-500">Progress</span><div className="text-white">{cursor}/{bars.length} · {progress}%</div></div><div><span className="text-slate-500">Open</span><div className="text-white">{formatPrice(current?.open)}</div></div><div><span className="text-slate-500">Close</span><div className="text-white">{formatPrice(current?.close)}</div></div><div><span className="text-slate-500">Snapshot</span><div className="text-white">{formatTime(Math.floor(Date.parse(data.replayAt) / 1000))}</div></div></div>
    <div className="mt-3 overflow-hidden rounded border border-slate-800 bg-[#071b2e]"><MemoForexProChart bars={visibleBars as Bar[]} height={360} levels={levels} showEma={false} showBb={false} showRsi={false} showMacd={false} hasMore={false} incremental /></div>
    <div className="mt-3 space-y-2"><input aria-label="Replay candle position" type="range" min={Math.min(1, bars.length)} max={Math.max(1, bars.length)} value={Math.min(cursor, Math.max(1, bars.length))} onChange={(event) => { setPlaying(false); setCursor(Number(event.target.value)); }} className="w-full accent-[#00d4ff]" /><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => { setPlaying(false); setCursor((value) => Math.max(1, value - 1)); }} className="min-h-9 rounded border border-slate-700 px-3 text-xs text-slate-300">◀ Step</button><button type="button" onClick={() => { if (cursor >= bars.length) setCursor(1); setPlaying((value) => !value); }} className="min-h-9 rounded border border-[#00d4ff]/50 px-3 text-xs text-[#00d4ff]">{playing ? "Pause" : "Play"}</button><button type="button" onClick={() => { setPlaying(false); setCursor((value) => Math.min(bars.length, value + 1)); }} className="min-h-9 rounded border border-slate-700 px-3 text-xs text-slate-300">Step ▶</button><button type="button" onClick={() => { setPlaying(false); setCursor(Math.min(20, Math.max(1, bars.length))); }} className="min-h-9 rounded border border-slate-700 px-3 text-xs text-slate-400">Reset</button><label className="ml-auto flex min-h-9 items-center gap-2 text-[10px] text-slate-500">Speed<select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300"><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label></div></div>
    <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]"><div className="rounded border border-[#00d4ff]/30 p-2"><span className="text-slate-500">Entry</span><div className="text-[#00d4ff]">{formatPrice(data.setup?.entry)}</div></div><div className="rounded border border-rose-900/50 p-2"><span className="text-slate-500">Stop loss</span><div className="text-rose-300">{formatPrice(data.setup?.stopLoss)}</div></div><div className="rounded border border-emerald-900/50 p-2"><span className="text-slate-500">Take profit</span><div className="text-emerald-300">{formatPrice(data.setup?.takeProfit)}</div></div></div>
  </div>;
}
