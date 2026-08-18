"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CandleChart, type Bar } from "@/components/candle-chart";
import { FinancialStatements } from "@/components/financial-statements";
import { CompanyProfile } from "@/components/company-profile";
import { SectionTitle } from "@/components/period-pill";
import {
  EPSTrendChart,
  HealthGauge,
  IndustryCompareBars,
  MarginsTrendChart,
  RevenueProfitChart,
  ROEvsIndustryChart,
} from "@/components/fundamental-charts";
import {
  HealthDetailCard,
  type HealthDetail,
} from "@/components/financial-health-detail";
import {
  api,
  changeColor,
  fmtNum,
  fmtPct,
  fmtVol,
  timeAgo,
  usePoll,
} from "@/lib/client";
import { ProtectedPage } from "@/components/ProtectedPage";

/* ──────────────────────────────────────────────────────────────
 * Types
 * ────────────────────────────────────────────────────────────── */

interface Quote {
  symbol: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  prevClose: number | null;
  changePct: number | null;
  source: string;
  confidence: number;
}

interface Company {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

interface Analysis {
  recommendation: string;
  confidence: number;
  score: number;
  reasons: string[];
  rsi14: number | null;
  macd: {
    macd: number;
    signal: number;
    histogram: number;
  } | null;
  sma20: number | null;
  sma50: number | null;
  bollinger: {
    upper: number;
    middle: number;
    lower: number;
  } | null;
  supportResistance: {
    support: number;
    resistance: number;
  } | null;
  volatilityPct: number | null;
  maxDrawdownPct: number | null;
  changePct1m: number | null;
}

interface NewsItem {
  id: number;
  title: string;
  link: string;
  sourceName: string;
  publishedAt: string;
  sentiment: number;
}

interface CandlePattern {
  name: string;
  nameVi: string;
  type: "bullish" | "bearish" | "neutral";
  time: number;
  reliability: number;
  description: string;
}

interface ChartPattern {
  name: string;
  nameVi: string;
  type: "bullish" | "bearish" | "neutral";
  reliability: number;
  target: number | null;
  description: string;
}

interface TechnicalData {
  candlestickPatterns: CandlePattern[];
  chartPatterns: ChartPattern[];
  totalCandlestickDetected: number;
  barsAnalyzed: number;
}

interface HealthBreakdown {
  score: number;
  detail: string;
}

interface FundamentalData {
  currentPrice: number;
  eps: number | null;
  roe: number | null;
  roa: number | null;
  ros: number | null;
  cagr3y: number | null;

  dupont: {
    netProfitMargin: number;
    assetTurnover: number;
    equityMultiplier: number;
    roe: number;
    description: string;
  } | null;

  financialHealth: {
    overallScore: number;
    rating: string;
    breakdown: Record<string, HealthBreakdown>;
  };

  valuation: {
    currentPrice: number;
    pe: number | null;
    pb: number | null;
    evEbitda: number | null;
    pcf: number | null;
    ddm: number | null;

    dcf: {
      base: number;
      optimistic: number;
      pessimistic: number;
    } | null;

    grahamNumber: number | null;
    reverseDcfGrowth: number | null;

    intrinsicValueRange: {
      low: number;
      mid: number;
      high: number;
    } | null;

    verdictVi: string;
  };

  quarterlyMetrics: {
    quarter: string;
    periodEnd: string;
    avgPrice: number;
    returnPct: number;
    volatilityPct: number;
    sharpeProxy: number;
  }[];

  disclaimer: string;
}

interface SentimentData {
  sentimentScore: number;
  marketSentiment: number;
  newsCount24h: number;
  articles: {
    title: string;
    sentiment: number;
    publishedAt: string;
  }[];
}

/* ──────────────────────────────────────────────────────────────
 * Chart configuration
 * ────────────────────────────────────────────────────────────── */

const TIMEFRAMES = [
  { key: "15m", label: "15 phút" },
  { key: "1h", label: "1 giờ" },
  { key: "1d", label: "Ngày" },
  { key: "1w", label: "Tuần" },
  { key: "1M", label: "Tháng" },
] as const;

type Timeframe = (typeof TIMEFRAMES)[number]["key"];

const INITIAL_HISTORY_LIMIT: Record<Timeframe, number> = {
  "15m": 1000,
  "1h": 1000,
  "1d": 1000,
  "1w": 600,
  "1M": 240,
};

const HISTORY_PAGE_SIZE: Record<Timeframe, number> = {
  "15m": 1000,
  "1h": 1000,
  "1d": 1000,
  "1w": 500,
  "1M": 120,
};

const RECO_STYLE: Record<string, string> = {
  "Strong Buy":
    "bg-emerald-500/20 text-emerald-300 border-emerald-600",

  Buy:
    "bg-emerald-500/10 text-emerald-400 border-emerald-700",

  Hold:
    "bg-amber-500/10 text-amber-300 border-amber-700",

  Sell:
    "bg-rose-500/10 text-rose-400 border-rose-700",

  "Strong Sell":
    "bg-rose-500/20 text-rose-300 border-rose-600",
};

const TABS = [
  "Tổng quan",
  "Phân tích KT",
  "Cơ bản",
  "Mẫu hình",
  "Tài chính",
  "Công ty",
  "Tin tức",
] as const;

type Tab = (typeof TABS)[number];

/* ──────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────── */

function SentimentBadge({ score }: { score: number }) {
  const label =
    score >= 0.15
      ? "Tích cực"
      : score > -0.15
        ? "Trung lập"
        : "Tiêu cực";

  const color =
    score >= 0.15
      ? "text-emerald-400"
      : score > -0.15
        ? "text-amber-400"
        : "text-rose-400";

  return (
    <span className={`text-xs font-medium ${color}`}>
      {label} ({score >= 0 ? "+" : ""}
      {score.toFixed(2)})
    </span>
  );
}

function PatternBadge({
  type,
}: {
  type: "bullish" | "bearish" | "neutral";
}) {
  const cfg =
    type === "bullish"
      ? "bg-emerald-500/15 text-emerald-400"
      : type === "bearish"
        ? "bg-rose-500/15 text-rose-400"
        : "bg-slate-500/15 text-slate-400";

  const label =
    type === "bullish"
      ? "▲ Tăng"
      : type === "bearish"
        ? "▼ Giảm"
        : "─ Trung lập";

  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] ${cfg}`}>
      {label}
    </span>
  );
}

function HealthBar({
  score,
  label,
}: {
  score: number;
  label: string;
}) {
  const color =
    score >= 70
      ? "bg-emerald-500"
      : score >= 40
        ? "bg-amber-500"
        : "bg-rose-500";

  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-slate-400">{label}</span>
        <span>{score}/100</span>
      </div>

      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{
            width: `${Math.max(0, Math.min(100, score))}%`,
          }}
        />
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
 * History helpers
 * ────────────────────────────────────────────────────────────── */

function mergeBars(existing: Bar[], incoming: Bar[]): Bar[] {
  const map = new Map<number, Bar>();

  for (const bar of existing) {
    map.set(bar.time, bar);
  }

  for (const bar of incoming) {
    map.set(bar.time, bar);
  }

  return Array.from(map.values()).sort(
    (a, b) => a.time - b.time,
  );
}

function normalizeBars(value: unknown): Bar[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((bar): bar is Bar => {
      if (!bar || typeof bar !== "object") {
        return false;
      }

      const item = bar as Record<string, unknown>;

      return (
        typeof item.time === "number" &&
        typeof item.open === "number" &&
        typeof item.high === "number" &&
        typeof item.low === "number" &&
        typeof item.close === "number" &&
        typeof item.volume === "number"
      );
    })
    .sort((a, b) => a.time - b.time);
}

/* ──────────────────────────────────────────────────────────────
 * Page
 * ────────────────────────────────────────────────────────────── */

export default function StockPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol: raw } = use(params);

  const symbol = raw.toUpperCase();

  const [tf, setTf] = useState<Timeframe>("1d");
  const [tab, setTab] = useState<Tab>("Tổng quan");
  const [watchMsg, setWatchMsg] = useState<string | null>(null);

  /* ────────────────────────────────────────────────────────────
   * Chart history state
   * ──────────────────────────────────────────────────────────── */

  const [historyBars, setHistoryBars] = useState<Bar[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyLoadingMore, setHistoryLoadingMore] =
    useState(false);

  const [historyHasMore, setHistoryHasMore] =
    useState(true);

  const [historyError, setHistoryError] =
    useState<string | null>(null);

  const historyRequestRef = useRef(0);

  const historyBeforeRef = useRef<number | null>(null);

  const historyHasMoreRef = useRef(true);

  const historyLoadingMoreRef = useRef(false);

  /* ────────────────────────────────────────────────────────────
   * Existing polling
   * ──────────────────────────────────────────────────────────── */

  const {
    data: stock,
    error: quoteError,
  } = usePoll<{
    quote: Quote;
    company: Company | null;
  }>(
    `/stocks/${symbol}`,
    10000,
  );

  const { data: analysis } =
    usePoll<Analysis>(
      `/stocks/${symbol}/analysis`,
      60000,
    );

  const {
    data: fundamental,
  } = usePoll<FundamentalData>(
    tab === "Cơ bản" || tab === "Tổng quan"
      ? `/stocks/${symbol}/fundamental`
      : null,
    120000,
  );

  const {
    data: technical,
  } = usePoll<TechnicalData>(
    tab === "Mẫu hình" || tab === "Tổng quan"
      ? `/stocks/${symbol}/technical?timeframe=${tf}`
      : null,
    60000,
  );

  const {
    data: sentiment,
  } = usePoll<SentimentData>(
    `/stocks/${symbol}/sentiment`,
    60000,
  );

  const {
    data: newsData,
  } = usePoll<{ items: NewsItem[] }>(
    `/news?symbol=${symbol}&limit=10`,
    90000,
  );

  const onFundamentalTab =
    tab === "Cơ bản" ||
    tab === "Tổng quan";

  const {
    data: chartData,
  } = usePoll<any>(
    onFundamentalTab
      ? `/stocks/${symbol}/fundamental-chart`
      : null,
    120000,
  );

  const {
    data: healthDetail,
  } = usePoll<HealthDetail>(
    tab === "Cơ bản"
      ? `/stocks/${symbol}/financial-health-detail`
      : null,
    120000,
  );

  const q = stock?.quote;

  /* ────────────────────────────────────────────────────────────
   * Reset chart when symbol/timeframe changes
   * ──────────────────────────────────────────────────────────── */

  useEffect(() => {
    historyRequestRef.current += 1;

    setHistoryBars([]);
    setHistoryLoading(true);
    setHistoryLoadingMore(false);
    setHistoryHasMore(true);
    setHistoryError(null);

    historyBeforeRef.current = null;
    historyHasMoreRef.current = true;
    historyLoadingMoreRef.current = false;
  }, [symbol, tf]);

  /* ────────────────────────────────────────────────────────────
   * Initial / realtime history loader
   *
   * This deliberately does NOT use usePoll for the chart.
   * Chart history has different lifecycle requirements from
   * quote polling:
   *
   * - initial dataset
   * - realtime refresh
   * - prepend historical pages
   * - preserve viewport
   * ──────────────────────────────────────────────────────────── */

  const loadHistory = useCallback(
  async (
    mode: "initial" | "refresh",
  ) => {
    const requestId =
      ++historyRequestRef.current;

    try {
      if (mode === "initial") {
        setHistoryLoading(true);
      }

      const limit =
        INITIAL_HISTORY_LIMIT[tf];

      const url =
        `/stocks/${symbol}/history` +
        `?timeframe=${encodeURIComponent(
          tf,
        )}` +
        `&limit=${limit}`;

      /*
       * IMPORTANT:
       *
       * Do NOT use fetch() here.
       *
       * api() automatically targets:
       *
       * /api/v1/stocks/:symbol/history
       *
       * and unwraps the API envelope:
       *
       * {
       *   data: {...},
       *   meta: {...}
       * }
       */
      const response =
        await api<{
          symbol: string;
          timeframe: string;
          bars: unknown;
        }>(url);

      if (
        requestId !==
        historyRequestRef.current
      ) {
        return;
      }

      const bars =
        normalizeBars(
          response.data?.bars,
        );

      setHistoryBars(
        (previous) => {
          if (
            mode === "refresh" &&
            previous.length > 0
          ) {
            return mergeBars(
              previous,
              bars,
            );
          }

          return bars;
        },
      );

      if (bars.length > 0) {
        historyBeforeRef.current =
          bars[0].time;
      }

      const explicitHasMore =
        response.meta?.hasMore;

      if (
        typeof explicitHasMore ===
        "boolean"
      ) {
        historyHasMoreRef.current =
          explicitHasMore;

        setHistoryHasMore(
          explicitHasMore,
        );
      } else {
        const inferred =
          bars.length >= limit;

        historyHasMoreRef.current =
          inferred;

        setHistoryHasMore(
          inferred,
        );
      }

      setHistoryError(null);
    } catch (error) {
      if (
        requestId !==
        historyRequestRef.current
      ) {
        return;
      }

      if (
        mode === "initial"
      ) {
        setHistoryBars([]);
      }

      setHistoryError(
        error instanceof Error
          ? error.message
          : "Không tải được dữ liệu chart",
      );
    } finally {
      if (
        requestId ===
        historyRequestRef.current
      ) {
        setHistoryLoading(false);
      }
    }
  },
  [symbol, tf],
);
  
        const payload =
          (await response.json()) as {
            bars?: unknown;
            meta?: Record<
              string,
              unknown
            >;
          };

        if (
          requestId !==
          historyRequestRef.current
        ) {
          return;
        }

        const bars =
          normalizeBars(
            payload.bars,
          );

        setHistoryBars((previous) => {
          if (
            mode === "refresh" &&
            previous.length > 0
          ) {
            /*
             * Realtime refresh should not discard
             * historical pages that the user already
             * loaded.
             */
            return mergeBars(
              previous,
              bars,
            );
          }

          return bars;
        });

        if (bars.length > 0) {
          historyBeforeRef.current =
            bars[0].time;
        }

        /*
         * If the backend explicitly returns hasMore,
         * respect it. Otherwise assume that a full page
         * means more data may exist.
         */
        const explicitHasMore =
          payload.meta?.hasMore;

        if (
          typeof explicitHasMore ===
          "boolean"
        ) {
          historyHasMoreRef.current =
            explicitHasMore;

          setHistoryHasMore(
            explicitHasMore,
          );
        } else {
          const inferred =
            bars.length >= limit;

          historyHasMoreRef.current =
            inferred;

          setHistoryHasMore(
            inferred,
          );
        }

        setHistoryError(null);
      } catch (error) {
        if (
          requestId !==
          historyRequestRef.current
        ) {
          return;
        }

        if (mode === "initial") {
          setHistoryBars([]);
        }

        setHistoryError(
          error instanceof Error
            ? error.message
            : "Không lấy được dữ liệu chart",
        );
      } finally {
        if (
          requestId ===
          historyRequestRef.current
        ) {
          setHistoryLoading(false);
        }
      }
    },
    [symbol, tf],
  );

  /* ────────────────────────────────────────────────────────────
   * Initial chart request
   * ──────────────────────────────────────────────────────────── */

  useEffect(() => {
    void loadHistory("initial");

    const interval =
      window.setInterval(() => {
        void loadHistory("refresh");
      }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadHistory]);

  /* ────────────────────────────────────────────────────────────
   * Load older history
   * ──────────────────────────────────────────────────────────── */

  const loadMoreHistory = useCallback(
  async () => {
    if (
      historyLoadingMoreRef.current ||
      !historyHasMoreRef.current
    ) {
      return;
    }

    const currentBars =
      historyBars;

    if (
      currentBars.length === 0
    ) {
      return;
    }

    const before =
      historyBeforeRef.current ??
      currentBars[0]?.time ??
      null;

    if (before == null) {
      return;
    }

    historyLoadingMoreRef.current =
      true;

    setHistoryLoadingMore(
      true,
    );

    try {
      const limit =
        HISTORY_PAGE_SIZE[tf];

      const url =
        `/stocks/${symbol}/history` +
        `?timeframe=${encodeURIComponent(
          tf,
        )}` +
        `&limit=${limit}` +
        `&before=${encodeURIComponent(
          String(before),
        )}`;

      /*
       * Use the same API client as
       * the rest of the application.
       *
       * This guarantees:
       *
       * /stocks/VIC/history
       *
       * becomes:
       *
       * /api/v1/stocks/VIC/history
       */
      const response =
        await api<{
          symbol: string;
          timeframe: string;
          bars: unknown;
        }>(url);

      const olderBars =
        normalizeBars(
          response.data?.bars,
        );

      if (
        olderBars.length === 0
      ) {
        historyHasMoreRef.current =
          false;

        setHistoryHasMore(
          false,
        );

        return;
      }

      setHistoryBars(
        (previous) => {
          const merged =
            mergeBars(
              olderBars,
              previous,
            );

          if (
            merged.length > 0
          ) {
            historyBeforeRef.current =
              merged[0].time;
          }

          return merged;
        },
      );

      const explicitHasMore =
        response.meta?.hasMore;

      if (
        typeof explicitHasMore ===
        "boolean"
      ) {
        historyHasMoreRef.current =
          explicitHasMore;

        setHistoryHasMore(
          explicitHasMore,
        );
      } else {
        const hasMore =
          olderBars.length >=
          limit;

        historyHasMoreRef.current =
          hasMore;

        setHistoryHasMore(
          hasMore,
        );
      }
    } catch (error) {
      setHistoryError(
        error instanceof Error
          ? error.message
          : "Không tải thêm được dữ liệu lịch sử",
      );
    } finally {
      historyLoadingMoreRef.current =
        false;

      setHistoryLoadingMore(
        false,
      );
    }
  },
  [
    symbol,
    tf,
    historyBars,
  ],
);
        const limit =
          HISTORY_PAGE_SIZE[tf];

        /*
         * Step 2 frontend is intentionally
         * backward compatible.
         *
         * Phase 2 will make the backend
         * formally support:
         *
         * ?timeframe=1d
         * &limit=500
         * &before=<unix>
         */
        const url =
          `/stocks/${symbol}/history` +
          `?timeframe=${encodeURIComponent(tf)}` +
          `&limit=${limit}` +
          `&before=${encodeURIComponent(
            String(before),
          )}`;

        const response = await fetch(
          url,
          {
            method: "GET",
            cache: "no-store",
          },
        );

        if (!response.ok) {
          throw new Error(
            `History API ${response.status}`,
          );
        }

        const payload =
          (await response.json()) as {
            bars?: unknown;
            meta?: Record<
              string,
              unknown
            >;
          };

        const olderBars =
          normalizeBars(
            payload.bars,
          );

        if (olderBars.length === 0) {
          historyHasMoreRef.current =
            false;

          setHistoryHasMore(false);

          return;
        }

        setHistoryBars((previous) => {
          const merged =
            mergeBars(
              olderBars,
              previous,
            );

          if (merged.length > 0) {
            historyBeforeRef.current =
              merged[0].time;
          }

          return merged;
        });

        /*
         * Prefer backend metadata when available.
         */
        const explicitHasMore =
          payload.meta?.hasMore;

        if (
          typeof explicitHasMore ===
          "boolean"
        ) {
          historyHasMoreRef.current =
            explicitHasMore;

          setHistoryHasMore(
            explicitHasMore,
          );
        } else {
          const hasMore =
            olderBars.length >= limit;

          historyHasMoreRef.current =
            hasMore;

          setHistoryHasMore(hasMore);
        }
      } catch (error) {
        console.error(
          "[stock-chart] loadMoreHistory:",
          error,
        );
      } finally {
        historyLoadingMoreRef.current =
          false;

        setHistoryLoadingMore(false);
      }
    },
    [
      symbol,
      tf,
      historyBars,
    ],
  );

  /* ────────────────────────────────────────────────────────────
   * Watchlist
   * ──────────────────────────────────────────────────────────── */

  const addToWatchlist = async () => {
    try {
      await api(
        `/watchlist`,
        {
          method: "POST",
          body: JSON.stringify({
            symbol,
          }),
          headers: {
            "Content-Type":
              "application/json",
          },
        },
      );

      setWatchMsg("Đã thêm ✓");
    } catch (err) {
      setWatchMsg(
        err instanceof Error
          ? err.message
          : "Lỗi",
      );
    }

    setTimeout(
      () => setWatchMsg(null),
      2500,
    );
  };

  const chartMeta = useMemo(() => {
    return {
      count: historyBars.length,
    };
  }, [historyBars.length]);

  return (
    <ProtectedPage featureName="chi tiết cổ phiếu">
      <div className="space-y-4">

        {/* ═══════════════════════════════════════════════════════
            Header
           ═══════════════════════════════════════════════════════ */}

        <div className="panel p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">
                {symbol}
              </h1>

              <span className="text-xs text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">
                {stock?.company?.exchange ||
                  "—"}
              </span>

              <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 live-dot" />
                LIVE
              </span>

              {sentiment && (
                <SentimentBadge
                  score={
                    sentiment.sentimentScore
                  }
                />
              )}
            </div>

            <div className="text-sm text-slate-400">
              {stock?.company?.name ?? ""}
            </div>
          </div>

          {q && (
            <>
              <div>
                <div className="text-3xl font-bold">
                  {fmtNum(q.close)}
                </div>

                <div
                  className={`text-sm font-semibold ${changeColor(
                    q.changePct,
                  )}`}
                >
                  {fmtPct(q.changePct)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-400">
                <span>
                  Mở: {fmtNum(q.open)}
                </span>

                <span>
                  Cao: {fmtNum(q.high)}
                </span>

                <span>
                  Thấp: {fmtNum(q.low)}
                </span>

                <span>
                  KL: {fmtVol(q.volume)}
                </span>
              </div>

              <div className="text-[10px] text-slate-600">
                Nguồn: {q.source}
                <br />
                Confidence:{" "}
                {(q.confidence * 100).toFixed(
                  0,
                )}
                %
              </div>
            </>
          )}

          <button
            onClick={addToWatchlist}
            className="ml-auto rounded-md border border-cyan-700 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-300 hover:bg-cyan-500/20"
          >
            {watchMsg ?? "+ Watchlist"}
          </button>
        </div>

        {quoteError && (
          <div className="panel border-rose-800 bg-rose-950/30 p-4 text-sm text-rose-300">
            Không lấy được dữ liệu cho{" "}
            {symbol}: {quoteError}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════
            Tabs
           ═══════════════════════════════════════════════════════ */}

        <div className="flex gap-1 border-b border-slate-800 pb-0 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() =>
                setTab(t)
              }
              className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap ${
                tab === t
                  ? "border-cyan-500 text-cyan-300"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* ═══════════════════════════════════════════════════════
            Tab: Tổng quan
           ═══════════════════════════════════════════════════════ */}

        {tab === "Tổng quan" && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

            {/* Chart */}

            <div className="panel p-4 lg:col-span-2">

              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">

                <div>
                  <h3 className="text-sm font-semibold text-slate-300">
                    Biểu đồ giá
                  </h3>

                  <div className="text-[10px] text-slate-600 mt-0.5">
                    Kéo ngang để xem lịch sử ·
                    Cuộn để zoom
                  </div>
                </div>

                <div className="flex gap-1 flex-wrap">
                  {TIMEFRAMES.map((t) => (
                    <button
                      key={t.key}
                      onClick={() =>
                        setTf(t.key)
                      }
                      className={`rounded px-2 py-1 text-xs ${
                        tf === t.key
                          ? "bg-cyan-500/20 text-cyan-300"
                          : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {historyLoading ? (
                <div className="h-[380px] flex items-center justify-center text-slate-500 text-sm">
                  Đang tải dữ liệu chart…
                </div>
              ) : historyError &&
                historyBars.length === 0 ? (
                <div className="h-[380px] flex flex-col items-center justify-center gap-2 text-sm">
                  <div className="text-rose-400">
                    Không tải được dữ liệu chart
                  </div>

                  <div className="text-[11px] text-slate-600">
                    {historyError}
                  </div>

                  <button
                    onClick={() =>
                      void loadHistory(
                        "initial",
                      )
                    }
                    className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:text-slate-200"
                  >
                    Thử lại
                  </button>
                </div>
              ) : historyBars.length > 0 ? (
                <CandleChart
                  bars={historyBars}
                  height={380}
                  onLoadMore={
                    loadMoreHistory
                  }
                  loadingMore={
                    historyLoadingMore
                  }
                  hasMore={
                    historyHasMore
                  }
                  loadMoreThreshold={30}
                />
              ) : (
                <div className="h-[380px] flex items-center justify-center text-slate-500 text-sm">
                  Chưa có dữ liệu giá
                </div>
              )}

              <div className="mt-2 flex items-center justify-between text-[10px] text-slate-600">

                <div>
                  {chartMeta.count} nến
                </div>

                <div className="flex items-center gap-3">
                  {historyLoadingMore && (
                    <span className="text-cyan-500">
                      Đang tải lịch sử…
                    </span>
                  )}

                  {!historyLoadingMore &&
                    !historyHasMore &&
                    historyBars.length >
                      0 && (
                      <span>
                        Đã đến đầu dữ liệu
                      </span>
                    )}
                </div>
              </div>

            </div>

            {/* Right column */}

            <div className="space-y-4">

              {/* Quick analysis */}

              {analysis && (
                <div className="panel p-4">
                  <h3 className="text-sm font-semibold text-slate-300 mb-2">
                    Khuyến nghị
                  </h3>

                  <div
                    className={`inline-block rounded-md border px-3 py-1.5 text-sm font-bold ${
                      RECO_STYLE[
                        analysis.recommendation
                      ] ?? ""
                    }`}
                  >
                    {analysis.recommendation}

                    <span className="ml-1 font-normal text-xs opacity-80">
                      {(
                        analysis.confidence *
                        100
                      ).toFixed(0)}
                      %
                    </span>
                  </div>

                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="text-slate-500">
                      RSI(14)
                    </dt>

                    <dd className="text-right">
                      {fmtNum(
                        analysis.rsi14,
                        1,
                      )}
                    </dd>

                    <dt className="text-slate-500">
                      MACD
                    </dt>

                    <dd className="text-right">
                      {fmtNum(
                        analysis.macd
                          ?.histogram,
                        3,
                      )}
                    </dd>

                    <dt className="text-slate-500">
                      Hỗ trợ
                    </dt>

                    <dd className="text-right">
                      {fmtNum(
                        analysis
                          .supportResistance
                          ?.support,
                      )}
                    </dd>

                    <dt className="text-slate-500">
                      Kháng cự
                    </dt>

                    <dd className="text-right">
                      {fmtNum(
                        analysis
                          .supportResistance
                          ?.resistance,
                      )}
                    </dd>
                  </dl>
                </div>
              )}

              {/* Quick health */}

              {fundamental && (
                <div className="panel p-4">
                  <h3 className="text-sm font-semibold text-slate-300 mb-2">
                    Sức khỏe tài chính:{" "}
                    <span
                      className={
                        fundamental
                          .financialHealth
                          .rating <= "B"
                          ? "text-emerald-400"
                          : fundamental
                                .financialHealth
                                .rating <=
                              "C"
                            ? "text-amber-400"
                            : "text-rose-400"
                      }
                    >
                      {
                        fundamental
                          .financialHealth
                          .rating
                      }
                    </span>{" "}
                    (
                    {
                      fundamental
                        .financialHealth
                        .overallScore
                    }
                    /100)
                  </h3>

                  <div className="space-y-1.5">
                    {Object.entries(
                      fundamental
                        .financialHealth
                        .breakdown,
                    ).map(
                      ([k, v]) => (
                        <HealthBar
                          key={k}
                          label={k}
                          score={v.score}
                        />
                      ),
                    )}
                  </div>
                </div>
              )}

              {/* Quick patterns */}

              {technical &&
                technical
                  .candlestickPatterns
                  .length > 0 && (
                  <div className="panel p-4">
                    <h3 className="text-sm font-semibold text-slate-300 mb-2">
                      Mẫu nến gần nhất
                    </h3>

                    {technical.candlestickPatterns
                      .slice(0, 3)
                      .map((p, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 text-xs py-1 border-b border-slate-800/50 last:border-0"
                        >
                          <PatternBadge
                            type={p.type}
                          />

                          <span className="font-medium">
                            {p.nameVi}
                          </span>

                          <span className="ml-auto text-slate-500">
                            {(
                              p.reliability *
                              100
                            ).toFixed(0)}
                            %
                          </span>
                        </div>
                      ))}
                  </div>
                )}

              {/* Sentiment */}

              {sentiment && (
                <div className="panel p-4">
                  <h3 className="text-sm font-semibold text-slate-300 mb-2">
                    Tâm lý thị trường (NLP)
                  </h3>

                  <div className="flex items-center gap-3">
                    <SentimentBadge
                      score={
                        sentiment.sentimentScore
                      }
                    />

                    <span className="text-[10px] text-slate-500">
                      {
                        sentiment.newsCount24h
                      }{" "}
                      tin 24h
                    </span>
                  </div>

                  <div className="mt-1 text-[10px] text-slate-500">
                    Thị trường chung:{" "}
                    {sentiment.marketSentiment >=
                    0
                      ? "+"
                      : ""}
                    {sentiment.marketSentiment.toFixed(
                      2,
                    )}
                  </div>
                </div>
              )}

            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════
            Tab: Phân tích KT
           ═══════════════════════════════════════════════════════ */}

        {tab === "Phân tích KT" &&
          analysis && (
            <div className="panel p-4 max-w-3xl">

              <div
                className={`inline-block rounded-md border px-4 py-2 text-lg font-bold mb-4 ${
                  RECO_STYLE[
                    analysis.recommendation
                  ] ?? ""
                }`}
              >
                {analysis.recommendation}

                <span className="text-sm font-normal opacity-80">
                  {" "}
                  tin cậy{" "}
                  {(
                    analysis.confidence *
                    100
                  ).toFixed(0)}
                  %
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">

                {([
                  [
                    "RSI (14)",
                    analysis.rsi14,
                    1,
                  ],
                  [
                    "MACD hist",
                    analysis.macd?.histogram,
                    3,
                  ],
                  [
                    "SMA 20",
                    analysis.sma20,
                    2,
                  ],
                  [
                    "SMA 50",
                    analysis.sma50,
                    2,
                  ],
                  [
                    "Bollinger ↑",
                    analysis.bollinger?.upper,
                    2,
                  ],
                  [
                    "Bollinger ↓",
                    analysis.bollinger?.lower,
                    2,
                  ],
                  [
                    "Hỗ trợ",
                    analysis
                      .supportResistance
                      ?.support,
                    2,
                  ],
                  [
                    "Kháng cự",
                    analysis
                      .supportResistance
                      ?.resistance,
                    2,
                  ],
                  [
                    "Biến động (năm)",
                    analysis.volatilityPct,
                    1,
                  ],
                  [
                    "Max drawdown",
                    analysis.maxDrawdownPct,
                    1,
                  ],
                  [
                    "1 tháng",
                    analysis.changePct1m,
                    2,
                  ],
                ] as [
                  string,
                  number | null | undefined,
                  number,
                ][]).map(
                  ([label, val, dig]) => (
                    <div
                      key={label}
                      className="bg-slate-800/40 rounded p-2"
                    >
                      <div className="text-[10px] text-slate-500">
                        {label}
                      </div>

                      <div className="text-sm font-semibold">
                        {fmtNum(
                          val,
                          dig,
                        )}
                        {label.includes(
                          "Biến động",
                        ) ||
                        label.includes(
                          "drawdown",
                        ) ||
                        label.includes(
                          "tháng",
                        )
                          ? "%"
                          : ""}
                      </div>
                    </div>
                  ),
                )}
              </div>

              <h4 className="text-sm font-semibold text-slate-300 mb-2">
                Lý do
              </h4>

              <ul className="space-y-1.5 text-sm text-slate-400">
                {analysis.reasons.map(
                  (r, i) => (
                    <li
                      key={i}
                      className="flex gap-2"
                    >
                      <span className="text-cyan-500">
                        ›
                      </span>

                      {r}
                    </li>
                  ),
                )}
              </ul>
            </div>
          )}

        {/* ═══════════════════════════════════════════════════════
            Tab: Cơ bản
           ═══════════════════════════════════════════════════════ */}

        {tab === "Cơ bản" && (
          <div className="space-y-6 max-w-6xl">

            {chartData && (
              <div className="space-y-5">

                <SectionTitle
                  eyebrow="Visual analyst"
                  title={
                    <>
                      Hiệu suất &amp; định giá
                      qua{" "}
                      {
                        chartData
                          .quarters
                          .length
                      }{" "}
                      quý
                    </>
                  }
                >
                  Nguồn:{" "}
                  {
                    chartData
                      .industry
                      .industry
                  }{" "}
                  ·{" "}
                  {
                    chartData
                      .industry
                      .sector
                  }
                </SectionTitle>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                  <div className="panel p-4 lg:col-span-2 reveal">
                    <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
                      Doanh thu · EBITDA · Lợi
                      nhuận ròng (tỷ VND)
                    </div>

                    <RevenueProfitChart
                      data={
                        chartData.quarters
                      }
                    />
                  </div>

                  <div className="panel p-4 reveal">
                    <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
                      Gauge sức khỏe tài chính
                    </div>

                    {chartData.health ? (
                      <HealthGauge
                        overall={
                          chartData
                            .health
                            .overall
                        }
                        rating={
                          chartData
                            .health
                            .rating
                        }
                      />
                    ) : (
                      <div className="h-[180px] flex items-center justify-center text-slate-500 text-sm">
                        Chưa có dữ liệu
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                  <div className="panel p-4 reveal">
                    <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
                      ROE · ROA vs ngành
                    </div>

                    <ROEvsIndustryChart
                      data={
                        chartData.quarters
                      }
                      industry={
                        chartData.industry
                      }
                    />
                  </div>

                  <div className="panel p-4 reveal">
                    <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
                      Biên lợi nhuận qua các
                      quý (%)
                    </div>

                    <MarginsTrendChart
                      data={
                        chartData.quarters
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                  <div className="panel p-4 reveal">
                    <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
                      EPS theo quý (nghìn VND /
                      cp)
                    </div>

                    <EPSTrendChart
                      data={
                        chartData.quarters
                      }
                    />
                  </div>

                  <div className="panel p-4 reveal">
                    <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
                      So sánh với trung bình ngành
                    </div>

                    <IndustryCompareBars
                      comparisons={
                        chartData
                          .comparisons
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {healthDetail && (
              <div>
                <SectionTitle
                  eyebrow="Health diagnostic"
                  title="Phân tích sức khỏe tài chính chi tiết"
                >
                  {
                    healthDetail.groups
                      .length
                  }{" "}
                  nhóm ·{" "}
                  {healthDetail.groups.reduce(
                    (s, g) =>
                      s +
                      g.indicators
                        .length,
                    0,
                  )}{" "}
                  chỉ số
                </SectionTitle>

                <HealthDetailCard
                  detail={
                    healthDetail
                  }
                />
              </div>
            )}

            {!fundamental &&
              !chartData && (
                <div className="panel p-8 text-center text-sm text-slate-500">
                  Đang tính toán từ dữ liệu giá thật…
                </div>
              )}

            {fundamental && (
              <>

                <div className="panel p-4">
                  <h3 className="text-sm font-semibold text-slate-300 mb-3">
                    Sức khỏe tài chính —
                    Điểm:{" "}
                    <span
                      className={
                        fundamental
                          .financialHealth
                          .rating <= "B"
                          ? "text-emerald-400"
                          : "text-amber-400"
                      }
                    >
                      {
                        fundamental
                          .financialHealth
                          .overallScore
                      }
                      /100 (
                      {
                        fundamental
                          .financialHealth
                          .rating
                      }
                      )
                    </span>
                  </h3>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {Object.entries(
                      fundamental
                        .financialHealth
                        .breakdown,
                    ).map(
                      ([k, v]) => (
                        <div
                          key={k}
                          className="space-y-1"
                        >
                          <HealthBar
                            label={
                              k
                                .charAt(
                                  0,
                                )
                                .toUpperCase() +
                              k.slice(1)
                            }
                            score={
                              v.score
                            }
                          />

                          <div className="text-[10px] text-slate-600">
                            {v.detail}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </div>

                <div className="panel p-4">
                  <h3 className="text-sm font-semibold text-slate-300 mb-3">
                    Chỉ số cơ bản
                  </h3>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {([
                      [
                        "EPS (ước tính)",
                        fundamental.eps,
                      ],
                      [
                        "ROE (%)",
                        fundamental.roe,
                      ],
                      [
                        "ROA (%)",
                        fundamental.roa,
                      ],
                      [
                        "ROS (%)",
                        fundamental.ros,
                      ],
                      [
                        "CAGR 3 năm (%)",
                        fundamental.cagr3y,
                      ],
                    ] as [
                      string,
                      number | null,
                    ][]).map(
                      ([label, val]) => (
                        <div
                          key={label}
                          className="bg-slate-800/40 rounded p-3"
                        >
                          <div className="text-[10px] text-slate-500">
                            {label}
                          </div>

                          <div className="text-lg font-bold">
                            {fmtNum(val)}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </div>

                {fundamental.dupont && (
                  <div className="panel p-4">
                    <h3 className="text-sm font-semibold text-slate-300 mb-2">
                      DuPont Decomposition
                    </h3>

                    <div className="flex items-center gap-2 text-sm flex-wrap">
                      <span className="bg-slate-800/60 px-2 py-1 rounded">
                        Biên LN:{" "}
                        {fundamental.dupont.netProfitMargin.toFixed(
                          1,
                        )}
                        %
                      </span>

                      <span className="text-slate-600">
                        ×
                      </span>

                      <span className="bg-slate-800/60 px-2 py-1 rounded">
                        Vòng quay TS:{" "}
                        {fundamental.dupont.assetTurnover.toFixed(
                          2,
                        )}
                      </span>

                      <span className="text-slate-600">
                        ×
                      </span>

                      <span className="bg-slate-800/60 px-2 py-1 rounded">
                        Đòn bẩy:{" "}
                        {fundamental.dupont.equityMultiplier.toFixed(
                          2,
                        )}
                      </span>

                      <span className="text-slate-600">
                        =
                      </span>

                      <span className="bg-cyan-500/15 px-2 py-1 rounded font-bold text-cyan-300">
                        ROE:{" "}
                        {fundamental.dupont.roe.toFixed(
                          1,
                        )}
                        %
                      </span>
                    </div>

                    <div className="mt-2 text-xs text-slate-500">
                      {
                        fundamental
                          .dupont
                          .description
                      }
                    </div>
                  </div>
                )}

                <div className="panel p-4">
                  <h3 className="text-sm font-semibold text-slate-300 mb-3">
                    Định giá
                  </h3>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                    {([
                      [
                        "P/E",
                        fundamental
                          .valuation
                          .pe,
                      ],
                      [
                        "P/B",
                        fundamental
                          .valuation
                          .pb,
                      ],
                      [
                        "EV/EBITDA",
                        fundamental
                          .valuation
                          .evEbitda,
                      ],
                      [
                        "P/CF",
                        fundamental
                          .valuation
                          .pcf,
                      ],
                      [
                        "DDM",
                        fundamental
                          .valuation
                          .ddm,
                      ],
                      [
                        "Graham #",
                        fundamental
                          .valuation
                          .grahamNumber,
                      ],
                      [
                        "Rev. DCF Growth",
                        fundamental
                          .valuation
                          .reverseDcfGrowth !=
                        null
                          ? `${fundamental.valuation.reverseDcfGrowth}%`
                          : null,
                      ],
                    ] as [
                      string,
                      number | string | null,
                    ][]).map(
                      ([label, val]) => (
                        <div
                          key={label}
                          className="bg-slate-800/40 rounded p-2"
                        >
                          <div className="text-[10px] text-slate-500">
                            {label}
                          </div>

                          <div className="text-sm font-semibold">
                            {typeof val ===
                            "number"
                              ? fmtNum(val)
                              : val ??
                                "—"}
                          </div>
                        </div>
                      ),
                    )}
                  </div>

                  {fundamental
                    .valuation
                    .dcf && (
                    <div className="mb-3">
                      <div className="text-xs font-medium text-slate-400 mb-1">
                        DCF 3 Kịch bản (giá
                        trị mỗi CP ước tính)
                      </div>

                      <div className="flex gap-3">
                        <div className="flex-1 bg-rose-500/10 border border-rose-800 rounded p-2 text-center">
                          <div className="text-[10px] text-rose-400">
                            Bi quan
                          </div>

                          <div className="font-bold">
                            {fmtNum(
                              fundamental
                                .valuation
                                .dcf
                                .pessimistic,
                            )}
                          </div>
                        </div>

                        <div className="flex-1 bg-cyan-500/10 border border-cyan-800 rounded p-2 text-center">
                          <div className="text-[10px] text-cyan-400">
                            Cơ sở
                          </div>

                          <div className="font-bold">
                            {fmtNum(
                              fundamental
                                .valuation
                                .dcf
                                .base,
                            )}
                          </div>
                        </div>

                        <div className="flex-1 bg-emerald-500/10 border border-emerald-800 rounded p-2 text-center">
                          <div className="text-[10px] text-emerald-400">
                            Lạc quan
                          </div>

                          <div className="font-bold">
                            {fmtNum(
                              fundamental
                                .valuation
                                .dcf
                                .optimistic,
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {fundamental
                    .valuation
                    .intrinsicValueRange && (
                    <div className="bg-slate-800/40 rounded p-3 mb-2">
                      <div className="text-xs text-slate-400 mb-1">
                        Vùng giá trị nội tại
                        ước tính
                      </div>

                      <div className="flex items-center gap-3 text-sm">
                        <span className="text-rose-400">
                          {fmtNum(
                            fundamental
                              .valuation
                              .intrinsicValueRange
                              .low,
                          )}
                        </span>

                        <div className="flex-1 h-2 bg-slate-700 rounded-full relative overflow-hidden">
                          <div
                            className="absolute inset-y-0 bg-gradient-to-r from-rose-500 via-amber-500 to-emerald-500 rounded-full"
                            style={{
                              left: "10%",
                              right: "10%",
                            }}
                          />

                          {(() => {
                            const r =
                              fundamental
                                .valuation
                                .intrinsicValueRange;

                            const range =
                              r.high -
                              r.low;

                            const pct =
                              range > 0
                                ? Math.max(
                                    0,
                                    Math.min(
                                      100,
                                      ((fundamental.currentPrice -
                                        r.low) /
                                        range) *
                                        80 +
                                        10,
                                    ),
                                  )
                                : 50;

                            return (
                              <div
                                className="absolute top-0 h-full w-0.5 bg-white"
                                style={{
                                  left: `${pct}%`,
                                }}
                              />
                            );
                          })()}
                        </div>

                        <span className="text-emerald-400">
                          {fmtNum(
                            fundamental
                              .valuation
                              .intrinsicValueRange
                              .high,
                          )}
                        </span>
                      </div>

                      <div className="text-center text-xs mt-1 text-white">
                        Giá hiện tại:{" "}
                        {fmtNum(
                          fundamental.currentPrice,
                        )}{" "}
                        · Trung bình:{" "}
                        {fmtNum(
                          fundamental
                            .valuation
                            .intrinsicValueRange
                            .mid,
                        )}
                      </div>
                    </div>
                  )}

                  <div className="text-sm text-slate-300 font-medium">
                    {
                      fundamental
                        .valuation
                        .verdictVi
                    }
                  </div>
                </div>

                {fundamental
                  .quarterlyMetrics
                  .length > 0 && (
                  <div className="panel p-4">
                    <h3 className="text-sm font-semibold text-slate-300 mb-3">
                      Báo cáo 4 quý gần nhất
                    </h3>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-slate-500 border-b border-slate-800">
                            <th className="py-1.5">
                              Quý
                            </th>

                            <th className="text-right">
                              Kết thúc
                            </th>

                            <th className="text-right">
                              Giá TB
                            </th>

                            <th className="text-right">
                              Hiệu suất
                            </th>

                            <th className="text-right">
                              Biến động
                            </th>

                            <th className="text-right">
                              Sharpe
                            </th>
                          </tr>
                        </thead>

                        <tbody>
                          {fundamental.quarterlyMetrics.map(
                            (q) => (
                              <tr
                                key={
                                  q.quarter
                                }
                                className="border-b border-slate-800/50"
                              >
                                <td className="py-1.5 font-medium">
                                  {
                                    q.quarter
                                  }
                                </td>

                                <td className="text-right text-slate-400">
                                  {
                                    q.periodEnd
                                  }
                                </td>

                                <td className="text-right">
                                  {fmtNum(
                                    q.avgPrice,
                                  )}
                                </td>

                                <td
                                  className={`text-right font-medium ${changeColor(
                                    q.returnPct,
                                  )}`}
                                >
                                  {fmtPct(
                                    q.returnPct,
                                  )}
                                </td>

                                <td className="text-right text-slate-400">
                                  {q.volatilityPct.toFixed(
                                    1,
                                  )}
                                  %
                                </td>

                                <td className="text-right">
                                  {q.sharpeProxy.toFixed(
                                    3,
                                  )}
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="text-[10px] text-slate-600">
                  {
                    fundamental
                      .disclaimer
                  }
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════
            Tab: Tài chính
           ═══════════════════════════════════════════════════════ */}

        {tab === "Tài chính" && (
          <FinancialStatements
            symbol={symbol}
          />
        )}

        {/* ═══════════════════════════════════════════════════════
            Tab: Công ty
           ═══════════════════════════════════════════════════════ */}

        {tab === "Công ty" && (
          <CompanyProfile
            symbol={symbol}
          />
        )}

        {/* ═══════════════════════════════════════════════════════
            Tab: Mẫu hình
           ═══════════════════════════════════════════════════════ */}

        {tab === "Mẫu hình" && (
          <div className="space-y-4 max-w-4xl">

            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <h3 className="text-sm font-semibold text-slate-300">
                Timeframe:
              </h3>

              {TIMEFRAMES.map((t) => (
                <button
                  key={t.key}
                  onClick={() =>
                    setTf(t.key)
                  }
                  className={`rounded px-2 py-1 text-xs ${
                    tf === t.key
                      ? "bg-cyan-500/20 text-cyan-300"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {!technical && (
              <div className="panel p-8 text-center text-sm text-slate-500">
                Đang phân tích mẫu hình từ dữ liệu thật…
              </div>
            )}

            {technical && (
              <>
                <div className="panel p-4">
                  <h3 className="text-sm font-semibold text-slate-300 mb-3">
                    Mẫu hình giá (Chart
                    Patterns)
                  </h3>

                  {technical.chartPatterns
                    .length === 0 ? (
                    <div className="text-sm text-slate-500">
                      Không phát hiện mẫu hình
                      giá nào trong giai đoạn này.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {technical.chartPatterns.map(
                        (p, i) => (
                          <div
                            key={i}
                            className="bg-slate-800/40 rounded p-3"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <PatternBadge
                                type={
                                  p.type
                                }
                              />

                              <span className="font-semibold text-sm">
                                {p.nameVi}
                              </span>

                              <span className="text-xs text-slate-500">
                                ({p.name})
                              </span>

                              <span className="ml-auto text-xs text-slate-500">
                                Tin cậy:{" "}
                                {(
                                  p.reliability *
                                  100
                                ).toFixed(
                                  0,
                                )}
                                %
                              </span>
                            </div>

                            <div className="text-xs text-slate-400">
                              {
                                p.description
                              }
                            </div>

                            {p.target !==
                              null && (
                              <div className="mt-1 text-xs font-medium text-cyan-400">
                                Mục tiêu giá:{" "}
                                {fmtNum(
                                  p.target,
                                )}
                              </div>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>

                <div className="panel p-4">
                  <h3 className="text-sm font-semibold text-slate-300 mb-3">
                    Mô hình nến Nhật
                    (Candlestick) — 20 phiên
                    gần nhất
                  </h3>

                  {technical
                    .candlestickPatterns
                    .length === 0 ? (
                    <div className="text-sm text-slate-500">
                      Không phát hiện mô hình
                      nến đặc biệt nào.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {technical.candlestickPatterns.map(
                        (p, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-3 bg-slate-800/30 rounded p-2"
                          >
                            <PatternBadge
                              type={
                                p.type
                              }
                            />

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">
                                  {p.nameVi}
                                </span>

                                <span className="text-[10px] text-slate-600">
                                  ({p.name})
                                </span>

                                <span className="text-[10px] text-slate-500 ml-auto">
                                  {new Date(
                                    p.time *
                                      1000,
                                  ).toLocaleDateString(
                                    "vi-VN",
                                  )}{" "}
                                  ·{" "}
                                  {(
                                    p.reliability *
                                    100
                                  ).toFixed(
                                    0,
                                  )}
                                  %
                                </span>
                              </div>

                              <div className="text-xs text-slate-400 mt-0.5">
                                {
                                  p.description
                                }
                              </div>
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  )}

                  <div className="mt-2 text-[10px] text-slate-600">
                    Tổng phát hiện toàn chuỗi:{" "}
                    {
                      technical.totalCandlestickDetected
                    }{" "}
                    · Phân tích trên{" "}
                    {
                      technical.barsAnalyzed
                    }{" "}
                    nến
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════
            Tab: Tin tức
           ═══════════════════════════════════════════════════════ */}

        {tab === "Tin tức" && (
          <div className="space-y-3 max-w-3xl">

            {sentiment && (
              <div className="panel p-4 flex items-center gap-6">
                <div>
                  <div className="text-xs text-slate-500 mb-1">
                    Sentiment {symbol} (24h)
                  </div>

                  <SentimentBadge
                    score={
                      sentiment.sentimentScore
                    }
                  />
                </div>

                <div>
                  <div className="text-xs text-slate-500 mb-1">
                    Thị trường chung
                  </div>

                  <SentimentBadge
                    score={
                      sentiment.marketSentiment
                    }
                  />
                </div>

                <div className="text-xs text-slate-500">
                  {sentiment.newsCount24h}{" "}
                  bài 24h
                </div>
              </div>
            )}

            {(newsData?.items ?? []).map(
              (n) => (
                <a
                  key={n.id}
                  href={n.link}
                  target="_blank"
                  rel="noreferrer"
                  className="panel flex items-start gap-3 p-3 hover:border-slate-600"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium leading-snug">
                      {n.title}
                    </div>

                    <div className="mt-1 text-[11px] text-slate-500">
                      {n.sourceName} ·{" "}
                      {timeAgo(
                        n.publishedAt,
                      )}

                      <span className="ml-2">
                        <SentimentBadge
                          score={
                            n.sentiment
                          }
                        />
                      </span>
                    </div>
                  </div>
                </a>
              ),
            )}

            {newsData &&
              newsData.items.length ===
                0 && (
                <div className="panel p-8 text-center text-sm text-slate-500">
                  Chưa có tin nhắc đến{" "}
                  {symbol}.
                </div>
              )}
          </div>
        )}
      </div>
    </ProtectedPage>
  );
}
