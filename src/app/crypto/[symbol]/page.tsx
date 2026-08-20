"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import type { Bar } from "@/components/candle-chart";

import {
  api,
  changeColor,
  fmtNum,
  fmtPct,
} from "@/lib/client";

import {
  createBinanceWebSocket,
  type BinanceKline,
} from "@/lib/crypto/binance-websocket";

const ChartSkeleton = () => (
  <div className="h-[380px] w-full animate-pulse rounded-lg bg-slate-800/40" />
);

const CandleChart = dynamic(
  () =>
    import("@/components/candle-chart").then(
      (module) => module.CandleChart,
    ),
  {
    ssr: false,
    loading: ChartSkeleton,
  },
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
  recommendation:
    | "LONG"
    | "SHORT"
    | "NEUTRAL";

  entryPrice: number;

  stopLoss: number | null;

  takeProfit: number | null;

  confidence: number;

  reasons: string[];

  sentiment: number;

  indicators: Record<
    string,
    unknown
  >;

  candlestickPatterns: Array<{
    nameVi: string;
    type: string;
    reliability: number;
  }>;

  chartPatterns: Array<{
    nameVi: string;
    type: string;
    reliability: number;
  }>;

  disclaimer: string;
}

interface SentimentData {
  score: number;
  label: string;

  articles?: Array<{
    title: string;
    link: string;
    source: string;
    publishedAt: string;
  }>;
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

const TIMEFRAMES = [
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
];

export default function CryptoDetail() {
  const params = useParams();

  const symbol = String(
    params.symbol ?? "",
  ).toUpperCase();

  const [timeframe, setTimeframe] =
    useState("1h");

  const [bundle, setBundle] =
    useState<Bundle | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const [wsStatus, setWsStatus] =
    useState<
      | "connecting"
      | "connected"
      | "reconnecting"
      | "disconnected"
      | "error"
    >("connecting");

  const [wsPrice, setWsPrice] =
    useState<number | null>(null);

  const [wsKline, setWsKline] =
    useState<BinanceKline | null>(
      null,
    );

  /*
   * ============================================================
   * ONE REQUEST FIRST PAINT
   * ============================================================
   *
   * Bundle trả về:
   *
   * - coin
   * - price
   * - OHLCV
   * - analysis
   * - sentiment
   *
   * Không còn 5 request riêng khi mở trang.
   */
  useEffect(() => {
    if (!symbol) {
      return;
    }

    let cancelled = false;

    setLoading(true);
    setError(null);

    /*
     * Xóa realtime candle cũ trước khi
     * load timeframe mới.
     */
    setWsKline(null);

    const path =
      `/crypto/${encodeURIComponent(
        symbol,
      )}/bundle?timeframe=${encodeURIComponent(
        timeframe,
      )}&limit=200`;

    void api<Bundle>(path)
      .then((response) => {
        if (cancelled) {
          return;
        }

        setBundle(response.data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }

        setError(
          err instanceof Error
            ? err.message
            : String(err),
        );

        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    symbol,
    timeframe,
  ]);

  /*
   * ============================================================
   * BINANCE REALTIME
   * ============================================================
   *
   * Bundle dùng cho initial paint.
   *
   * WebSocket dùng cho:
   *
   * - price
   * - current candle
   *
   * Vì vậy không cần polling OHLCV.
   */
  useEffect(() => {
    if (!symbol) {
      return;
    }

    const binanceSymbol =
      bundle?.coin
        ?.binanceSymbol ||
      `${symbol}USDT`;

    setWsPrice(null);
    setWsKline(null);
    setWsStatus("connecting");

    const connection =
      createBinanceWebSocket({
        symbol: binanceSymbol,
        timeframe,

        onTicker: (ticker) => {
          setWsPrice(
            ticker.price,
          );
        },

        onKline: (kline) => {
          setWsKline(kline);
        },

        onStatus: (status) => {
          setWsStatus(status);
        },
      });

    return () => {
      connection.disconnect();
    };
  }, [
    symbol,
    timeframe,
    bundle?.coin?.binanceSymbol,
  ]);

  /*
   * ============================================================
   * PRICE
   * ============================================================
   */
  const price = useMemo(() => {
    const rest =
      bundle?.price;

    if (
      wsPrice === null ||
      wsPrice === undefined
    ) {
      return rest;
    }

    return {
      ...(rest ?? {
        price: wsPrice,
        priceVnd: null,
        volume24h: null,
        marketCap: null,
        change24h: null,
        source:
          "Binance WebSocket",
        timestamp:
          new Date().toISOString(),
      }),

      price: wsPrice,

      source:
        "Binance WebSocket",

      timestamp:
        new Date().toISOString(),
    };
  }, [
    bundle?.price,
    wsPrice,
  ]);

  /*
   * ============================================================
   * CHART
   * ============================================================
   */
  const chartBars = useMemo(() => {
    const historical =
      bundle?.bars ?? [];

    if (
      historical.length === 0 ||
      !wsKline
    ) {
      return historical;
    }

    const realtimeBar: Bar = {
      time: Math.floor(
        wsKline.startTime / 1000,
      ),

      open: wsKline.open,
      high: wsKline.high,
      low: wsKline.low,
      close: wsKline.close,
      volume: wsKline.volume,
    };

    const last =
      historical[
        historical.length - 1
      ];

    /*
     * Update current candle.
     */
    if (
      last &&
      last.time ===
        realtimeBar.time
    ) {
      return [
        ...historical.slice(
          0,
          -1,
        ),
        realtimeBar,
      ];
    }

    /*
     * New candle.
     */
    if (
      last &&
      realtimeBar.time >
        last.time
    ) {
      return [
        ...historical,
        realtimeBar,
      ];
    }

    return historical;
  }, [
    bundle?.bars,
    wsKline,
  ]);

  const coin =
    bundle?.coin;

  const analysis =
    bundle?.analysis;

  const sentiment =
    bundle?.sentiment;

  /*
   * ============================================================
   * UI STATUS
   * ============================================================
   */
  const websocketText =
    wsStatus === "connected"
      ? "BINANCE LIVE"
      : wsStatus ===
          "reconnecting"
        ? "RECONNECTING"
        : wsStatus ===
            "connecting"
          ? "CONNECTING"
          : "REST FALLBACK";

  const websocketClass =
    wsStatus === "connected"
      ? "bg-emerald-400 live-dot"
      : wsStatus ===
          "reconnecting"
        ? "bg-amber-400"
        : "bg-slate-500";

  const recommendationClass =
    analysis?.recommendation ===
    "LONG"
      ? "border-emerald-600 bg-emerald-500/10 text-emerald-300"
      : analysis?.recommendation ===
          "SHORT"
        ? "border-rose-600 bg-rose-500/10 text-rose-300"
        : "border-amber-600 bg-amber-500/10 text-amber-300";

  /*
   * ============================================================
   * RENDER
   * ============================================================
   */
  return (
    <div className="space-y-5">

      <Link
        href="/crypto"
        className="text-xs text-[#00d4ff]"
      >
        ← Thị trường Crypto
      </Link>

      {/* HEADER */}

      <div className="panel p-4 flex flex-wrap items-center gap-4">

        {coin?.logoUrl ? (
          <img
            src={coin.logoUrl}
            alt=""
            className="h-12 w-12 rounded-full"
            loading="eager"
            decoding="async"
          />
        ) : (
          <div className="h-12 w-12 rounded-full bg-[#00d4ff]/15 flex items-center justify-center font-bold text-[#00d4ff]">
            {symbol.slice(0, 2)}
          </div>
        )}

        <div>
          <div className="flex items-center gap-2">

            <h1 className="text-2xl font-black text-white">
              {coin?.name ??
                symbol}
            </h1>

            <span className="text-slate-500">
              {symbol}
            </span>

            <span
              title={websocketText}
              className={`h-2 w-2 rounded-full ${websocketClass}`}
            />

          </div>

          <div className="text-[10px] text-slate-500 mt-1">
            {price?.source ??
              bundle?.source ??
              "Binance"}
            {" · "}
            {websocketText}
          </div>
        </div>

        <div className="sm:ml-auto">

          <div className="text-3xl font-black text-white font-mono">
            $
            {fmtNum(
              price?.price,
              price?.price &&
                price.price < 1
                ? 6
                : 2,
            )}
          </div>

          <div
            className={`text-right font-bold ${changeColor(
              price?.change24h,
            )}`}
          >
            {fmtPct(
              price?.change24h,
            )}
          </div>

        </div>

      </div>

      {/* CHART */}

      <div className="panel p-3">

        <div className="flex flex-wrap justify-between gap-2 mb-3">

          <div>
            <h2 className="font-semibold text-white">
              Biểu đồ {symbol}
            </h2>

            <div className="text-[10px] text-slate-500 mt-1">
              {bundle?.source ??
                "Binance"}
            </div>
          </div>

          <div className="flex gap-1 overflow-x-auto">

            {TIMEFRAMES.map(
              (value) => (
                <button
                  key={value}
                  onClick={() => {
                    if (
                      value !==
                      timeframe
                    ) {
                      setTimeframe(
                        value,
                      );
                    }
                  }}
                  disabled={
                    loading &&
                    value ===
                      timeframe
                  }
                  className={`min-h-9 rounded px-3 text-xs ${
                    timeframe ===
                    value
                      ? "bg-[#00d4ff] text-[#0A2540]"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  {value}
                </button>
              ),
            )}

          </div>

        </div>

        {loading &&
        chartBars.length ===
          0 ? (
          <ChartSkeleton />
        ) : error &&
          chartBars.length ===
            0 ? (
          <div className="h-[380px] flex items-center justify-center text-rose-400 text-sm">
            {error}
          </div>
        ) : chartBars.length >
          0 ? (
          <CandleChart
            bars={chartBars}
            height={380}
          />
        ) : (
          <div className="h-[380px] flex items-center justify-center text-slate-500 text-sm">
            Không có dữ liệu OHLCV
          </div>
        )}

      </div>

      {/* SUMMARY */}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        <div
          className={`panel border p-4 ${recommendationClass}`}
        >
          <div className="text-xs opacity-70">
            Khuyến nghị · {timeframe}
          </div>

          <div className="text-3xl font-black mt-1">
            {analysis?.recommendation ??
              "—"}
          </div>

          <div className="text-sm mt-1">
            Confidence:{" "}
            {analysis
              ? `${Math.round(
                  analysis.confidence *
                    100,
                )}%`
              : "—"}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-y-2 text-xs">

            <span className="opacity-60">
              Entry
            </span>

            <span className="text-right font-mono">
              {fmtNum(
                analysis?.entryPrice,
                6,
              )}
            </span>

            <span className="opacity-60">
              Stop Loss
            </span>

            <span className="text-right font-mono">
              {fmtNum(
                analysis?.stopLoss,
                6,
              )}
            </span>

            <span className="opacity-60">
              Take Profit
            </span>

            <span className="text-right font-mono">
              {fmtNum(
                analysis?.takeProfit,
                6,
              )}
            </span>

          </div>

          <ul className="mt-4 text-xs space-y-1">
            {(
              analysis?.reasons ??
              []
            )
              .slice(0, 6)
              .map(
                (reason, index) => (
                  <li
                    key={index}
                  >
                    • {reason}
                  </li>
                ),
              )}
          </ul>

          <div className="text-[9px] opacity-60 mt-4">
            {analysis?.disclaimer ??
              "Chỉ là tín hiệu định lượng tham khảo, không phải lời khuyên đầu tư."}
          </div>
        </div>

        {/* PRICE DATA */}

        <div className="panel p-4">

          <h2 className="font-semibold text-white mb-3">
            Thông tin thị trường
          </h2>

          <div className="grid grid-cols-2 gap-y-3 text-xs">

            <span className="text-slate-500">
              Giá
            </span>

            <span className="text-right font-mono text-white">
              {fmtNum(
                price?.price,
                6,
              )}
            </span>

            <span className="text-slate-500">
              Volume 24h
            </span>

            <span className="text-right font-mono text-white">
              {fmtNum(
                price?.volume24h,
                0,
              )}
            </span>

            <span className="text-slate-500">
              Market Cap
            </span>

            <span className="text-right font-mono text-white">
              {fmtNum(
                price?.marketCap,
                0,
              )}
            </span>

            <span className="text-slate-500">
              Rank
            </span>

            <span className="text-right font-mono text-white">
              {coin?.marketCapRank ??
                "—"}
            </span>

          </div>

        </div>

        {/* SENTIMENT */}

        <div className="panel p-4">

          <h2 className="font-semibold text-white mb-3">
            Sentiment
          </h2>

          <div className="text-3xl font-black text-white">
            {sentiment
              ? sentiment.label
              : "—"}
          </div>

          <div className="text-sm text-slate-400 mt-1">
            Score:{" "}
            {sentiment
              ? sentiment.score.toFixed(
                  3,
                )
              : "—"}
          </div>

          <div className="text-[10px] text-slate-600 mt-4">
            Sentiment được cập nhật
            nền, không block realtime
            price.
          </div>

        </div>

      </div>

      {/* INDICATORS */}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        <div className="panel p-4">

          <h2 className="font-semibold text-white mb-3">
            Chỉ báo kỹ thuật
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">

            {analysis &&
              Object.entries(
                analysis.indicators ??
                  {},
              )
                .filter(
                  ([, value]) =>
                    typeof value ===
                      "number" ||
                    value === null,
                )
                .map(
                  ([
                    key,
                    value,
                  ]) => (
                    <div
                      key={key}
                      className="rounded bg-slate-900/40 p-2 text-xs"
                    >
                      <div className="text-slate-500">
                        {key}
                      </div>

                      <div className="font-mono text-white mt-1">
                        {typeof value ===
                        "number"
                          ? fmtNum(
                              value,
                              5,
                            )
                          : "—"}
                      </div>
                    </div>
                  ),
                )}

          </div>

        </div>

        <div className="panel p-4">

          <h2 className="font-semibold text-white mb-3">
            Mẫu hình gần đây
          </h2>

          <div className="space-y-2 text-xs">

            {[
              ...(analysis
                ?.chartPatterns ??
                []),

              ...(analysis
                ?.candlestickPatterns ??
                []),
            ]
              .slice(0, 8)
              .map(
                (
                  pattern,
                  index,
                ) => (
                  <div
                    key={index}
                    className="flex justify-between rounded bg-slate-900/30 p-2"
                  >
                    <span>
                      {
                        pattern.nameVi
                      }
                    </span>

                    <span
                      className={
                        pattern.type ===
                        "bullish"
                          ? "text-emerald-400"
                          : pattern.type ===
                              "bearish"
                            ? "text-rose-400"
                            : "text-amber-400"
                      }
                    >
                      {
                        pattern.type
                      }{" "}
                      ·{" "}
                      {Math.round(
                        pattern.reliability *
                          100,
                      )}
                      %
                    </span>
                  </div>
                ),
              )}

          </div>

        </div>

      </div>

    </div>
  );
}
