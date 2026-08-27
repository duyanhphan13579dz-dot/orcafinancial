"use client";

import { memo, useMemo, useState } from "react";
import { recomputePositionAndLeverage } from "@/lib/forex/trade-setup";

export interface TradeSetupData {
  confidenceBreakdown: {
    base: number;
    factors: Array<{ id: string; label: string; points: number; note: string }>;
    total: number;
    explanation: string[];
  };
  risk: {
    entry: number;
    stopLoss: number | null;
    takeProfit: number | null;
    takeProfit2: number | null;
    riskPips: number | null;
    rewardPips: number | null;
    reward2Pips: number | null;
    riskReward: number | null;
    riskReward2: number | null;
    pipSize: number;
    side: "BUY" | "SELL" | "NEUTRAL";
    riskPrice: number | null;
    rewardPrice: number | null;
  };
  defaultPosition: {
    capital: number;
    riskPct: number;
    maxLossMoney: number;
    positionUnits: number | null;
    notional: number | null;
    note: string;
  };
  leverageScenarios: Array<{
    leverage: number;
    capital: number;
    notional: number;
    tpPnl: number | null;
    slPnl: number | null;
    marginUsed: number;
    illustrativeWipeMovePct: number | null;
    riskTier: string;
    warning: string | null;
  }>;
  setupQuality: "A" | "B" | "C" | "D";
  setupNote: string;
}

function fmt(n: number | null | undefined, d = 5) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(d);
}

function money(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function tierColor(t: string) {
  if (t === "EXTREME") return "text-rose-400";
  if (t === "HIGH") return "text-orange-400";
  if (t === "MODERATE") return "text-amber-400";
  return "text-emerald-400";
}

function gradeColor(g: string) {
  if (g === "A") return "bg-emerald-500/20 text-emerald-300 border-emerald-600";
  if (g === "B") return "bg-sky-500/20 text-sky-300 border-sky-600";
  if (g === "C") return "bg-amber-500/20 text-amber-300 border-amber-600";
  return "bg-slate-700/40 text-slate-400 border-slate-600";
}

export function ForexTradeSetupPanel({
  symbol,
  setup,
}: {
  symbol: string;
  setup: TradeSetupData;
}) {
  const [capital, setCapital] = useState(setup.defaultPosition.capital);
  const [riskPct, setRiskPct] = useState(setup.defaultPosition.riskPct);
  const [leverage, setLeverage] = useState(10);
  const [open, setOpen] = useState(false);

  const live = useMemo(() => {
    return recomputePositionAndLeverage({
      symbol,
      entry: setup.risk.entry,
      stopLoss: setup.risk.stopLoss,
      takeProfit: setup.risk.takeProfit,
      takeProfit2: setup.risk.takeProfit2,
      side: setup.risk.side,
      capital,
      riskPct,
      leverages: [1, 5, 10, 20, 50, 100, 200],
    });
  }, [symbol, setup, capital, riskPct]);

  const activeLev =
    live.leverageScenarios.find((s) => s.leverage === leverage) ??
    live.leverageScenarios[0];

  const conf = setup.confidenceBreakdown;

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="panel flex w-full items-center justify-between gap-3 p-3 text-left transition hover:border-[#00d4ff]/40"
        aria-expanded={open}
      >
        <span>
          <span className="block text-[10px] uppercase tracking-wide text-slate-500">
            Thiết lập giao dịch · Khuyến nghị 2.0
          </span>
          <span className="mt-0.5 block text-sm font-semibold text-white">
            Mức {setup.setupQuality} · Độ tin cậy {setup.confidenceBreakdown.total}%
          </span>
        </span>
        <span className="text-xs text-slate-500">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="space-y-4">
          <div className="panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-white">Thiết lập giao dịch · Khuyến nghị 2.0</h2>
          <span
            className={`rounded border px-2 py-0.5 text-sm font-black ${gradeColor(setup.setupQuality)}`}
          >
            Mức {setup.setupQuality}
          </span>
        </div>
        <p className="mb-3 text-[10px] text-slate-500">{setup.setupNote}</p>

        <div className="mb-2 flex items-end justify-between">
          <div className="text-xs text-slate-400">Phân tích độ tin cậy</div>
          <div className="text-2xl font-black text-white">{conf.total}%</div>
        </div>
        <div className="mb-3 h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full bg-[#00d4ff]/80"
            style={{ width: `${Math.min(100, conf.total)}%` }}
          />
        </div>
        <ul className="space-y-1 text-xs">
          {conf.factors
            .slice()
            .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
            .slice(0, 8)
            .map((f) => (
              <li key={f.id} className="flex justify-between gap-2">
                <span className="text-slate-400 truncate">
                  <span
                    className={
                      f.points >= 0 ? "text-emerald-400 font-mono" : "text-rose-400 font-mono"
                    }
                  >
                    {f.points >= 0 ? "+" : ""}
                    {f.points}
                  </span>{" "}
                  {f.label}
                </span>
                <span className="text-[10px] text-slate-600 truncate max-w-[50%]" title={f.note}>
                  {f.note}
                </span>
              </li>
            ))}
        </ul>
      </div>

      <div className="panel p-4">
        <h2 className="mb-3 font-semibold text-white">Bộ máy rủi ro</h2>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded bg-slate-900/40 p-2">
            <div className="text-slate-500">Rủi ro</div>
            <div className="font-mono text-white">
              {setup.risk.riskPips != null ? `${setup.risk.riskPips} pips` : "—"}
            </div>
          </div>
          <div className="rounded bg-slate-900/40 p-2">
            <div className="text-slate-500">Lợi nhuận TP1</div>
            <div className="font-mono text-white">
              {setup.risk.rewardPips != null ? `${setup.risk.rewardPips} pips` : "—"}
            </div>
          </div>
          <div className="rounded bg-slate-900/40 p-2">
            <div className="text-slate-500">R:R</div>
            <div className="font-mono text-[#00d4ff]">
              {setup.risk.riskReward != null ? `1 : ${setup.risk.riskReward}` : "—"}
            </div>
          </div>
          <div className="rounded bg-slate-900/40 p-2">
            <div className="text-slate-500">R:R TP2</div>
            <div className="font-mono text-white">
              {setup.risk.riskReward2 != null ? `1 : ${setup.risk.riskReward2}` : "—"}
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-slate-400">
          <div>Điểm vào {fmt(setup.risk.entry)}</div>
          <div className="text-rose-400">SL {fmt(setup.risk.stopLoss)}</div>
          <div className="text-emerald-400">TP1 {fmt(setup.risk.takeProfit)}</div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-400">
            Vốn ($)
            <input
              type="number"
              min={100}
              step={100}
              value={capital}
              onChange={(e) => setCapital(Number(e.target.value) || 1000)}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-white"
            />
          </label>
          <label className="text-xs text-slate-400">
            Rủi ro %
            <input
              type="number"
              min={0.1}
              max={10}
              step={0.1}
              value={riskPct}
              onChange={(e) => setRiskPct(Number(e.target.value) || 1)}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-white"
            />
          </label>
        </div>
        <div className="mt-3 rounded border border-slate-800 bg-slate-900/30 p-3 text-xs">
          <div className="text-slate-500">{live.position.note}</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              Lỗ tối đa: {" "}
              <span className="font-mono text-rose-300">
                ${live.position.maxLossMoney.toLocaleString()}
              </span>
            </div>
            <div>
              Số đơn vị: {" "}
              <span className="font-mono text-white">
                {live.position.positionUnits != null
                  ? live.position.positionUnits.toLocaleString()
                  : "—"}
              </span>
            </div>
            <div className="col-span-2">
              Giá trị danh nghĩa: {" "}
              <span className="font-mono text-[#00d4ff]">
                {live.position.notional != null
                  ? `$${live.position.notional.toLocaleString()}`
                  : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="panel p-4">
        <h2 className="mb-1 font-semibold text-white">Mô phỏng đòn bẩy và kịch bản</h2>
        <p className="mb-3 text-[10px] text-slate-500">
          Minh họa lãi/lỗ theo đòn bẩy — không phải thanh lý thực tế. Tỷ lệ mất vốn chỉ là ước lượng
          theo mức đòn bẩy.
        </p>

        <div className="mb-3">
          <div className="mb-1 flex justify-between text-xs text-slate-400">
            <span>Đòn bẩy</span>
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
          />
          <div className="mt-1 flex flex-wrap gap-1">
            {[1, 5, 10, 20, 50, 100, 200].map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => setLeverage(x)}
                className={`rounded px-2 py-0.5 text-[10px] ${
                  leverage === x
                    ? "bg-[#00d4ff] text-[#0A2540]"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                {x}x
              </button>
            ))}
          </div>
        </div>

        {activeLev && (
          <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded bg-slate-900/40 p-2">
              <div className="text-slate-500">Giá trị danh nghĩa</div>
              <div className="font-mono text-white">
                ${activeLev.notional.toLocaleString()}
              </div>
            </div>
            <div className="rounded bg-slate-900/40 p-2">
              <div className="text-slate-500">Lợi nhuận TP</div>
              <div className="font-mono text-emerald-400">{money(activeLev.tpPnl)}</div>
            </div>
            <div className="rounded bg-slate-900/40 p-2">
              <div className="text-slate-500">Lỗ SL</div>
              <div className="font-mono text-rose-400">{money(activeLev.slPnl)}</div>
            </div>
            <div className="rounded bg-slate-900/40 p-2">
              <div className="text-slate-500">Mức rủi ro</div>
              <div className={`font-semibold ${tierColor(activeLev.riskTier)}`}>
                {activeLev.riskTier}
              </div>
            </div>
          </div>
        )}

        {activeLev?.warning && (
          <div className="mb-3 rounded border border-amber-700/50 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-200">
            {activeLev.warning}
            {activeLev.illustrativeWipeMovePct != null && (
              <span className="ml-1 text-amber-400/80">
                · ~{activeLev.illustrativeWipeMovePct}% biến động ngược chiều ≈ rủi ro vốn (minh họa)
              </span>
            )}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[10px]">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 pr-2">Đòn bẩy</th>
                <th className="py-1 pr-2">Notional</th>
                <th className="py-1 pr-2">TP</th>
                <th className="py-1 pr-2">SL</th>
                <th className="py-1">Mức</th>
              </tr>
            </thead>
            <tbody>
              {live.leverageScenarios.map((s) => (
                <tr
                  key={s.leverage}
                  className={
                    s.leverage === leverage ? "bg-[#00d4ff]/10 text-white" : "text-slate-300"
                  }
                >
                  <td className="py-1 pr-2 font-mono">{s.leverage}x</td>
                  <td className="py-1 pr-2 font-mono">
                    ${s.notional.toLocaleString()}
                  </td>
                  <td className="py-1 pr-2 font-mono text-emerald-400">{money(s.tpPnl)}</td>
                  <td className="py-1 pr-2 font-mono text-rose-400">{money(s.slPnl)}</td>
                  <td className={`py-1 font-semibold ${tierColor(s.riskTier)}`}>
                    {s.riskTier}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const MemoForexTradeSetupPanel = memo(ForexTradeSetupPanel);
