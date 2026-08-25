"use client";

import { memo, useState } from "react";
import { api } from "@/lib/client";

function fmt(n: number | null | undefined, d = 5) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(d);
}

export function ForexIntelligenceCard({
  symbol,
  timeframeLabel,
  analysis,
}: {
  symbol: string;
  timeframeLabel: string;
  analysis: any;
}) {
  const a = analysis;
  const mtf = a?.mtf;
  const fx = a?.fxIntelligence;
  const macro = a?.macro;
  const analyst = a?.analyst;
  const alerts = (a?.alerts ?? []) as Array<{
    severity: string;
    title: string;
    message: string;
  }>;

  const [journalMsg, setJournalMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rec = a?.recommendation ?? "…";
  const signal = rec === "BUY" ? "LONG" : rec === "SELL" ? "SHORT" : rec;
  const conf = a ? Math.round(a.confidence * 100) : null;

  const style =
    rec === "BUY"
      ? "border-emerald-600/80 bg-gradient-to-b from-emerald-500/15 to-transparent"
      : rec === "SELL"
        ? "border-rose-600/80 bg-gradient-to-b from-rose-500/15 to-transparent"
        : "border-amber-600/60 bg-gradient-to-b from-amber-500/10 to-transparent";

  const addJournal = async () => {
    if (!a?.entryPrice || rec === "NEUTRAL" || rec === "…") return;
    setBusy(true);
    setJournalMsg(null);
    try {
      await api("/forex/journal", {
        method: "POST",
        body: JSON.stringify({
          symbol,
          direction: rec,
          timeframe: a.timeframe ?? "1h",
          entry: a.entryPrice,
          stopLoss: a.stopLoss,
          takeProfit: a.takeProfit,
          confidence: a.confidence,
          emotion: "neutral",
          note: analyst?.traderSummary?.action ?? a.reasons?.[0] ?? "",
          setupQuality: a.tradeSetup?.setupQuality,
          result: "OPEN",
        }),
      });
      setJournalMsg("Đã thêm vào Journal");
    } catch (e) {
      setJournalMsg(e instanceof Error ? e.message : "Lỗi journal");
    } finally {
      setBusy(false);
    }
  };

  const openPosition = async () => {
    if (!a?.entryPrice || rec === "NEUTRAL" || rec === "…") return;
    setBusy(true);
    setJournalMsg(null);
    try {
      await api("/forex/portfolio", {
        method: "POST",
        body: JSON.stringify({
          symbol,
          direction: rec,
          entry: a.entryPrice,
          stopLoss: a.stopLoss,
          takeProfit: a.takeProfit,
          confidence: a.confidence,
          timeframe: a.timeframe ?? "1h",
          addToJournal: true,
        }),
      });
      setJournalMsg("Đã mở position + journal");
    } catch (e) {
      setJournalMsg(e instanceof Error ? e.message : "Lỗi portfolio");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`panel border p-4 ${style}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">
            Trade Intelligence · {timeframeLabel}
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="text-3xl font-black text-white">{signal}</span>
            {conf != null && (
              <span className="rounded bg-slate-900/50 px-2 py-0.5 font-mono text-lg text-[#00d4ff]">
                {conf}%
              </span>
            )}
          </div>
        </div>
        {a?.tradeSetup?.setupQuality && (
          <span className="rounded border border-slate-600 px-2 py-1 text-xs font-bold text-white">
            Grade {a.tradeSetup.setupQuality}
          </span>
        )}
      </div>

      {/* Compact intel chips */}
      <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
        {mtf && (
          <span className="rounded-full border border-slate-700 bg-slate-900/40 px-2 py-0.5 text-slate-300">
            MTF {mtf.overall} · {(mtf.alignment * 100).toFixed(0)}%
          </span>
        )}
        {fx?.session && (
          <span className="rounded-full border border-slate-700 bg-slate-900/40 px-2 py-0.5 text-slate-300">
            {fx.session.label}
          </span>
        )}
        {a?.marketStructure && (
          <span className="rounded-full border border-slate-700 bg-slate-900/40 px-2 py-0.5 text-slate-300">
            {a.marketStructure}
          </span>
        )}
        {a?.volatilityRegime && (
          <span className="rounded-full border border-slate-700 bg-slate-900/40 px-2 py-0.5 text-slate-300">
            Vol {a.volatilityRegime}
          </span>
        )}
        {macro?.eventRisk && macro.eventRisk !== "NONE" && (
          <span className="rounded-full border border-amber-700/60 bg-amber-500/10 px-2 py-0.5 text-amber-200">
            Macro {macro.eventRisk}
          </span>
        )}
      </div>

      {macro?.eventRiskNote && macro.eventRisk !== "NONE" && (
        <div className="mt-2 rounded border border-amber-800/40 bg-amber-500/5 px-2 py-1.5 text-[10px] text-amber-100/90">
          {macro.eventRiskNote}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-y-2 text-xs">
        <span className="text-slate-500">Entry</span>
        <span className="text-right font-mono text-white">{fmt(a?.entryPrice)}</span>
        <span className="text-slate-500">Stop Loss</span>
        <span className="text-right font-mono text-rose-300">{fmt(a?.stopLoss)}</span>
        <span className="text-slate-500">Take Profit 1</span>
        <span className="text-right font-mono text-emerald-300">{fmt(a?.takeProfit)}</span>
        <span className="text-slate-500">Take Profit 2</span>
        <span className="text-right font-mono text-emerald-300/80">
          {fmt(a?.takeProfit2)}
        </span>
        {a?.tradeSetup?.risk?.riskReward != null && (
          <>
            <span className="text-slate-500">R:R</span>
            <span className="text-right font-mono text-[#00d4ff]">
              1 : {a.tradeSetup.risk.riskReward}
            </span>
          </>
        )}
      </div>

      {analyst?.traderSummary && (
        <div className="mt-3 rounded border border-slate-800 bg-slate-900/40 p-2 text-[10px] text-slate-300">
          <div className="font-semibold text-white">
            {analyst.traderSummary.bias} · Risk {analyst.traderSummary.risk}
          </div>
          <div className="mt-0.5">{analyst.traderSummary.action}</div>
        </div>
      )}

      <ul className="mt-3 max-h-28 space-y-1 overflow-y-auto text-[10px] text-slate-400">
        {(a?.reasons ?? []).slice(0, 6).map((x: string, i: number) => (
          <li key={i}>• {x}</li>
        ))}
      </ul>

      {alerts.length > 0 && (
        <div className="mt-3 space-y-1">
          {alerts.slice(0, 3).map((al, i) => (
            <div
              key={i}
              className={`rounded px-2 py-1 text-[10px] ${
                al.severity === "critical"
                  ? "bg-rose-500/15 text-rose-200"
                  : al.severity === "action"
                    ? "bg-sky-500/10 text-sky-200"
                    : "bg-slate-800/60 text-slate-400"
              }`}
            >
              <span className="font-semibold">{al.title}</span> — {al.message}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || rec === "NEUTRAL" || !a?.entryPrice}
          onClick={() => void addJournal()}
          className="min-h-9 rounded bg-slate-800 px-3 text-xs text-white disabled:opacity-40"
        >
          + Journal
        </button>
        <button
          type="button"
          disabled={busy || rec === "NEUTRAL" || !a?.entryPrice}
          onClick={() => void openPosition()}
          className="min-h-9 rounded bg-[#00d4ff]/90 px-3 text-xs font-semibold text-[#0A2540] disabled:opacity-40"
        >
          Open position
        </button>
      </div>
      {journalMsg && (
        <div className="mt-2 text-[10px] text-slate-400">{journalMsg}</div>
      )}
    </div>
  );
}

export const MemoForexIntelligenceCard = memo(ForexIntelligenceCard);
