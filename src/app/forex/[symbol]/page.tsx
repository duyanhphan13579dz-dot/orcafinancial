"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Bar } from "@/components/candle-chart";
import { api, changeColor, fmtNum, fmtPct, usePoll } from "@/lib/client";

const ChartSkeleton = () => (
  <div className="h-[380px] w-full animate-pulse rounded-lg bg-slate-800/40" />
);

const CandleChart = dynamic(
  () => import("@/components/candle-chart").then((m) => m.CandleChart),
  { ssr: false, loading: ChartSkeleton },
);

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

interface Bundle {
  pair: Detail["pair"];
  price: Detail["price"];
  bars: Bar[];
  timeframe: string;
  source: string;
  analysis: Analysis | null;
}

const TFS = ["1m", "5m", "15m", "1h", "4h", "1d"];

export default function ForexDetail() {
  const symbol = String(useParams().symbol).toUpperCase();
  const [tf, setTf] = useState("1h");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  const [chartSource, setChartSource] = useState("");
  const [bundleLoading, setBundleLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const initialDone = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setBundleLoading(true);
    setBundleError(null);
    api<Bundle>(`/forex/${symbol}/bundle?timeframe=${tf}&limit=200`)
      .then((env) => {
        if (cancelled) return;
        setBundle(env.data);
        setBars(env.data.bars ?? []);
        setChartSource(env.data.source ?? "");
        setBundleLoading(false);
        initialDone.current = true;
      })
      .catch(async (err) => {
        if (cancelled) return;
        try {
          const o = await api<{ bars: Bar[] }>(
            `/forex/${symbol}/ohlcv?timeframe=${tf}&limit=200`,
          );
          if (cancelled) return;
          setBars(o.data.bars ?? []);
          setChartSource(String(o.meta?.source ?? "yahoo"));
          setBundleError(null);
        } catch {
          setBundleError(err instanceof Error ? err.message : String(err));
        }
        setBundleLoading(false);
        initialDone.current = true;
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const loadTf = useCallback(
    async (next: string) => {
      setChartLoading(true);
      setBundleError(null);
      try {
        const o = await api<{ bars: Bar[] }>(
          `/forex/${symbol}/ohlcv?timeframe=${next}&limit=200`,
        );
        setBars(o.data.bars ?? []);
        setChartSource(String(o.meta?.source ?? "yahoo"));
        void api<Analysis>(`/forex/${symbol}/analysis?timeframe=${next}`)
          .then((a) => {
            setBundle((prev) =>
              prev
                ? { ...prev, analysis: a.data, timeframe: next }
                : prev,
            );
          })
          .catch(() => undefined);
      } catch (err) {
        setBundleError(err instanceof Error ? err.message : String(err));
      } finally {
        setChartLoading(false);
      }
    },
    [symbol],
  );

  const onSelectTf = (x: string) => {
    if (x === tf) return;
    setTf(x);
    if (initialDone.current) void loadTf(x);
  };

  const live = usePoll<Detail>(`/forex/${symbol}/price`, 8_000);
  const pair = bundle?.pair;
  const p = live.data?.price ?? bundle?.price;
  const a = bundle?.analysis;
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

      <div className="panel flex flex-wrap items-center gap-4 p-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#00d4ff]/15 text-lg font-black text-[#00d4ff]">
          FX
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-white">{pair?.name ?? symbol}</h1>
            <span className="h-2 w-2 rounded-full bg-emerald-400 live-dot" />
          </div>
          <div className="text-[10px] text-slate-500">
            {(p?.source ?? chartSource) || "multi-source"} · Asia/Ho_Chi_Minh
          </div>
        </div>
        <div className="sm:ml-auto">
          <div className="font-mono text-3xl font-black text-white">
            {fmtNum(p?.price, p?.price && p.price > 1000 ? 2 : 5)}
          </div>
          <div className={`text-right font-bold ${changeColor(p?.changePercent)}`}>
            {fmtPct(p?.changePercent)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="panel p-3 xl:col-span-2">
          <div className="mb-2 flex flex-wrap justify-between gap-2">
            <h2 className="font-semibold text-white">
              Biểu đồ {symbol}
              {chartSource ? (
                <span className="ml-2 text-[10px] font-normal text-slate-500">
                  {chartSource}
                  {chartLoading ? " · đang đổi khung…" : ""}
                </span>
              ) : null}
            </h2>
            <div className="flex gap-1 overflow-x-auto">
              {TFS.map((x) => (
                <button
                  key={x}
                  type="button"
                  onClick={() => onSelectTf(x)}
                  disabled={chartLoading && tf === x}
                  className={`min-h-9 rounded px-3 text-xs ${
                    tf === x
                      ? "bg-[#00d4ff] text-[#0A2540]"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  {x}
                </button>
              ))}
            </div>
          </div>
          {bundleLoading && !bars.length ? (
            <div className="flex h-[360px] items-center justify-center text-sm text-slate-500">
              Đang tải chart…
            </div>
          ) : bundleError && !bars.length ? (
            <div className="flex h-[360px] items-center justify-center text-sm text-rose-400">
              {bundleError}
            </div>
          ) : bars.length > 0 ? (
            <div className={chartLoading ? "opacity-70" : ""}>
              <CandleChart bars={bars} height={360} />
            </div>
          ) : (
            <div className="flex h-[360px] items-center justify-center text-sm text-slate-500">
              Không có dữ liệu OHLCV
            </div>
          )}
          {bundleError && bars.length > 0 && (
            <div className="mt-2 text-[10px] text-amber-400">
              Khung mới: {bundleError} — đang giữ chart cũ.
            </div>
          )}
        </div>

        <div className={`panel border p-4 ${style}`}>
          <div className="text-xs opacity-70">Khuyến nghị · {tf}</div>
          <div className="mt-1 text-3xl font-black">{a?.recommendation ?? "…"}</div>
          <div className="mt-1 text-sm">
            Confidence: {a ? `${Math.round(a.confidence * 100)}%` : "—"}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-y-2 text-xs">
            <span className="opacity-60">Entry</span>
            <span className="text-right font-mono">{fmtNum(a?.entryPrice, 5)}</span>
            <span className="opacity-60">Stop Loss</span>
            <span className="text-right font-mono">{fmtNum(a?.stopLoss, 5)}</span>
            <span className="opacity-60">Take Profit</span>
            <span className="text-right font-mono">{fmtNum(a?.takeProfit, 5)}</span>
          </div>
          <ul className="mt-4 space-y-1 text-xs">
            {a?.reasons.slice(0, 6).map((x, i) => (
              <li key={i}>• {x}</li>
            ))}
          </ul>
          <div className="mt-4 text-[9px] opacity-60">Không phải lời khuyên đầu tư.</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="panel p-4">
          <h2 className="mb-3 font-semibold text-white">Chỉ báo</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {a &&
              Object.entries(a.indicators)
                .filter(([, v]) => typeof v === "number" || v === null)
                .map(([k, v]) => (
                  <div key={k} className="rounded bg-slate-900/40 p-2 text-xs">
                    <div className="text-slate-500">{k}</div>
                    <div className="mt-1 font-mono text-white">
                      {typeof v === "number" ? fmtNum(v, 5) : "—"}
                    </div>
                  </div>
                ))}
          </div>
        </div>
        <div className="panel p-4">
          <h2 className="mb-3 font-semibold text-white">Mẫu hình gần đây</h2>
          <div className="space-y-2 text-xs">
            {[...(a?.chartPatterns ?? []), ...(a?.candlestickPatterns ?? [])]
              .slice(0, 8)
              .map((x, i) => (
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
