"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createBinanceOrderBookWebSocket,
  type LiveOrderBookState,
} from "@/lib/crypto/binance-orderbook-websocket";

function money(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function statusLabel(status: LiveOrderBookState["status"]): string {
  return status === "live" ? "Trực tiếp" : status === "stale" ? "Dữ liệu cũ" : status === "resyncing" ? "Đang đồng bộ" : status === "error" ? "Lỗi" : status;
}

function pressureLabel(pressure: LiveOrderBookState["pressure"]): string {
  return pressure === "BUY_PRESSURE" ? "Áp lực mua" : pressure === "SELL_PRESSURE" ? "Áp lực bán" : "Cân bằng";
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
  const resyncRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) {
      resyncRef.current = null;
      return;
    }
    const connection = createBinanceOrderBookWebSocket({
      symbol,
      depthLimit: 1000,
      onState: setState,
    });
    resyncRef.current = connection.resync;
    return () => {
      connection.disconnect();
      resyncRef.current = null;
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
          <div className="text-[10px] uppercase tracking-[0.16em] text-[#00d4ff]">Mô-đun B · Luồng lệnh trực tiếp</div>
          <div className="mt-1 text-sm font-semibold text-white">Sổ lệnh WebSocket + hồ sơ khối lượng</div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {state && <span className={statusClass(state.status)}>{statusLabel(state.status)}</span>}
          <span className="text-slate-500">{open ? "Thu gọn" : "Kết nối trực tiếp"}</span>
        </div>
      </button>

      {open && (
        <div className="mt-3 border-t border-white/10 pt-3">
          {!state && <div className="h-28 animate-pulse rounded-lg bg-slate-800/50" />}
          {state && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className={`rounded-lg border px-3 py-2 text-sm font-black ${pressureClass(state.pressure)}`}>
                  {pressureLabel(state.pressure)} · {state.imbalancePct >= 0 ? "+" : ""}{state.imbalancePct.toFixed(1)}%
                </div>
                <div className="text-right text-[10px] text-slate-500">
                  <div>Thứ tự: {state.lastUpdateId ?? "—"}</div>
                  <div>Ảnh chụp + chênh lệch · {state.synced ? "đã đồng bộ" : "đang đồng bộ"}</div>
                  <div>{state.executedTrades} giao dịch gộp · 15 phút</div>
                </div>
              </div>

              {state.error && <div className="mt-2 text-[11px] text-amber-200">{state.error}</div>}
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div className="rounded bg-black/20 p-2"><div className="text-slate-500">Chênh lệch</div><div className="font-mono text-white">{state.spreadBps == null ? "—" : `${state.spreadBps.toFixed(2)} bps`}</div></div>
                <div className="rounded bg-black/20 p-2"><div className="text-slate-500">Độ sâu bên mua</div><div className="font-mono text-emerald-300">{money(state.bidDepthUsd)}</div></div>
                <div className="rounded bg-black/20 p-2"><div className="text-slate-500">Độ sâu bên bán</div><div className="font-mono text-rose-300">{money(state.askDepthUsd)}</div></div>
                <div className="rounded bg-black/20 p-2"><div className="text-slate-500">POC khớp lệnh</div><div className="font-mono text-[#00d4ff]">{state.executedVolumeProfile.poc == null ? "—" : state.executedVolumeProfile.poc.toFixed(4)}</div></div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-emerald-300">Bên mua</div>
                  <div className="space-y-1">
                    {state.bids.slice(0, 6).map((level) => <div key={level.price} className="flex justify-between text-[11px]"><span className="font-mono text-emerald-300">{level.price.toFixed(4)}</span><span className="text-slate-400">{money(level.notional)}</span></div>)}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-rose-300">Bên bán</div>
                  <div className="space-y-1">
                    {state.asks.slice(0, 6).map((level) => <div key={level.price} className="flex justify-between text-[11px]"><span className="font-mono text-rose-300">{level.price.toFixed(4)}</span><span className="text-slate-400">{money(level.notional)}</span></div>)}
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-[#00d4ff]/15 p-2">
                  <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500"><span>Hồ sơ khối lượng khớp lệnh</span><span>Bin {state.executedVolumeProfile.binSize.toFixed(4)}</span></div>
                  <div className="mb-2 grid grid-cols-2 gap-2 text-[10px] text-slate-400"><span>CVD <b className={state.cvd >= 0 ? "text-emerald-300" : "text-rose-300"}>{money(Math.abs(state.cvd))} {state.cvd >= 0 ? "Mua" : "Bán"}</b></span><span>Chủ động <b className={state.aggressiveFlow === "BUY" ? "text-emerald-300" : state.aggressiveFlow === "SELL" ? "text-rose-300" : "text-amber-300"}>{state.aggressiveFlow === "BUY" ? "Mua" : state.aggressiveFlow === "SELL" ? "Bán" : "Trung tính"}</b></span></div>
                  <div className="space-y-1">
                    {profileBins.map((bin) => {
                      const max = Math.max(...profileBins.map((item) => item.totalNotional), 1);
                      const width = Math.max(3, (bin.totalNotional / max) * 100);
                      return <div key={bin.price} className="flex items-center gap-2 text-[10px]"><span className="w-20 shrink-0 text-right font-mono text-slate-400">{bin.price.toFixed(4)}</span><div className="h-2 flex-1 rounded bg-slate-800"><div className={`h-2 rounded ${bin.price === state.executedVolumeProfile.poc ? "bg-[#00d4ff]" : "bg-slate-500"}`} style={{ width: `${width}%` }} /></div><span className="w-16 text-right text-slate-500">{money(bin.totalNotional)}</span></div>;
                    })}
                  </div>
                  <div className="mt-2 text-[10px] text-slate-500">Vùng giá trị {state.executedVolumeProfile.valueAreaLow == null ? "—" : `${state.executedVolumeProfile.valueAreaLow.toFixed(4)} – ${state.executedVolumeProfile.valueAreaHigh?.toFixed(4)}`} · HVN {state.executedVolumeProfile.hvn.length} · LVN {state.executedVolumeProfile.lvn.length}</div>
                </div>
                <div className="rounded-lg border border-slate-700/60 p-2 text-[10px] text-slate-400">
                  <div className="uppercase tracking-wide text-slate-500">Hồ sơ thanh khoản lệnh chờ</div>
                  <div className="mt-2">POC {state.liquidityProfile.poc == null ? "—" : state.liquidityProfile.poc.toFixed(4)}</div>
                  <div>Vùng giá trị {state.liquidityProfile.valueAreaLow == null ? "—" : `${state.liquidityProfile.valueAreaLow.toFixed(4)} – ${state.liquidityProfile.valueAreaHigh?.toFixed(4)}`}</div>
                  <div className="mt-2 text-slate-500">Độ sâu lệnh chờ, không phải khối lượng khớp lệnh.</div>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <button type="button" onClick={() => resyncRef.current?.()} className="rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-[#00d4ff]/50 hover:text-white">Đồng bộ lại dữ liệu</button>
                <div className="text-right text-[10px] text-slate-500">Luồng chênh lệch 100ms · giao diện cập nhật 250ms · chỉ mô phỏng/nghiên cứu</div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
