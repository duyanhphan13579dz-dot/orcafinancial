"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Bar } from "@/components/candle-chart";
import { api, changeColor, fmtNum, fmtPct } from "@/lib/client";
import {
  createBinanceWebSocket,
  type BinanceKline,
} from "@/lib/crypto/binance-websocket";

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
}

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"];

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

  const initialDone = useRef(false);

  /** Initial paint: one bundle (chart + meta). */
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
        // Bundle failed → still try OHLCV-only so chart works
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
          });
          setError(null);
        } catch {
          setError(err instanceof Error ? err.message : String(err));
        }
        setLoading(false);
        initialDone.current = true;
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial only on symbol
  }, [symbol]);

  /** Timeframe switch: OHLCV only — keep previous bars until new ones arrive. */
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
        // Refresh analysis in background (optional)
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
        // keep existing bars
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
          <img
            src={coin.logoUrl}
            alt=""
            className="h-12 w-12 rounded-full"
            loading="eager"
            decoding="async"
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
            {price?.source ?? chartSource || "Binance"} · {websocketText}
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
