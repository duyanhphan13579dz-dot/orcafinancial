"use client";

import { memo, useState, type ReactNode } from "react";
import type {
  FuturesIntelligence,
  OrderFlowIntelligence,
  WhaleLiquidationIntelligence,
} from "@/lib/crypto/types";

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${Math.round(a)}`;
}

function tone(bias: string): string {
  const b = bias.toUpperCase();
  if (b.includes("LONG") || b.includes("BUY") || b.includes("ACCUM") || b.includes("BULL"))
    return "text-emerald-400";
  if (b.includes("SHORT") || b.includes("SELL") || b.includes("DISTRIB") || b.includes("BEAR"))
    return "text-rose-400";
  return "text-amber-300";
}

function prettyBias(bias: string): string {
  return bias.replace(/_/g, " ");
}

function PanelShell({
  title,
  badge,
  children,
  defaultOpen = true,
}: {
  title: string;
  badge?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-white/[0.02]"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-white">{title}</span>
          {badge && (
            <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
              {badge}
            </span>
          )}
        </div>
        <span className="text-xs text-slate-500">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="border-t border-slate-800/80 px-4 pb-4 pt-3">{children}</div>}
    </section>
  );
}

function MetricTile({
  label,
  value,
  sub,
  subClass,
}: {
  label: string;
  value: string;
  sub?: string;
  subClass?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-gradient-to-b from-slate-900/80 to-slate-950/60 p-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 truncate font-mono text-lg font-bold text-white">{value}</div>
      {sub && <div className={`mt-0.5 text-xs font-medium ${subClass ?? "text-slate-400"}`}>{sub}</div>}
    </div>
  );
}

export function FuturesPanel({ data }: { data: FuturesIntelligence }) {
  if (!data.available) return null;
  const f = data.funding;
  const ls = data.longShort;
  const oi = data.openInterest;

  return (
    <PanelShell
      title="Futures Intelligence"
      badge={data.binanceFuturesSymbol}
      defaultOpen={false}
    >
      <div className="grid grid-cols-3 gap-2">
        <MetricTile
          label="Funding"
          value={
            f.ratePct != null
              ? `${f.ratePct >= 0 ? "+" : ""}${f.ratePct.toFixed(4)}%`
              : "—"
          }
          sub={prettyBias(f.bias)}
          subClass={tone(f.bias)}
        />
        <MetricTile
          label="Long / Short"
          value={
            ls.longAccountPct != null && ls.shortAccountPct != null
              ? `${ls.longAccountPct.toFixed(0)}/${ls.shortAccountPct.toFixed(0)}`
              : "—"
          }
          sub={ls.ratio != null ? `ratio ${ls.ratio.toFixed(2)}` : prettyBias(ls.bias)}
          subClass={tone(ls.bias)}
        />
        <MetricTile
          label="Open Interest"
          value={fmtUsd(oi.openInterestUsd)}
          sub={
            oi.changePct != null
              ? `${oi.changePct >= 0 ? "+" : ""}${oi.changePct.toFixed(2)}% · ${prettyBias(oi.setup)}`
              : prettyBias(oi.setup)
          }
          subClass={tone(oi.setup)}
        />
      </div>
      <p className="mt-3 line-clamp-2 text-[11px] leading-relaxed text-slate-400">{oi.insight}</p>
    </PanelShell>
  );
}

export function WhalePanel({ data }: { data: WhaleLiquidationIntelligence }) {
  if (!data.available) return null;
  const w = data.whale;
  const zones = data.liquidation.zones.slice(0, 6);
  const maxZ = Math.max(1, ...zones.map((z) => z.notionalEstimate));

  return (
    <PanelShell
      title="Whale Liquidations"
      defaultOpen={false}
      badge={`${w.windowMinutes}m · ≥${fmtUsd(data.whaleThresholdUsd)}`}
    >
      <div className="grid grid-cols-3 gap-2">
        <MetricTile
          label="Whale Buy"
          value={fmtUsd(w.buyNotional)}
          sub={`${w.buyCount} orders`}
          subClass="text-emerald-400/80"
        />
        <MetricTile
          label="Whale Sell"
          value={fmtUsd(w.sellNotional)}
          sub={`${w.sellCount} orders`}
          subClass="text-rose-400/80"
        />
        <MetricTile
          label="Net flow"
          value={`${w.netFlow >= 0 ? "+" : ""}${fmtUsd(w.netFlow)}`}
          sub={prettyBias(w.bias)}
          subClass={tone(w.bias)}
        />
      </div>

      {zones.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-[10px] text-slate-500">
            <span>Liq. zones (est.)</span>
            {data.liquidation.markPrice != null && (
              <span>mark ${data.liquidation.markPrice.toFixed(0)}</span>
            )}
          </div>
          <div className="space-y-1">
            {zones.map((z, i) => (
              <div
                key={`${z.side}-${z.price}-${i}`}
                className="relative flex items-center justify-between overflow-hidden rounded-md px-2 py-1 font-mono text-[11px]"
              >
                <div
                  className={`absolute inset-y-0 left-0 ${z.side === "SHORT" ? "bg-rose-500/15" : "bg-emerald-500/15"}`}
                  style={{ width: `${Math.min(100, (z.notionalEstimate / maxZ) * 100)}%` }}
                />
                <span className="relative z-10 text-slate-300">${z.price.toFixed(0)}</span>
                <span
                  className={`relative z-10 ${z.side === "SHORT" ? "text-rose-400" : "text-emerald-400"}`}
                >
                  {z.side === "SHORT" ? "shorts" : "longs"} {fmtUsd(z.notionalEstimate)}
                </span>
                <span className="relative z-10 text-slate-500">
                  {z.distancePct >= 0 ? "↑" : "↓"}
                  {Math.abs(z.distancePct).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {w.events.length > 0 && (
        <div className="mt-3 max-h-28 space-y-0.5 overflow-y-auto border-t border-slate-800/60 pt-2 font-mono text-[10px]">
          {w.events.slice(0, 8).map((e, i) => (
            <div key={`${e.time}-${i}`} className="flex justify-between gap-2 text-slate-400">
              <span className={e.side === "BUY" ? "text-emerald-400" : "text-rose-400"}>
                {e.kind === "WHALE" ? "🐋" : e.kind === "ORDER_WALL" ? "🧱" : "·"} {e.side}
              </span>
              <span className="text-slate-300">${e.price.toFixed(2)}</span>
              <span>{fmtUsd(e.notional)}</span>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

export function OrderFlowPanel({ data }: { data: OrderFlowIntelligence }) {
  const book = data.orderBook;
  if (!data.available || !book) return null;

  const maxN = Math.max(1, ...[...book.bids, ...book.asks].map((l) => l.notional));
  const asks = [...book.asks].reverse().slice(0, 6);
  const bids = book.bids.slice(0, 6);

  return (
    <PanelShell
      title="Order Flow"
      defaultOpen={false}
      badge={`spread ${book.spreadBps != null ? `${book.spreadBps.toFixed(1)}bps` : "—"}`}
    >
      <div className="mb-2">
        <div className="mb-1 flex justify-between text-[10px] text-slate-500">
          <span>Buy {book.imbalance.bidPct.toFixed(0)}%</span>
          <span className={tone(book.imbalance.bias)}>{prettyBias(book.imbalance.bias)}</span>
          <span>Sell {book.imbalance.askPct.toFixed(0)}%</span>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div className="bg-emerald-500" style={{ width: `${book.imbalance.bidPct}%` }} />
          <div className="bg-rose-500" style={{ width: `${book.imbalance.askPct}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-0.5 font-mono text-[10px]">
          <div className="text-[10px] font-semibold uppercase text-rose-400/80">Asks</div>
          {asks.map((lvl) => (
            <div key={`a-${lvl.price}`} className="relative flex justify-between rounded px-1 py-0.5">
              <div
                className="absolute inset-y-0 right-0 bg-rose-500/12"
                style={{ width: `${Math.min(100, (lvl.notional / maxN) * 100)}%` }}
              />
              <span className="relative z-10 text-rose-300">{lvl.price.toFixed(2)}</span>
              <span className="relative z-10 text-slate-500">{lvl.qty.toFixed(3)}</span>
            </div>
          ))}
          <div className="my-1 border-t border-dashed border-slate-700/80" />
          <div className="text-[10px] font-semibold uppercase text-emerald-400/80">Bids</div>
          {bids.map((lvl) => (
            <div key={`b-${lvl.price}`} className="relative flex justify-between rounded px-1 py-0.5">
              <div
                className="absolute inset-y-0 right-0 bg-emerald-500/12"
                style={{ width: `${Math.min(100, (lvl.notional / maxN) * 100)}%` }}
              />
              <span className="relative z-10 text-emerald-300">{lvl.price.toFixed(2)}</span>
              <span className="relative z-10 text-slate-500">{lvl.qty.toFixed(3)}</span>
            </div>
          ))}
        </div>

        <div className="max-h-[200px] space-y-0.5 overflow-y-auto font-mono text-[10px]">
          <div className="sticky top-0 bg-[var(--panel-bg,transparent)] text-[10px] font-semibold uppercase text-slate-500">
            Trades
            {(data.whaleSummary.buyCount > 0 || data.whaleSummary.sellCount > 0) && (
              <span className="ml-1 font-normal text-amber-400/90">
                🐋 {fmtUsd(data.whaleSummary.netFlow)}
              </span>
            )}
          </div>
          {data.recentTrades.slice(0, 14).map((t) => (
            <div
              key={t.id}
              className={`flex justify-between gap-1 rounded px-1 py-0.5 ${t.isWhale ? "bg-amber-500/10" : ""}`}
            >
              <span className={t.side === "BUY" ? "text-emerald-400" : "text-rose-400"}>
                {t.side[0]}
                {t.isWhale ? "🐋" : ""}
              </span>
              <span className="text-slate-300">{t.price.toFixed(2)}</span>
              <span className="text-slate-500">{fmtUsd(t.notional)}</span>
            </div>
          ))}
        </div>
      </div>
    </PanelShell>
  );
}

export const MemoFuturesPanel = memo(FuturesPanel);
export const MemoWhalePanel = memo(WhalePanel);
export const MemoOrderFlowPanel = memo(OrderFlowPanel);
