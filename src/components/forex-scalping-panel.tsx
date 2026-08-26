"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Props = { symbol: string };

type Candidate = {
  strategy: string;
  direction: "BUY" | "SELL";
  state: string;
  score: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  stopDistancePips: number;
  riskRewardAfterCosts: number;
  reasons: string[];
  hardBlocks: string[];
  risk: { lotSize: number; pipValuePerLot: number; valid: boolean; reason: string | null };
};

type Result = {
  signal: "BUY" | "SELL" | "WAIT";
  state: string;
  generatedAt: string;
  paperOnly: true;
  executionEnabled: false;
  dataQuality: { score: number; ok: boolean; gaps: string[] };
  blockers: string[];
  bestCandidate: Candidate | null;
};

function fmt(value: number | null | undefined, digits = 5) { return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits); }

export default function ForexScalpingPanel({ symbol }: Props) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const envelope = await api<Result>(`/forex/${encodeURIComponent(symbol)}/scalping`, { timeoutMs: 12_000 });
        if (!active) return;
        setResult(envelope.data);
        setError(null);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Scalping unavailable");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [symbol]);

  const candidate = result?.bestCandidate;
  const locked = Boolean(result?.blockers?.length) || result?.state === "HALTED";
  const signalClass = result?.signal === "BUY" ? "text-emerald-300" : result?.signal === "SELL" ? "text-rose-300" : "text-slate-300";

  return (
    <section className="panel space-y-3 p-3 sm:p-4" aria-label="Forex scalping research panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-white">Forex Scalping · M15–M5–M1</h2>
            <span className="rounded border border-amber-700/50 bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-300">PAPER ONLY</span>
          </div>
          <p className="mt-0.5 text-[10px] text-slate-500">Biquote-first · local calculation · no execution path</p>
        </div>
        <div className="text-right text-[10px]">
          <div className={locked ? "text-amber-300" : "text-emerald-300"}>{locked ? "WATCH / LOCKED" : "READY"}</div>
          <div className="text-slate-500">{result?.generatedAt ? new Date(result.generatedAt).toLocaleTimeString() : loading ? "loading…" : "—"}</div>
        </div>
      </div>

      {error && <div className="rounded border border-rose-800/50 bg-rose-500/5 p-2 text-xs text-rose-300">{error}</div>}
      {loading && !result && <div className="h-20 animate-pulse rounded bg-slate-800/40" />}
      {result && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded border border-slate-800 p-2"><div className="text-[10px] text-slate-500">Signal</div><div className={`text-xl font-bold ${signalClass}`}>{result.signal}</div></div>
            <div className="rounded border border-slate-800 p-2"><div className="text-[10px] text-slate-500">State</div><div className="text-sm font-semibold text-white">{result.state}</div></div>
            <div className="rounded border border-slate-800 p-2"><div className="text-[10px] text-slate-500">Data quality</div><div className="text-sm font-semibold text-white">{result.dataQuality.score}/15</div></div>
            <div className="rounded border border-slate-800 p-2"><div className="text-[10px] text-slate-500">Execution</div><div className="text-sm font-semibold text-amber-300">DISABLED</div></div>
          </div>

          {candidate ? (
            <div className="rounded border border-slate-700 bg-slate-900/30 p-3 text-xs">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-white">{candidate.strategy} · {candidate.direction} · score {candidate.score}</span><span className={candidate.state === "QUALIFIED" ? "text-emerald-300" : "text-amber-300"}>{candidate.state}</span></div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <div><span className="text-slate-500">Entry</span><div className="text-white">{fmt(candidate.entry)}</div></div>
                <div><span className="text-slate-500">SL</span><div className="text-rose-300">{fmt(candidate.stopLoss)}</div></div>
                <div><span className="text-slate-500">TP</span><div className="text-emerald-300">{fmt(candidate.takeProfit)}</div></div>
                <div><span className="text-slate-500">Stop</span><div className="text-white">{fmt(candidate.stopDistancePips, 1)} pips</div></div>
                <div><span className="text-slate-500">Lot / R:R</span><div className="text-white">{fmt(candidate.risk.lotSize, 2)} / {fmt(candidate.riskRewardAfterCosts, 2)}</div></div>
              </div>
              <div className="mt-2 text-slate-400">{candidate.reasons.join(" · ")}</div>
              {candidate.hardBlocks.length > 0 && <div className="mt-2 text-amber-300">Blocks: {candidate.hardBlocks.join(" · ")}</div>}
            </div>
          ) : <div className="rounded border border-slate-800 p-3 text-xs text-slate-400">Chưa có setup đủ điều kiện trong cửa sổ M15–M5–M1.</div>}

          {result.blockers.length > 0 && <div className="text-[10px] text-amber-300">Gates: {result.blockers.slice(0, 4).join(" · ")}</div>}
        </>
      )}
    </section>
  );
}
