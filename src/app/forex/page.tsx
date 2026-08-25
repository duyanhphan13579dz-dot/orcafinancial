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

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="panel h-32 animate-pulse bg-slate-800/30 p-4" />
      ))}
    </div>
  );
}

export default function ForexPage() {
  // 6s poll — soft cache keeps UI snappy
  const feed = usePoll<{ prices: Row[]; freshness: Record<string, unknown> }>(
    "/forex/prices",
    6_000,
    { softTtlMs: 4_000, hardTtlMs: 60_000 },
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
    <div className="mx-auto max-w-7xl space-y-4 sm:space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[.25em] text-[#00d4ff]">
            Global Rates
          </div>
          <h1 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Forex · Vàng · Dầu · DXY
          </h1>
          <p className="mt-1 text-xs text-slate-400 sm:text-sm">
            26 cặp · tick realtime · GMT+7
          </p>
        </div>
        <span className="inline-flex items-center gap-2 text-xs text-emerald-300">
          <i className="live-dot h-2 w-2 rounded-full bg-emerald-400" />
          LIVE
          {feed.isValidating && (
            <span className="text-[10px] text-slate-500">updating…</span>
          )}
        </span>
      </div>

      <div className="panel sticky top-0 z-10 space-y-3 p-3 backdrop-blur supports-[backdrop-filter]:bg-slate-900/80">
        <input
          className="Input w-full min-h-11 text-base sm:text-sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm EURUSD, USDVND, XAUUSD…"
          autoComplete="off"
          enterKeyHint="search"
        />
        <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {["all", "usd_cross", "vnd_pair", "gold", "oil", "index"].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`min-h-10 shrink-0 rounded-lg border px-3 text-xs ${
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
        <div className="panel border-rose-800 p-4 text-sm text-rose-300">
          {feed.error}
        </div>
      )}
      {feed.loading && !feed.data && <SkeletonGrid />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {rows.map((r) => (
          <Link
            key={r.symbol}
            href={`/forex/${r.symbol}`}
            prefetch={false}
            className="panel p-3 transition active:scale-[.99] hover:border-[#00d4ff]/40 sm:p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-base font-black text-white sm:text-lg">
                  {r.name}
                </div>
                <div className="truncate text-[10px] text-slate-500">
                  {LABELS[r.category] ?? r.category} · {r.symbol}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <span
                  className={`font-mono text-sm font-bold ${changeColor(r.changePercent)}`}
                >
                  {fmtPct(r.changePercent)}
                </span>
                {r.freshness && (
                  <div
                    className={`mt-0.5 font-mono text-[9px] ${freshnessClass(r.freshness)}`}
                  >
                    {r.freshness}
                    {r.ageMs != null ? ` · ${formatAge(r.ageMs)}` : ""}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3 font-mono text-xl font-black text-white sm:text-2xl">
              {fmtNum(r.price, r.price > 1000 ? 2 : r.price < 10 ? 5 : 3)}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] text-slate-500">
              <span className="truncate">Bid {fmtNum(r.bid, 5)}</span>
              <span className="text-center">
                {r.spreadPips != null
                  ? `${fmtNum(r.spreadPips, 1)}p`
                  : "—"}
              </span>
              <span className="truncate text-right">Ask {fmtNum(r.ask, 5)}</span>
            </div>
          </Link>
        ))}
      </div>

      {!feed.loading && feed.data && rows.length === 0 && (
        <div className="panel p-8 text-center text-sm text-slate-500">
          Không có cặp khớp bộ lọc.
        </div>
      )}

      <p className="text-[10px] text-slate-600">
        Dữ liệu tham khảo · không phải lời khuyên đầu tư.
      </p>
    </div>
  );
}
