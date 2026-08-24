"use client";

import { useEffect, useState } from "react";
import { api, fmtNum } from "@/lib/client";
import { isDocumentVisible, whenVisible } from "@/lib/client-visibility";
import type { OnChainIntelligence } from "@/lib/crypto/types";

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${Math.round(a)}`;
}

function Tile({
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
    <div className="rounded-lg border border-slate-700/40 bg-slate-900/50 p-2.5">
      <div className="text-[9px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 truncate font-mono text-base font-bold text-white">{value}</div>
      {sub && <div className={`mt-0.5 text-[10px] ${subClass ?? "text-slate-400"}`}>{sub}</div>}
    </div>
  );
}

export function CryptoOnChainPanel({ symbol }: { symbol: string }) {
  const [data, setData] = useState<OnChainIntelligence | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const load = () => {
      if (!isDocumentVisible()) return;
      void api<OnChainIntelligence>(`/crypto/${encodeURIComponent(symbol)}/onchain`)
        .then((r) => {
          if (!cancelled) setData(r.data);
        })
        .catch(() => undefined);
    };
    const t = setTimeout(load, 600);
    const id = setInterval(load, 240_000);
    const off = whenVisible(load);
    return () => {
      cancelled = true;
      clearTimeout(t);
      clearInterval(id);
      off();
    };
  }, [symbol]);

  if (!data) {
    return (
      <section className="panel overflow-hidden">
        <div className="px-4 py-2.5 text-xs text-slate-500">On-chain · …</div>
      </section>
    );
  }

  if (!data.available) {
    return (
      <section className="panel overflow-hidden">
        <div className="px-4 py-2.5 text-xs text-slate-500">On-chain · N/A</div>
      </section>
    );
  }

  const d = data.defi;
  const s = data.supply;
  const a = data.activity;

  return (
    <section className="panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-white/[0.02]"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-semibold text-white">On-chain</span>
          <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            {data.sources.join(" · ") || "—"}
          </span>
        </div>
        <span className="text-xs text-slate-500">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-slate-800/80 px-3 pb-3 pt-2.5">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <Tile
              label="DeFi TVL"
              value={fmtUsd(d.tvl)}
              sub={
                d.tvlChange1d != null
                  ? `${d.tvlChange1d >= 0 ? "+" : ""}${d.tvlChange1d.toFixed(1)}% 1d`
                  : d.protocolName ?? undefined
              }
              subClass={
                d.tvlChange1d != null
                  ? d.tvlChange1d >= 0
                    ? "text-emerald-400"
                    : "text-rose-400"
                  : undefined
              }
            />
            <Tile
              label="Circ / Supply"
              value={
                s.circulatingRatio != null
                  ? `${(s.circulatingRatio * 100).toFixed(0)}%`
                  : "—"
              }
              sub={s.circulating != null ? `${fmtNum(s.circulating, 0)} circ` : undefined}
            />
            <Tile
              label="Market Cap"
              value={fmtUsd(s.marketCap)}
              sub={s.fdv != null ? `FDV ${fmtUsd(s.fdv)}` : undefined}
            />
            <Tile
              label="CEX vol conc."
              value={
                a.exchangeVolumeConcentration != null
                  ? `${(a.exchangeVolumeConcentration * 100).toFixed(0)}%`
                  : "—"
              }
              sub="top-3 / 24h"
            />
          </div>

          {data.bitcoin && (
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <Tile
                label="Fee fast"
                value={
                  data.bitcoin.feeFastSatVb != null
                    ? `${data.bitcoin.feeFastSatVb} sat/vB`
                    : "—"
                }
              />
              <Tile
                label="Fee ~30m"
                value={
                  data.bitcoin.feeHalfHourSatVb != null
                    ? `${data.bitcoin.feeHalfHourSatVb} sat/vB`
                    : "—"
                }
              />
              <Tile
                label="Hashrate"
                value={
                  data.bitcoin.hashrateEh != null
                    ? `${data.bitcoin.hashrateEh.toFixed(0)} EH/s`
                    : "—"
                }
              />
              <Tile
                label="Difficulty"
                value={
                  data.bitcoin.difficulty != null
                    ? fmtNum(data.bitcoin.difficulty, 0)
                    : "—"
                }
              />
            </div>
          )}

          <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-400">{data.assessment}</p>
        </div>
      )}
    </section>
  );
}
