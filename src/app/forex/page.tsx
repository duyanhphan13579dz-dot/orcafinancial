"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { changeColor, fmtNum, fmtPct, usePoll } from "@/lib/client";

interface Row {
  symbol: string;
  name: string;
  category: string;
  baseCurrency: string;
  quoteCurrency: string;
  price: number;
  bid: number | null;
  ask: number | null;
  spread?: number | null;
  spreadPips?: number | null;
  change: number | null;
  changePercent: number | null;
  source: string;
  timestamp: string;
  freshness?: string;
  ageMs?: number;
}

const LABELS: Record<string, string> = {
  usd_cross: "USD chéo",
  vnd_pair: "Ngoại tệ/VND",
  gold: "Vàng",
  oil: "Dầu thô",
  index: "Chỉ số",
};

function freshnessClass(f?: string) {
  switch (f) {
    case "LIVE":
      return "text-emerald-400";
    case "FRESH":
      return "text-sky-400";
    case "STALE":
      return "text-amber-400";
    case "DEGRADED":
      return "text-orange-400";
    case "OFFLINE":
      return "text-rose-400";
    default:
      return "text-slate-500";
  }
}

function formatAge(ageMs?: number) {
  if (ageMs == null || !Number.isFinite(ageMs)) return "";
  if (ageMs < 1000) return `${ageMs}ms`;
  if (ageMs < 60_000) return `${(ageMs / 1000).toFixed(1)}s`;
  return `${Math.floor(ageMs / 60_000)}m`;
}

export default function ForexPage() {
  // Phase 2: client poll ~5s aligned with price refresh policy
  const feed = usePoll<{ prices: Row[]; freshness: Record<string, unknown> }>(
    "/forex/prices",
    5_000,
  );
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () =>
      (feed.data?.prices ?? []).filter(
        (x) =>
          (category === "all" || x.category === category) &&
          (!query ||
            x.symbol.includes(query.toUpperCase()) ||
            x.name.toLowerCase().includes(query.toLowerCase())),
      ),
    [feed.data, category, query],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between gap-3 items-end">
        <div>
          <div className="font-mono text-[10px] tracking-[.3em] text-[#00d4ff] uppercase">
            Global Rates Monitor
          </div>
          <h1 className="text-3xl font-black text-white mt-1">Forex, Vàng, Dầu & DXY</h1>
          <p className="text-sm text-slate-400 mt-1">
            26 cặp/chỉ số · Realtime tick · GMT+7
          </p>
        </div>
        <span className="inline-flex items-center gap-2 text-xs text-emerald-300">
          <i className="h-2 w-2 rounded-full bg-emerald-400 live-dot" />
          LIVE
        </span>
      </div>

      <div className="panel p-3 space-y-3">
        <input
          className="Input w-full"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm EURUSD, USDVND, XAUUSD..."
        />
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {["all", "usd_cross", "vnd_pair", "gold", "oil", "index"].map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`shrink-0 min-h-10 rounded-lg border px-3 text-xs ${
                category === c
                  ? "border-[#00d4ff] bg-[#00d4ff]/15 text-[#00d4ff]"
                  : "border-slate-700 text-slate-400"
              }`}
            >
              {c === "all" ? "Tất cả" : LABELS[c]}
            </button>
          ))}
        </div>
      </div>

      {feed.error && !feed.data && (
        <div className="panel border-rose-800 p-4 text-rose-300 text-sm">{feed.error}</div>
      )}
      {feed.loading && !feed.data && (
        <div className="panel p-12 text-center text-slate-500">Đang đồng bộ thị trường ngoại hối...</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {rows.map((r) => (
          <Link
            key={r.symbol}
            href={`/forex/${r.symbol}`}
            prefetch
            className="panel p-4 hover:border-[#00d4ff]/50 transition active:scale-[.99]"
          >
            <div className="flex justify-between">
              <div>
                <div className="font-black text-white text-lg">{r.name}</div>
                <div className="text-[10px] text-slate-500">
                  {LABELS[r.category] ?? r.category} · {r.source}
                </div>
              </div>
              <div className="text-right">
                <span className={`font-mono font-bold ${changeColor(r.changePercent)}`}>
                  {fmtPct(r.changePercent)}
                </span>
                {r.freshness && (
                  <div className={`text-[9px] font-mono mt-0.5 ${freshnessClass(r.freshness)}`}>
                    {r.freshness}
                    {r.ageMs != null ? ` · ${formatAge(r.ageMs)}` : ""}
                  </div>
                )}
              </div>
            </div>
            <div className="text-2xl font-black text-white mt-4 font-mono">
              {fmtNum(r.price, r.price > 1000 ? 2 : r.price < 10 ? 5 : 3)}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-slate-500">
              <span>Bid {fmtNum(r.bid, 5)}</span>
              <span className="text-center">
                {r.spreadPips != null
                  ? `Spr ${fmtNum(r.spreadPips, 1)}p`
                  : r.spread != null
                    ? `Spr ${fmtNum(r.spread, 5)}`
                    : "—"}
              </span>
              <span className="text-right">Ask {fmtNum(r.ask, 5)}</span>
            </div>
          </Link>
        ))}
      </div>

      <div className="text-[10px] text-slate-600">
        Phase 2 realtime: price poll 5s · current candle tick-merge · không phải lời khuyên đầu tư.
      </div>
    </div>
  );
}
