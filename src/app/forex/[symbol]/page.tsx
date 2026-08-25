"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Bar } from "@/components/candle-chart";
import { api, changeColor, fmtNum, fmtPct, usePoll } from "@/lib/client";
import {
  defaultTimeframe,
  timeframeLabel,
  timeframesFor,
} from "@/lib/forex/timeframes";
import {
  ForexTradeSetupPanel,
  type TradeSetupData,
} from "@/components/forex-trade-setup";

const ChartSkeleton = () => (
  <div className="h-[520px] w-full animate-pulse rounded-lg bg-slate-800/40" />
);

const ForexProChart = dynamic(
  () => import("@/components/forex-pro-chart").then((m) => m.ForexProChart),
  { ssr: false, loading: ChartSkeleton },
);

const PatternTimeline = dynamic(
  () => import("@/components/forex-pro-chart").then((m) => m.PatternTimeline),
  { ssr: false },
);

// NOTE: full page restored — tradeSetup wired below.
// Minimal shell that loads analysis + trade setup to avoid broken placeholder.

export default function ForexDetail() {
  const symbol = String(useParams().symbol).toUpperCase();
  const tfs = useMemo(() => [...timeframesFor(symbol)], [symbol]);
  const [tf, setTf] = useState(() => defaultTimeframe(symbol));
  const [bundle, setBundle] = useState<any>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  const [chartSource, setChartSource] = useState("");
  const [bundleLoading, setBundleLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [focusTime, setFocusTime] = useState<number | null>(null);
  const [showEma, setShowEma] = useState(true);
  const [showBb, setShowBb] = useState(true);
  const [showRsi, setShowRsi] = useState(true);
  const [showMacd, setShowMacd] = useState(true);
  const initialDone = useRef(false);

  useEffect(() => {
    const initialTf = defaultTimeframe(symbol);
    setTf(initialTf);
    initialDone.current = false;
    setFocusTime(null);
    let cancelled = false;
    setBundleLoading(true);
    setBundleError(null);
    setBars([]);

    void api<any>(`/forex/${symbol}/bundle?timeframe=${initialTf}&limit=120`)
      .then((env) => {
        if (cancelled) return;
        setBundle(env.data);
        setBars(env.data.bars ?? []);
        setChartSource(env.data.source ?? "");
        setBundleLoading(false);
        initialDone.current = true;
      })
      .catch((err) => {
        if (cancelled) return;
        setBundleError(err instanceof Error ? err.message : String(err));
        setBundleLoading(false);
        initialDone.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const loadTf = useCallback(
    async (next: string) => {
      setChartLoading(true);
      setBundleError(null);
      setFocusTime(null);
      try {
        const o = await api<{ bars: Bar[] }>(
          `/forex/${symbol}/ohlcv?timeframe=${next}&limit=120`,
        );
        setBars(o.data.bars ?? []);
        setChartSource(String(o.meta?.source ?? "yahoo"));
        void api<any>(`/forex/${symbol}/analysis?timeframe=${next}`)
          .then((a) => {
            setBundle((prev: any) =>
              prev ? { ...prev, analysis: a.data, timeframe: next } : prev,
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

  const live = usePoll<any>(`/forex/${symbol}/price`, 5_000);
  const pair = bundle?.pair;
  const q = live.data?.quote ?? bundle?.quote ?? null;
  const p = q ?? live.data?.price ?? bundle?.price;
  const a = bundle?.analysis;
  const mtf = a?.mtf;
  const fx = a?.fxIntelligence;
  const style =
    a?.recommendation === "BUY"
      ? "border-emerald-600 bg-emerald-500/10 text-emerald-300"
      : a?.recommendation === "SELL"
        ? "border-rose-600 bg-rose-500/10 text-rose-300"
        : "border-amber-600 bg-amber-500/10 text-amber-300";

  const levels = useMemo(() => {
    if (!a) return null;
    return {
      support: a.levels?.support ?? null,
      resistance: a.levels?.resistance ?? null,
      entry: a.levels?.entry ?? a.entryPrice,
      stopLoss: a.levels?.stopLoss ?? a.stopLoss,
      takeProfit: a.levels?.takeProfit ?? a.takeProfit,
      takeProfit2: a.levels?.takeProfit2 ?? a.takeProfit2 ?? null,
    };
  }, [a]);

  return (
    <div className="space-y-5">
      <Link href="/forex" className="text-xs text-[#00d4ff]">
        ← Forex market
      </Link>

      <div className="panel flex flex-wrap items-center gap-4 p-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#00d4ff]/15 text-lg font-black text-[#00d4ff]">
          {symbol === "DXY" ? "$" : "FX"}
        </div>
        <div>
          <h1 className="text-2xl font-black text-white">{pair?.name ?? symbol}</h1>
          <div className="text-[10px] text-slate-500">
            {(p?.source ?? chartSource) || "multi-source"}
            {fx?.session ? ` · ${fx.session.label}` : ""}
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
            <h2 className="font-semibold text-white">Trading chart · {symbol}</h2>
            <div className="flex gap-1 overflow-x-auto">
              {tfs.map((x) => (
                <button
                  key={x}
                  type="button"
                  onClick={() => onSelectTf(x)}
                  className={`min-h-9 rounded px-3 text-xs ${
                    tf === x
                      ? "bg-[#00d4ff] text-[#0A2540]"
                      : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {timeframeLabel(x)}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-2 flex flex-wrap gap-2">
            {(
              [
                ["EMA", showEma, setShowEma],
                ["BB", showBb, setShowBb],
                ["RSI", showRsi, setShowRsi],
                ["MACD", showMacd, setShowMacd],
              ] as const
            ).map(([label, on, set]) => (
              <button
                key={label}
                type="button"
                onClick={() => set(!on)}
                className={`rounded border px-2 py-1 text-[10px] ${
                  on
                    ? "border-[#00d4ff]/50 bg-[#00d4ff]/10 text-[#00d4ff]"
                    : "border-slate-700 text-slate-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {bundleLoading && !bars.length ? (
            <div className="flex h-[520px] items-center justify-center text-sm text-slate-500">
              Đang tải chart…
            </div>
          ) : bars.length > 0 ? (
            <div className={chartLoading ? "opacity-70" : ""}>
              <ForexProChart
                bars={bars}
                height={520}
                levels={levels}
                focusTime={focusTime}
                showEma={showEma}
                showBb={showBb}
                showRsi={showRsi}
                showMacd={showMacd}
              />
            </div>
          ) : (
            <div className="flex h-[520px] items-center justify-center text-sm text-rose-400">
              {bundleError ?? "Không có dữ liệu OHLCV"}
            </div>
          )}
        </div>

        <div className={`panel border p-4 ${style}`}>
          <div className="text-xs opacity-70">Khuyến nghị · {timeframeLabel(tf)}</div>
          <div className="mt-1 text-3xl font-black">{a?.recommendation ?? "…"}</div>
          <div className="mt-1 text-sm">
            Confidence: {a ? `${Math.round(a.confidence * 100)}%` : "—"}
          </div>
          {mtf && (
            <div className="mt-2 text-[10px] text-slate-400">
              MTF {mtf.overall} · align {(mtf.alignment * 100).toFixed(0)}%
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-y-2 text-xs">
            <span className="opacity-60">Entry</span>
            <span className="text-right font-mono">{fmtNum(a?.entryPrice, 5)}</span>
            <span className="opacity-60">Stop Loss</span>
            <span className="text-right font-mono">{fmtNum(a?.stopLoss, 5)}</span>
            <span className="opacity-60">Take Profit 1</span>
            <span className="text-right font-mono">{fmtNum(a?.takeProfit, 5)}</span>
            <span className="opacity-60">Take Profit 2</span>
            <span className="text-right font-mono">{fmtNum(a?.takeProfit2, 5)}</span>
          </div>
          <ul className="mt-4 space-y-1 text-xs">
            {(a?.reasons ?? []).slice(0, 6).map((x: string, i: number) => (
              <li key={i}>• {x}</li>
            ))}
          </ul>
        </div>
      </div>

      {a?.tradeSetup && (
        <ForexTradeSetupPanel symbol={symbol} setup={a.tradeSetup as TradeSetupData} />
      )}

      {mtf?.frames?.length > 0 && (
        <div className="panel p-4">
          <h2 className="mb-2 font-semibold text-white">Multi-Timeframe Trend</h2>
          <p className="mb-3 text-[10px] text-slate-500">{mtf.summary}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {mtf.frames.map((fr: any) => (
              <div key={fr.timeframe} className="rounded border border-slate-800 p-2 text-xs">
                <div className="font-semibold text-white">{fr.label}</div>
                <div className="uppercase text-slate-400">{fr.bias}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {fx && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="panel p-4 text-xs">
            <h2 className="mb-1 font-semibold text-white">Session</h2>
            <div className="text-lg text-[#00d4ff]">{fx.session.label}</div>
            <div>Vol {fx.session.volatility} · Liq {fx.session.liquidity}</div>
          </div>
          <div className="panel p-4 text-xs">
            <h2 className="mb-1 font-semibold text-white">DXY</h2>
            <div>{fx.dxy.note}</div>
          </div>
          <div className="panel p-4 text-xs">
            <h2 className="mb-1 font-semibold text-white">Strength bias</h2>
            <div>{fx.pairBiasFromStrength.note}</div>
          </div>
        </div>
      )}
    </div>
  );
}
