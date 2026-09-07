"use client";

import { memo, useMemo, useState } from "react";
import { api } from "@/lib/client";

function displayLabel(value: string): string {
  return (
    ({
      BUY: "Mua",
      SELL: "Bán",
      LONG: "Mua",
      SHORT: "Bán",
      NEUTRAL: "Trung tính",
      BULLISH: "Tăng",
      BEARISH: "Giảm",
      HIGH: "Cao",
      MEDIUM: "Trung bình",
      LOW: "Thấp",
    } as Record<string, string>)[value] ?? value
  );
}

function fmt(n: number | null | undefined, d = 5) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(d);
}

function money(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}$${Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(0)}`;
}

const LEVERAGES = [1, 5, 10, 20, 50, 100, 200] as const;

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
  const [leverage, setLeverage] = useState(10);
  const [capital] = useState(10_000);

  const rec = a?.recommendation ?? "…";
  const signal = rec === "BUY" ? "LONG" : rec === "SELL" ? "SHORT" : rec;
  const conf = a ? Math.round(a.confidence * 100) : null;

  const entry = a?.entryPrice ?? a?.levels?.entry ?? null;
  const stopLoss = a?.stopLoss ?? a?.levels?.stopLoss ?? null;
  const takeProfit = a?.takeProfit ?? a?.levels?.takeProfit ?? null;
  const takeProfit2 = a?.takeProfit2 ?? a?.levels?.takeProfit2 ?? null;
  const riskReward = a?.tradeSetup?.risk?.riskReward ?? null;

  const style =
    rec === "BUY"
      ? "border-emerald-600/80 bg-gradient-to-b from-emerald-500/15 to-transparent"
      : rec === "SELL"
        ? "border-rose-600/80 bg-gradient-to-b from-rose-500/15 to-transparent"
        : "border-amber-600/60 bg-gradient-to-b from-amber-500/10 to-transparent";

  const confBarColor =
    rec === "BUY"
      ? "bg-emerald-400"
      : rec === "SELL"
        ? "bg-rose-400"
        : "bg-amber-400";

  const levScenario = useMemo(() => {
    if (entry == null || !Number.isFinite(entry) || entry <= 0) return null;
    const notional = capital * leverage;
    const riskPct =
      stopLoss != null && Number.isFinite(stopLoss)
        ? Math.abs(entry - stopLoss) / entry
        : null;
    const rewardPct =
      takeProfit != null && Number.isFinite(takeProfit)
        ? Math.abs(takeProfit - entry) / entry
        : null;
    const tpPnl = rewardPct != null ? notional * rewardPct : null;
    const slPnl = riskPct != null ? -(notional * riskPct) : null;
    const tier =
      leverage >= 100
        ? "EXTREME"
        : leverage >= 50
          ? "HIGH"
          : leverage >= 20
            ? "MODERATE"
            : "LOW";
    return {
      notional,
      tpPnl,
      slPnl,
      tier,
      wipePct: Number(((1 / leverage) * 100).toFixed(2)),
    };
  }, [entry, stopLoss, takeProfit, leverage, capital]);

  const addJournal = async () => {
    if (!entry || rec === "NEUTRAL" || rec === "…") return;
    setBusy(true);
    setJournalMsg(null);
    try {
      await api("/forex/journal", {
        method: "POST",
        body: JSON.stringify({
          symbol,
          direction: rec,
          timeframe: a.timeframe ?? "1h",
          entry,
          stopLoss,
          takeProfit,
          confidence: a.confidence,
          emotion: "neutral",
          note: analyst?.traderSummary?.action ?? a.reasons?.[0] ?? "",
          setupQuality: a.tradeSetup?.setupQuality,
          result: "OPEN",
        }),
      });
      setJournalMsg("Đã thêm vào nhật ký");
    } catch (e) {
      setJournalMsg(e instanceof Error ? e.message : "Lỗi nhật ký");
    } finally {
      setBusy(false);
    }
  };

  const openPosition = async () => {
    if (!entry || rec === "NEUTRAL" || rec === "…") return;
    setBusy(true);
    setJournalMsg(null);
    try {
      await api("/forex/portfolio", {
        method: "POST",
        body: JSON.stringify({
          symbol,
          direction: rec,
          entry,
          stopLoss,
          takeProfit,
          confidence: a.confidence,
          timeframe: a.timeframe ?? "1h",
          addToJournal: true,
        }),
      });
      setJournalMsg("Đã mở vị thế và thêm nhật ký");
    } catch (e) {
      setJournalMsg(e instanceof Error ? e.message : "Lỗi danh mục");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`panel border p-3 sm:p-4 ${style}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">
            Signal · {timeframeLabel}
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-black text-white sm:text-3xl">
              {displayLabel(signal)}
            </span>
            {conf != null && (
              <span className="rounded bg-slate-900/60 px-2 py-0.5 font-mono text-base text-[#00d4ff] sm:text-lg">
                {conf}%
              </span>
            )}
          </div>
        </div>
        {a?.tradeSetup?.setupQuality && (
          <span className="shrink-0 rounded border border-slate-600 px-2 py-1 text-xs font-bold text-white">
            Mức {a.tradeSetup.setupQuality}
          </span>
        )}
      </div>

      {conf != null && (
        <div className="mt-2">
          <div className="mb-1 flex items-center justify-between text-[10px] text-slate-500">
            <span>Độ tin cậy</span>
            <span className="font-mono text-slate-300">{conf}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full transition-all ${confBarColor}`}
              style={{ width: `${Math.min(100, conf)}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1 text-[10px]">
        {mtf && (
          <span className="rounded-full border border-slate-700 bg-slate-900/40 px-2 py-0.5 text-slate-300">
            MTF {displayLabel(mtf.overall)} · {(mtf.alignment * 100).toFixed(0)}%
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
            Vĩ mô {macro.eventRisk}
          </span>
        )}
      </div>

      {macro?.eventRiskNote && macro.eventRisk !== "NONE" && (
        <div className="mt-2 rounded border border-amber-800/40 bg-amber-500/5 px-2 py-1.5 text-[10px] text-amber-100/90">
          {macro.eventRiskNote}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <div className="rounded border border-slate-800 bg-slate-900/40 p-2">
          <div className="text-[10px] text-slate-500">Entry</div>
          <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-white">
            {fmt(entry)}
          </div>
        </div>
        <div className="rounded border border-rose-900/40 bg-rose-500/5 p-2">
          <div className="text-[10px] text-slate-500">SL</div>
          <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-rose-300">
            {fmt(stopLoss)}
          </div>
        </div>
        <div className="rounded border border-emerald-900/40 bg-emerald-500/5 p-2">
          <div className="text-[10px] text-slate-500">TP1</div>
          <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-emerald-300">
            {fmt(takeProfit)}
          </div>
        </div>
        <div className="rounded border border-emerald-900/30 bg-emerald-500/5 p-2">
          <div className="text-[10px] text-slate-500">TP2 / R:R</div>
          <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-emerald-300/80">
            {takeProfit2 != null ? fmt(takeProfit2) : riskReward != null ? `1:${riskReward}` : "—"}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded border border-slate-800 bg-slate-900/30 p-2.5">
        <div className="mb-1.5 flex items-center justify-between text-[10px]">
          <span className="font-semibold text-slate-300">Đòn bẩy · kịch bản</span>
          <span className="font-mono text-white">{leverage}x</span>
        </div>
        <input
          type="range"
          min={1}
          max={200}
          step={1}
          value={leverage}
          onChange={(e) => setLeverage(Number(e.target.value))}
          className="w-full accent-[#00d4ff]"
          aria-label="Chọn đòn bẩy"
        />
        <div className="mt-1.5 flex flex-wrap gap-1">
          {LEVERAGES.map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => setLeverage(x)}
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                leverage === x
                  ? "bg-[#00d4ff] font-semibold text-[#0A2540]"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700"
              }`}
            >
              {x}x
            </button>
          ))}
        </div>

        <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-[10px]">
          <div className="rounded bg-slate-950/40 p-1.5 text-center">
            <div className="text-slate-500">Entry</div>
            <div className="mt-0.5 font-mono tabular-nums text-white">{fmt(entry)}</div>
          </div>
          <div className="rounded bg-slate-950/40 p-1.5 text-center">
            <div className="text-slate-500">SL</div>
            <div className="mt-0.5 font-mono tabular-nums text-rose-300">{fmt(stopLoss)}</div>
          </div>
          <div className="rounded bg-slate-950/40 p-1.5 text-center">
            <div className="text-slate-500">TP1</div>
            <div className="mt-0.5 font-mono tabular-nums text-emerald-300">{fmt(takeProfit)}</div>
          </div>
        </div>

        {levScenario && (
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px] sm:grid-cols-4">
            <div className="rounded bg-slate-950/40 p-1.5">
              <div className="text-slate-500">Notional</div>
              <div className="mt-0.5 font-mono text-white">
                ${levScenario.notional.toLocaleString()}
              </div>
            </div>
            <div className="rounded bg-slate-950/40 p-1.5">
              <div className="text-slate-500">TP PnL</div>
              <div className="mt-0.5 font-mono text-emerald-400">
                {money(levScenario.tpPnl)}
              </div>
            </div>
            <div className="rounded bg-slate-950/40 p-1.5">
              <div className="text-slate-500">SL PnL</div>
              <div className="mt-0.5 font-mono text-rose-400">
                {money(levScenario.slPnl)}
              </div>
            </div>
            <div className="rounded bg-slate-950/40 p-1.5">
              <div className="text-slate-500">Rủi ro</div>
              <div
                className={`mt-0.5 font-semibold ${
                  levScenario.tier === "EXTREME"
                    ? "text-rose-400"
                    : levScenario.tier === "HIGH"
                      ? "text-orange-400"
                      : levScenario.tier === "MODERATE"
                        ? "text-amber-400"
                        : "text-emerald-400"
                }`}
              >
                {levScenario.tier}
              </div>
            </div>
          </div>
        )}

        {levScenario && leverage >= 20 && (
          <p className="mt-1.5 text-[9px] leading-snug text-amber-200/80">
            ~{levScenario.wipePct}% biến động ngược ≈ rủi ro vốn (minh họa, không phải thanh lý
            thực tế).
          </p>
        )}
      </div>

      {analyst?.traderSummary && (
        <div className="mt-3 rounded border border-slate-800 bg-slate-900/40 p-2 text-[10px] text-slate-300">
          <div className="font-semibold text-white">
            {displayLabel(analyst.traderSummary.bias)} · Rủi ro{" "}
            {analyst.traderSummary.risk}
          </div>
          <div className="mt-0.5">{analyst.traderSummary.action}</div>
        </div>
      )}

      {(a?.reasons?.length ?? 0) > 0 && (
        <ul className="mt-2.5 max-h-20 space-y-0.5 overflow-y-auto text-[10px] text-slate-400">
          {(a.reasons as string[]).slice(0, 5).map((x, i) => (
            <li key={i} className="truncate">
              • {x}
            </li>
          ))}
        </ul>
      )}

      {alerts.length > 0 && (
        <div className="mt-2 space-y-1">
          {alerts.slice(0, 2).map((al, i) => (
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

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || rec === "NEUTRAL" || !entry}
          onClick={() => void addJournal()}
          className="min-h-9 flex-1 rounded bg-slate-800 px-3 text-xs text-white disabled:opacity-40 sm:flex-none"
        >
          + Nhật ký
        </button>
        <button
          type="button"
          disabled={busy || rec === "NEUTRAL" || !entry}
          onClick={() => void openPosition()}
          className="min-h-9 flex-1 rounded bg-[#00d4ff]/90 px-3 text-xs font-semibold text-[#0A2540] disabled:opacity-40 sm:flex-none"
        >
          Mở vị thế
        </button>
      </div>
      {journalMsg && (
        <div className="mt-1.5 text-[10px] text-slate-400">{journalMsg}</div>
      )}
    </div>
  );
}

export const MemoForexIntelligenceCard = memo(ForexIntelligenceCard);
