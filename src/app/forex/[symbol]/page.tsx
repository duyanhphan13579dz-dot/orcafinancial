"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CandleChart, type Bar } from "@/components/candle-chart";
import { changeColor, fmtNum, fmtPct, usePoll } from "@/lib/client";

interface Detail {
  pair: {
    symbol: string;
    name: string;
    category: string;
    baseCurrency: string;
    quoteCurrency: string;
  };
  price: {
    price: number;
    bid: number | null;
    ask: number | null;
    change: number | null;
    changePercent: number | null;
    source: string;
    timestamp: string;
  } | null;
}

interface Analysis {
  recommendation: "BUY" | "SELL" | "NEUTRAL";
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  confidence: number;
  reasons: string[];
  indicators: Record<string, unknown>;
  candlestickPatterns: Array<{ nameVi: string; type: string; reliability: number }>;
  chartPatterns: Array<{ nameVi: string; type: string; reliability: number }>;
  source: string;
  disclaimer: string;
}

const TFS = ["1m", "5m", "15m", "1h", "4h", "1d"];

export default function ForexDetail() {
  const symbol = String(useParams().symbol).toUpperCase();
  const [tf, setTf] = useState("1h");
  const detail = usePoll<Detail>(`/forex/${symbol}`, 60000);
  const live = usePoll<Detail>(`/forex/${symbol}/price`, 5000);
  const chart = usePoll<{ bars: Bar[] }>(`/forex/${symbol}/ohlcv?timeframe=${tf}&limit=300`, 15000);
  const analysis = usePoll<Analysis>(`/forex/${symbol}/analysis?timeframe=${tf}`, 60000);

  const d = detail.data;
  const p = live.data?.price ?? d?.price;
  const a = analysis.data;
  const style =
    a?.recommendation === "BUY"
      ? "border-emerald-600 bg-emerald-500/10 text-emerald-300"
      : a?.recommendation === "SELL"
        ? "border-rose-600 bg-rose-500/10 text-rose-300"
        : "border-amber-600 bg-amber-500/10 text-amber-300";

  return (
    <div className="space-y-5">
      <Link href="/forex" className="text-xs text-[#00d4ff]">
        ← Forex market
      </Link>

      <div className="panel p-4 flex flex-wrap items-center gap-4">
        <div className="h-12 w-12 rounded-full bg-[#00d4ff]/15 flex items-center justify-center text-lg font-black text-[#00d4ff]">
          FX
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-white">{d?.pair.name ?? symbol}</h1>
            <span className="h-2 w-2 rounded-full bg-emerald-400 live-dot" />
          </div>
          <div className="text-[10px] text-slate-500">
            {p?.source ?? "Yahoo Finance"} · Asia/Ho_Chi_Minh
          </div>
        </div>
        <div className="sm:ml-auto">
          <div className="text-3xl font-black text-white font-mono">
            {fmtNum(p?.price, p?.price && p.price > 1000 ? 2 : 5)}
          </div>
          <div className={`text-right font-bold ${changeColor(p?.changePercent)}`}>
            {fmtPct(p?.changePercent)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="panel p-3 xl:col-span-2">
          <div className="flex flex-wrap justify-between gap-2 mb-2">
            <h2 className="font-semibold text-white">Biểu đồ {symbol}</h2>
            <div className="flex gap-1 overflow-x-auto">
              {TFS.map((x) => (
                <button
                  key={x}
                  onClick={() => setTf(x)}
                  className={`min-h-9 rounded px-3 text-xs ${
                    tf === x ? "bg-[#00d4ff] text-[#0A2540]" : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {x}
                </button>
              ))}
            </div>
          </div>
          {chart.data ? (
            <CandleChart bars={chart.data.bars} height={400} />
          ) : (
            <div className="h-96 flex items-center justify-center text-slate-500">
              Đang tải Yahoo OHLCV...
            </div>
          )}
        </div>

        <div className={`panel border p-4 ${style}`}>
          <div className="text-[10px] tracking-[.25em] uppercase opacity-70">Tín hiệu kỹ thuật</div>
          <div className="text-4xl font-black mt-2">{a?.recommendation ?? "—"}</div>
          <div className="text-sm">Confidence {a ? `${Math.round(a.confidence * 100)}%` : "—"}</div>
          <div className="mt-4 grid grid-cols-2 gap-y-2 text-xs">
            <span className="opacity-60">Entry</span>
            <span className="text-right font-mono">{fmtNum(a?.entryPrice, 5)}</span>
            <span className="opacity-60">Stop Loss</span>
            <span className="text-right font-mono">{fmtNum(a?.stopLoss, 5)}</span>
            <span className="opacity-60">Take Profit</span>
            <span className="text-right font-mono">{fmtNum(a?.takeProfit, 5)}</span>
          </div>
          <ul className="mt-4 text-xs space-y-1">
            {a?.reasons.slice(0, 6).map((x, i) => (
              <li key={i}>• {x}</li>
            ))}
          </ul>
          <div className="text-[9px] opacity-60 mt-4">Không phải lời khuyên đầu tư.</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel p-4">
          <h2 className="font-semibold text-white mb-3">Chỉ báo</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {a &&
              Object.entries(a.indicators)
                .filter(([, v]) => typeof v === "number" || v === null)
                .map(([k, v]) => (
                  <div key={k} className="rounded bg-slate-900/40 p-2 text-xs">
                    <div className="text-slate-500">{k}</div>
                    <div className="font-mono text-white mt-1">
                      {typeof v === "number" ? fmtNum(v, 5) : "—"}
                    </div>
                  </div>
                ))}
          </div>
        </div>
        <div className="panel p-4">
          <h2 className="font-semibold text-white mb-3">Mẫu hình gần đây</h2>
          <div className="space-y-2 text-xs">
            {[...(a?.chartPatterns ?? []), ...(a?.candlestickPatterns ?? [])].slice(0, 8).map((x, i) => (
              <div key={i} className="flex justify-between rounded bg-slate-900/30 p-2">
                <span>{x.nameVi}</span>
                <span
                  className={
                    x.type === "bullish"
                      ? "text-emerald-400"
                      : x.type === "bearish"
                        ? "text-rose-400"
                        : "text-amber-400"
                  }
                >
                  {x.type} · {Math.round(x.reliability * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
