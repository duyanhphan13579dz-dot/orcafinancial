"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  CandleChart,
  type Bar,
} from "@/components/candle-chart";

import {
  changeColor,
  fmtNum,
  fmtPct,
  fmtVol,
  usePoll,
} from "@/lib/client";

import {
  createBinanceWebSocket,
  type BinanceKline,
} from "@/lib/crypto/binance-websocket";

/* -------------------------------------------------------------------------- */
/*                                   TYPES                                    */
/* -------------------------------------------------------------------------- */

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

    /*
     * Quan trọng cho Binance WebSocket.
     *
     * Ví dụ:
     * BTC -> BTCUSDT
     * ETH -> ETHUSDT
     */
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
    any
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

/* -------------------------------------------------------------------------- */
/*                               CONSTANTS                                    */
/* -------------------------------------------------------------------------- */

const TFS = [
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
];

/* -------------------------------------------------------------------------- */
/*                              MAIN COMPONENT                                */
/* -------------------------------------------------------------------------- */

export default function CryptoDetail() {
  const params = useParams();

  const symbol =
    String(
      params.symbol ?? "",
    ).toUpperCase();

  const [tf, setTf] =
    useState("1h");

  /*
   * ------------------------------------------------------------------------
   * BINANCE REALTIME STATE
   * ------------------------------------------------------------------------
   */

  const [wsPrice, setWsPrice] =
    useState<number | null>(
      null,
    );

  const [wsKline, setWsKline] =
    useState<BinanceKline | null>(
      null,
    );

  const [wsStatus, setWsStatus] =
    useState<
      | "connecting"
      | "connected"
      | "reconnecting"
      | "disconnected"
      | "error"
    >("connecting");

  /*
   * ------------------------------------------------------------------------
   * DETAIL
   * ------------------------------------------------------------------------
   *
   * Profile không cần realtime.
   */
  const detail =
    usePoll<Detail>(
      `/crypto/${symbol}`,
      5 * 60_000,
    );

  /*
   * ------------------------------------------------------------------------
   * REST PRICE FALLBACK
   * ------------------------------------------------------------------------
   *
   * WebSocket là nguồn realtime chính.
   * REST vẫn giữ làm fallback.
   */
  const realtime =
    usePoll<{
      price: Detail["price"];
    }>(
      `/crypto/${symbol}/price`,
      30_000,
    );

  /*
   * ------------------------------------------------------------------------
   * REST OHLCV
   * ------------------------------------------------------------------------
   *
   * REST chỉ làm initial/history refresh.
   *
   * Candle hiện tại được Binance WebSocket
   * cập nhật realtime.
   */
  const ohlcv =
    usePoll<{
      bars: Bar[];
    }>(
      `/crypto/${symbol}/ohlcv?timeframe=${tf}&limit=200`,
      60_000,
    );

  /*
   * ------------------------------------------------------------------------
   * ANALYSIS
   * ------------------------------------------------------------------------
   */
  const analysis =
    usePoll<Analysis>(
      `/crypto/${symbol}/analysis?timeframe=${tf}`,
      5 * 60_000,
    );

  /*
   * ------------------------------------------------------------------------
   * SENTIMENT
   * ------------------------------------------------------------------------
   */
  const sentiment =
    usePoll<SentimentData>(
      `/crypto/${symbol}/sentiment`,
      15 * 60_000,
    );

  /* ------------------------------------------------------------------------ */
  /*                         BINANCE WEBSOCKET                                */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (!symbol) {
      return;
    }

    /*
     * Reset realtime state khi:
     *
     * BTC 1h
     * ↓
     * BTC 4h
     *
     * hoặc:
     *
     * BTC
     * ↓
     * ETH
     */
    setWsPrice(null);

    setWsKline(null);

    setWsStatus(
      "connecting",
    );

    /*
     * Binance symbol.
     *
     * Ưu tiên:
     *
     * coin.binanceSymbol
     *
     * nhưng coin profile có thể chưa load.
     *
     * Khi chưa có thì fallback:
     *
     * BTC -> BTCUSDT
     */
    const binanceSymbol =
      detail.data?.coin
        ?.binanceSymbol ||
      `${symbol}USDT`;

    const connection =
      createBinanceWebSocket({
        symbol:
          binanceSymbol,

        timeframe: tf,

        onTicker: (
          ticker,
        ) => {
          setWsPrice(
            ticker.price,
          );
        },

        onKline: (
          kline,
        ) => {
          setWsKline(
            kline,
          );
        },

        onStatus: (
          status,
        ) => {
          setWsStatus(
            status,
          );
        },
      });

    return () => {
      connection.disconnect();
    };
  }, [
    symbol,
    tf,
    detail.data?.coin
      ?.binanceSymbol,
  ]);

  /* ------------------------------------------------------------------------ */
  /*                              COIN                                        */
  /* ------------------------------------------------------------------------ */

  const coin =
    detail.data?.coin;

  /* ------------------------------------------------------------------------ */
  /*                              PRICE                                       */
  /* ------------------------------------------------------------------------ */

  const restPrice =
    realtime.data?.price ??
    detail.data?.price;

  /*
   * WebSocket price được ưu tiên.
   *
   * Các field khác như:
   *
   * marketCap
   * volume24h
   * change24h
   *
   * vẫn lấy từ REST.
   */
  const price =
    wsPrice != null
      ? {
          ...(restPrice ?? {
            price:
              wsPrice,

            priceVnd:
              null,

            volume24h:
              null,

            marketCap:
              null,

            change24h:
              null,

            source:
              "binance-websocket",

            timestamp:
              new Date().toISOString(),
          }),

          price:
            wsPrice,

          source:
            "binance-websocket",

          timestamp:
            new Date().toISOString(),
        }
      : restPrice;

  /* ------------------------------------------------------------------------ */
  /*                         REALTIME CHART DATA                               */
  /* ------------------------------------------------------------------------ */

  /*
   * Kết hợp:
   *
   * REST 200 candles
   *
   * +
   *
   * Binance realtime candle.
   *
   * useMemo giúp tránh tạo lại array
   * khi những phần khác của page render.
   */
  const chartBars =
    useMemo(() => {
      const historicalBars =
        ohlcv.data?.bars ?? [];

      /*
       * Chưa có WebSocket candle.
       *
       * Dùng nguyên REST data.
       */
      if (
        !wsKline ||
        historicalBars.length === 0
      ) {
        return historicalBars;
      }

      const realtimeBar: Bar = {
        /*
         * lightweight-charts sử dụng
         * Unix timestamp tính bằng giây.
         */
        time: Math.floor(
          wsKline.startTime /
            1000,
        ),

        open:
          wsKline.open,

        high:
          wsKline.high,

        low:
          wsKline.low,

        close:
          wsKline.close,

        volume:
          wsKline.volume,
      };

      const last =
        historicalBars[
          historicalBars.length - 1
        ];

      /*
       * ------------------------------------------------------
       * CASE 1
       *
       * Binance đang update candle
       * hiện tại.
       *
       * REST:
       *
       * ... 100
       *
       * WS:
       *
       * ... 101
       * ------------------------------------------------------
       */
      if (
        last &&
        last.time ===
          realtimeBar.time
      ) {
        return [
          ...historicalBars.slice(
            0,
            -1,
          ),

          realtimeBar,
        ];
      }

      /*
       * ------------------------------------------------------
       * CASE 2
       *
       * Binance đã bước sang
       * candle mới.
       *
       * ------------------------------------------------------
       */
      if (
        last &&
        realtimeBar.time >
          last.time
      ) {
        return [
          ...historicalBars,
          realtimeBar,
        ];
      }

      /*
       * ------------------------------------------------------
       * CASE 3
       *
       * WS candle cũ hơn REST.
       *
       * Không dùng.
       * ------------------------------------------------------
       */
      return historicalBars;
    }, [
      ohlcv.data?.bars,
      wsKline,
    ]);

  /* ------------------------------------------------------------------------ */
  /*                            ANALYSIS                                      */
  /* ------------------------------------------------------------------------ */

  const a =
    analysis.data;

  const recoStyle =
    a?.recommendation ===
    "LONG"
      ? "border-emerald-600 bg-emerald-500/10 text-emerald-300"
      : a?.recommendation ===
          "SHORT"
        ? "border-rose-600 bg-rose-500/10 text-rose-300"
        : "border-amber-600 bg-amber-500/10 text-amber-300";

  /* ------------------------------------------------------------------------ */
  /*                         TIMEFRAME HANDLER                                */
  /* ------------------------------------------------------------------------ */

  const handleTimeframeChange =
    (
      nextTf: string,
    ) => {
      if (
        nextTf === tf
      ) {
        return;
      }

      /*
       * Xóa candle realtime cũ
       * trước khi chuyển timeframe.
       */
      setWsKline(null);

      setWsPrice(null);

      setTf(nextTf);
    };

  /* ------------------------------------------------------------------------ */
  /*                         WEBSOCKET STATUS                                 */
  /* ------------------------------------------------------------------------ */

  const websocketStatusText =
    wsStatus ===
    "connected"
      ? "REALTIME"
      : wsStatus ===
          "reconnecting"
        ? "RECONNECTING"
        : wsStatus ===
            "connecting"
          ? "CONNECTING"
          : "FALLBACK";

  const websocketStatusClass =
    wsStatus ===
    "connected"
      ? "bg-emerald-400"
      : wsStatus ===
          "reconnecting"
        ? "bg-amber-400"
        : "bg-slate-500";

  /* ------------------------------------------------------------------------ */
  /*                                  UI                                      */
  /* ------------------------------------------------------------------------ */

  return (
    <div className="space-y-5">

      {/* ------------------------------------------------------------------ */}
      {/* BACK                                                               */}
      {/* ------------------------------------------------------------------ */}

      <div>
        <Link
          href="/crypto"
          className="text-xs text-[#00d4ff]"
        >
          ← Thị trường Crypto
        </Link>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* HEADER                                                             */}
      {/* ------------------------------------------------------------------ */}

      <div className="panel p-4 flex flex-wrap items-center gap-4">

        {/* Logo */}
        {coin?.logoUrl ? (
          <img
            src={
              coin.logoUrl
            }
            alt=""
            className="h-12 w-12 rounded-full"
            loading="eager"
            decoding="async"
          />
        ) : (
          <div className="h-12 w-12 rounded-full bg-[#00d4ff]/15 flex items-center justify-center font-bold">
            {symbol.slice(
              0,
              2,
            )}
          </div>
        )}

        {/* Coin name */}
        <div>
          <div className="flex items-center gap-2">

            <h1 className="text-2xl font-black text-white">
              {coin?.name ??
                symbol}
            </h1>

            <span className="text-slate-500">
              {symbol}
            </span>

            {/* WebSocket indicator */}
            <span
              title={`Binance ${websocketStatusText}`}
              className={`h-2 w-2 rounded-full ${websocketStatusClass} ${
                wsStatus ===
                "connected"
                  ? "live-dot"
                  : ""
              }`}
            />
          </div>

          <div className="text-[10px] text-slate-500">
            Nguồn giá:{" "}
            {price?.source ??
              "—"}{" "}
            · GMT+7
          </div>

          <div className="text-[9px] mt-1 text-slate-600">
            Binance WebSocket:{" "}
            {websocketStatusText}
          </div>
        </div>

        {/* Price */}
        <div className="sm:ml-auto">

          <div className="text-3xl font-black text-white">
            $
            {fmtNum(
              price?.price,
              price?.price &&
                price.price <
                  1
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

      {/* ------------------------------------------------------------------ */}
      {/* CHART + SIGNAL                                                     */}
      {/* ------------------------------------------------------------------ */}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* ---------------------------------------------------------------- */}
        {/* CHART                                                            */}
        {/* ---------------------------------------------------------------- */}

        <div className="panel p-3 xl:col-span-2">

          <div className="flex flex-wrap justify-between gap-2 mb-2">

            <div className="flex items-center gap-3">

              <h2 className="font-semibold text-white">
                Biểu đồ{" "}
                {symbol}/USDT
              </h2>

              {/* Realtime label */}
              {wsStatus ===
                "connected" && (
                <span className="text-[9px] uppercase tracking-wider text-emerald-400">
                  ● Live
                </span>
              )}

            </div>

            {/* Timeframes */}
            <div className="flex gap-1 overflow-x-auto">

              {TFS.map(
                (x) => (
                  <button
                    key={x}
                    onClick={() =>
                      handleTimeframeChange(
                        x,
                      )
                    }
                    disabled={
                      tf === x
                    }
                    className={`min-h-9 px-3 rounded text-xs ${
                      tf ===
                      x
                        ? "bg-[#00d4ff] text-[#0A2540]"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                    }`}
                  >
                    {x}
                  </button>
                ),
              )}

            </div>
          </div>

          {/* Candle chart */}
          {chartBars.length >
          0 ? (
            <CandleChart
              bars={
                chartBars
              }
              height={
                400
              }
            />
          ) : (
            <div className="h-96 flex items-center justify-center text-slate-500">
              Đang tải Binance klines...
            </div>
          )}

        </div>

        {/* ---------------------------------------------------------------- */}
        {/* QUANT SIGNAL                                                     */}
        {/* ---------------------------------------------------------------- */}

        <div
          className={`panel border p-4 ${recoStyle}`}
        >

          <div className="text-[10px] tracking-[.25em] uppercase opacity-70">
            Tín hiệu định lượng
          </div>

          <div className="text-4xl font-black mt-2">
            {a?.recommendation ??
              "—"}
          </div>

          <div className="text-sm mt-1">
            Confidence{" "}
            {a
              ? `${Math.round(
                  a.confidence *
                    100,
                )}%`
              : "—"}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-y-2 text-xs">

            <span className="opacity-60">
              Entry
            </span>

            <span className="text-right font-mono">
              $
              {fmtNum(
                a?.entryPrice,
                4,
              )}
            </span>

            <span className="opacity-60">
              Stop Loss
            </span>

            <span className="text-right font-mono">
              $
              {fmtNum(
                a?.stopLoss,
                4,
              )}
            </span>

            <span className="opacity-60">
              Take Profit
            </span>

            <span className="text-right font-mono">
              $
              {fmtNum(
                a?.takeProfit,
                4,
              )}
            </span>

          </div>

          <ul className="mt-4 text-xs space-y-1 opacity-90">

            {a?.reasons
              ?.slice(
                0,
                6,
              )
              .map(
                (
                  r,
                  i,
                ) => (
                  <li
                    key={i}
                  >
                    • {r}
                  </li>
                ),
              )}

          </ul>

          <div className="mt-4 text-[9px] opacity-60">
            Không phải lời khuyên đầu tư.
          </div>

        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* TECHNICAL / SENTIMENT / MARKET                                    */}
      {/* ------------------------------------------------------------------ */}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ---------------------------------------------------------------- */}
        {/* INDICATORS                                                       */}
        {/* ---------------------------------------------------------------- */}

        <div className="panel p-4">

          <h2 className="font-semibold text-white mb-3">
            Chỉ báo kỹ thuật
          </h2>

          <div className="grid grid-cols-2 gap-2 text-xs">

            {a &&
              Object.entries(
                a.indicators,
              )
                .filter(
                  ([, v]) =>
                    typeof v ===
                      "number" ||
                    v === null,
                )
                .map(
                  ([
                    k,
                    v,
                  ]) => (
                    <div
                      key={k}
                      className="rounded bg-slate-900/40 p-2"
                    >
                      <div className="text-slate-500">
                        {k}
                      </div>

                      <div className="font-mono text-white mt-1">
                        {typeof v ===
                        "number"
                          ? fmtNum(
                              v,
                              4,
                            )
                          : "—"}
                      </div>
                    </div>
                  ),
                )}

          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* SENTIMENT                                                         */}
        {/* ---------------------------------------------------------------- */}

        <div className="panel p-4">

          <h2 className="font-semibold text-white mb-3">
            Sentiment
          </h2>

          <div className="text-3xl font-black text-white">

            {sentiment.data
              ?.score !=
            null
              ? `${
                  sentiment
                    .data
                    .score >
                  0
                    ? "+"
                    : ""
                }${sentiment.data.score.toFixed(
                  2,
                )}`
              : "—"}

          </div>

          <div className="text-sm text-slate-400">
            {sentiment.data
              ?.label ??
              "Đang phân tích RSS..."}
          </div>

          <div className="mt-3 space-y-2">

            {sentiment.data?.articles
              ?.slice(
                0,
                4,
              )
              .map(
                (
                  n,
                  i,
                ) => (
                  <a
                    key={i}
                    href={
                      n.link
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="block text-xs text-slate-400 hover:text-[#00d4ff] line-clamp-2"
                  >
                    {
                      n.title
                    }{" "}
                    ·{" "}
                    {
                      n.source
                    }
                  </a>
                ),
              )}

          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* MARKET INFORMATION                                               */}
        {/* ---------------------------------------------------------------- */}

        <div className="panel p-4">

          <h2 className="font-semibold text-white mb-3">
            Thông tin thị trường
          </h2>

          <dl className="grid grid-cols-2 gap-y-2 text-xs">

            <dt className="text-slate-500">
              Market cap
            </dt>

            <dd className="text-right">
              $
              {fmtVol(
                price?.marketCap,
              )}
            </dd>

            <dt className="text-slate-500">
              Volume 24h
            </dt>

            <dd className="text-right">
              $
              {fmtVol(
                price?.volume24h,
              )}
            </dd>

            <dt className="text-slate-500">
              Rank
            </dt>

            <dd className="text-right">
              #
              {coin?.marketCapRank ??
                "—"}
            </dd>

            <dt className="text-slate-500">
              Circulating
            </dt>

            <dd className="text-right">
              {fmtVol(
                coin?.circulatingSupply,
              )}
            </dd>

            <dt className="text-slate-500">
              Max supply
            </dt>

            <dd className="text-right">
              {fmtVol(
                coin?.maxSupply,
              )}
            </dd>

          </dl>

          {coin?.website && (
            <a
              href={
                coin.website
              }
              target="_blank"
              rel="noreferrer"
              className="mt-3 block text-xs text-[#00d4ff]"
            >
              Website chính thức ↗
            </a>
          )}

        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* DESCRIPTION                                                        */}
      {/* ------------------------------------------------------------------ */}

      {coin?.description && (
        <div className="panel p-4">

          <h2 className="font-semibold text-white mb-2">
            Giới thiệu
          </h2>

          <p className="text-sm text-slate-400 leading-relaxed line-clamp-6">
            {
              coin.description
            }
          </p>

        </div>
      )}

    </div>
  );
}
