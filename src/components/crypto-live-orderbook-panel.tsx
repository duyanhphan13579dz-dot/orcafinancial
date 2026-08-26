"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createBinanceOrderBookWebSocket,
  type LiveOrderBookState,
} from "@/lib/crypto/binance-orderbook-websocket";

function money(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function statusClass(status: LiveOrderBookState["status"]) {
  if (status === "live") return "text-emerald-300";
  if (status === "stale" || status === "resyncing") return "text-amber-300";
  if (status === "error") return "text-rose-300";
  return "text-slate-400";
}

function pressureClass(pressure: LiveOrderBookState["pressure"]) {
  if (pressure === "BUY_PRESSURE") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (pressure === "SELL_PRESSURE") return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  return "border-amber-500/40 bg-amber-500/10 text-amber-300";
}

export default function CryptoLiveOrderBookPanel({ symbol }: { symbol: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LiveOrderBookState | null>(null);
  const [resync, setResync] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (!open) {
      setResync(null);
      return;
    }
    const connection = createBinanceOrderBookWebSocket({
      symbol,
      depthLimit: 1000,
      onState: setState,
    });
    setResync(() => connection.resync);
    return () => {
      connection.disconnect();
      setResync(null);
    };
  }, [open, symbol]);

  const profileBins = useMemo(() => {
    if (!state) return [];
    const bins = state.executedVolumeProfile.bins;
    if (bins.length <= 9) return bins;
    const poc = state.executedVolumeProfile.poc ?? bins[Math.floor(bins.length / 2)]?.price ?? 0;
    return [...bins].sort((a, b) => Math.abs(a.price - poc) - Math.abs(b.price - poc)).slice(0, 9).sort((a, b) => a.price - b.price);
  }, [state]);

  return (
    <section className="panel border border-[#00d4ff]/20 p-3.5 sm:p-4">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={open}>
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-[#00d4ff]">Module B · Live Order Flow</div>
          <div className="mt-1 text-sm font-semibold text-white">Order book WebSocket + Volume Profile</div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {state && <span className={statusClass(state.status)}>{state.status.toUpperCase()}</span>}
          <span className="text-slate-500">{open ? "Thu gọn" : "Kết nối live"}</span>
        </div>
      </button>

      {open && (
        <div className="mt-3 border-t border-white/10 pt-3">
          {!state && <div className="h-28 animate-pulse rounded-lg bg-slate-800/50" />}
          {state && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className={`rounded-lg border px-3 py-2 text-sm font-black ${pressureClass(state.pressure)}`}>
                  {state.pressure.replace("_", " ")} · {state.imbalancePct >= 0 ? "+" : ""}{state.imbalancePct.toFixed(1)}%
                </div>
                <div className="text-right text-[10px] text-slate-500">
                  <div>Sequence: {state.lastUpdateId ?? "—"}</div>
                  <div>Snapshot+diff · {state.synced ? "đã đồng bộ" : "đang đồng bộ"}</div>
                  <div>{state.executedTrades} aggTrade · 15 phút</div>
                </div>
              </div>

              {state.error && <div className="mt-2 text-[11px] text-amber-200">{state.error}</div>}
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div className="rounded bg-black/20 p-2"><div className="text-slate-500">Spread</div><div className="font-mono text-white">{state.spreadBps == null ? "—" : `${state.spreadBps.toFixed(2)} bps`}</div></div>
                <div className="rounded bg-black/20 p-2"><div className="text-slate-500">Bid depth</div><div className="font-mono text-emerald-300">{money(state.bidDepthUsd)}</div></div>
                <div className="rounded bg-black/20 p-2"><div className="text-slate-500">Ask depth</div><div className="font-mono text-rose-300">{money(state.askDepthUsd)}</div></div>
                <div className="rounded bg-black/20 p-2"><div className="text-slate-500">Executed POC</div><div className="font-mono text-[#00d4ff]">{state.executedVolumeProfile.poc == null ? "—" : state.executedVolumeProfile.poc.toFixed(4)}</div></div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-emerald-300">Bids</div>
                  <div className="space-y-1">
                    {state.bids.slice(0, 6).map((level) => <div key={level.price} className="flex justify-between text-[11px]"><span className="font-mono text-emerald-300">{level.price.toFixed(4)}</span><span className="text-slate-400">{money(level.notional)}</span></div>)}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-rose-300">Asks</div>
                  <div className="space-y-1">
                    {state.asks.slice(0, 6).map((level) => <div key={level.price} className="flex justify-between text-[11px]"><span className="font-mono text-rose-300">{level.price.toFixed(4)}</span><span className="text-slate-400">{money(level.notional)}</span></div>)}
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-[#00d4ff]/15 p-2">
                  <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500"><span>Executed Volume Profile</span><span>Bin {state.executedVolumeProfile.binSize.toFixed(4)}</span></div>
                  <div className="mb-2 grid grid-cols-2 gap-2 text-[10px] text-slate-400"><span>CVD <b className={state.cvd >= 0 ? "text-emerald-300" : "text-rose-300"}>{money(Math.abs(state.cvd))} {state.cvd >= 0 ? "BUY" : "SELL"}</b></span><span>Aggressor <b className={state.aggressiveFlow === "BUY" ? "text-emerald-300" : state.aggressiveFlow === "SELL" ? "text-rose-300" : "text-amber-300"}>{state.aggressiveFlow}</b></span></div>
                  <div className="space-y-1">
                    {profileBins.map((bin) => {
                      const max = Math.max(...profileBins.map((item) => item.totalNotional), 1);
                      const width = Math.max(3, (bin.totalNotional / max) * 100);
                      return <div key={bin.price} className="flex items-center gap-2 text-[10px]"><span className="w-20 shrink-0 text-right font-mono text-slate-400">{bin.price.toFixed(4)}</span><div className="h-2 flex-1 rounded bg-slate-800"><div className={`h-2 rounded ${bin.price === state.executedVolumeProfile.poc ? "bg-[#00d4ff]" : "bg-slate-500"}`} style={{ width: `${width}%` }} /></div><span className="w-16 text-right text-slate-500">{money(bin.totalNotional)}</span></div>;
                    })}
                  </div>
                  <div className="mt-2 text-[10px] text-slate-500">Value area {state.executedVolumeProfile.valueAreaLow == null ? "—" : `${state.executedVolumeProfile.valueAreaLow.toFixed(4)} – ${state.executedVolumeProfile.valueAreaHigh?.toFixed(4)}`} · HVN {state.executedVolumeProfile.hvn.length} · LVN {state.executedVolumeProfile.lvn.length}</div>
                </div>
                <div className="rounded-lg border border-slate-700/60 p-2 text-[10px] text-slate-400">
                  <div className="uppercase tracking-wide text-slate-500">Resting-book liquidity profile</div>
                  <div className="mt-2">POC {state.liquidityProfile.poc == null ? "—" : state.liquidityProfile.poc.toFixed(4)}</div>
                  <div>Value area {state.liquidityProfile.valueAreaLow == null ? "—" : `${state.liquidityProfile.valueAreaLow.toFixed(4)} – ${state.liquidityProfile.valueAreaHigh?.toFixed(4)}`}</div>
                  <div className="mt-2 text-slate-500">Độ sâu lệnh chờ, không phải executed volume.</div>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <button type="button" onClick={() => resync?.()} className="rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-[#00d4ff]/50 hover:text-white">Resync snapshot</button>
                <div className="text-right text-[10px] text-slate-500">100ms diff stream · cập nhật UI 250ms · paper/research only</div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
