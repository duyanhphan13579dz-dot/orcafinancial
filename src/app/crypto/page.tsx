"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  changeColor,
  fmtNum,
  fmtPct,
  fmtVol,
  usePoll,
} from "@/lib/client";

import {
  createBinanceMarketWebSocket,
  type BinanceMarketTicker,
} from "@/lib/crypto/binance-market-websocket";

/* -------------------------------------------------------------------------- */
/*                                   TYPES                                    */
/* -------------------------------------------------------------------------- */

interface Row {
  symbol: string;
  name: string;
  logoUrl: string | null;
  marketCapRank: number | null;

  price: number;
  priceVnd: number | null;

  volume24h: number | null;
  marketCap: number | null;

  change24h: number | null;

  source: string;
  timestamp: string;
}

/* -------------------------------------------------------------------------- */
/*                           REALTIME PATCH TYPE                              */
/* -------------------------------------------------------------------------- */

interface RealtimePatch {
  price: number;
  change24h: number;
  volume24h: number;
  source: string;
  timestamp: string;
}

/* -------------------------------------------------------------------------- */
/*                                   PAGE                                     */
/* -------------------------------------------------------------------------- */

export default function CryptoPage() {
  /*
   * ------------------------------------------------------------------------
   * INITIAL REST DATA
   * ------------------------------------------------------------------------
   *
   * REST chỉ lấy initial snapshot.
   *
   * Không polling 5 giây nữa.
   */
  const feed =
    usePoll<{
      prices: Row[];
      freshness: Record<
        string,
        unknown
      >;
    }>(
      "/crypto/prices?limit=100",
      60_000,
    );

  /*
   * ------------------------------------------------------------------------
   * UI STATE
   * ------------------------------------------------------------------------
   */

  const [query, setQuery] =
    useState("");

  const [sort, setSort] =
    useState<
      | "volume"
      | "gainers"
      | "losers"
    >("volume");

  /*
   * ------------------------------------------------------------------------
   * BINANCE WEBSOCKET STATE
   * ------------------------------------------------------------------------
   */

  const [
    realtime,
    setRealtime,
  ] = useState<
    Record<
      string,
      RealtimePatch
    >
  >({});

  const [
    wsStatus,
    setWsStatus,
  ] = useState<
    | "connecting"
    | "connected"
    | "reconnecting"
    | "disconnected"
    | "error"
  >("connecting");

  /*
   * ------------------------------------------------------------------------
   * BINANCE MARKET WEBSOCKET
   * ------------------------------------------------------------------------
   *
   * Chỉ một WebSocket cho toàn bộ trang.
   */
  useEffect(() => {
    const connection =
      createBinanceMarketWebSocket(
        {
          onStatus: (
            status,
          ) => {
            setWsStatus(
              status,
            );
          },

          onTicker: (
            ticker,
          ) => {
            setRealtime(
              (
                current,
              ) => {
                const next =
                  {
                    ...current,
                  };

                /*
                 * Binance:
                 *
                 * BTCUSDT
                 *
                 * Orca:
                 *
                 * BTC
                 */
                const symbol =
                  ticker.symbol.endsWith(
                    "USDT",
                  )
                    ? ticker.symbol.slice(
                        0,
                        -4,
                      )
                    : ticker.symbol;

                next[
                  symbol.toUpperCase()
                ] = {
                  price:
                    ticker.price,

                  change24h:
                    ticker.priceChangePercent,

                  /*
                   * Binance v = base volume.
                   *
                   * UI hiện tại hiển thị
                   * Volume 24h theo USD.
                   *
                   * Vì vậy ưu tiên quoteVolume.
                   */
                  volume24h:
                    ticker.quoteVolume24h,

                  source:
                    "Binance WS",

                  timestamp:
                    new Date(
                      ticker.eventTime,
                    ).toISOString(),
                };

                return next;
              },
            );
          },
        },
      );

    return () => {
      connection.disconnect();
    };
  }, []);

  /*
   * ------------------------------------------------------------------------
   * MERGE REST + WEBSOCKET
   * ------------------------------------------------------------------------
   *
   * REST cung cấp:
   *
   * - logo
   * - name
   * - market cap
   * - rank
   * - VND
   *
   * WebSocket cung cấp:
   *
   * - price
   * - change 24h
   * - volume
   */
  const mergedRows =
    useMemo(() => {
      return (
        feed.data?.prices ??
        []
      ).map(
        (row) => {
          const live =
            realtime[
              row.symbol.toUpperCase()
            ];

          if (!live) {
            return row;
          }

          return {
            ...row,

            price:
              live.price,

            change24h:
              live.change24h,

            volume24h:
              live.volume24h,

            source:
              live.source,

            timestamp:
              live.timestamp,
          };
        },
      );
    }, [
      feed.data,
      realtime,
    ]);

  /*
   * ------------------------------------------------------------------------
   * SEARCH + SORT
   * ------------------------------------------------------------------------
   */

  const rows =
    useMemo(() => {
      const filtered =
        mergedRows.filter(
          (x) =>
            !query ||
            x.symbol
              .toUpperCase()
              .includes(
                query.toUpperCase(),
              ) ||
            x.name
              .toLowerCase()
              .includes(
                query.toLowerCase(),
              ),
        );

      return [
        ...filtered,
      ].sort(
        (
          x,
          y,
        ) => {
          if (
            sort ===
            "gainers"
          ) {
            return (
              (y.change24h ??
                0) -
              (x.change24h ??
                0)
            );
          }

          if (
            sort ===
            "losers"
          ) {
            return (
              (x.change24h ??
                0) -
              (y.change24h ??
                0)
            );
          }

          return (
            (y.volume24h ??
              0) -
            (x.volume24h ??
              0)
          );
        },
      );
    }, [
      mergedRows,
      query,
      sort,
    ]);

  /*
   * ------------------------------------------------------------------------
   * WEBSOCKET UI
   * ------------------------------------------------------------------------
   */

  const websocketText =
    wsStatus ===
    "connected"
      ? "BINANCE LIVE"
      : wsStatus ===
          "reconnecting"
        ? "RECONNECTING"
        : wsStatus ===
            "connecting"
          ? "CONNECTING"
          : "FALLBACK";

  const websocketDot =
    wsStatus ===
    "connected"
      ? "bg-emerald-400 live-dot"
      : wsStatus ===
          "reconnecting"
        ? "bg-amber-400"
        : "bg-slate-500";

  /*
   * ------------------------------------------------------------------------
   * RENDER
   * ------------------------------------------------------------------------
   */

  return (
    <div className="space-y-5">

      {/* ------------------------------------------------------------------ */}
      {/* HEADER                                                             */}
      {/* ------------------------------------------------------------------ */}

      <div className="flex flex-wrap items-end justify-between gap-3">

        <div>

          <div className="font-mono text-[10px] tracking-[.3em] text-[#00d4ff] uppercase">
            Binance Market Intelligence
          </div>

          <h1 className="text-3xl font-black text-white mt-1">
            Thị trường Crypto
          </h1>

          <p className="text-sm text-slate-400 mt-1">
            Giá USDT realtime · Binance WebSocket
          </p>

        </div>

        {/* LIVE STATUS */}

        <span className="inline-flex items-center gap-2 text-xs text-emerald-300">

          <i
            className={`h-2 w-2 rounded-full ${websocketDot}`}
          />

          {websocketText}

        </span>

      </div>

      {/* ------------------------------------------------------------------ */}
      {/* SEARCH / SORT                                                      */}
      {/* ------------------------------------------------------------------ */}

      <div className="panel p-3 flex flex-col sm:flex-row gap-2">

        <input
          value={query}
          onChange={(e) =>
            setQuery(
              e.target.value,
            )
          }
          placeholder="Tìm BTC, ETH, SOL..."
          className="Input flex-1"
        />

        <div className="flex gap-1">

          {[
            [
              "volume",
              "Thanh khoản",
            ],
            [
              "gainers",
              "Tăng mạnh",
            ],
            [
              "losers",
              "Giảm mạnh",
            ],
          ].map(
            ([
              value,
              label,
            ]) => (
              <button
                key={value}
                onClick={() =>
                  setSort(
                    value as
                      | "volume"
                      | "gainers"
                      | "losers",
                  )
                }
                className={`min-h-11 rounded-lg px-3 text-xs ${
                  sort ===
                  value
                    ? "bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/40"
                    : "border border-slate-700 text-slate-400 hover:bg-slate-800"
                }`}
              >
                {label}
              </button>
            ),
          )}

        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* ERROR                                                              */}
      {/* ------------------------------------------------------------------ */}

      {feed.error && (
        <div className="panel border-rose-800 p-4 text-sm text-rose-300">
          {feed.error}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* INITIAL LOADING                                                    */}
      {/* ------------------------------------------------------------------ */}

      {feed.loading &&
        !feed.data && (
          <div className="panel p-12 text-center text-slate-500">
            Đang đồng bộ Binance...
          </div>
        )}

      {/* ------------------------------------------------------------------ */}
      {/* MARKET TABLE                                                       */}
      {/* ------------------------------------------------------------------ */}

      <div className="panel overflow-x-auto">

        <table className="w-full min-w-[760px] text-sm">

          <thead>

            <tr className="border-b border-slate-700 text-xs text-slate-500">

              <th className="text-left p-3">
                Coin
              </th>

              <th className="text-right">
                Giá USD
              </th>

              <th className="text-right">
                Giá VND
              </th>

              <th className="text-right">
                24h
              </th>

              <th className="text-right">
                Volume 24h
              </th>

              <th className="text-right pr-3">
                Nguồn
              </th>

            </tr>

          </thead>

          <tbody>

            {rows.map(
              (r) => {
                const live =
                  realtime[
                    r.symbol.toUpperCase()
                  ];

                return (
                  <tr
                    key={
                      r.symbol
                    }
                    className={`border-b border-slate-800/70 hover:bg-slate-800/30 ${
                      live
                        ? "transition-colors duration-300"
                        : ""
                    }`}
                  >

                    {/* -------------------------------------------------- */}
                    {/* COIN                                                */}
                    {/* -------------------------------------------------- */}

                    <td className="p-3">

                      <Link
                        href={`/crypto/${r.symbol}`}
                        className="flex items-center gap-2"
                      >

                        {r.logoUrl ? (
                          <img
                            src={
                              r.logoUrl
                            }
                            alt=""
                            className="h-8 w-8 rounded-full"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span className="h-8 w-8 rounded-full bg-[#00d4ff]/15 flex items-center justify-center text-xs font-bold text-[#00d4ff]">
                            {r.symbol.slice(
                              0,
                              2,
                            )}
                          </span>
                        )}

                        <div>

                          <div className="font-bold text-white">
                            {
                              r.symbol
                            }
                          </div>

                          <div className="text-[10px] text-slate-500">
                            {r.name}
                          </div>

                        </div>

                      </Link>

                    </td>

                    {/* -------------------------------------------------- */}
                    {/* PRICE                                               */}
                    {/* -------------------------------------------------- */}

                    <td className="text-right font-mono">

                      $
                      {fmtNum(
                        r.price,
                        r.price <
                          1
                          ? 6
                          : 2,
                      )}

                    </td>

                    {/* -------------------------------------------------- */}
                    {/* VND                                                 */}
                    {/* -------------------------------------------------- */}

                    <td className="text-right font-mono text-slate-400">

                      {r.priceVnd
                        ? fmtNum(
                            r.priceVnd,
                            0,
                          )
                        : "—"}

                    </td>

                    {/* -------------------------------------------------- */}
                    {/* CHANGE                                              */}
                    {/* -------------------------------------------------- */}

                    <td
                      className={`text-right font-mono font-bold ${changeColor(
                        r.change24h,
                      )}`}
                    >
                      {fmtPct(
                        r.change24h,
                      )}
                    </td>

                    {/* -------------------------------------------------- */}
                    {/* VOLUME                                              */}
                    {/* -------------------------------------------------- */}

                    <td className="text-right text-slate-400">

                      $
                      {fmtVol(
                        r.volume24h,
                      )}

                    </td>

                    {/* -------------------------------------------------- */}
                    {/* SOURCE                                              */}
                    {/* -------------------------------------------------- */}

                    <td className="text-right pr-3">

                      <span
                        className={`text-[10px] ${
                          live
                            ? "text-emerald-400"
                            : "text-slate-600"
                        }`}
                      >
                        {live
                          ? "Binance WS"
                          : r.source}
                      </span>

                    </td>

                  </tr>
                );
              },
            )}

          </tbody>

        </table>

      </div>

      {/* ------------------------------------------------------------------ */}
      {/* EMPTY SEARCH                                                       */}
      {/* ------------------------------------------------------------------ */}

      {!feed.loading &&
        feed.data &&
        rows.length ===
          0 && (
          <div className="panel p-10 text-center text-slate-500">
            Không tìm thấy coin phù hợp.
          </div>
        )}

      {/* ------------------------------------------------------------------ */}
      {/* FOOTER                                                             */}
      {/* ------------------------------------------------------------------ */}

      <div className="text-[10px] text-slate-600">
        Binance WebSocket cập nhật giá realtime. Dữ liệu market cap và thông tin cơ bản được đồng bộ từ hệ thống dữ liệu Orca Financial.
      </div>

      <div className="text-[10px] text-slate-600">
        Dữ liệu chỉ nhằm mục đích tham khảo. Giao dịch tài sản số có rủi ro cao.
      </div>

    </div>
  );
}
