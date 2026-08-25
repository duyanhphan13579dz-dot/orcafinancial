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
import { ForexIntelligenceCard } from "@/components/forex-intelligence-card";

const ChartSkeleton = () => (
  <div className="h-[420px] w-full animate-pulse rounded-lg bg-slate-800/40 sm:h-[520px]" />
);

const ForexProChart = dynamic(
  () => import("@/components/forex-pro-chart").then((m) => m.ForexProChart),
  { ssr: false, loading: ChartSkeleton },
);

function freshnessDot(f?: string) {
  if (f === "LIVE" || f === "FRESH") return "bg-emerald-400";
  if (f === "STALE") return "bg-amber-400";
  if (f === "DEGRADED" || f === "OFFLINE") return "bg-rose-400";
  return "bg-slate-500";
}

function ageLabel(ageMs?: number | null) {
  if (ageMs == null || !Number.isFinite(ageMs)) return null;
  if (ageMs < 2000) return "Updated just now";
  if (ageMs < 60_000) return `Updated ${(ageMs / 1000).toFixed(1)}s ago`;
  return `Updated ${Math.round(ageMs / 60_000)}m ago`;
}

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
  const macro = a?.macro;
  const analyst = a?.analyst;

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

  const displayName =
    pair?.name ??
    (symbol.length === 6
      ? `${symbol.slice(0, 3)}/${symbol.slice(3)}`
      : symbol);

  const freshness = p?.freshness as string | undefined;
  const ageMs = p?.ageMs as number | undefined;
  const spreadPips = p?.spreadPips as number | null | undefined;

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-0 sm:space-y-5">
      <Link href="/forex" className="text-xs text-[#00d4ff]">
        ← Forex market
      </Link>

      {/* ── Phase 16 Header ── */}
      <header className="panel flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#00d4ff]/15 text-sm font-black text-[#00d4ff]">
            {symbol === "DXY" ? "$" : symbol.slice(0, 2)}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-black text-white sm:text-2xl">
              {displayName}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${freshnessDot(freshness)}`}
                />
                <span className="font-semibold text-slate-300">
                  {freshness ?? "—"}
                </span>
              </span>
              {ageLabel(ageMs) && <span>{ageLabel(ageMs)}</span>}
              {spreadPips != null && Number.isFinite(spreadPips) && (
                <span>Spread {spreadPips.toFixed(1)} pip</span>
              )}
              <span className="truncate">
                {(p?.source ?? chartSource) || "multi-source"}
              </span>
              {fx?.session ? <span>· {fx.session.label}</span> : null}
            </div>
          </div>
        </div>

        <div className="sm:ml-auto sm:text-right">
          <div className="font-mono text-3xl font-black tracking-tight text-white">
            {fmtNum(p?.price, p?.price && p.price > 1000 ? 2 : 5)}
          </div>
          <div className={`font-bold ${changeColor(p?.changePercent)}`}>
            {fmtPct(p?.changePercent)}
          </div>
        </div>
      </header>

      {/* Mobile-first: Intelligence before chart */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-3">
        <div className="order-1 lg:order-2 lg:col-span-1">
          <ForexIntelligenceCard
            symbol={symbol}
            timeframeLabel={timeframeLabel(tf)}
            analysis={a}
          />
        </div>

        <div className="panel order-2 p-3 lg:order-1 lg:col-span-2">
          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <h2 className="font-semibold text-white">
              Chart · {symbol}
            </h2>
            <div className="flex gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {tfs.map((x) => (
                <button
                  key={x}
                  type="button"
                  onClick={() => onSelectTf(x)}
                  className={`min-h-9 shrink-0 rounded px-3 text-xs ${
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
            <div className="flex h-[420px] items-center justify-center text-sm text-slate-500 sm:h-[520px]">
              Đang tải chart…
            </div>
          ) : bars.length > 0 ? (
            <div className={chartLoading ? "opacity-70" : ""}>
              <ForexProChart
                bars={bars}
                height={typeof window !== "undefined" && window.innerWidth < 640 ? 400 : 520}
                levels={levels}
                focusTime={focusTime}
                showEma={showEma}
                showBb={showBb}
                showRsi={showRsi}
                showMacd={showMacd}
              />
            </div>
          ) : (
            <div className="flex h-[420px] items-center justify-center text-sm text-rose-400 sm:h-[520px]">
              {bundleError ?? "Không có dữ liệu OHLCV"}
            </div>
          )}
        </div>
      </div>

      {/* Analyst narrative */}
      {analyst?.marketSummary && (
        <div className="panel space-y-2 p-4 text-xs text-slate-300">
          <h2 className="font-semibold text-white">AI Analyst Summary</h2>
          <p>{analyst.marketSummary}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded border border-emerald-900/40 bg-emerald-500/5 p-2">
              <div className="text-[10px] font-semibold text-emerald-300">Bull case</div>
              <p className="mt-1 text-[10px]">{analyst.bullCase}</p>
            </div>
            <div className="rounded border border-rose-900/40 bg-rose-500/5 p-2">
              <div className="text-[10px] font-semibold text-rose-300">Bear case</div>
              <p className="mt-1 text-[10px]">{analyst.bearCase}</p>
            </div>
          </div>
          {analyst.invalidation && (
            <p className="text-[10px] text-slate-500">
              <span className="font-semibold text-slate-400">Invalidation:</span>{" "}
              {analyst.invalidation}
            </p>
          )}
        </div>
      )}

      {a?.tradeSetup && (
        <ForexTradeSetupPanel symbol={symbol} setup={a.tradeSetup as TradeSetupData} />
      )}

      {mtf?.frames?.length > 0 && (
        <div className="panel p-4">
          <h2 className="mb-2 font-semibold text-white">Multi-Timeframe Trend</h2>
          <p className="mb-3 text-[10px] text-slate-500">{mtf.summary}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
            {mtf.frames.map((fr: any) => (
              <div
                key={fr.timeframe}
                className="rounded border border-slate-800 p-2 text-xs"
              >
                <div className="font-semibold text-white">{fr.label}</div>
                <div className="uppercase text-slate-400">{fr.bias}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {fx && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="panel p-4 text-xs">
            <h2 className="mb-1 font-semibold text-white">Session</h2>
            <div className="text-lg text-[#00d4ff]">{fx.session.label}</div>
            <div className="text-slate-400">
              Vol {fx.session.volatility} · Liq {fx.session.liquidity}
            </div>
          </div>
          <div className="panel p-4 text-xs">
            <h2 className="mb-1 font-semibold text-white">DXY</h2>
            <div className="text-slate-300">{fx.dxy.note}</div>
          </div>
          <div className="panel p-4 text-xs">
            <h2 className="mb-1 font-semibold text-white">Strength bias</h2>
            <div className="text-slate-300">{fx.pairBiasFromStrength.note}</div>
          </div>
        </div>
      )}

      {/* Macro calendar strip */}
      {macro?.upcoming?.length > 0 && (
        <div className="panel p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-white">Macro calendar</h2>
            <span className="text-[10px] text-slate-500">{macro.source}</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {macro.upcoming.slice(0, 8).map((ev: any) => (
              <div
                key={ev.id}
                className={`min-w-[140px] shrink-0 rounded border p-2 text-[10px] ${
                  ev.impact === "EXTREME" || ev.impact === "HIGH"
                    ? "border-rose-800/50 bg-rose-500/5"
                    : "border-slate-800 bg-slate-900/30"
                }`}
              >
                <div className="text-slate-500">
                  {ev.flag} {ev.impact}
                </div>
                <div className="font-semibold text-white line-clamp-2">{ev.title}</div>
                <div className="mt-1 text-slate-400">
                  {ev.minutesUntil >= 0
                    ? `in ${ev.minutesUntil < 60 ? `${ev.minutesUntil}m` : `${Math.round(ev.minutesUntil / 60)}h`}`
                    : `${Math.abs(ev.minutesUntil)}m ago`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
