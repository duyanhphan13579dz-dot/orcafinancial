"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Bar } from "@/components/candle-chart";
import { api, changeColor, fmtNum, fmtPct } from "@/lib/client";
import {
  createBiquoteForexWebSocket,
  fetchBiquoteOhlc,
  type BiquoteForexBar,
  type BiquoteForexStatus,
} from "@/lib/forex/biquote-websocket";
import type { ForexQuoteContract } from "@/lib/forex/types";
import {
  defaultTimeframe,
  timeframeLabel,
  timeframesFor,
} from "@/lib/forex/timeframes";
import {
  MemoForexTradeSetupPanel,
  type TradeSetupData,
} from "@/components/forex-trade-setup";
import { MemoForexIntelligenceCard } from "@/components/forex-intelligence-card";
import ForexScalpingPanel from "@/components/forex-scalping-panel";

const ChartSkeleton = () => (
  <div className="h-[360px] w-full animate-pulse rounded-lg bg-slate-800/40 sm:h-[440px] lg:h-[520px]" />
);

const ForexProChart = dynamic(
  () => import("@/components/forex-pro-chart").then((m) => m.MemoForexProChart),
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
  if (ageMs < 2000) return "just now";
  if (ageMs < 60_000) return `${(ageMs / 1000).toFixed(1)}s`;
  return `${Math.round(ageMs / 60_000)}m`;
}

const BAR_LIMIT = 90;

function mergeBars(older: Bar[], current: Bar[]): Bar[] {
  const byTime = new Map<number, Bar>();
  for (const bar of [...older, ...current]) {
    const previous = byTime.get(bar.time);
    if (!previous) {
      byTime.set(bar.time, bar);
      continue;
    }
    const previousVolume = Number(previous.volume ?? 0);
    const nextVolume = Number(bar.volume ?? 0);
    byTime.set(bar.time, {
      ...previous,
      ...bar,
      open: previous.open,
      high: Math.max(previous.high, bar.high),
      low: Math.min(previous.low, bar.low),
      close: bar.close,
      volume: Math.max(previousVolume, nextVolume),
    });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export default function ForexDetail() {
  const symbol = String(useParams().symbol).toUpperCase();
  const tfs = useMemo(() => [...timeframesFor(symbol)], [symbol]);
  const [tf, setTf] = useState(() => defaultTimeframe(symbol));
  const [bundle, setBundle] = useState<any>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  const [chartSource, setChartSource] = useState("");
  const [bundleLoading, setBundleLoading] = useState(true);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [liveQuote, setLiveQuote] = useState<ForexQuoteContract | null>(null);
  const [liveBar, setLiveBar] = useState<BiquoteForexBar | null>(null);
  const [biquoteStatus, setBiquoteStatus] = useState<BiquoteForexStatus>("connecting");
  const connectionRef = useRef<ReturnType<typeof createBiquoteForexWebSocket> | null>(null);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(true);
  const [showEma, setShowEma] = useState(true);
  const [showBb, setShowBb] = useState(false);
  const [showRsi, setShowRsi] = useState(true);
  const [showMacd, setShowMacd] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const initialDone = useRef(false);
  const analysisGen = useRef(0);
  const historyBeforeRef = useRef<number | null>(null);
  const historyLoadingRef = useRef(false);

  const loadAnalysis = useCallback(
    async (timeframe: string, fast = false) => {
      const gen = ++analysisGen.current;
      setAnalysisLoading(true);
      try {
        const a = await api<any>(
          `/forex/${symbol}/analysis?timeframe=${timeframe}${fast ? "&fast=1" : ""}`,
          { timeoutMs: fast ? 4_200 : 8_500 },
        );
        if (analysisGen.current !== gen) return;
        setBundle((prev: any) =>
          prev
            ? { ...prev, analysis: a.data, timeframe, light: false }
            : {
                analysis: a.data,
                timeframe,
                pair: { symbol, name: symbol },
              },
        );
      } catch {
        /* keep light shell */
      } finally {
        if (analysisGen.current === gen) setAnalysisLoading(false);
      }
    },
    [symbol],
  );

  // Progressive: light bundle first paint → analysis in background
  useEffect(() => {
    const initialTf = defaultTimeframe(symbol);
    queueMicrotask(() => {
      setTf(initialTf);
      setBundleLoading(true);
      setBundleError(null);
      setBars([]);
      setBundle(null);
    });
    initialDone.current = false;
    let cancelled = false;

    void api<any>(
      `/forex/${symbol}/bundle?timeframe=${initialTf}&limit=${BAR_LIMIT}&light=1&ws=1`,
      { timeoutMs: 3_900 },
    )
      .then((env) => {
        if (cancelled) return;
        setBundle(env.data);
        setBars([]);
        historyBeforeRef.current = null;
        setHistoryHasMore(true);
        setChartSource("Biquote OHLC + Biquote WebSocket");
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
  }, [symbol, loadAnalysis]);

  useEffect(() => {
    let active = true;
    setChartLoading(true);
    setBundleError(null);
    setBars([]);
    setLiveQuote(null);
    setLiveBar(null);
    setBiquoteStatus("connecting");
    setHistoryHasMore(true);
    historyBeforeRef.current = null;
    setChartSource("Biquote OHLC + Biquote WebSocket");

    const connection = createBiquoteForexWebSocket({
      symbol,
      timeframe: tf,
      onQuote: (quote) => {
        if (active) setLiveQuote(quote);
      },
      onBar: (bar) => {
        if (!active) return;
        setLiveBar(bar);
        if (bar.isClosed) {
          setBars((current) => mergeBars(current, [bar]));
        }
      },
      onStatus: (status) => {
        if (active) setBiquoteStatus(status);
      },
    });
    connectionRef.current = connection;

    void connection.loadHistory(300).then((history) => {
      if (!active) return;
      const initialBars = history.bars as Bar[];
      setBars(initialBars);
      historyBeforeRef.current = initialBars[0]?.time ?? null;
      setHistoryHasMore(history.hasMore);
      setChartLoading(false);
      setChartSource("Biquote OHLC + Biquote WebSocket");
      void loadAnalysis(tf, true).then(() => {
        if (active) void loadAnalysis(tf);
      });
    }).catch(async (error) => {
      if (!active) return;
      try {
        const fallback = await api<{ bars: Bar[] }>(
          `/forex/${symbol}/ohlcv?timeframe=${tf}&limit=300`,
          { timeoutMs: 6_000 },
        );
        if (!active) return;
        const fallbackBars = fallback.data.bars ?? [];
        setBars(fallbackBars);
        historyBeforeRef.current = fallbackBars[0]?.time ?? null;
        setHistoryHasMore(fallback.meta?.hasMore === true || fallbackBars.length >= BAR_LIMIT);
        setChartSource("Biquote WebSocket unavailable · degraded fallback");
        setBiquoteStatus("error");
        void loadAnalysis(tf, true).then(() => {
          if (active) void loadAnalysis(tf);
        });
      } catch {
        if (active) setBundleError(error instanceof Error ? error.message : "Biquote OHLC unavailable");
      } finally {
        if (active) setChartLoading(false);
      }
    });

    return () => {
      active = false;
      if (connectionRef.current === connection) connectionRef.current = null;
      connection.disconnect();
    };
  }, [symbol, tf, loadAnalysis]);

  const loadMoreHistory = useCallback(async () => {
    if (historyLoadingRef.current || !historyHasMore || historyBeforeRef.current == null) return;
    historyLoadingRef.current = true;
    setHistoryLoadingMore(true);
    const before = historyBeforeRef.current;
    try {
      let page: { bars: Bar[]; hasMore: boolean };
      try {
        page = await fetchBiquoteOhlc(symbol, tf, BAR_LIMIT, before);
      } catch {
        const fallback = await api<{ bars: Bar[] }>(
          `/forex/${symbol}/ohlcv?timeframe=${tf}&limit=${BAR_LIMIT}&before=${before}`,
          { timeoutMs: 6_000 },
        );
        page = { bars: fallback.data.bars ?? [], hasMore: fallback.meta?.hasMore === true };
      }
      const older = page.bars;
      if (!older.length) {
        setHistoryHasMore(false);
        return;
      }
      setBars((current) => mergeBars(older, current));
      historyBeforeRef.current = older[0]?.time ?? before;
      setHistoryHasMore(page.hasMore || older.length >= BAR_LIMIT);
    } catch {
      // Keep the current chart visible; the next edge trigger can retry.
    } finally {
      historyLoadingRef.current = false;
      setHistoryLoadingMore(false);
    }
  }, [symbol, tf, historyHasMore]);

  const onSelectTf = (x: string) => {
    if (x === tf) return;
    setTf(x);
  };

  const pair = bundle?.pair;
  const q = liveQuote ?? bundle?.quote ?? null;
  const p = q ?? bundle?.price;
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

  const freshness = biquoteStatus === "live"
    ? "LIVE"
    : biquoteStatus === "stale"
      ? "STALE"
      : biquoteStatus === "error"
        ? "DEGRADED"
        : p?.freshness as string | undefined;
  const ageMs = p?.ageMs as number | undefined;
  const spreadPips = p?.spreadPips as number | null | undefined;

  return (
    <div className="mx-auto max-w-7xl space-y-3 sm:space-y-4">
      <Link href="/forex" className="inline-block text-xs text-[#00d4ff]">
        ← Forex market
      </Link>

      {/* Sticky compact header */}
      <header className="panel sticky top-0 z-20 flex items-center gap-3 p-3 backdrop-blur supports-[backdrop-filter]:bg-slate-900/85 sm:static sm:flex-wrap sm:gap-4 sm:p-4">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#00d4ff]/15 text-xs font-black text-[#00d4ff] sm:h-11 sm:w-11 sm:text-sm">
            {symbol === "DXY" ? "$" : symbol.slice(0, 2)}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-black text-white sm:text-2xl">
              {displayName}
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
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
                <span className="hidden sm:inline">
                  Spr {spreadPips.toFixed(1)}p
                </span>
              )}
              {fx?.session ? (
                <span className="hidden md:inline">· {fx.session.label}</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="font-mono text-2xl font-black tracking-tight text-white sm:text-3xl">
            {fmtNum(p?.price, p?.price && p.price > 1000 ? 2 : 5)}
          </div>
          <div className={`text-sm font-bold ${changeColor(p?.changePercent)}`}>
            {fmtPct(p?.changePercent)}
          </div>
        </div>
      </header>

      {/* Mobile: signal first · Desktop: chart 2/3 + card 1/3 */}
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-3 lg:gap-4">
        <div className="order-1 lg:order-2 lg:col-span-1">
          {a ? (
            <MemoForexIntelligenceCard
              symbol={symbol}
              timeframeLabel={timeframeLabel(tf)}
              analysis={a}
            />
          ) : (
            <div className="panel space-y-3 p-4">
              <div className="h-4 w-24 animate-pulse rounded bg-slate-700/50" />
              <div className="h-10 w-32 animate-pulse rounded bg-slate-700/40" />
              <div className="h-20 animate-pulse rounded bg-slate-800/40" />
              <p className="text-[10px] text-slate-500">
                {analysisLoading || bundleLoading
                  ? "Đang tính tín hiệu…"
                  : "Chưa có phân tích"}
              </p>
            </div>
          )}
        </div>

        <div className="panel order-2 p-2.5 sm:p-3 lg:order-1 lg:col-span-2">
          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold text-white sm:text-base">
              Chart
            </h2>
            <div className="flex gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {tfs.map((x) => (
                <button
                  key={x}
                  type="button"
                  onClick={() => onSelectTf(x)}
                  className={`min-h-9 shrink-0 rounded px-2.5 text-xs sm:px-3 ${
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
          <div className="mb-2 flex flex-wrap gap-1.5">
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
          {(bundleLoading || chartLoading) && !bars.length ? (
            <ChartSkeleton />
          ) : bars.length > 0 ? (
            <div className={chartLoading ? "opacity-60" : ""}>
              {/* CSS-driven height: mobile / tablet / desktop */}
              <div className="h-[360px] sm:h-[440px] lg:h-[520px]">
                <ForexProChart
                  bars={mergeBars(bars, liveBar ? [liveBar] : [])}
                  height={520}
                  onLoadMore={loadMoreHistory}
                  loadingMore={historyLoadingMore}
                  hasMore={historyHasMore}
                  loadMoreThreshold={24}
                  levels={levels}
                  showEma={showEma}
                  showBb={showBb}
                  showRsi={showRsi}
                  showMacd={showMacd}
                />
              </div>
            </div>
          ) : (
            <div className="flex h-[360px] items-center justify-center text-sm text-rose-400 sm:h-[440px]">
              {bundleError ?? "Không có dữ liệu OHLCV"}
            </div>
          )}
          <div className="mt-1 text-[9px] text-slate-600">
            {chartSource || "—"}
            {analysisLoading ? " · analysis…" : ""}
          </div>
        </div>
      </div>

      {a?.tradeSetup && (
        <MemoForexTradeSetupPanel
          symbol={symbol}
          setup={a.tradeSetup as TradeSetupData}
        />
      )}

      <ForexScalpingPanel symbol={symbol} />

      {/* Secondary intel — collapsible on mobile */}
      {(mtf || fx || macro || analyst) && (
        <div className="space-y-3">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-300 lg:hidden"
            onClick={() => setMoreOpen((v) => !v)}
          >
            <span>MTF · Session · Macro · Analyst</span>
            <span>{moreOpen ? "▲" : "▼"}</span>
          </button>

          <div
            className={`space-y-3 ${
              moreOpen ? "block" : "hidden lg:block"
            }`}
          >
            {analyst?.marketSummary && (
              <div className="panel space-y-2 p-3 text-xs text-slate-300 sm:p-4">
                <h2 className="font-semibold text-white">AI Analyst</h2>
                <p className="line-clamp-4 lg:line-clamp-none">
                  {analyst.marketSummary}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded border border-emerald-900/40 bg-emerald-500/5 p-2">
                    <div className="text-[10px] font-semibold text-emerald-300">
                      Bull
                    </div>
                    <p className="mt-1 text-[10px]">{analyst.bullCase}</p>
                  </div>
                  <div className="rounded border border-rose-900/40 bg-rose-500/5 p-2">
                    <div className="text-[10px] font-semibold text-rose-300">
                      Bear
                    </div>
                    <p className="mt-1 text-[10px]">{analyst.bearCase}</p>
                  </div>
                </div>
              </div>
            )}

            {mtf?.frames?.length > 0 && (
              <div className="panel p-3 sm:p-4">
                <h2 className="mb-1 font-semibold text-white">Multi-Timeframe</h2>
                <p className="mb-2 text-[10px] text-slate-500">{mtf.summary}</p>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 sm:gap-2">
                  {mtf.frames.map((fr: any) => (
                    <div
                      key={fr.timeframe}
                      className="rounded border border-slate-800 p-1.5 text-center text-[10px] sm:p-2 sm:text-xs"
                    >
                      <div className="font-semibold text-white">{fr.label}</div>
                      <div className="uppercase text-slate-400">{fr.bias}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {fx && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
                <div className="panel p-3 text-xs">
                  <h2 className="mb-0.5 font-semibold text-white">Session</h2>
                  <div className="text-base text-[#00d4ff] sm:text-lg">
                    {fx.session.label}
                  </div>
                  <div className="text-slate-400">
                    Vol {fx.session.volatility} · Liq {fx.session.liquidity}
                  </div>
                </div>
                <div className="panel p-3 text-xs">
                  <h2 className="mb-0.5 font-semibold text-white">DXY</h2>
                  <div className="text-slate-300">{fx.dxy.note}</div>
                </div>
                <div className="panel p-3 text-xs">
                  <h2 className="mb-0.5 font-semibold text-white">Strength</h2>
                  <div className="text-slate-300">
                    {fx.pairBiasFromStrength.note}
                  </div>
                </div>
              </div>
            )}

            {macro?.upcoming?.length > 0 && (
              <div className="panel p-3 sm:p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-semibold text-white">Macro</h2>
                  <span className="text-[10px] text-slate-500">
                    {macro.source}
                  </span>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {macro.upcoming.slice(0, 6).map((ev: any) => (
                    <div
                      key={ev.id}
                      className={`min-w-[128px] shrink-0 rounded border p-2 text-[10px] ${
                        ev.impact === "EXTREME" || ev.impact === "HIGH"
                          ? "border-rose-800/50 bg-rose-500/5"
                          : "border-slate-800 bg-slate-900/30"
                      }`}
                    >
                      <div className="text-slate-500">
                        {ev.flag} {ev.impact}
                      </div>
                      <div className="line-clamp-2 font-semibold text-white">
                        {ev.title}
                      </div>
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
        </div>
      )}
    </div>
  );
}
