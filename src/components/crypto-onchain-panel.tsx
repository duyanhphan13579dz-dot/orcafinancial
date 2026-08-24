"use client";

import { useEffect, useState } from "react";
import { api, fmtNum } from "@/lib/client";
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
    <div className="rounded-xl border border-slate-700/50 bg-gradient-to-b from-slate-900/80 to-slate-950/60 p-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 truncate font-mono text-lg font-bold text-white">{value}</div>
      {sub && <div className={`mt-0.5 text-xs ${subClass ?? "text-slate-400"}`}>{sub}</div>}
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
      void api<OnChainIntelligence>(`/crypto/${encodeURIComponent(symbol)}/onchain`)
        .then((r) => {
          if (!cancelled) setData(r.data);
        })
        .catch(() => undefined);
    };
    load();
    const id = setInterval(load, 180_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbol]);

  if (!data) {
    return (
      <section className="panel overflow-hidden">
        <div className="px-4 py-3 text-sm text-slate-500">On-chain · đang tải…</div>
      </section>
    );
  }

  if (!data.available) {
    return (
      <section className="panel overflow-hidden">
        <div className="px-4 py-3">
          <div className="text-sm font-semibold text-white">On-chain</div>
          <p className="mt-1 text-xs text-slate-500">
            Chưa có dữ liệu free cho {symbol}. Netflow CEX cần provider trả phí.
          </p>
        </div>
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
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-white/[0.02]"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-semibold text-white">On-chain</span>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
            {data.sources.join(" · ") || "—"}
          </span>
        </div>
        <span className="text-xs text-slate-500">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="border-t border-slate-800/80 px-4 pb-4 pt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
              sub={
                s.circulating != null
                  ? `${fmtNum(s.circulating, 0)} circ`
                  : undefined
              }
            />
            <Tile label="Market Cap" value={fmtUsd(s.marketCap)} sub={s.fdv != null ? `FDV ${fmtUsd(s.fdv)}` : undefined} />
            <Tile
              label="CEX vol conc."
              value={
                a.exchangeVolumeConcentration != null
                  ? `${(a.exchangeVolumeConcentration * 100).toFixed(0)}%`
                  : "—"
              }
              sub="top-3 / 24h vol"
            />
          </div>

          {(a.commits4w != null || a.githubStars != null || a.twitterFollowers != null) && (
            <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
              {a.commits4w != null && <span>Dev {a.commits4w} commits/4w</span>}
              {a.githubStars != null && <span>★ {fmtNum(a.githubStars, 0)}</span>}
              {a.twitterFollowers != null && (
                <span>𝕏 {fmtNum(a.twitterFollowers, 0)}</span>
              )}
            </div>
          )}

          {d.topChains.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] uppercase text-slate-500">Protocol chains</div>
              <div className="flex flex-wrap gap-1.5">
                {d.topChains.map((c) => (
                  <span
                    key={c.chain}
                    className="rounded-md bg-slate-900/60 px-2 py-1 font-mono text-[10px] text-slate-300"
                  >
                    {c.chain} {fmtUsd(c.tvl)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {data.bitcoin && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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

          <p className="text-[11px] leading-relaxed text-slate-400">{data.assessment}</p>
          <p className="text-[9px] text-slate-600">
            Free sources only. Exchange netflow / labeled whales cần Glassnode/CryptoQuant.
          </p>
        </div>
      )}
    </section>
  );
}
