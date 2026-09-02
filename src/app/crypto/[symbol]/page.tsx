"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Bar } from "@/components/candle-chart";
import {
  MemoFuturesPanel,
  MemoOrderFlowPanel,
  MemoWhalePanel,
} from "@/components/crypto-intel-panels";
import { MemoCryptoOnChainPanel } from "@/components/crypto-onchain-panel";
import { MemoCryptoSentimentPanel } from "@/components/crypto-sentiment-panel";
import { api, changeColor, fmtNum, fmtPct } from "@/lib/client";
import { isDocumentVisible, whenVisible } from "@/lib/client-visibility";
import {
  createBinanceChartWebSocket,
  type BinanceChartBar,
  type BinanceChartHistory,
  type BinanceChartStatus,
  type BinanceLiveTicker,
} from "@/lib/crypto/binance-chart-websocket";
import { computeLeverageLevels } from "@/lib/crypto/leverage-levels";
import type {
  FuturesIntelligence,
  OrderFlowIntelligence,
  WhaleLiquidationIntelligence,
} from "@/lib/crypto/types";

const ChartSkeleton = () => (
  <div className="h-[360px] w-full animate-pulse rounded-lg bg-slate-800/40" />
);

const CandleChart = dynamic(
    () => import("@/components/candle-chart").then((m) => m.MemoCandleChart),
  { ssr: false, loading: ChartSkeleton },
);

interface Detail {
  coin: {
    symbol: string;
    name: string;
    logoUrl: string | null;
    website: string | null;
    description: string | null;
    marketCapRank: number | null;
    circulatingSupply: number | null;
    totalSupply: number | null;
    maxSupply: number | null;
    binanceSymbol?: string | null;
  };
  price: {
    price: number;
    priceVnd: number | null;
    volume24h: number | null;
    marketCap: number | null;
    change24h: number | null;
    source: string;
    timestamp: string;
  } | null;
}

interface Analysis {
  recommendation: "LONG" | "SHORT" | "NEUTRAL";
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  confidence: number;
  reasons: string[];
  sentiment: number;
  indicators: Record<string, unknown>;
  candlestickPatterns: Array<{ nameVi: string; type: string; reliability: number }>;
  chartPatterns: Array<{ nameVi: string; type: string; reliability: number }>;
  disclaimer: string;
}

interface Bundle {
  coin: Detail["coin"];
  price: Detail["price"];
  bars: Bar[];
  timeframe: string;
  source: string;
  analysis: Analysis | null;
  futures?: FuturesIntelligence | null;
}

interface IntelPayload {
  futures: FuturesIntelligence | null;
  orderFlow: OrderFlowIntelligence | null;
  whale: WhaleLiquidationIntelligence | null;
  layersOk: string[];
  cacheHit?: boolean;
}

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"];
const LEVERAGE_PRESETS = [0, 5, 10, 20, 50, 100, 125, 200, 500];
const INTEL_POLL_MS = 8_000;

function mergeBars(older: Bar[], current: Bar[]): Bar[] {
  const byTime = new Map<number, Bar>();
  for (const bar of [...older, ...current]) byTime.set(bar.time, bar);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export default function CryptoDetail() {
  const params = useParams();
  const symbol = String(params.symbol ?? "").toUpperCase();

  const [timeframe, setTimeframe] = useState("1h");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  const [chartSource, setChartSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<
    "connecting" | "connected" | "reconnecting" | "disconnected" | "error"
  >("connecting");
  const [wsPrice, setWsPrice] = useState<number | null>(null);
  const [wsTicker, setWsTicker] = useState<BinanceLiveTicker | null>(null);
  const [wsKline, setWsKline] = useState<BinanceChartBar | null>(null);
  const [wsHistoryBars, setWsHistoryBars] = useState<Bar[]>([]);
  const chartConnRef = useRef<ReturnType<typeof createBinanceChartWebSocket> | null>(null);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(true);
  const [orderFlow, setOrderFlow] = useState<OrderFlowIntelligence | null>(null);
  const [whaleLiq, setWhaleLiq] = useState<WhaleLiquidationIntelligence | null>(null);
  const [intelFutures, setIntelFutures] = useState<FuturesIntelligence | null>(null);
  const [leverage, setLeverage] = useState(10);

  const initialDone = useRef(false);
  const historyBeforeRef = useRef<number | null>(null);
  const historyLoadingRef = useRef(false);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
    });

    void api<Bundle>(
      `/crypto/${encodeURIComponent(symbol)}/bundle?timeframe=${encodeURIComponent(timeframe)}&limit=120&light=1`,
    )
      .then((res) => {
        if (cancelled) return;
        setBundle(res.data);
        const initialBars = res.data.bars ?? [];
        setBars(initialBars);
        historyBeforeRef.current = initialBars[0]?.time ?? null;
        setHistoryHasMore(initialBars.length >= 120);
        setChartSource(res.data.source ?? "");
        setLoading(false);
        initialDone.current = true;
        // Keep the first paint focused on coin/price/OHLCV. Analysis is the
        // expensive path and is hydrated after the chart is visible.
        void api<Analysis>(
          `/crypto/${encodeURIComponent(symbol)}/analysis?timeframe=${encodeURIComponent(timeframe)}&fast=1`,
        )
          .then((analysisRes) => {
            if (cancelled) return;
            setBundle((prev) =>
              prev
                ? { ...prev, analysis: analysisRes.data, timeframe }
                : prev,
            );
          })
          .catch(() => undefined);
      })
      .catch(async (err) => {
        if (cancelled) return;
        try {
          const o = await api<{ bars: Bar[] }>(
            `/crypto/${encodeURIComponent(symbol)}/ohlcv?timeframe=${encodeURIComponent(timeframe)}&limit=200`,
          );
          if (cancelled) return;
          const fallbackBars = o.data.bars ?? [];
          setBars(fallbackBars);
          historyBeforeRef.current = fallbackBars[0]?.time ?? null;
          setHistoryHasMore(o.meta?.hasMore === true || fallbackBars.length >= 200);
          setChartSource(String(o.meta?.source ?? "binance"));
          setBundle({
            coin: {
              symbol,
              name: symbol,
              logoUrl: null,
              website: null,
              description: null,
              marketCapRank: null,
              circulatingSupply: null,
              totalSupply: null,
              maxSupply: null,
              binanceSymbol: `${symbol}USDT`,
            },
            price: null,
            bars: o.data.bars,
            timeframe,
            source: String(o.meta?.source ?? "binance"),
            analysis: null,
            futures: null,
          });
          setError(null);
          void api<Analysis>(
            `/crypto/${encodeURIComponent(symbol)}/analysis?timeframe=${encodeURIComponent(timeframe)}&fast=1`,
          )
            .then((analysisRes) => {
              if (cancelled) return;
              setBundle((prev) =>
                prev
                  ? { ...prev, analysis: analysisRes.data, timeframe }
                  : prev,
              );
            })
            .catch(() => undefined);
        } catch {
          setError(err instanceof Error ? err.message : String(err));
        }
        setLoading(false);
        initialDone.current = true;
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // Single batched intel poll (futures + orderflow + whale)
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const load = () => {
      if (!isDocumentVisible()) return;
      void api<IntelPayload>(`/crypto/${encodeURIComponent(symbol)}/intel`)
        .then((r) => {
          if (cancelled) return;
          const d = r.data;
          if (d.orderFlow) setOrderFlow(d.orderFlow);
          if (d.whale) setWhaleLiq(d.whale);
          if (d.futures) {
            setIntelFutures(d.futures);
            setBundle((prev) => (prev ? { ...prev, futures: d.futures } : prev));
          }
        })
        .catch(() => undefined);
    };
    // Intel is valuable but not part of the critical first paint. Waiting a
    // short moment prevents its four upstream legs from competing with the
    // chart/price bundle on a cold detail page.
    const boot = window.setTimeout(load, 650);
    const id = setInterval(load, INTEL_POLL_MS);
    const off = whenVisible(load);
    return () => {
      cancelled = true;
      window.clearTimeout(boot);
      clearInterval(id);
      off();
    };
  }, [symbol]);

  const loadTimeframe = useCallback(
    async (tf: string) => {
      if (!symbol) return;
      setChartLoading(true);
      setWsKline(null);
      setHistoryHasMore(true);
      historyBeforeRef.current = null;
      setError(null);
      try {
        const o = await api<{ bars: Bar[] }>(
          `/crypto/${encodeURIComponent(symbol)}/ohlcv?timeframe=${encodeURIComponent(tf)}&limit=200`,
        );
        const nextBars = o.data.bars ?? [];
        setBars(nextBars);
        historyBeforeRef.current = nextBars[0]?.time ?? null;
        setHistoryHasMore(o.meta?.hasMore === true || nextBars.length >= 200);
        setChartSource(String(o.meta?.source ?? "binance"));
        void api<Analysis>(
          `/crypto/${encodeURIComponent(symbol)}/analysis?timeframe=${encodeURIComponent(tf)}&fast=1`,
        )
          .then((a) => {
            setBundle((prev) =>
              prev ? { ...prev, analysis: a.data, timeframe: tf } : prev,
            );
          })
          .catch(() => undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setChartLoading(false);
      }
    },
    [symbol],
  );

  const loadMoreHistory = useCallback(async () => {
    if (historyLoadingRef.current || !historyHasMore || historyBeforeRef.current == null) return;
    historyLoadingRef.current = true;
    setHistoryLoadingMore(true);
    const before = historyBeforeRef.current;
    try {
      if (chartConnRef.current) {
        // Pull older history directly from Binance WebSocket API.
        const page = await chartConnRef.current.loadHistory(200, before * 1000);
        const older = page.bars;
        if (!older.length) {
          setHistoryHasMore(false);
          return;
        }
        setWsHistoryBars((current) => mergeBars(older, current));
        historyBeforeRef.current = older[0]?.time ?? before;
        setHistoryHasMore(page.hasMore);
        return;
      }
      const page = await api<{ bars: Bar[] }>(
        `/crypto/${encodeURIComponent(symbol)}/ohlcv?timeframe=${encodeURIComponent(timeframe)}&limit=200&before=${before}`,
        { timeoutMs: 8_000 },
      );
      const older = page.data.bars ?? [];
      if (!older.length) {
        setHistoryHasMore(false);
        return;
      }
      setBars((current) => mergeBars(older, current));
      historyBeforeRef.current = older[0]?.time ?? before;
      setHistoryHasMore(page.meta?.hasMore === true || older.length >= 200);
    } catch {
      // Keep the current chart visible and allow retry on the next edge trigger.
    } finally {
      historyLoadingRef.current = false;
      setHistoryLoadingMore(false);
    }
  }, [symbol, timeframe, historyHasMore]);

  const onSelectTf = (tf: string) => {
    if (tf === timeframe) return;
    setTimeframe(tf);
    if (initialDone.current) void loadTimeframe(tf);
  };

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    // Chart + live stream are pulled **directly from Binance WebSocket** so the
    // chart loads even when the app's server can't reach Binance over REST.
    chartConnRef.current?.disconnect();
    chartConnRef.current = null;
    queueMicrotask(() => {
      if (cancelled) return;
      setWsPrice(null);
      setWsKline(null);
      setWsHistoryBars([]);
      setWsStatus("connecting");
    });
    const binanceSymbol = bundle?.coin?.binanceSymbol || `${symbol}USDT`;
    const connection = createBinanceChartWebSocket({
      symbol: binanceSymbol,
      timeframe,
      onTicker: (ticker) => {
        setWsTicker(ticker);
        setWsPrice(ticker.price);
      },
      onKline: (kline) => setWsKline(kline),
      onHistory: (history: BinanceChartHistory) => {
        if (cancelled) return;
        const bars = history.bars;
        setWsHistoryBars(bars);
        historyBeforeRef.current = bars[0]?.time ?? null;
        setHistoryHasMore(history.hasMore || bars.length >= 120);
        setChartSource(history.source);
      },
      onStatus: (status: BinanceChartStatus) => {
        const mapped =
          status === "live" || status === "connected"
            ? "connected"
            : status === "loading-history" || status === "connecting"
              ? "connecting"
              : status === "reconnecting" || status === "stale"
                ? "reconnecting"
                : status === "error"
                  ? "error"
                  : "disconnected";
        setWsStatus(mapped);
      },
    });
    chartConnRef.current = connection;
    // Initial chart history from Binance's WebSocket API (browser-side).
    void connection.loadHistory(120).catch(() => undefined);
    return () => {
      cancelled = true;
      connection.disconnect();
      if (chartConnRef.current === connection) chartConnRef.current = null;
    };
  }, [symbol, timeframe, bundle?.coin?.binanceSymbol]);

  const price = useMemo(() => {
    const rest = bundle?.price;
    if (wsPrice == null) return rest;
    return {
      ...(rest ?? {
        price: wsPrice,
        priceVnd: null,
        volume24h: null,
        marketCap: null,
        change24h: null,
        source: "Binance WebSocket",
        timestamp: new Date().toISOString(),
      }),
      price: wsPrice,
      change24h: wsTicker?.change24h ?? rest?.change24h ?? null,
      volume24h: wsTicker?.volume24h ?? rest?.volume24h ?? null,
      source: "Binance WebSocket",
      timestamp: new Date().toISOString(),
    };
  }, [bundle?.price, wsPrice, wsTicker]);

  const chartBars = useMemo(() => {
    // Prefer the Binance WebSocket history (direct source) over the REST fallback.
    const base = wsHistoryBars.length > 0 ? wsHistoryBars : bars;
    if (base.length === 0 || !wsKline) return base;
    const realtimeBar: Bar = {
      time: wsKline.time,
      open: wsKline.open,
      high: wsKline.high,
      low: wsKline.low,
      close: wsKline.close,
      volume: wsKline.volume,
    };
    const last = base[base.length - 1];
    if (last && last.time === realtimeBar.time) return [...base.slice(0, -1), realtimeBar];
    if (last && realtimeBar.time > last.time) return [...base, realtimeBar];
    return base;
  }, [bars, wsHistoryBars, wsKline]);

  const coin = bundle?.coin;
  const analysis = bundle?.analysis;
  const futures = intelFutures ?? bundle?.futures ?? null;

  const levLevels = useMemo(() => {
    if (!analysis || !Number.isFinite(analysis.entryPrice)) return null;
    return computeLeverageLevels({
      recommendation: analysis.recommendation,
      entryPrice: analysis.entryPrice,
      stopLoss: analysis.stopLoss,
      takeProfit: analysis.takeProfit,
      markPrice: price?.price ?? null,
      leverage,
    });
  }, [analysis, leverage, price?.price]);

  const sourceLabel = price?.source ?? chartSource ?? "Binance";

  const live =
    wsStatus === "connected"
      ? { text: "TRỰC TIẾP", cls: "bg-emerald-400 live-dot" }
      : wsStatus === "reconnecting"
        ? { text: "KẾT NỐI LẠI", cls: "bg-amber-400" }
        : { text: "DỰ PHÒNG", cls: "bg-slate-500" };

  const recCls =
    analysis?.recommendation === "LONG"
      ? "border-emerald-600/60 bg-emerald-500/10 text-emerald-300"
      : analysis?.recommendation === "SHORT"
        ? "border-rose-600/60 bg-rose-500/10 text-rose-300"
        : "border-amber-600/50 bg-amber-500/10 text-amber-300";

  const pxDigits = (v: number | null | undefined) =>
    v != null && v < 1 ? 6 : v != null && v < 100 ? 4 : 2;

  return (
    <div className="space-y-3">
      <Link href="/crypto" className="inline-block text-xs text-[#00d4ff] hover:underline">
        ← Thị trường Crypto
      </Link>

      <div className="panel flex flex-wrap items-center gap-3 p-3 sm:p-4">
        {coin?.logoUrl ? (
          <Image
            src={coin.logoUrl}
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 rounded-full"
            priority
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#00d4ff]/15 text-sm font-bold text-[#00d4ff]">
            {symbol.slice(0, 2)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-black text-white sm:text-xl">
              {coin?.name ?? symbol}
            </h1>
            <span className="text-sm text-slate-500">{symbol}</span>
            <span title={live.text} className={`h-2 w-2 rounded-full ${live.cls}`} />
            <span className="text-[10px] text-slate-500">{live.text}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10px] text-slate-500">
            <span>{sourceLabel}</span>
            {coin?.marketCapRank != null && <span>Xếp hạng #{coin.marketCapRank}</span>}
            {price?.volume24h != null && <span>Khối lượng {fmtNum(price.volume24h, 0)}</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-2xl font-black text-white sm:text-3xl">
            ${fmtNum(price?.price, price?.price && price.price < 1 ? 6 : 2)}
          </div>
          <div className={`text-sm font-bold ${changeColor(price?.change24h)}`}>
            {fmtPct(price?.change24h)}
          </div>
        </div>
      </div>

      <div className="panel p-3 sm:p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-white">Biểu đồ · {symbol}</h2>
          <div className="flex gap-0.5 overflow-x-auto rounded-lg bg-slate-900/60 p-0.5">
            {TIMEFRAMES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onSelectTf(value)}
                disabled={chartLoading && value === timeframe}
                className={`min-h-8 rounded-md px-2.5 text-xs font-medium transition ${
                  timeframe === value
                    ? "bg-[#00d4ff] text-[#0A2540]"
                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        {loading && chartBars.length === 0 ? (
          <ChartSkeleton />
        ) : error && chartBars.length === 0 ? (
          <div className="flex h-[320px] items-center justify-center text-sm text-rose-400">
            {error}
          </div>
        ) : chartBars.length > 0 ? (
          <div className={chartLoading ? "opacity-60 transition-opacity" : ""}>
            <CandleChart
              bars={chartBars}
              height={320}
              onLoadMore={loadMoreHistory}
              loadingMore={historyLoadingMore}
              hasMore={historyHasMore}
              loadMoreThreshold={24}
            />
          </div>
        ) : (
          <div className="flex h-[320px] items-center justify-center text-sm text-slate-500">
            Không có OHLCV
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        {futures?.available && <MemoFuturesPanel data={futures} />}
        {whaleLiq?.available && <MemoWhalePanel data={whaleLiq} />}
        {orderFlow?.available && <MemoOrderFlowPanel data={orderFlow} />}
        <MemoCryptoSentimentPanel symbol={symbol} />
        <MemoCryptoOnChainPanel symbol={symbol} />
      </div>

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        <div className={`panel border p-3.5 ${recCls}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wide opacity-70">
                Tín hiệu · {timeframe}
              </div>
              <div className="mt-1 text-3xl font-black">{analysis?.recommendation ?? "—"}</div>
              <div className="mt-0.5 text-sm opacity-80">
                {analysis ? `${Math.round(analysis.confidence * 100)}% độ tin cậy` : "—"}
              </div>
            </div>
            <div className="rounded-lg bg-black/20 px-2.5 py-1 text-right">
              <div className="text-[9px] uppercase opacity-60">Đòn bẩy</div>
              <div className="font-mono text-lg font-black tabular-nums">
                {leverage <= 0 ? "Giao ngay" : `${leverage}×`}
              </div>
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-[10px] opacity-70">
              <span>Đòn bẩy</span>
              <span className="font-mono">0 → 500×</span>
            </div>
            <input
              type="range"
              min={0}
              max={500}
              step={1}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-800 accent-[#00d4ff]"
              aria-label="Đòn bẩy"
            />
            <div className="flex flex-wrap gap-1">
              {LEVERAGE_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setLeverage(p)}
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition ${
                    leverage === p
                      ? "bg-[#00d4ff]/25 text-[#00d4ff]"
                      : "bg-black/20 text-slate-400 hover:text-white"
                  }`}
                >
                  {p === 0 ? "Giao ngay" : `${p}×`}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
            <div>
              <div className="opacity-60">Điểm vào</div>
              <div className="font-mono text-sm font-semibold">
                {fmtNum(
                  levLevels?.entry ?? analysis?.entryPrice,
                  pxDigits(levLevels?.entry ?? analysis?.entryPrice),
                )}
              </div>
            </div>
            <div>
              <div className="opacity-60">SL</div>
              <div className="font-mono text-sm font-semibold text-rose-300/90">
                {fmtNum(
                  levLevels?.stopLoss ?? analysis?.stopLoss,
                  pxDigits(levLevels?.stopLoss ?? analysis?.stopLoss),
                )}
              </div>
              {levLevels?.slPct != null && (
                <div className="text-[9px] opacity-60">{levLevels.slPct.toFixed(2)}%</div>
              )}
            </div>
            <div>
              <div className="opacity-60">TP</div>
              <div className="font-mono text-sm font-semibold text-emerald-300/90">
                {fmtNum(
                  levLevels?.takeProfit ?? analysis?.takeProfit,
                  pxDigits(levLevels?.takeProfit ?? analysis?.takeProfit),
                )}
              </div>
              {levLevels?.tpPct != null && (
                <div className="text-[9px] opacity-60">{levLevels.tpPct.toFixed(2)}%</div>
              )}
            </div>
          </div>

          {levLevels?.liquidation != null && leverage > 0 && (
            <div className="mt-2 flex items-center justify-between rounded-md bg-black/25 px-2 py-1.5 text-[10px]">
              <span className="opacity-60">Giá thanh lý ước tính</span>
              <span className="font-mono text-amber-300">
                {fmtNum(levLevels.liquidation, pxDigits(levLevels.liquidation))}
              </span>
            </div>
          )}

          {levLevels?.riskReward != null && (
            <div className="mt-1 text-[10px] opacity-70">
              R:R ≈ 1:{levLevels.riskReward.toFixed(1)} · {levLevels.note}
            </div>
          )}

          <ul className="mt-3 max-h-20 space-y-0.5 overflow-y-auto text-[11px] opacity-90">
            {(analysis?.reasons ?? []).slice(0, 4).map((r, i) => (
              <li key={i}>· {r}</li>
            ))}
          </ul>
        </div>

        <div className="panel p-3.5">
          <h2 className="mb-2.5 text-sm font-semibold text-white">Thị trường</h2>
          <div className="grid grid-cols-2 gap-y-2 text-xs">
            <span className="text-slate-500">Giá</span>
            <span className="text-right font-mono text-white">{fmtNum(price?.price, 6)}</span>
            <span className="text-slate-500">Khối lượng 24h</span>
            <span className="text-right font-mono text-white">{fmtNum(price?.volume24h, 0)}</span>
            <span className="text-slate-500">Vốn hóa</span>
            <span className="text-right font-mono text-white">{fmtNum(price?.marketCap, 0)}</span>
            <span className="text-slate-500">Xếp hạng</span>
            <span className="text-right font-mono text-white">{coin?.marketCapRank ?? "—"}</span>
          </div>
        </div>

        <div className="panel p-3.5 md:col-span-2 xl:col-span-1">
          <h2 className="mb-2.5 text-sm font-semibold text-white">Mẫu hình</h2>
          <div className="max-h-32 space-y-1 overflow-y-auto text-xs">
            {[...(analysis?.chartPatterns ?? []), ...(analysis?.candlestickPatterns ?? [])]
              .slice(0, 5)
              .map((p, i) => (
                <div key={i} className="flex justify-between rounded bg-slate-900/40 px-2 py-1.5">
                  <span className="text-slate-300">{p.nameVi}</span>
                  <span
                    className={
                      p.type === "bullish"
                        ? "text-emerald-400"
                        : p.type === "bearish"
                          ? "text-rose-400"
                          : "text-amber-400"
                    }
                  >
                    {Math.round(p.reliability * 100)}%
                  </span>
                </div>
              ))}
            {!analysis?.chartPatterns?.length && !analysis?.candlestickPatterns?.length && (
              <div className="text-slate-500">Chưa có mẫu hình</div>
            )}
          </div>
        </div>
      </div>

      {analysis && (
        <div className="panel p-3.5">
          <h2 className="mb-2.5 text-sm font-semibold text-white">Chỉ báo kỹ thuật</h2>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {Object.entries(analysis.indicators ?? {})
              .filter(([, v]) => typeof v === "number" || v === null)
              .map(([key, value]) => (
                <div key={key} className="rounded-lg bg-slate-900/50 px-2 py-1.5 text-xs">
                  <div className="text-slate-500">{key}</div>
                  <div className="mt-0.5 font-mono text-white">
                    {typeof value === "number" ? fmtNum(value, 4) : "—"}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
