"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
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

interface RealtimePatch {
  price: number;
  change24h: number;
  volume24h: number;
  source: string;
  timestamp: string;
}

/* -------------------------------------------------------------------------- */
/*                              PREFETCH CONFIG                               */
/* -------------------------------------------------------------------------- */

/*
 * Số coin sẽ được prefetch khi trang /crypto mở.
 *
 * 15 coin đầu tiên được lấy trực tiếp từ market ranking,
 * không hard-code BTC/ETH/SOL.
 */
const PREFETCH_COUNT = 15;

/*
 * Mỗi batch chỉ xử lý 3 coin.
 *
 * Ví dụ:
 *
 * Batch 1: BTC ETH BNB
 * Batch 2: SOL XRP DOGE
 * Batch 3: ADA TRX AVAX
 *
 * Điều này tránh tạo 30 request cùng lúc.
 */
const PREFETCH_BATCH_SIZE = 3;

/*
 * Khoảng nghỉ giữa các batch.
 */
const PREFETCH_BATCH_DELAY = 150;

/*
 * Prefetch chart mặc định ở timeframe 1h.
 */
const PREFETCH_TIMEFRAME = "1h";

/*
 * Số candle historical được preload.
 */
const PREFETCH_CANDLE_LIMIT = 200;

/* -------------------------------------------------------------------------- */
/*                              HELPER FUNCTIONS                              */
/* -------------------------------------------------------------------------- */

function normalizeSymbol(
  symbol: string,
): string {
  return symbol
    .toUpperCase()
    .trim();
}

/*
 * Delay helper.
 */
function sleep(
  ms: number,
): Promise<void> {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms,
      ),
  );
}

/* -------------------------------------------------------------------------- */
/*                                   PAGE                                     */
/* -------------------------------------------------------------------------- */

export default function CryptoPage() {
  /* ---------------------------------------------------------------------- */
  /* INITIAL REST DATA                                                      */
  /* ---------------------------------------------------------------------- */

  /*
   * REST chỉ lấy initial snapshot.
   *
   * Realtime market price được Binance WebSocket cập nhật.
   */
  const feed = usePoll<{
    prices: Row[];
    freshness: Record<
      string,
      unknown
    >;
  }>(
    "/crypto/prices?limit=100",
    60_000,
  );

  /* ---------------------------------------------------------------------- */
  /* UI STATE                                                               */
  /* ---------------------------------------------------------------------- */

  const [query, setQuery] =
    useState("");

  const [sort, setSort] =
    useState<
      | "volume"
      | "gainers"
      | "losers"
    >("volume");

  /* ---------------------------------------------------------------------- */
  /* REALTIME STATE                                                         */
  /* ---------------------------------------------------------------------- */

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

  /* ---------------------------------------------------------------------- */
  /* PREFETCH STATE                                                         */
  /* ---------------------------------------------------------------------- */

  /*
   * Những coin đã prefetch thành công.
   *
   * Ví dụ:
   *
   * BTC:1h
   * ETH:1h
   * SOL:1h
   */
  const prefetchedRef =
    useRef<
      Set<string>
    >(new Set());

  /*
   * Những coin đang được prefetch.
   *
   * Set này chống việc hover BTC trong lúc BTC
   * đang được prefetch rồi tạo thêm request.
   */
  const prefetchingRef =
    useRef<
      Set<string>
    >(new Set());

  /*
   * Chặn nhiều lần chạy background prefetch
   * với cùng một snapshot.
   */
  const prefetchRunRef =
    useRef(false);

  /* ---------------------------------------------------------------------- */
  /* BINANCE MARKET WEBSOCKET                                               */
  /* ---------------------------------------------------------------------- */

  /*
   * Chỉ một WebSocket cho toàn bộ trang /crypto.
   *
   * Không tạo WebSocket riêng cho từng row.
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
            ticker: BinanceMarketTicker,
          ) => {
            setRealtime(
              (
                current,
              ) => {
                const next = {
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
                   * quoteVolume24h là volume
                   * theo USDT/USD.
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

  /* ---------------------------------------------------------------------- */
  /* PREFETCH SINGLE COIN                                                   */
  /* ---------------------------------------------------------------------- */

  /*
   * Prefetch profile + OHLCV của một coin.
   *
   * Không prefetch:
   *
   * - analysis
   * - sentiment
   *
   * vì hai API này nặng hơn và chỉ cần khi user
   * thực sự mở trang detail.
   */
    const prefetchCoin =
    async (
      symbol: string,
    ) => {
      const normalized =
        normalizeSymbol(
          symbol,
        );

      if (!normalized) {
        return;
      }

      const key =
        `${normalized}:${PREFETCH_TIMEFRAME}`;

      if (
        prefetchedRef.current.has(
          key,
        )
      ) {
        return;
      }

      if (
        prefetchingRef.current.has(
          key,
        )
      ) {
        return;
      }

      prefetchingRef.current.add(
        key,
      );

      try {
        const [
          profileResponse,
          ohlcvResponse,
        ] =
          await Promise.allSettled([
            fetch(
              `/api/v1/crypto/${encodeURIComponent(
                normalized,
              )}`,
              {
                method: "GET",
                cache:
                  "force-cache",
                credentials:
                  "same-origin",
              },
            ),

            fetch(
              `/api/v1/crypto/${encodeURIComponent(
                normalized,
              )}/ohlcv?timeframe=${PREFETCH_TIMEFRAME}&limit=${PREFETCH_CANDLE_LIMIT}`,
              {
                method: "GET",
                cache:
                  "force-cache",
                credentials:
                  "same-origin",
              },
            ),
          ]);

        const profileOk =
          profileResponse.status ===
            "fulfilled" &&
          profileResponse.value.ok;

        const ohlcvOk =
          ohlcvResponse.status ===
            "fulfilled" &&
          ohlcvResponse.value.ok;

        if (
          profileOk &&
          ohlcvOk
        ) {
          prefetchedRef.current.add(
            key,
          );
        }
      } catch {
        // Prefetch failure must never break /crypto.
      } finally {
        prefetchingRef.current.delete(
          key,
        );
      }
    };
        const profilePromise =
          fetch(
            `/api/v1/crypto/${encodeURIComponent(
              normalized,
            )}`,
            {
              method: "GET",
              cache:
                "force-cache",
              credentials:
                "same-origin",
            },
          );

        const ohlcvPromise =
          fetch(
            `/api/v1/crypto/${encodeURIComponent(
              normalized,
            )}/ohlcv?timeframe=${PREFETCH_TIMEFRAME}&limit=${PREFETCH_CANDLE_LIMIT}`,
            {
              method: "GET",
              cache:
                "force-cache",
              credentials:
                "same-origin",
            },
          );

        /*
         * Không để một request fail làm request còn lại
         * bị hủy.
         */
        await Promise.allSettled(
          [
            profilePromise,
            ohlcvPromise,
          ],
        );

        /*
         * Đánh dấu đã prefetch.
         *
         * Nếu API server trả lỗi thì request detail
         * sau này vẫn có thể tự fetch lại.
         *
         * Vì vậy kiểm tra response trước khi đánh dấu.
         */
        const [
          profileResponse,
          ohlcvResponse,
        ] =
          await Promise.allSettled(
            [
              profilePromise,
              ohlcvPromise,
            ],
          );

        const profileOk =
          profileResponse.status ===
            "fulfilled" &&
          profileResponse.value.ok;

        const ohlcvOk =
          ohlcvResponse.status ===
            "fulfilled" &&
          ohlcvResponse.value.ok;

        if (
          profileOk ||
          ohlcvOk
        ) {
          prefetchedRef.current.add(
            key,
          );
        }
      } catch {
        /*
         * Prefetch không được phép phá UI.
         */
      } finally {
        prefetchingRef.current.delete(
          key,
        );
      }
    };

  /* ---------------------------------------------------------------------- */
  /* PREFETCH TOP 15                                                       */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const prices =
      feed.data?.prices;

    if (
      !prices ||
      prices.length === 0
    ) {
      return;
    }

    /*
     * Chỉ chạy một lần cho market snapshot đầu tiên.
     */
    if (
      prefetchRunRef.current
    ) {
      return;
    }

    prefetchRunRef.current =
      true;

    /*
     * Lấy 15 coin đầu tiên theo ranking hiện tại.
     */
    const topCoins =
      prices
        .map(
          (item) =>
            item.symbol,
        )
        .filter(
          Boolean,
        )
        .map(
          normalizeSymbol,
        )
        .filter(
          (
            symbol,
            index,
            array,
          ) =>
            array.indexOf(
              symbol,
            ) === index,
        )
        .slice(
          0,
          PREFETCH_COUNT,
        );

    let cancelled =
      false;

    const run =
      async () => {
        /*
         * Chia thành batch.
         */
        for (
          let i = 0;
          i <
            topCoins.length;
          i +=
            PREFETCH_BATCH_SIZE
        ) {
          if (
            cancelled
          ) {
            return;
          }

          const batch =
            topCoins.slice(
              i,
              i +
                PREFETCH_BATCH_SIZE,
            );

          /*
           * 3 coin chạy song song.
           */
          await Promise.all(
            batch.map(
              (
                symbol,
              ) =>
                prefetchCoin(
                  symbol,
                ),
            ),
          );

          if (
            cancelled
          ) {
            return;
          }

          /*
           * Nghỉ ngắn giữa các batch.
           */
          if (
            i +
              PREFETCH_BATCH_SIZE <
            topCoins.length
          ) {
            await sleep(
              PREFETCH_BATCH_DELAY,
            );
          }
        }
      };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    feed.data?.prices,
  ]);

  /* ---------------------------------------------------------------------- */
  /* MERGE REST + WEBSOCKET                                                 */
  /* ---------------------------------------------------------------------- */

  const mergedRows =
    useMemo(() => {
      return (
        feed.data?.prices ??
        []
      ).map(
        (row) => {
          const live =
            realtime[
              normalizeSymbol(
                row.symbol,
              )
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

  /* ---------------------------------------------------------------------- */
  /* SEARCH + SORT                                                          */
  /* ---------------------------------------------------------------------- */

  const rows =
    useMemo(() => {
      const normalizedQuery =
        query
          .trim()
          .toLowerCase();

      const filtered =
        mergedRows.filter(
          (x) => {
            if (
              !normalizedQuery
            ) {
              return true;
            }

            return (
              x.symbol
                .toLowerCase()
                .includes(
                  normalizedQuery,
                ) ||
              x.name
                .toLowerCase()
                .includes(
                  normalizedQuery,
                )
            );
          },
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

  /* ---------------------------------------------------------------------- */
  /* WEBSOCKET UI                                                           */
  /* ---------------------------------------------------------------------- */

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

  /* ---------------------------------------------------------------------- */
  /* RENDER                                                                 */
  /* ---------------------------------------------------------------------- */

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
      {/* ERROR                                                               */}
      {/* ------------------------------------------------------------------ */}

      {feed.error && (
        <div className="panel border-rose-800 p-4 text-sm text-rose-300">
          {feed.error}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* INITIAL LOADING                                                     */}
      {/* ------------------------------------------------------------------ */}

      {feed.loading &&
        !feed.data && (
          <div className="panel p-12 text-center text-slate-500">
            Đang đồng bộ Binance...
          </div>
        )}

      {/* ------------------------------------------------------------------ */}
      {/* MARKET TABLE                                                        */}
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
                    normalizeSymbol(
                      r.symbol,
                    )
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
                        prefetch
                        onMouseEnter={() => {
                          void prefetchCoin(
                            r.symbol,
                          );
                        }}
                        onFocus={() => {
                          void prefetchCoin(
                            r.symbol,
                          );
                        }}
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
        Binance WebSocket cập nhật giá realtime.
        Dữ liệu market cap và thông tin cơ bản
        được đồng bộ từ hệ thống dữ liệu Orca Financial.
      </div>

      <div className="text-[10px] text-slate-600">
        Giá và dữ liệu thị trường có thể thay đổi
        theo thời gian thực. Không phải lời khuyên đầu tư.
      </div>

    </div>
  );
}
