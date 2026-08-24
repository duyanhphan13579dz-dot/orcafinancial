"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Bar } from "@/components/candle-chart";
import { api, changeColor, fmtNum, fmtPct } from "@/lib/client";
import {
  createBinanceWebSocket,
  type BinanceKline,
} from "@/lib/crypto/binance-websocket";
import type { FuturesIntelligence, OrderFlowIntelligence } from "@/lib/crypto/types";

const ChartSkeleton = () => (
  <div className="h-[380px] w-full animate-pulse rounded-lg bg-slate-800/40" />
);

const CandleChart = dynamic(
  () => import("@/components/candle-chart").then((m) => m.CandleChart),
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

interface SentimentData {
  score: number;
  label: string;
  articles?: Array<{ title: string; link: string; source: string; publishedAt: string }>;
}

interface Bundle {
  coin: Detail["coin"];
  price: Detail["price"];
  bars: Bar[];
  timeframe: string;
  source: string;
  analysis: Analysis | null;
  sentiment: SentimentData | null;
  futures?: FuturesIntelligence | null;
}

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"];

function biasColor(bias: string): string {
  if (bias.includes("LONG") || bias.includes("BUY")) return "text-emerald-400";
  if (bias.includes("SHORT") || bias.includes("SELL")) return "text-rose-400";
  return "text-amber-300";
}

function biasLabel(bias: string): string {
  const map: Record<string, string> = {
    LONG_CROWDED: "LONG crowded",
    SHORT_CROWDED: "SHORT crowded",
    NEUTRAL: "NEUTRAL",
    LONG_DOMINANT: "LONG dominant",
    SHORT_DOMINANT: "SHORT dominant",
    BALANCED: "Balanced",
    LONG_BUILDUP: "Long buildup",
    SHORT_BUILDUP: "Short buildup",
    SHORT_COVERING: "Short covering",
    LONG_LIQUIDATION: "Long liquidation",
    BUY_DOMINANT: "Buy-side dominant",
    SELL_DOMINANT: "Sell-side dominant",
    UNKNOWN: "—",
  };
  return map[bias] ?? bias;
}

function fmtOiUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${fmtNum(n, 0)}`;
}

function fmtTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

export default function CryptoDetail() {
  const params = useParams();
  const symbol = String(params.symbol ?? "").toUpperCase();

  const [timeframe, setTimeframe] = useState("1h");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  const [chartSource, setChartSource] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<
    "connecting" | "connected" | "reconnecting" | "disconnected" | "error"
  >("connecting");
  const [wsPrice, setWsPrice] = useState<number | null>(null);
  const [wsKline, setWsKline] = useState<BinanceKline | null>(null);
  const [orderFlow, setOrderFlow] = useState<OrderFlowIntelligence | null>(null);

  const initialDone = useRef(false);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    void api<Bundle>(
      `/crypto/${encodeURIComponent(symbol)}/bundle?timeframe=${encodeURIComponent(timeframe)}&limit=200`,
    )
      .then((res) => {
        if (cancelled) return;
        setBundle(res.data);
        setBars(res.data.bars ?? []);
        setChartSource(res.data.source ?? "");
        setLoading(false);
        initialDone.current = true;
      })
      .catch(async (err) => {
        if (cancelled) return;
        try {
          const o = await api<{ symbol: string; timeframe: string; bars: Bar[] }>(
            `/crypto/${encodeURIComponent(symbol)}/ohlcv?timeframe=${encodeURIComponent(timeframe)}&limit=200`,
          );
          if (cancelled) return;
          setBars(o.data.bars ?? []);
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
            sentiment: null,
            futures: null,
          });
          setError(null);
          void api<FuturesIntelligence>(`/crypto/${encodeURIComponent(symbol)}/futures`)
            .then((f) => {
              if (!cancelled) {
                setBundle((prev) => (prev ? { ...prev, futures: f.data } : prev));
              }
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

  // Phase 2 — poll order flow every 5s
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const load = () => {
      void api<OrderFlowIntelligence>(`/crypto/${encodeURIComponent(symbol)}/orderflow`)
        .then((r) => {
          if (!cancelled) setOrderFlow(r.data);
        })
        .catch(() => undefined);
    };
    load();
    const id = setInterval(load, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbol]);

  const loadTimeframe = useCallback(
    async (tf: string) => {
      if (!symbol) return;
      setChartLoading(true);
      setWsKline(null);
      setError(null);
      try {
        const o = await api<{ symbol: string; timeframe: string; bars: Bar[] }>(
          `/crypto/${encodeURIComponent(symbol)}/ohlcv?timeframe=${encodeURIComponent(tf)}&limit=200`,
        );
        setBars(o.data.bars ?? []);
        setChartSource(String(o.meta?.source ?? "binance"));
        void api<Analysis>(
          `/crypto/${encodeURIComponent(symbol)}/analysis?timeframe=${encodeURIComponent(tf)}`,
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

  const onSelectTf = (tf: string) => {
    if (tf === timeframe) return;
    setTimeframe(tf);
    if (initialDone.current) void loadTimeframe(tf);
  };

  useEffect(() => {
    if (!symbol) return;
    const binanceSymbol = bundle?.coin?.binanceSymbol || `${symbol}USDT`;
    setWsPrice(null);
    setWsKline(null);
    setWsStatus("connecting");
    const connection = createBinanceWebSocket({
      symbol: binanceSymbol,
      timeframe,
      onTicker: (ticker) => setWsPrice(ticker.price),
      onKline: (kline) => setWsKline(kline),
      onStatus: (status) => setWsStatus(status),
    });
    return () => connection.disconnect();
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
      source: "Binance WebSocket",
      timestamp: new Date().toISOString(),
    };
  }, [bundle?.price, wsPrice]);

  const chartBars = useMemo(() => {
    const historical = bars;
    if (historical.length === 0 || !wsKline) return historical;
    const realtimeBar: Bar = {
      time: Math.floor(wsKline.startTime / 1000),
      open: wsKline.open,
      high: wsKline.high,
      low: wsKline.low,
      close: wsKline.close,
      volume: wsKline.volume,
    };
    const last = historical[historical.length - 1];
    if (last && last.time === realtimeBar.time) {
      return [...historical.slice(0, -1), realtimeBar];
    }
    if (last && realtimeBar.time > last.time) {
      return [...historical, realtimeBar];
    }
    return historical;
  }, [bars, wsKline]);

  const coin = bundle?.coin;
  const analysis = bundle?.analysis;
  const sentiment = bundle?.sentiment;
  const futures = bundle?.futures;
  const book = orderFlow?.orderBook;

  const maxDepthNotional = useMemo(() => {
    if (!book) return 1;
    const all = [...book.bids, ...book.asks].map((l) => l.notional);
    return Math.max(1, ...all);
  }, [book]);

  const websocketText =
    wsStatus === "connected"
      ? "BINANCE LIVE"
      : wsStatus === "reconnecting"
        ? "RECONNECTING"
        : wsStatus === "connecting"
          ? "CONNECTING"
          : "REST FALLBACK";

  const websocketClass =
    wsStatus === "connected"
      ? "bg-emerald-400 live-dot"
      : wsStatus === "reconnecting"
        ? "bg-amber-400"
        : "bg-slate-500";

  const recommendationClass =
    analysis?.recommendation === "LONG"
      ? "border-emerald-600 bg-emerald-500/10 text-emerald-300"
      : analysis?.recommendation === "SHORT"
        ? "border-rose-600 bg-rose-500/10 text-rose-300"
        : "border-amber-600 bg-amber-500/10 text-amber-300";

  return (
    <div className="space-y-5">
      <Link href="/crypto" className="text-xs text-[#00d4ff]">
        ← Thị trường Crypto
      </Link>

      <div className="panel flex flex-wrap items-center gap-4 p-4">
        {coin?.logoUrl ? (
          <Image
            src={coin.logoUrl}
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 rounded-full"
            priority
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#00d4ff]/15 font-bold text-[#00d4ff]">
            {symbol.slice(0, 2)}
          </div>
        )}
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-white">{coin?.name ?? symbol}</h1>
            <span className="text-slate-500">{symbol}</span>
            <span title={websocketText} className={`h-2 w-2 rounded-full ${websocketClass}`} />
          </div>
          <div className="mt-1 text-[10px] text-slate-500">
            {(price?.source ?? chartSource) || "Binance"} · {websocketText}
          </div>
        </div>
        <div className="sm:ml-auto">
          <div className="font-mono text-3xl font-black text-white">
            ${fmtNum(price?.price, price?.price && price.price < 1 ? 6 : 2)}
          </div>
          <div className={`text-right font-bold ${changeColor(price?.change24h)}`}>
            {fmtPct(price?.change24h)}
          </div>
        </div>
      </div>

      {futures?.available && (
        <div className="panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-white">Futures Intelligence</h2>
            <span className="text-[10px] text-slate-500">
              Binance Futures · {futures.binanceFuturesSymbol}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Funding Rate</div>
              <div className="mt-1 font-mono text-xl font-bold text-white">
                {futures.funding.ratePct != null
                  ? `${futures.funding.ratePct >= 0 ? "+" : ""}${futures.funding.ratePct.toFixed(4)}%`
                  : "—"}
              </div>
              <div className={`mt-1 text-xs font-semibold ${biasColor(futures.funding.bias)}`}>
                {biasLabel(futures.funding.bias)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Long / Short</div>
              <div className="mt-1 font-mono text-xl font-bold text-white">
                {futures.longShort.longAccountPct != null && futures.longShort.shortAccountPct != null
                  ? `${futures.longShort.longAccountPct.toFixed(0)} / ${futures.longShort.shortAccountPct.toFixed(0)}`
                  : "—"}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className={`font-semibold ${biasColor(futures.longShort.bias)}`}>
                  {biasLabel(futures.longShort.bias)}
                </span>
                {futures.longShort.ratio != null && (
                  <span className="font-mono text-slate-400">
                    ratio {futures.longShort.ratio.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Open Interest</div>
              <div className="mt-1 font-mono text-xl font-bold text-white">
                {fmtOiUsd(futures.openInterest.openInterestUsd)}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className={`font-semibold ${biasColor(futures.openInterest.setup)}`}>
                  {biasLabel(futures.openInterest.setup)}
                </span>
                {futures.openInterest.changePct != null && (
                  <span
                    className={`font-mono ${
                      futures.openInterest.changePct >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {futures.openInterest.changePct >= 0 ? "+" : ""}
                    {futures.openInterest.changePct.toFixed(2)}%
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 space-y-1.5 rounded-lg bg-slate-900/30 p-3 text-xs text-slate-300">
            <div className="font-semibold text-slate-400">OI + Price Analysis</div>
            <p>{futures.openInterest.insight}</p>
            <p className="text-slate-500">{futures.funding.insight}</p>
            <p className="text-slate-500">{futures.longShort.insight}</p>
          </div>
        </div>
      )}

      {/* Phase 2 — Order Flow */}
      {orderFlow?.available && (
        <div className="panel p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-white">Order Flow</h2>
            <span className="text-[10px] text-slate-500">
              Depth + trades · refresh 5s · whale ≥ {fmtOiUsd(orderFlow.whaleThresholdUsd)}
            </span>
          </div>

          {book && (
            <>
              <div className="mb-3 rounded-lg bg-slate-900/40 p-3">
                <div className="mb-1 flex justify-between text-[10px] text-slate-500">
                  <span>Buy liquidity {book.imbalance.bidPct.toFixed(0)}%</span>
                  <span className={biasColor(book.imbalance.bias)}>
                    {biasLabel(book.imbalance.bias)}
                  </span>
                  <span>Sell liquidity {book.imbalance.askPct.toFixed(0)}%</span>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="bg-emerald-500/80 transition-all"
                    style={{ width: `${book.imbalance.bidPct}%` }}
                  />
                  <div
                    className="bg-rose-500/80 transition-all"
                    style={{ width: `${book.imbalance.askPct}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-400">{book.imbalance.insight}</p>
                {book.spreadBps != null && (
                  <p className="mt-1 text-[10px] text-slate-500">
                    Spread {book.spreadBps.toFixed(1)} bps · best {fmtNum(book.bestBid, 2)} /{" "}
                    {fmtNum(book.bestAsk, 2)}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-rose-400">
                    Asks (Sell)
                  </div>
                  <div className="space-y-0.5 font-mono text-[11px]">
                    {[...book.asks].reverse().slice(0, 10).map((lvl) => {
                      const isWall = book.sellWalls.some(
                        (w) => Math.abs(w.price - lvl.price) < lvl.price * 1e-8,
                      );
                      return (
                        <div
                          key={`a-${lvl.price}`}
                          className={`relative flex justify-between overflow-hidden rounded px-1 py-0.5 ${isWall ? "ring-1 ring-rose-500/50" : ""}`}
                        >
                          <div
                            className="absolute inset-y-0 right-0 bg-rose-500/15"
                            style={{
                              width: `${Math.min(100, (lvl.notional / maxDepthNotional) * 100)}%`,
                            }}
                          />
                          <span className="relative z-10 text-rose-300">{fmtNum(lvl.price, 2)}</span>
                          <span className="relative z-10 text-slate-400">{fmtNum(lvl.qty, 4)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="my-2 border-t border-dashed border-slate-700" />
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
                    Bids (Buy)
                  </div>
                  <div className="space-y-0.5 font-mono text-[11px]">
                    {book.bids.slice(0, 10).map((lvl) => {
                      const isWall = book.buyWalls.some(
                        (w) => Math.abs(w.price - lvl.price) < lvl.price * 1e-8,
                      );
                      return (
                        <div
                          key={`b-${lvl.price}`}
                          className={`relative flex justify-between overflow-hidden rounded px-1 py-0.5 ${isWall ? "ring-1 ring-emerald-500/50" : ""}`}
                        >
                          <div
                            className="absolute inset-y-0 right-0 bg-emerald-500/15"
                            style={{
                              width: `${Math.min(100, (lvl.notional / maxDepthNotional) * 100)}%`,
                            }}
                          />
                          <span className="relative z-10 text-emerald-300">{fmtNum(lvl.price, 2)}</span>
                          <span className="relative z-10 text-slate-400">{fmtNum(lvl.qty, 4)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Recent trades
                    </div>
                    {(orderFlow.whaleSummary.buyCount > 0 ||
                      orderFlow.whaleSummary.sellCount > 0) && (
                      <div className="text-[10px] text-amber-300">
                        🐋 net {fmtOiUsd(orderFlow.whaleSummary.netFlow)} (B
                        {orderFlow.whaleSummary.buyCount}/S{orderFlow.whaleSummary.sellCount})
                      </div>
                    )}
                  </div>
                  <div className="max-h-[320px] space-y-0.5 overflow-y-auto font-mono text-[11px]">
                    {orderFlow.recentTrades.slice(0, 25).map((t) => (
                      <div
                        key={t.id}
                        className={`flex items-center justify-between rounded px-1 py-0.5 ${t.isWhale ? "bg-amber-500/10 ring-1 ring-amber-500/30" : ""}`}
                      >
                        <span className="text-slate-500">{fmtTime(t.time)}</span>
                        <span
                          className={
                            t.side === "BUY" ? "text-emerald-400" : "text-rose-400"
                          }
                        >
                          {t.side}
                          {t.isWhale ? " 🐋" : ""}
                        </span>
                        <span className="text-white">{fmtNum(t.price, 2)}</span>
                        <span className="text-slate-400">{fmtNum(t.qty, 4)}</span>
                        <span className="text-slate-500">{fmtOiUsd(t.notional)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <div className="panel p-3">
        <div className="mb-3 flex flex-wrap justify-between gap-2">
          <div>
            <h2 className="font-semibold text-white">Biểu đồ {symbol}</h2>
            <div className="mt-1 text-[10px] text-slate-500">
              {chartSource || "Binance"}
              {chartLoading ? " · đang đổi khung…" : ""}
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto">
            {TIMEFRAMES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onSelectTf(value)}
                disabled={chartLoading && value === timeframe}
                className={`min-h-9 rounded px-3 text-xs ${
                  timeframe === value
                    ? "bg-[#00d4ff] text-[#0A2540]"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700"
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
          <div className="flex h-[380px] items-center justify-center text-sm text-rose-400">{error}</div>
        ) : chartBars.length > 0 ? (
          <div className={chartLoading ? "opacity-70 transition-opacity" : ""}>
            <CandleChart bars={chartBars} height={380} />
          </div>
        ) : (
          <div className="flex h-[380px] items-center justify-center text-sm text-slate-500">
            Không có dữ liệu OHLCV
          </div>
        )}
        {error && chartBars.length > 0 && (
          <div className="mt-2 text-[10px] text-amber-400">Khung mới: {error} — đang giữ chart cũ.</div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className={`panel border p-4 ${recommendationClass}`}>
          <div className="text-xs opacity-70">Khuyến nghị · {timeframe}</div>
          <div className="mt-1 text-3xl font-black">{analysis?.recommendation ?? "—"}</div>
          <div className="mt-1 text-sm">
            Confidence:{" "}
            {analysis ? `${Math.round(analysis.confidence * 100)}%` : "—"}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-y-2 text-xs">
            <span className="opacity-60">Entry</span>
            <span className="text-right font-mono">{fmtNum(analysis?.entryPrice, 6)}</span>
            <span className="opacity-60">Stop Loss</span>
            <span className="text-right font-mono">{fmtNum(analysis?.stopLoss, 6)}</span>
            <span className="opacity-60">Take Profit</span>
            <span className="text-right font-mono">{fmtNum(analysis?.takeProfit, 6)}</span>
          </div>
          <ul className="mt-4 space-y-1 text-xs">
            {(analysis?.reasons ?? []).slice(0, 6).map((reason, index) => (
              <li key={index}>• {reason}</li>
            ))}
          </ul>
          <div className="mt-4 text-[9px] opacity-60">
            {analysis?.disclaimer ??
              "Chỉ là tín hiệu định lượng tham khảo, không phải lời khuyên đầu tư."}
          </div>
        </div>

        <div className="panel p-4">
          <h2 className="mb-3 font-semibold text-white">Thông tin thị trường</h2>
          <div className="grid grid-cols-2 gap-y-3 text-xs">
            <span className="text-slate-500">Giá</span>
            <span className="text-right font-mono text-white">{fmtNum(price?.price, 6)}</span>
            <span className="text-slate-500">Volume 24h</span>
            <span className="text-right font-mono text-white">{fmtNum(price?.volume24h, 0)}</span>
            <span className="text-slate-500">Market Cap</span>
            <span className="text-right font-mono text-white">{fmtNum(price?.marketCap, 0)}</span>
            <span className="text-slate-500">Rank</span>
            <span className="text-right font-mono text-white">{coin?.marketCapRank ?? "—"}</span>
          </div>
        </div>

        <div className="panel p-4">
          <h2 className="mb-3 font-semibold text-white">Sentiment</h2>
          <div className="text-3xl font-black text-white">{sentiment ? sentiment.label : "—"}</div>
          <div className="mt-1 text-sm text-slate-400">
            Score: {sentiment ? sentiment.score.toFixed(3) : "—"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="panel p-4">
          <h2 className="mb-3 font-semibold text-white">Chỉ báo kỹ thuật</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {analysis &&
              Object.entries(analysis.indicators ?? {})
                .filter(([, value]) => typeof value === "number" || value === null)
                .map(([key, value]) => (
                  <div key={key} className="rounded bg-slate-900/40 p-2 text-xs">
                    <div className="text-slate-500">{key}</div>
                    <div className="mt-1 font-mono text-white">
                      {typeof value === "number" ? fmtNum(value, 5) : "—"}
                    </div>
                  </div>
                ))}
          </div>
        </div>
        <div className="panel p-4">
          <h2 className="mb-3 font-semibold text-white">Mẫu hình gần đây</h2>
          <div className="space-y-2 text-xs">
            {[...(analysis?.chartPatterns ?? []), ...(analysis?.candlestickPatterns ?? [])]
              .slice(0, 8)
              .map((pattern, index) => (
                <div
                  key={index}
                  className="flex justify-between rounded bg-slate-900/30 p-2"
                >
                  <span>{pattern.nameVi}</span>
                  <span
                    className={
                      pattern.type === "bullish"
                        ? "text-emerald-400"
                        : pattern.type === "bearish"
                          ? "text-rose-400"
                          : "text-amber-400"
                    }
                  >
                    {pattern.type} · {Math.round(pattern.reliability * 100)}%
                  </span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
