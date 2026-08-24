"use client";

import Link from "next/link";
import Image from "next/image";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

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
/*                              PERFORMANCE CONFIG                            */
/* -------------------------------------------------------------------------- */

/*
 * REST snapshot:
 *
 * Không cần polling quá thường xuyên vì giá realtime đã được Binance
 * WebSocket cập nhật.
 *
 * REST chủ yếu đóng vai trò:
 * - initial snapshot
 * - fallback
 * - metadata
 */
const REST_POLL_INTERVAL = 120_000;

/*
 * Binance có thể gửi ticker rất thường xuyên.
 *
 * Không cần render React tree cho từng message.
 * Chỉ commit realtime data vào UI theo nhịp này.
 */
const REALTIME_RENDER_INTERVAL = 500;

/*
 * Chỉ warm-cache một số coin đầu bảng.
 *
 * Không nên prefetch 15 coin x 2 API ngay khi page vừa mở.
 * Điều đó tạo rất nhiều request cạnh tranh với initial page load.
 */
const PREFETCH_COUNT = 6;
const PREFETCH_BATCH_SIZE = 2;
const PREFETCH_BATCH_DELAY = 300;

/*
 * Warm-cache chart vừa đủ.
 *
 * User mở detail vẫn có thể request dữ liệu đầy đủ.
 */
const PREFETCH_TIMEFRAME = "1h";
const PREFETCH_CANDLE_LIMIT = 120;

/*
 * Delay trước khi bắt đầu background prefetch.
 *
 * Cho initial page render hoàn tất trước.
 */
const PREFETCH_START_DELAY = 1200;

/* -------------------------------------------------------------------------- */
/*                              HELPER FUNCTIONS                              */
/* -------------------------------------------------------------------------- */

function normalizeSymbol(symbol: string): string {
  return symbol.toUpperCase().trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/* -------------------------------------------------------------------------- */
/*                                   PAGE                                     */
/* -------------------------------------------------------------------------- */

export default function CryptoPage() {
  const router = useRouter();

  /* ---------------------------------------------------------------------- */
  /* INITIAL REST DATA                                                      */
  /* ---------------------------------------------------------------------- */

  const feed = usePoll<{
    prices: Row[];
    freshness: Record<string, unknown>;
  }>(
    "/crypto/prices?limit=100",
    REST_POLL_INTERVAL,
  );

  /* ---------------------------------------------------------------------- */
  /* UI STATE                                                               */
  /* ---------------------------------------------------------------------- */

  const [query, setQuery] = useState("");

  const deferredQuery = useDeferredValue(query);

  const [sort, setSort] = useState<
    "volume" | "gainers" | "losers"
  >("volume");

  /* ---------------------------------------------------------------------- */
  /* REALTIME STATE                                                         */
  /* ---------------------------------------------------------------------- */

  /*
   * QUAN TRỌNG:
   *
   * Không lưu realtime ticker trực tiếp bằng useState cho từng message.
   *
   * Binance có thể gửi rất nhiều message.
   *
   * Nếu mỗi message gọi:
   *
   * setRealtime(...)
   *
   * thì toàn bộ component có thể re-render liên tục.
   *
   * Thay vào đó:
   *
   * websocket -> realtimeRef
   *             ↓
   *      mỗi 500ms commit
   *             ↓
   *        realtimeVersion
   */
  const realtimeRef = useRef<
    Record<string, RealtimePatch>
  >({});

  /*
   * Chỉ dùng để kích hoạt render theo batch.
   *
   * Không chứa data.
   */
  const [realtimeVersion, setRealtimeVersion] =
    useState(0);

  const realtimeCommitTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

  const realtimeDirtyRef = useRef(false);

  const [wsStatus, setWsStatus] = useState<
    | "connecting"
    | "connected"
    | "reconnecting"
    | "disconnected"
    | "error"
  >("connecting");

  /* ---------------------------------------------------------------------- */
  /* PREFETCH STATE                                                         */
  /* ---------------------------------------------------------------------- */

  const prefetchedRef = useRef<Set<string>>(
    new Set(),
  );

  const prefetchingRef = useRef<Set<string>>(
    new Set(),
  );

  const prefetchRunRef = useRef(false);

  /* ---------------------------------------------------------------------- */
  /* REALTIME COMMIT                                                        */
  /* ---------------------------------------------------------------------- */

  const scheduleRealtimeCommit = useCallback(() => {
    /*
     * Nếu đã có timer thì không tạo thêm.
     *
     * Đây là phần quan trọng nhất để tránh render storm.
     */
    if (realtimeCommitTimerRef.current) {
      return;
    }

    realtimeCommitTimerRef.current = setTimeout(() => {
      realtimeCommitTimerRef.current = null;

      if (!realtimeDirtyRef.current) {
        return;
      }

      realtimeDirtyRef.current = false;

      setRealtimeVersion((version) => version + 1);
    }, REALTIME_RENDER_INTERVAL);
  }, []);

  /* ---------------------------------------------------------------------- */
  /* BINANCE MARKET WEBSOCKET                                               */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const connection =
      createBinanceMarketWebSocket({
        onStatus: (status) => {
          setWsStatus(status);
        },

        onTicker: (
          ticker: BinanceMarketTicker,
        ) => {
          /*
           * Binance symbol:
           *
           * BTCUSDT
           *
           * Orca:
           *
           * BTC
           */
          const symbol =
            ticker.symbol.endsWith("USDT")
              ? ticker.symbol.slice(0, -4)
              : ticker.symbol;

          const normalized =
            symbol.toUpperCase();

          /*
           * Chỉ mutate ref.
           *
           * Không trigger React render ở đây.
           */
          realtimeRef.current[
            normalized
          ] = {
            price: ticker.price,
            change24h:
              ticker.priceChangePercent,
            volume24h:
              ticker.quoteVolume24h,
            source: "Binance WS",
            timestamp: new Date(
              ticker.eventTime,
            ).toISOString(),
          };

          realtimeDirtyRef.current = true;

          scheduleRealtimeCommit();
        },
      });

    return () => {
      connection.disconnect();

      if (
        realtimeCommitTimerRef.current
      ) {
        clearTimeout(
          realtimeCommitTimerRef.current,
        );

        realtimeCommitTimerRef.current =
          null;
      }
    };
  }, [scheduleRealtimeCommit]);

  /* ---------------------------------------------------------------------- */
  /* PREFETCH SINGLE COIN                                                   */
  /* ---------------------------------------------------------------------- */

  const prefetchCoin = useCallback(
    async (symbol: string) => {
      const normalized =
        normalizeSymbol(symbol);

      if (!normalized) {
        return;
      }

      const key = `${normalized}:${PREFETCH_TIMEFRAME}`;

      /*
       * Đã warm-cache.
       */
      if (
        prefetchedRef.current.has(key)
      ) {
        return;
      }

      /*
       * Request đang chạy.
       */
      if (
        prefetchingRef.current.has(key)
      ) {
        return;
      }

      prefetchingRef.current.add(key);

      try {
        /*
         * Profile + OHLCV chạy song song.
         */
        const [
          profileResult,
          ohlcvResult,
        ] = await Promise.allSettled([
          fetch(
            `/api/v1/crypto/${encodeURIComponent(
              normalized,
            )}`,
            {
              method: "GET",
              cache: "force-cache",
              credentials: "same-origin",
            },
          ),

          fetch(
            `/api/v1/crypto/${encodeURIComponent(
              normalized,
            )}/ohlcv?timeframe=${PREFETCH_TIMEFRAME}&limit=${PREFETCH_CANDLE_LIMIT}`,
            {
              method: "GET",
              cache: "force-cache",
              credentials: "same-origin",
            },
          ),
        ]);

        const profileOk =
          profileResult.status ===
            "fulfilled" &&
          profileResult.value.ok;

        const ohlcvOk =
          ohlcvResult.status ===
            "fulfilled" &&
          ohlcvResult.value.ok;

        if (profileOk && ohlcvOk) {
          prefetchedRef.current.add(
            key,
          );
        }
      } catch {
        /*
         * Prefetch là optimization.
         *
         * Tuyệt đối không để lỗi prefetch
         * ảnh hưởng page chính.
         */
      } finally {
        prefetchingRef.current.delete(
          key,
        );
      }
    },
    [],
  );

  /* ---------------------------------------------------------------------- */
  /* BACKGROUND PREFETCH TOP COINS                                          */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const prices = feed.data?.prices;

    if (
      !prices ||
      prices.length === 0
    ) {
      return;
    }

    /*
     * Chỉ chạy một lần.
     */
    if (prefetchRunRef.current) {
      return;
    }

    prefetchRunRef.current = true;

    const topCoins = prices
      .map((item) => item.symbol)
      .filter(Boolean)
      .map(normalizeSymbol)
      .filter(
        (symbol, index, array) =>
          array.indexOf(symbol) ===
          index,
      )
      .slice(0, PREFETCH_COUNT);

    let cancelled = false;

    const run = async () => {
      /*
       * Cho initial page render trước.
       */
      await sleep(
        PREFETCH_START_DELAY,
      );

      if (cancelled) {
        return;
      }

      for (
        let i = 0;
        i < topCoins.length;
        i += PREFETCH_BATCH_SIZE
      ) {
        if (cancelled) {
          return;
        }

        const batch =
          topCoins.slice(
            i,
            i + PREFETCH_BATCH_SIZE,
          );

        await Promise.all(
          batch.map((symbol) =>
            prefetchCoin(symbol),
          ),
        );

        if (cancelled) {
          return;
        }

        if (
          i + PREFETCH_BATCH_SIZE <
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
    prefetchCoin,
  ]);

  /* ---------------------------------------------------------------------- */
  /* MERGE REST + WEBSOCKET                                                 */
  /* ---------------------------------------------------------------------- */

  const mergedRows = useMemo(() => {
    /*
     * realtimeVersion cố tình được đọc ở đây.
     *
     * Mỗi 500ms component mới lấy snapshot realtime
     * mới nhất.
     */
    void realtimeVersion;

    const realtime =
      realtimeRef.current;

    return (
      feed.data?.prices ?? []
    ).map((row) => {
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

        price: live.price,

        change24h:
          live.change24h,

        volume24h:
          live.volume24h,

        source:
          live.source,

        timestamp:
          live.timestamp,
      };
    });
  }, [
    feed.data,
    realtimeVersion,
  ]);

  /* ---------------------------------------------------------------------- */
  /* SEARCH + SORT                                                          */
  /* ---------------------------------------------------------------------- */

  const rows = useMemo(() => {
    const normalizedQuery =
      deferredQuery
        .trim()
        .toLowerCase();

    const filtered =
      mergedRows.filter((x) => {
        if (!normalizedQuery) {
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
      });

    return [...filtered].sort(
      (x, y) => {
        if (
          sort === "gainers"
        ) {
          return (
            (y.change24h ?? 0) -
            (x.change24h ?? 0)
          );
        }

        if (
          sort === "losers"
        ) {
          return (
            (x.change24h ?? 0) -
            (y.change24h ?? 0)
          );
        }

        return (
          (y.volume24h ?? 0) -
          (x.volume24h ?? 0)
        );
      },
    );
  }, [
    mergedRows,
    deferredQuery,
    sort,
  ]);

  /* ---------------------------------------------------------------------- */
  /* WEBSOCKET STATUS                                                       */
  /* ---------------------------------------------------------------------- */

  const websocketText =
    wsStatus === "connected"
      ? "BINANCE LIVE"
      : wsStatus === "reconnecting"
        ? "RECONNECTING"
        : wsStatus === "connecting"
          ? "CONNECTING"
          : "FALLBACK";

  const websocketDot =
    wsStatus === "connected"
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
            setQuery(e.target.value)
          }
          placeholder="Tìm BTC, ETH, SOL..."
          className="Input flex-1"
        />

        <div className="flex gap-1">

          {[
            ["volume", "Thanh khoản"],
            ["gainers", "Tăng mạnh"],
            ["losers", "Giảm mạnh"],
          ].map(
            ([value, label]) => (
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
                  sort === value
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

            {rows.map((r) => {
              const normalized =
                normalizeSymbol(
                  r.symbol,
                );

              /*
               * Đọc realtime snapshot hiện tại.
               *
               * Không tạo state riêng cho từng row.
               */
              const live =
                realtimeRef.current[
                  normalized
                ];

              const handlePrefetch =
                () => {
                  /*
                   * Next.js route prefetch:
                   *
                   * chỉ thực hiện khi user thực sự
                   * có ý định mở coin.
                   */
                  void router.prefetch(
                    `/crypto/${r.symbol}`,
                  );

                  /*
                   * Warm API cache song song.
                   */
                  void prefetchCoin(
                    r.symbol,
                  );
                };

              return (
                <tr
                  key={r.symbol}
                  className={`border-b border-slate-800/70 hover:bg-slate-800/30 ${
                    live
                      ? "transition-colors duration-300"
                      : ""
                  }`}
                >

                  {/* ---------------------------------------------------- */}
                  {/* COIN                                                   */}
                  {/* ---------------------------------------------------- */}

                  <td className="p-3">

                    <Link
                      href={`/crypto/${r.symbol}`}
                      /*
                       * KHÔNG dùng:
                       *
                       * prefetch
                       *
                       * trên toàn bộ 100 row.
                       *
                       * Chỉ prefetch khi hover/focus.
                       */
                      onMouseEnter={
                        handlePrefetch
                      }
                      onFocus={
                        handlePrefetch
                      }
                      className="flex items-center gap-2"
                    >

                      {r.logoUrl ? (
                        <Image
                          src={r.logoUrl}
                          alt=""
                          width={32}
                          height={32}
                          className="h-8 w-8 rounded-full"
                          loading="lazy"
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
                          {r.symbol}
                        </div>

                        <div className="text-[10px] text-slate-500">
                          {r.name}
                        </div>

                      </div>

                    </Link>

                  </td>

                  {/* ---------------------------------------------------- */}
                  {/* PRICE                                                  */}
                  {/* ---------------------------------------------------- */}

                  <td className="text-right font-mono">
                    $
                    {fmtNum(
                      r.price,
                      r.price < 1
                        ? 6
                        : 2,
                    )}
                  </td>

                  {/* ---------------------------------------------------- */}
                  {/* VND                                                    */}
                  {/* ---------------------------------------------------- */}

                  <td className="text-right font-mono text-slate-400">
                    {r.priceVnd
                      ? fmtNum(
                          r.priceVnd,
                          0,
                        )
                      : "—"}
                  </td>

                  {/* ---------------------------------------------------- */}
                  {/* CHANGE                                                 */}
                  {/* ---------------------------------------------------- */}

                  <td
                    className={`text-right font-mono font-bold ${changeColor(
                      r.change24h,
                    )}`}
                  >
                    {fmtPct(
                      r.change24h,
                    )}
                  </td>

                  {/* ---------------------------------------------------- */}
                  {/* VOLUME                                                 */}
                  {/* ---------------------------------------------------- */}

                  <td className="text-right text-slate-400">
                    $
                    {fmtVol(
                      r.volume24h,
                    )}
                  </td>

                  {/* ---------------------------------------------------- */}
                  {/* SOURCE                                                 */}
                  {/* ---------------------------------------------------- */}

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
            })}

          </tbody>

        </table>

      </div>

      {/* ------------------------------------------------------------------ */}
      {/* EMPTY SEARCH                                                       */}
      {/* ------------------------------------------------------------------ */}

      {!feed.loading &&
        feed.data &&
        rows.length === 0 && (
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
