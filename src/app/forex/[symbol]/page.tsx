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

interface QuoteContract {
  symbol: string;
  name: string;
  category: string;
  baseCurrency: string;
  quoteCurrency: string;
  price: number;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  spreadPips: number | null;
  change: number | null;
  changePercent: number | null;
  source: string;
  timestamp: string;
  freshness: string;
  ageMs: number;
}

interface Detail {
  pair: {
    symbol: string;
    name: string;
    category: string;
    baseCurrency: string;
    quoteCurrency: string;
  };
  quote?: QuoteContract | null;
  price: {
    price: number;
    bid: number | null;
    ask: number | null;
    change: number | null;
    changePercent: number | null;
    source: string;
    timestamp: string;
    spread?: number | null;
    spreadPips?: number | null;
    freshness?: string;
    ageMs?: number;
  } | null;
  freshness?: { state?: string; ageMs?: number; timestamp?: string; source?: string };
}

interface LayerScore {
  id: string;
  label: string;
  score: number;
  bias: "bullish" | "bearish" | "neutral";
  weight: number;
  effectiveWeight?: number;
  role?: "directional" | "modulator";
  detail: string[];
}

interface AggregationMeta {
  rawComposite?: number;
  composite?: number;
  agreement?: number;
  conflict?: number;
  coreAligned?: boolean;
  gates?: string[];
}

interface Analysis {
  recommendation: "BUY" | "SELL" | "NEUTRAL";
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  takeProfit2?: number | null;
  confidence: number;
  reasons: string[];
  indicators: Record<string, unknown>;
  layers?: LayerScore[];
  compositeScore?: number;
  aggregation?: AggregationMeta;
  marketStructure?: string;
  volatilityRegime?: string;
  levels?: {
    support?: number | null;
    resistance?: number | null;
    entry?: number | null;
    stopLoss?: number | null;
    takeProfit?: number | null;
    takeProfit2?: number | null;
  };
  candlestickPatterns: Array<{
    name: string;
    nameVi: string;
    type: string;
    reliability: number;
    time?: number;
    barIndex?: number;
  }>;
  chartPatterns: Array<{
    name: string;
    nameVi: string;
    type: string;
    reliability: number;
    endTime?: number;
    startTime?: number;
  }>;
  source: string;
  disclaimer: string;
}

interface Bundle {
  pair: Detail["pair"];
  price: Detail["price"];
  quote?: QuoteContract | null;
  bars: Bar[];
  timeframe: string;
  source: string;
  analysis: Analysis | null;
}

function freshnessClass(f?: string) {
  switch (f) {
    case "LIVE":
      return "bg-emerald-400";
    case "FRESH":
      return "bg-sky-400";
    case "STALE":
      return "bg-amber-400";
    case "DEGRADED":
      return "bg-orange-400";
    case "OFFLINE":
      return "bg-rose-400";
    default:
      return "bg-slate-500";
  }
}

function formatAge(ageMs?: number) {
  if (ageMs == null || !Number.isFinite(ageMs)) return "—";
  if (ageMs < 1000) return `${ageMs}ms ago`;
  if (ageMs < 60_000) return `${(ageMs / 1000).toFixed(1)}s ago`;
  return `${Math.floor(ageMs / 60_000)}m ago`;
}

function biasColor(bias: string) {
  if (bias === "bullish") return "text-emerald-400";
  if (bias === "bearish") return "text-rose-400";
  return "text-amber-400";
}

function scoreBar(score: number) {
  const pct = Math.min(100, Math.abs(score) * 100);
  const positive = score >= 0;
  return { pct, positive };
}

export default function ForexDetail() {
  const symbol = String(useParams().symbol).toUpperCase();
  const tfs = useMemo(() => [...timeframesFor(symbol)], [symbol]);
  const [tf, setTf] = useState(() => defaultTimeframe(symbol));
  const [bundle, setBundle] = useState<Bundle | null>(null);
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

    api<{ bars: Bar[]; quote?: QuoteContract | null }>(
      `/forex/${symbol}/ohlcv?timeframe=${initialTf}&limit=120`,
    )
      .then((env) => {
        if (cancelled) return;
        setBars(env.data.bars ?? []);
        setChartSource(String(env.meta?.source ?? "yahoo"));
        setBundleLoading(false);
        initialDone.current = true;
      })
      .catch(async (err) => {
        if (cancelled) return;
        try {
          const b = await api<Bundle>(
            `/forex/${symbol}/bundle?timeframe=${initialTf}&limit=120`,
          );
          if (cancelled) return;
          setBundle(b.data);
          setBars(b.data.bars ?? []);
          setChartSource(b.data.source ?? "");
          setBundleError(null);
        } catch {
          setBundleError(err instanceof Error ? err.message : String(err));
        }
        setBundleLoading(false);
        initialDone.current = true;
      });

    void api<Bundle>(`/forex/${symbol}/bundle?timeframe=${initialTf}&limit=120`)
      .then((env) => {
        if (cancelled) return;
        setBundle(env.data);
        if (env.data.bars?.length) {
          setBars(env.data.bars);
          setChartSource(env.data.source ?? "");
        }
      })
      .catch(() => undefined);

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
        void api<Analysis>(`/forex/${symbol}/analysis?timeframe=${next}`)
          .then((a) => {
            setBundle((prev) =>
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

  const live = usePoll<Detail>(`/forex/${symbol}/price`, 5_000);
  const pair = bundle?.pair;
  const q = live.data?.quote ?? bundle?.quote ?? null;
  const p = q ?? live.data?.price ?? bundle?.price;
  const freshness =
    q?.freshness ??
    live.data?.freshness?.state ??
    (p && "freshness" in p ? (p as { freshness?: string }).freshness : undefined);
  const ageMs =
    q?.ageMs ??
    live.data?.freshness?.ageMs ??
    (p && "ageMs" in p ? (p as { ageMs?: number }).ageMs : undefined);
  const spreadPips =
    q?.spreadPips ??
    (p && "spreadPips" in p ? (p as { spreadPips?: number | null }).spreadPips : null);
  const a = bundle?.analysis;
  const style =
    a?.recommendation === "BUY"
      ? "border-emerald-600 bg-emerald-500/10 text-emerald-300"
      : a?.recommendation === "SELL"
        ? "border-rose-600 bg-rose-500/10 text-rose-300"
        : "border-amber-600 bg-amber-500/10 text-amber-300";

  const levels = useMemo(() => {
    if (!a) return null;
    return {
      support:
        a.levels?.support ??
        (typeof a.indicators.support === "number" ? a.indicators.support : null),
      resistance:
        a.levels?.resistance ??
        (typeof a.indicators.resistance === "number" ? a.indicators.resistance : null),
      entry: a.levels?.entry ?? a.entryPrice,
      stopLoss: a.levels?.stopLoss ?? a.stopLoss,
      takeProfit: a.levels?.takeProfit ?? a.takeProfit,
      takeProfit2: a.levels?.takeProfit2 ?? a.takeProfit2 ?? null,
    };
  }, [a]);

  const timelinePatterns = useMemo(() => {
    if (!a) return [];
    const candles = (a.candlestickPatterns ?? [])
      .filter((x) => typeof x.time === "number")
      .map((x) => ({
        time: x.time as number,
        name: x.name,
        nameVi: x.nameVi,
        type: x.type as "bullish" | "bearish" | "neutral",
        reliability: x.reliability,
      }));
    const charts = (a.chartPatterns ?? [])
      .filter((x) => typeof x.endTime === "number")
      .map((x) => ({
        time: x.endTime as number,
        name: x.name,
        nameVi: x.nameVi,
        type: x.type as "bullish" | "bearish" | "neutral",
        reliability: x.reliability,
      }));
    return [...candles, ...charts]
      .sort((x, y) => x.time - y.time)
      .slice(-10);
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
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-white">{pair?.name ?? symbol}</h1>
            <span
              className={`h-2 w-2 rounded-full live-dot ${freshnessClass(freshness)}`}
              title={freshness ?? "unknown"}
            />
            {freshness && (
              <span className="text-[10px] font-mono text-slate-400">
                {freshness} · {formatAge(ageMs)}
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-500">
            {(p?.source ?? chartSource) || "multi-source"} · Asia/Ho_Chi_Minh
            {spreadPips != null ? ` · Spread ${fmtNum(spreadPips, 1)} pips` : ""}
            {symbol === "DXY" ? " · khung dài hạn" : ""}
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
              Trading chart · {symbol}
              {chartSource ? (
                <span className="ml-2 text-[10px] font-normal text-slate-500">
                  {chartSource}
                  {chartLoading ? " · đang đổi khung…" : ""}
                </span>
              ) : null}
            </h2>
            <div className="flex gap-1 overflow-x-auto">
              {tfs.map((x) => (
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
          ) : bundleError && !bars.length ? (
            <div className="flex h-[520px] items-center justify-center text-sm text-rose-400">
              {bundleError}
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
            <div className="flex h-[520px] items-center justify-center text-sm text-slate-500">
              Không có dữ liệu OHLCV
            </div>
          )}

          <div className="mt-3 border-t border-slate-800 pt-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
              Pattern timeline · click để nhảy chart
            </div>
            <PatternTimeline
              patterns={timelinePatterns}
              barsLength={bars.length}
              activeTime={focusTime}
              onSelect={setFocusTime}
            />
          </div>

          {bundleError && bars.length > 0 && (
            <div className="mt-2 text-[10px] text-amber-400">
              Khung mới: {bundleError} — đang giữ chart cũ.
            </div>
          )}
        </div>

        <div className={`panel border p-4 ${style}`}>
          <div className="text-xs opacity-70">
            Khuyến nghị · {timeframeLabel(tf)}
          </div>
          <div className="mt-1 text-3xl font-black">{a?.recommendation ?? "…"}</div>
          <div className="mt-1 text-sm">
            Confidence: {a ? `${Math.round(a.confidence * 100)}%` : "—"}
            {a?.compositeScore != null && (
              <span className="ml-2 text-[10px] opacity-70">
                composite {a.compositeScore > 0 ? "+" : ""}
                {a.compositeScore.toFixed(2)}
              </span>
            )}
          </div>
          {a?.aggregation && (
            <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-slate-400">
              {a.aggregation.agreement != null && (
                <span>agree {(a.aggregation.agreement * 100).toFixed(0)}%</span>
              )}
              {a.aggregation.conflict != null && a.aggregation.conflict > 0 && (
                <span className="text-amber-400">
                  conflict {(a.aggregation.conflict * 100).toFixed(0)}%
                </span>
              )}
              {a.aggregation.coreAligned === false && (
                <span className="text-rose-400">core misaligned</span>
              )}
            </div>
          )}
          {(a?.marketStructure || a?.volatilityRegime) && (
            <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
              {a.marketStructure && (
                <span className="rounded bg-slate-900/50 px-2 py-0.5 text-slate-300">
                  Structure {a.marketStructure}
                </span>
              )}
              {a.volatilityRegime && (
                <span className="rounded bg-slate-900/50 px-2 py-0.5 text-slate-300">
                  Vol {a.volatilityRegime}
                </span>
              )}
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
            <span className="opacity-60">Support</span>
            <span className="text-right font-mono text-emerald-400">
              {fmtNum(levels?.support, 5)}
            </span>
            <span className="opacity-60">Resistance</span>
            <span className="text-right font-mono text-rose-400">
              {fmtNum(levels?.resistance, 5)}
            </span>
          </div>
          <ul className="mt-4 space-y-1 text-xs">
            {a?.reasons.slice(0, 6).map((x, i) => (
              <li key={i}>• {x}</li>
            ))}
          </ul>
          <div className="mt-4 text-[9px] opacity-60">Không phải lời khuyên đầu tư.</div>
        </div>
      </div>

      {a?.layers && a.layers.length > 0 && (
        <div className="panel p-4">
          <h2 className="mb-1 font-semibold text-white">Technical Intelligence · 6 layers</h2>
          <p className="mb-4 text-[10px] text-slate-500">
            Directional vote: Trend · Momentum · Structure · Pattern — Volatility/Volume modulate
            confidence only · weights adapt to ADX & vol regime
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {a.layers.map((layer) => {
              const bar = scoreBar(layer.score);
              const w =
                layer.effectiveWeight != null ? layer.effectiveWeight : layer.weight;
              const isMod = layer.role === "modulator";
              return (
                <div
                  key={layer.id}
                  className={`rounded-lg border p-3 ${
                    isMod
                      ? "border-slate-800/60 bg-slate-950/40 opacity-90"
                      : "border-slate-800 bg-slate-900/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">
                      {layer.label}
                      {isMod && (
                        <span className="ml-1 text-[9px] font-normal text-slate-500">
                          modulator
                        </span>
                      )}
                    </span>
                    <span className={`text-[10px] font-mono uppercase ${biasColor(layer.bias)}`}>
                      {layer.bias}
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between text-[10px] text-slate-500">
                    <span>
                      {isMod ? "no vote" : `w ${Math.round(w * 100)}%`}
                    </span>
                    <span className={`font-mono ${biasColor(layer.bias)}`}>
                      {layer.score > 0 ? "+" : ""}
                      {layer.score.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                    <div className="relative h-full w-full">
                      <div className="absolute left-1/2 top-0 h-full w-px bg-slate-600" />
                      <div
                        className={`absolute top-0 h-full ${
                          bar.positive ? "left-1/2 bg-emerald-500/80" : "right-1/2 bg-rose-500/80"
                        }`}
                        style={{ width: `${bar.pct / 2}%` }}
                      />
                    </div>
                  </div>
                  <ul className="mt-2 space-y-0.5 text-[10px] text-slate-400">
                    {layer.detail.slice(0, 3).map((d, i) => (
                      <li key={i} className="truncate" title={d}>
                        · {d}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
                <button
                  key={i}
                  type="button"
                  className="flex w-full justify-between rounded bg-slate-900/30 p-2 text-left hover:bg-slate-800/50"
                  onClick={() => {
                    const t =
                      "time" in x && typeof x.time === "number"
                        ? x.time
                        : "endTime" in x && typeof x.endTime === "number"
                          ? x.endTime
                          : null;
                    if (t) setFocusTime(t);
                  }}
                >
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
                </button>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
