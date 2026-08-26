"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

export type ForexScalpingCandidateView = {
  strategy: string;
  direction: "BUY" | "SELL";
  state: string;
  score: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  stopDistancePips: number;
  riskRewardAfterCosts: number;
  timeframes?: string[];
  reasons: string[];
  hardBlocks: string[];
  risk: { lotSize: number; pipValuePerLot: number; valid: boolean; reason: string | null };
};

export type ForexScalpingResultView = {
  symbol?: string;
  signal: "BUY" | "SELL" | "WAIT";
  state: string;
  generatedAt: string;
  paperOnly: true;
  executionEnabled: false;
  dataQuality: { score: number; ok: boolean; gaps: string[] };
  blockers: string[];
  bestCandidate: ForexScalpingCandidateView | null;
};

type Props = {
  symbol: string;
  marketStatus?: string;
  quoteAgeMs?: number | null;
  spreadPips?: number | null;
  sessionLabel?: string | null;
  onResult?: (result: ForexScalpingResultView | null) => void;
  onSaveSetup?: (candidate: ForexScalpingCandidateView) => Promise<void> | void;
};

function fmt(value: number | null | undefined, digits = 5) { return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits); }
function age(value?: number | null) { if (value == null || !Number.isFinite(value)) return "—"; return value < 1_000 ? `${Math.round(value)}ms` : `${(value / 1_000).toFixed(1)}s`; }
function tone(status: string) { return status === "OK" || status === "CONFIRMED" || status === "LIVE" ? "text-emerald-300" : status === "WAIT" ? "text-amber-300" : "text-slate-400"; }

export default function ForexScalpingPanel({ symbol, marketStatus, quoteAgeMs, spreadPips, sessionLabel, onResult, onSaveSetup }: Props) {
  const [result, setResult] = useState<ForexScalpingResultView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const envelope = await api<ForexScalpingResultView>(`/forex/${encodeURIComponent(symbol)}/scalping`, { timeoutMs: 12_000 });
        if (!active) return;
        setResult(envelope.data);
        onResult?.(envelope.data);
        setError(null);
      } catch (err) {
        if (active) { setError(err instanceof Error ? err.message : "Scalping unavailable"); onResult?.(null); }
      } finally { if (active) setLoading(false); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [symbol, onResult]);

  const saveSetup = async () => {
    if (!candidate || !onSaveSetup || saving) return;
    setSaving(true);
    try { await onSaveSetup(candidate); setSaved(true); window.setTimeout(() => setSaved(false), 2500); } finally { setSaving(false); }
  };

  const candidate = result?.bestCandidate;
  const locked = Boolean(result?.blockers?.length) || result?.state === "HALTED";
  const signalClass = result?.signal === "BUY" ? "text-emerald-300" : result?.signal === "SELL" ? "text-rose-300" : "text-amber-200";
  const tf = (key: string, fallback: string) => candidate?.timeframes?.includes(key) ? (candidate.hardBlocks.length ? "WAIT" : "CONFIRMED") : fallback;
  const connection = marketStatus === "live" ? "LIVE" : marketStatus === "stale" ? "STALE" : marketStatus === "reconnecting" ? "RECONNECTING" : marketStatus ? marketStatus.toUpperCase() : "—";
  const spreadStatus = spreadPips == null ? "—" : spreadPips <= 1.8 ? "OK" : "HIGH";

  return (
    <section className="panel space-y-3 p-3 sm:p-4" aria-label="Forex scalping decision cockpit">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-white">Scalping Decision Cockpit</h2><span className="rounded border border-amber-700/50 bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-300">PAPER ONLY</span></div>
          <p className="mt-0.5 text-[10px] text-slate-500">M15 → M5 → M1 · Biquote realtime · local calculation</p>
        </div>
        <div className="text-right text-[10px]"><div className={locked ? "text-amber-300" : "text-emerald-300"}>{locked ? "WATCH / LOCKED" : "READY"}</div><div className="text-slate-500">updated {result?.generatedAt ? new Date(result.generatedAt).toLocaleTimeString() : loading ? "loading…" : "—"}</div></div>
      </div>

      {error && <div className="rounded border border-rose-800/50 bg-rose-500/5 p-2 text-xs text-rose-300">{error}</div>}
      {loading && !result && <div className="h-24 animate-pulse rounded bg-slate-800/40" />}
      {result && <>
        <div className="grid gap-2 sm:grid-cols-[1.2fr_repeat(4,minmax(0,1fr))]">
          <div className="rounded border border-slate-700 bg-slate-900/50 p-3"><div className="text-[10px] uppercase tracking-wider text-slate-500">Decision</div><div className={`mt-1 text-3xl font-black ${signalClass}`}>{result.signal}</div><div className="text-[10px] text-slate-400">{result.state} · score {candidate?.score ?? "—"}</div></div>
          <div className="rounded border border-slate-800 p-2"><div className="text-[10px] text-slate-500">Market</div><div className={`mt-1 text-sm font-semibold ${tone(connection)}`}>{connection}</div><div className="text-[10px] text-slate-500">age {age(quoteAgeMs)}</div></div>
          <div className="rounded border border-slate-800 p-2"><div className="text-[10px] text-slate-500">Spread</div><div className={`mt-1 text-sm font-semibold ${tone(spreadStatus)}`}>{spreadPips == null ? "—" : `${fmt(spreadPips, 1)} pips`}</div><div className="text-[10px] text-slate-500">{spreadStatus}</div></div>
          <div className="rounded border border-slate-800 p-2"><div className="text-[10px] text-slate-500">Session</div><div className="mt-1 truncate text-sm font-semibold text-white">{sessionLabel ?? "—"}</div><div className="text-[10px] text-slate-500">{result.blockers.includes("SESSION_BLOCK") ? "BLOCKED" : "allowed"}</div></div>
          <div className="rounded border border-slate-800 p-2"><div className="text-[10px] text-slate-500">Data</div><div className={`mt-1 text-sm font-semibold ${tone(result.dataQuality.ok ? "OK" : "WAIT")}`}>{result.dataQuality.score}/15</div><div className="text-[10px] text-slate-500">{result.dataQuality.ok ? "coverage OK" : "incomplete"}</div></div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {[{ key: "15m", label: "M15 · Context", status: tf("15m", "WAIT"), detail: candidate?.reasons.find((x) => x.toLowerCase().includes("m15")) ?? "Trend / impulse" }, { key: "5m", label: "M5 · Confirmation", status: tf("5m", "WAIT"), detail: candidate?.reasons.find((x) => x.toLowerCase().includes("m5")) ?? "Breakout / retest" }, { key: "1m", label: "M1 · Trigger", status: tf("1m", "WAIT"), detail: candidate?.reasons.find((x) => x.toLowerCase().includes("m1")) ?? "Closed trigger candle" }].map((gate) => <div key={gate.key} className="rounded border border-slate-800 p-2"><div className="flex items-center justify-between"><span className="text-[10px] text-slate-400">{gate.label}</span><span className={`text-[10px] font-semibold ${tone(gate.status)}`}>{gate.status}</span></div><div className="mt-1 truncate text-[10px] text-slate-500">{gate.detail}</div></div>)}
        </div>

        {candidate ? <div className="rounded border border-slate-700 bg-slate-900/30 p-3 text-xs"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-white">{candidate.strategy} · {candidate.direction}</span><span className={candidate.state === "QUALIFIED" ? "text-emerald-300" : "text-amber-300"}>{candidate.state}</span></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-5"><div><span className="text-slate-500">Entry</span><div className="text-white">{fmt(candidate.entry)}</div></div><div><span className="text-slate-500">SL</span><div className="text-rose-300">{fmt(candidate.stopLoss)}</div></div><div><span className="text-slate-500">TP1</span><div className="text-emerald-300">{fmt(candidate.takeProfit)}</div></div><div><span className="text-slate-500">Stop</span><div className="text-white">{fmt(candidate.stopDistancePips, 1)} pips</div></div><div><span className="text-slate-500">Paper lot / R:R</span><div className="text-white">{fmt(candidate.risk.lotSize, 2)} / {fmt(candidate.riskRewardAfterCosts, 2)}</div></div></div><div className="mt-2 text-slate-400">{candidate.reasons.join(" · ")}</div>{candidate.hardBlocks.length > 0 && <div className="mt-2 text-amber-300">Why WAIT: {candidate.hardBlocks.join(" · ")}</div>}<div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void saveSetup()} disabled={!onSaveSetup || saving} className="min-h-9 rounded border border-[#00d4ff]/40 px-3 text-[10px] text-[#00d4ff] disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Saving…" : saved ? "Saved to journal" : "Watch setup"}</button><button type="button" className="min-h-9 rounded border border-slate-700 px-3 text-[10px] text-slate-400">View gate details</button></div></div> : <div className="rounded border border-slate-800 p-3 text-xs text-slate-400">WAIT — no qualified setup in the current M15–M5–M1 window.</div>}
        {result.blockers.length > 0 && <div className="text-[10px] text-amber-300">Safety gates: {result.blockers.slice(0, 5).join(" · ")}</div>}
      </>}
    </section>
  );
}
