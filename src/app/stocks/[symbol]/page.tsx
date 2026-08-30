"use client";

import {
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import dynamic from "next/dynamic";

import type { Bar } from "@/components/candle-chart";

import type { HealthDetail } from "@/components/financial-health-detail";
import { StockMicrostructurePanel } from "@/components/stock-microstructure-panel";
import type { StockMicrostructureSnapshot } from "@/lib/connectors/tcbs-microstructure";

import {
  SectionTitle,
} from "@/components/period-pill";

import {
  api,
  changeColor,
  fmtNum,
  fmtPct,
  fmtVol,
  timeAgo,
  usePoll,
} from "@/lib/client";

import {
  ProtectedPage,
} from "@/components/ProtectedPage";

/* ============================================================
 * CODE-SPLIT: heavy per-tab components
 *
 * These are only needed once the user opens the tab that uses
 * them. Loading them via next/dynamic (ssr:false) keeps them out
 * of the initial JS bundle for this page, so the shell (nav,
 * quote header, tab bar) hydrates faster — the chart/FA libraries
 * (lightweight-charts, recharts) stream in as separate chunks only
 * when actually needed.
 * ============================================================ */

const ChartSkeleton = () => (
  <div className="h-[380px] w-full animate-pulse rounded-lg bg-slate-800/40" />
);

const PanelSkeleton = () => (
  <div className="h-64 w-full animate-pulse rounded-lg bg-slate-800/40" />
);

const CandleChart = dynamic(
  () => import("@/components/candle-chart").then((m) => m.CandleChart),
  { ssr: false, loading: ChartSkeleton },
);

const FinancialStatements = dynamic(
  () => import("@/components/financial-statements").then((m) => m.FinancialStatements),
  { ssr: false, loading: PanelSkeleton },
);

const CompanyProfile = dynamic(
  () => import("@/components/company-profile").then((m) => m.CompanyProfile),
  { ssr: false, loading: PanelSkeleton },
);

const HealthDetailCard = dynamic(
  () => import("@/components/financial-health-detail").then((m) => m.HealthDetailCard),
  { ssr: false },
);

const RevenueProfitChart = dynamic(
  () => import("@/components/fundamental-charts").then((m) => m.RevenueProfitChart),
  { ssr: false },
);

const HealthGauge = dynamic(
  () => import("@/components/fundamental-charts").then((m) => m.HealthGauge),
  { ssr: false },
);

const ROEvsIndustryChart = dynamic(
  () => import("@/components/fundamental-charts").then((m) => m.ROEvsIndustryChart),
  { ssr: false },
);

const MarginsTrendChart = dynamic(
  () => import("@/components/fundamental-charts").then((m) => m.MarginsTrendChart),
  { ssr: false },
);

const EPSTrendChart = dynamic(
  () => import("@/components/fundamental-charts").then((m) => m.EPSTrendChart),
  { ssr: false },
);

const IndustryCompareBars = dynamic(
  () => import("@/components/fundamental-charts").then((m) => m.IndustryCompareBars),
  { ssr: false },
);

/* ============================================================
 * TYPES
 * ============================================================ */

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
  type:
    | "bullish"
    | "bearish"
    | "neutral";
  time: number;
  reliability: number;
  description: string;
}

interface ChartPattern {
  name: string;
  nameVi: string;
  type:
    | "bullish"
    | "bearish"
    | "neutral";
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
    breakdown: Record<
      string,
      HealthBreakdown
    >;
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

interface HistoryResponse {
  symbol: string;
  timeframe: string;
  bars: unknown;
}

/* ============================================================
 * TIMEFRAME
 * ============================================================ */

const TIMEFRAMES = [
  {
    key: "15m",
    label: "15m",
  },
  {
    key: "1h",
    label: "1h",
  },
  {
    key: "4h",
    label: "4h",
  },
  {
    key: "1d",
    label: "1D",
  },
  {
    key: "1w",
    label: "1W",
  },
  {
    key: "1M",
    label: "1M",
  },
  {
    key: "12M",
    label: "12M",
  },
] as const;

type Timeframe =
  (typeof TIMEFRAMES)[number]["key"];

/*
 * Số nến lấy lần đầu.
 *
 * Không nên lấy quá nhiều ngay từ đầu vì:
 *
 * 15m -> 1000 candles
 * 1h  -> 1000 candles
 * 1d  -> 1000 candles
 * 1w  -> 600 candles
 * 1M  -> 240 candles
 *
 * Khi user kéo về quá khứ, loadMoreHistory()
 * sẽ lấy thêm.
 */

const INITIAL_HISTORY_LIMIT: Record<
  Timeframe,
  number
> = {
  "15m": 1000,
  "1h": 1000,
  "4h": 800,
  "1d": 1000,
  "1w": 600,
  "1M": 240,
  "12M": 50,
};

const HISTORY_PAGE_SIZE: Record<
  Timeframe,
  number
> = {
  "15m": 1000,
  "1h": 1000,
  "4h": 800,
  "1d": 1000,
  "1w": 500,
  "1M": 120,
  "12M": 30,
};

/* ============================================================
 * UI CONFIG
 * ============================================================ */

function recommendationLabel(value: string) {
  return ({ "Strong Buy": "Mua mạnh", Buy: "Mua", Hold: "Giữ", Sell: "Bán", "Strong Sell": "Bán mạnh" } as Record<string, string>)[value] ?? value;
}

const RECO_STYLE: Record<
  string,
  string
> = {
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

type Tab =
  (typeof TABS)[number];

/* ============================================================
 * HELPERS
 * ============================================================ */

function SentimentBadge({
  score,
}: {
  score: number;
}) {
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
    <span
      className={`text-xs font-medium ${color}`}
    >
      {label} (
      {score >= 0 ? "+" : ""}
      {score.toFixed(2)})
    </span>
  );
}

function PatternBadge({
  type,
}: {
  type:
    | "bullish"
    | "bearish"
    | "neutral";
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
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] ${cfg}`}
    >
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
  const safeScore = Math.max(
    0,
    Math.min(100, score),
  );

  const color =
    safeScore >= 70
      ? "bg-emerald-500"
      : safeScore >= 40
        ? "bg-amber-500"
        : "bg-rose-500";

  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-slate-400">
          {label}
        </span>

        <span>
          {safeScore}/100
        </span>
      </div>

      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{
            width: `${safeScore}%`,
          }}
        />
      </div>
    </div>
  );
}

/* ============================================================
 * CHART HELPERS
 * ============================================================ */

function normalizeBars(
  value: unknown,
): Bar[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Bar => {
      if (
        !item ||
        typeof item !== "object"
      ) {
        return false;
      }

      const bar =
        item as Record<
          string,
          unknown
        >;

      return (
        typeof bar.time === "number" &&
        typeof bar.open === "number" &&
        typeof bar.high === "number" &&
        typeof bar.low === "number" &&
        typeof bar.close === "number" &&
        typeof bar.volume === "number"
      );
    })
    .sort(
      (a, b) =>
        a.time - b.time,
    );
}

function mergeBars(
  first: Bar[],
  second: Bar[],
): Bar[] {
  const map =
    new Map<number, Bar>();

  for (const bar of first) {
    map.set(
      bar.time,
      bar,
    );
  }

  for (const bar of second) {
    map.set(
      bar.time,
      bar,
    );
  }

  return Array.from(
    map.values(),
  ).sort(
    (a, b) =>
      a.time - b.time,
  );
}

/* ============================================================
 * PAGE
 * ============================================================ */

export default function StockPage({
  params,
}: {
  params: Promise<{
    symbol: string;
  }>;
}) {
  const { symbol: raw } =
    use(params);

  const symbol =
    raw.toUpperCase();

  const [tf, setTf] =
    useState<Timeframe>("1d");

  const [tab, setTab] =
    useState<Tab>("Tổng quan");

  const [watchMsg, setWatchMsg] =
    useState<string | null>(null);

  const [reportLoading, setReportLoading] =
    useState(false);

  const [reportError, setReportError] =
    useState<string | null>(null);

  /* ==========================================================
   * STOCK / API DATA
   * ========================================================== */

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
  const { data: microstructure } =
    usePoll<StockMicrostructureSnapshot>(
      tab === "Tổng quan" ? `/stocks/${symbol}/microstructure` : null,
      10000,
      { softTtlMs: 5000, hardTtlMs: 30000, timeoutMs: 7000 },
    );

  const {
    data: fundamental,
  } =
    usePoll<FundamentalData>(
      tab === "Cơ bản" ||
        tab === "Tổng quan"
        ? `/stocks/${symbol}/fundamental`
        : null,
      120000,
    );

  const {
    data: technical,
  } =
    usePoll<TechnicalData>(
      tab === "Mẫu hình" ||
        tab === "Tổng quan"
        ? `/stocks/${symbol}/technical?timeframe=${encodeURIComponent(tf)}`
        : null,
      60000,
    );

  const {
    data: sentiment,
  } =
    usePoll<SentimentData>(
      `/stocks/${symbol}/sentiment`,
      60000,
    );

  const {
    data: newsData,
  } =
    usePoll<{
      items: NewsItem[];
    }>(
      `/news?symbol=${encodeURIComponent(
        symbol,
      )}&limit=10`,
      90000,
    );

  const onFundamentalTab =
    tab === "Cơ bản" ||
    tab === "Tổng quan";

  const {
    data: chartData,
  } =
    usePoll<any>(
      onFundamentalTab
        ? `/stocks/${symbol}/fundamental-chart`
        : null,
      120000,
    );

  const {
    data: healthDetail,
  } =
    usePoll<HealthDetail>(
      tab === "Cơ bản"
        ? `/stocks/${symbol}/financial-health-detail`
        : null,
      120000,
    );

  const q =
    stock?.quote;

  /* ==========================================================
   * CHART STATE
   * ========================================================== */

  const [
    historyBars,
    setHistoryBars,
  ] = useState<Bar[]>([]);

  const [
    historyLoading,
    setHistoryLoading,
  ] = useState(true);

  const [
    historyLoadingMore,
    setHistoryLoadingMore,
  ] = useState(false);

  const [
    historyHasMore,
    setHistoryHasMore,
  ] = useState(true);

  const [
    historyError,
    setHistoryError,
  ] = useState<string | null>(
    null,
  );

  const historyRequestRef =
    useRef(0);

  const historyBeforeRef =
    useRef<number | null>(
      null,
    );

  const historyHasMoreRef =
    useRef(true);

  const historyLoadingMoreRef =
    useRef(false);

  /* ==========================================================
   * LOAD HISTORY
   *
   * IMPORTANT:
   *
   * Do NOT use fetch("/stocks/...")
   *
   * Use api("/stocks/...")
   *
   * api() automatically becomes:
   *
   * /api/v1/stocks/:symbol/history
   *
   * ========================================================== */

  const loadHistory =
    useCallback(
      async (
        mode:
          | "initial"
          | "refresh",
      ) => {
        const requestId =
          ++historyRequestRef.current;

        try {
          if (
            mode === "initial"
          ) {
            setHistoryLoading(
              true,
            );
          }

          const limit =
            INITIAL_HISTORY_LIMIT[
              tf
            ];

          const url =
            `/stocks/${symbol}/history` +
            `?timeframe=${encodeURIComponent(
              tf,
            )}` +
            `&limit=${limit}`;

          const response =
            await api<HistoryResponse>(
              url,
            );

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

          if (
            mode === "refresh"
          ) {
            setHistoryBars(
              (previous) =>
                mergeBars(
                  previous,
                  bars,
                ),
            );
          } else {
            setHistoryBars(
              bars,
            );
          }

          if (
            bars.length > 0
          ) {
            historyBeforeRef.current =
              bars[0].time;
          }

          const explicitHasMore =
            response.meta
              ?.hasMore;

          const hasMore =
            typeof explicitHasMore ===
            "boolean"
              ? explicitHasMore
              : bars.length >=
                limit;

          historyHasMoreRef.current =
            hasMore;

          setHistoryHasMore(
            hasMore,
          );

          setHistoryError(
            null,
          );
        } catch (error) {
          if (
            requestId !==
            historyRequestRef.current
          ) {
            return;
          }

          setHistoryError(
            error instanceof Error
              ? error.message
              : "Không tải được dữ liệu chart",
          );

          if (
            mode === "initial"
          ) {
            setHistoryBars(
              [],
            );
          }
        } finally {
          if (
            requestId ===
            historyRequestRef.current
          ) {
            setHistoryLoading(
              false,
            );
          }
        }
      },
      [symbol, tf],
    );

  /* ==========================================================
   * LOAD OLDER HISTORY
   *
   * Used when user requests more historical data.
   * ========================================================== */

  const loadMoreHistory =
    useCallback(
      async () => {
        if (
          historyLoadingMoreRef.current
        ) {
          return;
        }

        if (
          !historyHasMoreRef.current
        ) {
          return;
        }

        const oldest =
          historyBeforeRef.current;

        if (
          oldest === null
        ) {
          return;
        }

        historyLoadingMoreRef.current =
          true;

        setHistoryLoadingMore(
          true,
        );

        try {
          const limit =
            HISTORY_PAGE_SIZE[
              tf
            ];

          const url =
            `/stocks/${symbol}/history` +
            `?timeframe=${encodeURIComponent(
              tf,
            )}` +
            `&limit=${limit}` +
            `&before=${encodeURIComponent(
              String(oldest),
            )}`;

          const response =
            await api<HistoryResponse>(
              url,
            );

          const olderBars =
            normalizeBars(
              response.data?.bars,
            );

          if (
            olderBars.length ===
            0
          ) {
            historyHasMoreRef.current =
              false;

            setHistoryHasMore(
              false,
            );

            return;
          }

          setHistoryBars(
            (previous) =>
              mergeBars(
                olderBars,
                previous,
              ),
          );

          historyBeforeRef.current =
            olderBars[0].time;

          const explicitHasMore =
            response.meta
              ?.hasMore;

          const hasMore =
            typeof explicitHasMore ===
            "boolean"
              ? explicitHasMore
              : olderBars.length >=
                limit;

          historyHasMoreRef.current =
            hasMore;

          setHistoryHasMore(
            hasMore,
          );
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
      [symbol, tf],
    );

  /* ==========================================================
   * RESET HISTORY WHEN SYMBOL / TIMEFRAME CHANGES
   * ========================================================== */

  useEffect(() => {
    historyRequestRef.current +=
      1;

    historyBeforeRef.current =
      null;

    historyHasMoreRef.current =
      true;

    historyLoadingMoreRef.current =
      false;

    queueMicrotask(() => {
      setHistoryBars([]);
      setHistoryLoading(true);
      setHistoryLoadingMore(false);
      setHistoryHasMore(true);
      setHistoryError(null);
    });
  }, [symbol, tf]);

  /* ==========================================================
   * INITIAL LOAD
   * ========================================================== */

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadHistory("initial");
    });
    return () => {
      cancelled = true;
    };
  }, [loadHistory]);

  /* ==========================================================
   * REFRESH CHART DATA
   *
   * Prices update every 30 seconds.
   *
   * This does not reload the entire page.
   * ========================================================== */

  useEffect(() => {
    const timer =
      window.setInterval(
        () => {
          void loadHistory(
            "refresh",
          );
        },
        3500,
      );

    return () =>
      window.clearInterval(
        timer,
      );
  }, [
    loadHistory,
  ]);

  /* ==========================================================
   * WATCHLIST
   * ========================================================== */

  const addToWatchlist =
    async () => {
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

        setWatchMsg(
          "Đã thêm ✓",
        );
      } catch (error) {
        setWatchMsg(
          error instanceof Error
            ? error.message
            : "Lỗi",
        );
      }

      window.setTimeout(
        () =>
          setWatchMsg(
            null,
          ),
        2500,
      );
    };

  /* ==========================================================
   * ANALYSIS REPORT
   * ========================================================== */

  const downloadAnalysisReport =
    async () => {
      if (reportLoading) return;

      setReportLoading(true);
      setReportError(null);

      try {
        const response = await fetch(
          `/api/v1/stocks/${encodeURIComponent(symbol)}/analysis-report`,
          {
            credentials: "include",
            cache: "no-store",
          },
        );

        if (!response.ok) {
          let message = `Không thể tạo báo cáo (HTTP ${response.status}).`;
          try {
            const payload = (await response.json()) as { error?: string };
            if (payload.error) message = payload.error;
          } catch {
            // Keep the HTTP fallback when the server response is not JSON.
          }
          throw new Error(message);
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("application/pdf")) {
          throw new Error("Máy chủ không trả về file PDF hợp lệ.");
        }

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = `ORCA_${symbol}_BAO_CAO_PHAN_TICH.pdf`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      } catch (error) {
        setReportError(
          error instanceof Error
            ? error.message
            : "Không thể tải báo cáo phân tích.",
        );
      } finally {
        setReportLoading(false);
      }
    };

  /* ==========================================================
   * RENDER
   * ========================================================== */

  return (
    <ProtectedPage
      featureName="chi tiết cổ phiếu"
    >
      <div className="space-y-4">

        {/* ======================================================
         * HEADER
         * ====================================================== */}

        <div className="panel p-4 flex flex-wrap items-center gap-x-6 gap-y-3">

          <div>
            <div className="flex items-center gap-3">

              <h1 className="text-2xl font-bold">
                {symbol}
              </h1>

              <span className="text-xs text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">
                {stock?.company
                  ?.exchange ||
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
              {stock?.company
                ?.name ??
                ""}
            </div>
          </div>

          {q && (
            <>
              <div>
                <div className="text-3xl font-bold">
                  {fmtNum(
                    q.close,
                  )}
                </div>

                <div
                  className={`text-sm font-semibold ${changeColor(
                    q.changePct,
                  )}`}
                >
                  {fmtPct(
                    q.changePct,
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-400">
                <span>
                  Mở:{" "}
                  {fmtNum(
                    q.open,
                  )}
                </span>

                <span>
                  Cao:{" "}
                  {fmtNum(
                    q.high,
                  )}
                </span>

                <span>
                  Thấp:{" "}
                  {fmtNum(
                    q.low,
                  )}
                </span>

                <span>
                  KL:{" "}
                  {fmtVol(
                    q.volume,
                  )}
                </span>
              </div>

              <div className="text-[10px] text-slate-600">
                Nguồn:{" "}
                {q.source}
                <br />
                Confidence:{" "}
                {(
                  q.confidence *
                  100
                ).toFixed(0)}
                %
              </div>
            </>
          )}

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={downloadAnalysisReport}
              disabled={reportLoading}
              aria-busy={reportLoading}
              className="inline-flex items-center gap-2 rounded-md border border-amber-500/70 bg-amber-500/10 px-3 py-1.5 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-500/20 disabled:cursor-wait disabled:opacity-60"
            >
              <span aria-hidden="true">{reportLoading ? "…" : "↓"}</span>
              {reportLoading ? "Đang tạo báo cáo…" : "BÁO CÁO PHÂN TÍCH"}
            </button>

            <button
              type="button"
              onClick={addToWatchlist}
              className="rounded-md border border-cyan-700 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-300 hover:bg-cyan-500/20"
            >
              {watchMsg ?? "+ Watchlist"}
            </button>
          </div>
        </div>

        {(quoteError || reportError) && (
          <div className="panel border-rose-800 bg-rose-950/30 p-4 text-sm text-rose-300">
            {quoteError
              ? <>Không lấy được dữ liệu cho {symbol}: {quoteError}</>
              : <>Không thể tải BÁO CÁO PHÂN TÍCH: {reportError}</>}
          </div>
        )}

        {/* ======================================================
         * TABS
         * ====================================================== */}

        <div className="flex gap-1 border-b border-slate-800 pb-0 overflow-x-auto">
          {TABS.map(
            (item) => (
              <button
                key={item}
                onClick={() =>
                  setTab(
                    item,
                  )
                }
                className={`whitespace-nowrap px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                  tab === item
                    ? "border-cyan-500 text-cyan-300"
                    : "border-transparent text-slate-500 hover:text-slate-300"
                }`}
              >
                {item}
              </button>
            ),
          )}
        </div>

        {/* ======================================================
         * TỔNG QUAN
         * ====================================================== */}

        {tab ===
          "Tổng quan" && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

            {/* CHART */}

            <div className="panel p-4 lg:col-span-2">

              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">

                <div>
                  <h3 className="text-sm font-semibold text-slate-300">
                    Biểu đồ giá
                  </h3>

                  <div className="text-[10px] text-slate-600 mt-0.5">
                    {historyBars.length > 0
                      ? `${historyBars.length.toLocaleString()} nến`
                      : "Đang tải dữ liệu..."}
                  </div>
                </div>

                <div className="flex gap-1 overflow-x-auto">
                  {TIMEFRAMES.map(
                    (item) => (
                      <button
                        key={
                          item.key
                        }
                        onClick={() =>
                          setTf(
                            item.key,
                          )
                        }
                        className={`rounded px-2 py-1 text-xs whitespace-nowrap ${
                          tf ===
                          item.key
                            ? "bg-cyan-500/20 text-cyan-300"
                            : "text-slate-500 hover:text-slate-300"
                        }`}
                      >
                        {
                          item.label
                        }
                      </button>
                    ),
                  )}
                </div>
              </div>

              {/* CHART ERROR */}

              {historyError ? (
                <div className="h-72 flex flex-col items-center justify-center gap-3">

                  <div className="text-sm text-rose-400">
                    Không tải được dữ liệu chart
                  </div>

                  <div className="text-xs text-slate-500 text-center max-w-md">
                    {historyError}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setHistoryError(
                        null,
                      );

                      void loadHistory(
                        "initial",
                      );
                    }}
                    className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    Thử lại
                  </button>
                </div>
              ) : historyLoading &&
                historyBars.length ===
                  0 ? (
                <div className="h-72 flex flex-col items-center justify-center gap-2 text-slate-500 text-sm">
                  <div>
                    Đang tải dữ liệu chart…
                  </div>

                  <div className="text-[10px] text-slate-600">
                    {symbol} ·{" "}
                    {tf}
                  </div>
                </div>
              ) : historyBars.length >
                0 ? (
                <div className="relative">

                  <CandleChart
                    bars={
                      historyBars
                    }
                    onLoadMore={loadMoreHistory}
                    loadingMore={historyLoadingMore}
                    hasMore={historyHasMore}
                    loadMoreThreshold={24}
                  />

                  {historyLoadingMore && (
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-slate-900/90 border border-slate-700 px-3 py-1.5 text-[10px] text-slate-400">
                      Đang tải thêm lịch sử…
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-72 flex flex-col items-center justify-center gap-3 text-slate-500 text-sm">
                  <div>
                    Chưa có dữ liệu chart
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      void loadHistory(
                        "initial",
                      )
                    }
                    className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    Tải lại
                  </button>
                </div>
              )}

              {/* CHART FOOTER */}

              {historyBars.length >
                0 && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-600">

                  <span>
                    {historyBars.length.toLocaleString()} nến
                  </span>

                  <span>
                    Timeframe:{" "}
                    {tf}
                  </span>

                  <button
                    type="button"
                    disabled={
                      historyLoadingMore ||
                      !historyHasMore
                    }
                    onClick={
                      loadMoreHistory
                    }
                    className="rounded border border-slate-800 px-2 py-1 text-slate-500 hover:text-slate-300 hover:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {historyLoadingMore
                      ? "Đang tải…"
                      : historyHasMore
                        ? "← Tải thêm lịch sử"
                        : "Đã hết dữ liệu"}
                  </button>
                </div>
              )}
            </div>

            {/* RIGHT COLUMN */}
            <div className="space-y-4">
              {microstructure && (
                <StockMicrostructurePanel
                  orderBook={microstructure.orderBook}
                  foreignFlow={microstructure.foreignFlow}
                />
              )}

              {/* QUICK ANALYSIS */}

              {analysis && (
                <div className="panel p-4">

                  <h3 className="text-sm font-semibold text-slate-300 mb-2">
                    Khuyến nghị
                  </h3>

                  <div
                    className={`inline-block rounded-md border px-3 py-1.5 text-sm font-bold ${
                      RECO_STYLE[
                        analysis
                          .recommendation
                      ] ?? ""
                    }`}
                  >
                    {
                      recommendationLabel(analysis.recommendation)
                    }

                    <span className="ml-1 font-normal text-xs opacity-80">
                      {(
                        analysis.confidence *
                        100
                      ).toFixed(
                        0,
                      )}
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

              {/* SENTIMENT */}

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

        {/* ======================================================
         * PHÂN TÍCH KỸ THUẬT
         * ====================================================== */}

        {tab ===
          "Phân tích KT" &&
          analysis && (
            <div className="panel p-4 max-w-3xl">

              <div
                className={`inline-block rounded-md border px-4 py-2 text-lg font-bold mb-4 ${
                  RECO_STYLE[
                    analysis.recommendation
                  ] ?? ""
                }`}
              >
                {
                  recommendationLabel(analysis.recommendation)
                }

                <span className="text-sm font-normal opacity-80">
                  {" "}
                  tin cậy{" "}
                  {(
                    analysis.confidence *
                    100
                  ).toFixed(
                    0,
                  )}
                  %
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">

                {[
                  [
                    "RSI (14)",
                    analysis.rsi14,
                    1,
                  ],

                  [
                    "Histogram MACD",
                    analysis.macd
                      ?.histogram,
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
                    analysis
                      .bollinger
                      ?.upper,
                    2,
                  ],

                  [
                    "Bollinger ↓",
                    analysis
                      .bollinger
                      ?.lower,
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
                    "Mức giảm tối đa",
                    analysis.maxDrawdownPct,
                    1,
                  ],

                  [
                    "1 tháng",
                    analysis.changePct1m,
                    2,
                  ],
                ].map(
                  ([
                    label,
                    value,
                    digits,
                  ]) => (
                    <div
                      key={
                        label
                      }
                      className="bg-slate-800/40 rounded p-2"
                    >
                      <div className="text-[10px] text-slate-500">
                        {
                          label
                        }
                      </div>

                      <div className="text-sm font-semibold">
                        {fmtNum(
                          value as
                            | number
                            | null
                            | undefined,
                          digits as number,
                        )}

                        {typeof label ===
                          "string" &&
                        (
                          label.includes(
                            "Biến động",
                          ) ||
                          label.includes(
                            "Mức giảm",
                          ) ||
                          label.includes(
                            "tháng",
                          )
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
                  (
                    reason,
                    index,
                  ) => (
                    <li
                      key={
                        index
                      }
                      className="flex gap-2"
                    >
                      <span className="text-cyan-500">
                        ›
                      </span>

                      {reason}
                    </li>
                  ),
                )}
              </ul>
            </div>
          )}

        {/* ======================================================
         * CƠ BẢN
         * ====================================================== */}

        {tab ===
          "Cơ bản" && (
          <div className="space-y-6 max-w-6xl">

            {/* VISUAL ANALYST */}

            {chartData && (
              <div className="space-y-5">

                <SectionTitle
                  eyebrow="PHÂN TÍCH TRỰC QUAN"
                  title={
                    <>
                      Hiệu suất & định giá qua{" "}
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
                      Doanh thu · EBITDA · Lợi nhuận ròng (tỷ VND)
                    </div>

                    <RevenueProfitChart
                      data={
                        chartData.quarters
                      }
                    />
                  </div>

                  <div className="panel p-4 reveal">

                    <div className="font-mono text-[10px] tracking-[0.25em] text-[#00d4ff] uppercase mb-2">
                      Đồng hồ sức khỏe tài chính
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
                      Biên lợi nhuận qua các quý (%)
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
                      EPS theo quý (nghìn VND / cp)
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
                        chartData.comparisons
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {/* HEALTH DETAIL */}

            {healthDetail && (
              <div>

                <SectionTitle
                  eyebrow="CHẨN ĐOÁN SỨC KHỎE"
                  title="Phân tích sức khỏe tài chính chi tiết"
                >
                  {
                    healthDetail
                      .groups.length
                  }{" "}
                  nhóm ·{" "}
                  {healthDetail.groups.reduce(
                    (
                      total,
                      group,
                    ) =>
                      total +
                      group.indicators
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

            {/* LEGACY FUNDAMENTAL */}

            {!fundamental &&
              !chartData && (
                <div className="panel p-8 text-center text-sm text-slate-500">
                  Đang tính toán từ dữ liệu giá thật…
                </div>
              )}

            {fundamental && (
              <>
                {/* FINANCIAL HEALTH */}

                <div className="panel p-4">

                  <h3 className="text-sm font-semibold text-slate-300 mb-3">
                    Sức khỏe tài chính — Điểm:{" "}
                    <span
                      className={
                        fundamental
                          .financialHealth
                          .overallScore >=
                        70
                          ? "text-emerald-400"
                          : fundamental
                                .financialHealth
                                .overallScore >=
                              40
                            ? "text-amber-400"
                            : "text-rose-400"
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
                      ([
                        key,
                        value,
                      ]) => (
                        <div
                          key={
                            key
                          }
                          className="space-y-1"
                        >
                          <HealthBar
                            label={
                              key
                                .charAt(
                                  0,
                                )
                                .toUpperCase() +
                              key.slice(
                                1,
                              )
                            }
                            score={
                              value.score
                            }
                          />

                          <div className="text-[10px] text-slate-600">
                            {
                              value.detail
                            }
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </div>

                {/* KEY RATIOS */}

                <div className="panel p-4">

                  <h3 className="text-sm font-semibold text-slate-300 mb-3">
                    Chỉ số cơ bản
                  </h3>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

                    {[
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
].map(
  ([
    label,
    value,
  ]) => (
    <div
      key={
        label
      }
      className="bg-slate-800/40 rounded p-3"
    >
      <div className="text-[10px] text-slate-500">
        {
          label
        }
      </div>

      <div className="text-lg font-bold">
        {fmtNum(
          value as
            | number
            | null
            | undefined,
        )}
      </div>
    </div>
  ),
)}
                  </div>
                </div>

                {/* DUPONT */}

                {fundamental.dupont && (
                  <div className="panel p-4">

                    <h3 className="text-sm font-semibold text-slate-300 mb-2">
                      DuPont Decomposition
                    </h3>

                    <div className="flex items-center gap-2 text-sm flex-wrap">

                      <span className="bg-slate-800/60 px-2 py-1 rounded">
                        Biên LN:{" "}
                        {fundamental
                          .dupont
                          .netProfitMargin.toFixed(
                            1,
                          )}
                        %
                      </span>

                      <span className="text-slate-600">
                        ×
                      </span>

                      <span className="bg-slate-800/60 px-2 py-1 rounded">
                        Vòng quay TS:{" "}
                        {fundamental
                          .dupont
                          .assetTurnover.toFixed(
                            2,
                          )}
                      </span>

                      <span className="text-slate-600">
                        ×
                      </span>

                      <span className="bg-slate-800/60 px-2 py-1 rounded">
                        Đòn bẩy:{" "}
                        {fundamental
                          .dupont
                          .equityMultiplier.toFixed(
                            2,
                          )}
                      </span>

                      <span className="text-slate-600">
                        =
                      </span>

                      <span className="bg-cyan-500/15 px-2 py-1 rounded font-bold text-cyan-300">
                        ROE:{" "}
                        {fundamental
                          .dupont
                          .roe.toFixed(
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

                {/* VALUATION */}

                <div className="panel p-4">

                  <h3 className="text-sm font-semibold text-slate-300 mb-3">
                    Định giá
                  </h3>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">

                    {[
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
                    ].map(
                      ([
                        label,
                        value,
                      ]) => (
                        <div
                          key={
                            label
                          }
                          className="bg-slate-800/40 rounded p-2"
                        >
                          <div className="text-[10px] text-slate-500">
                            {
                              label
                            }
                          </div>

                          <div className="text-sm font-semibold">
                            {typeof value ===
                            "number"
                              ? fmtNum(
                                  value,
                                )
                              : value ??
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
                        DCF 3 Kịch bản (giá trị mỗi CP ước tính)
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
                        Vùng giá trị nội tại ước tính
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
                            const range =
                              fundamental
                                .valuation
                                .intrinsicValueRange!;

                            const total =
                              range.high -
                              range.low;

                            const pct =
                              total >
                              0
                                ? Math.max(
                                    0,
                                    Math.min(
                                      100,
                                      ((fundamental.currentPrice -
                                        range.low) /
                                        total) *
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

                {/* QUARTERLY */}

                {fundamental
                  .quarterlyMetrics
                  .length >
                  0 && (
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
                            (
                              metric,
                            ) => (
                              <tr
                                key={
                                  metric.quarter
                                }
                                className="border-b border-slate-800/50"
                              >

                                <td className="py-1.5 font-medium">
                                  {
                                    metric.quarter
                                  }
                                </td>

                                <td className="text-right text-slate-400">
                                  {
                                    metric.periodEnd
                                  }
                                </td>

                                <td className="text-right">
                                  {fmtNum(
                                    metric.avgPrice,
                                  )}
                                </td>

                                <td
                                  className={`text-right font-medium ${changeColor(
                                    metric.returnPct,
                                  )}`}
                                >
                                  {fmtPct(
                                    metric.returnPct,
                                  )}
                                </td>

                                <td className="text-right text-slate-400">
                                  {metric.volatilityPct.toFixed(
                                    1,
                                  )}
                                  %
                                </td>

                                <td className="text-right">
                                  {metric.sharpeProxy.toFixed(
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
                    fundamental.disclaimer
                  }
                </div>
              </>
            )}
          </div>
        )}

        {/* ======================================================
         * TÀI CHÍNH
         * ====================================================== */}

        {tab ===
          "Tài chính" && (
          <FinancialStatements
            symbol={symbol}
          />
        )}

        {/* ======================================================
         * CÔNG TY
         * ====================================================== */}

        {tab ===
          "Công ty" && (
          <CompanyProfile
            symbol={symbol}
          />
        )}

        {/* ======================================================
         * MẪU HÌNH
         * ====================================================== */}

        {tab ===
          "Mẫu hình" && (
          <div className="space-y-4 max-w-4xl">

            <div className="flex items-center gap-2 mb-2">

              <h3 className="text-sm font-semibold text-slate-300">
                Timeframe:
              </h3>

              {TIMEFRAMES.map(
                (item) => (
                  <button
                    key={
                      item.key
                    }
                    onClick={() =>
                      setTf(
                        item.key,
                      )
                    }
                    className={`rounded px-2 py-1 text-xs ${
                      tf ===
                      item.key
                        ? "bg-cyan-500/20 text-cyan-300"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {
                      item.label
                    }
                  </button>
                ),
              )}
            </div>

            {!technical && (
              <div className="panel p-8 text-center text-sm text-slate-500">
                Đang phân tích mẫu hình từ dữ liệu thật…
              </div>
            )}

            {technical && (
              <>
                {/* CHART PATTERNS */}

                <div className="panel p-4">

                  <h3 className="text-sm font-semibold text-slate-300 mb-3">
                    Mẫu hình giá (Chart Patterns)
                  </h3>

                  {technical
                    .chartPatterns
                    .length ===
                  0 ? (
                    <div className="text-sm text-slate-500">
                      Không phát hiện mẫu hình giá nào trong giai đoạn này.
                    </div>
                  ) : (
                    <div className="space-y-3">

                      {technical.chartPatterns.map(
                        (
                          pattern,
                          index,
                        ) => (
                          <div
                            key={
                              index
                            }
                            className="bg-slate-800/40 rounded p-3"
                          >

                            <div className="flex items-center gap-2 mb-1">

                              <PatternBadge
                                type={
                                  pattern.type
                                }
                              />

                              <span className="font-semibold text-sm">
                                {
                                  pattern.nameVi
                                }
                              </span>

                              <span className="text-xs text-slate-500">
                                (
                                {
                                  pattern.name
                                }
                                )
                              </span>

                              <span className="ml-auto text-xs text-slate-500">
                                Tin cậy:{" "}
                                {(
                                  pattern.reliability *
                                  100
                                ).toFixed(
                                  0,
                                )}
                                %
                              </span>
                            </div>

                            <div className="text-xs text-slate-400">
                              {
                                pattern.description
                              }
                            </div>

                            {pattern.target !==
                              null && (
                              <div className="mt-1 text-xs font-medium text-cyan-400">
                                Mục tiêu giá:{" "}
                                {fmtNum(
                                  pattern.target,
                                )}
                              </div>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>

                {/* CANDLESTICK PATTERNS */}

                <div className="panel p-4">

                  <h3 className="text-sm font-semibold text-slate-300 mb-3">
                    Mô hình nến Nhật — 20 phiên gần nhất
                  </h3>

                  {technical
                    .candlestickPatterns
                    .length ===
                  0 ? (
                    <div className="text-sm text-slate-500">
                      Không phát hiện mô hình nến đặc biệt nào.
                    </div>
                  ) : (
                    <div className="space-y-2">

                      {technical.candlestickPatterns.map(
                        (
                          pattern,
                          index,
                        ) => (
                          <div
                            key={
                              index
                            }
                            className="flex items-start gap-3 bg-slate-800/30 rounded p-2"
                          >

                            <PatternBadge
                              type={
                                pattern.type
                              }
                            />

                            <div className="flex-1 min-w-0">

                              <div className="flex items-center gap-2">

                                <span className="font-medium text-sm">
                                  {
                                    pattern.nameVi
                                  }
                                </span>

                                <span className="text-[10px] text-slate-600">
                                  (
                                  {
                                    pattern.name
                                  }
                                  )
                                </span>

                                <span className="text-[10px] text-slate-500 ml-auto">
                                  {new Date(
                                    pattern.time *
                                      1000,
                                  ).toLocaleDateString(
                                    "vi-VN",
                                  )}{" "}
                                  ·{" "}
                                  {(
                                    pattern.reliability *
                                    100
                                  ).toFixed(
                                    0,
                                  )}
                                  %
                                </span>
                              </div>

                              <div className="text-xs text-slate-400 mt-0.5">
                                {
                                  pattern.description
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

        {/* ======================================================
         * NEWS
         * ====================================================== */}

        {tab ===
          "Tin tức" && (
          <div className="space-y-3 max-w-3xl">

            {sentiment && (
              <div className="panel p-4 flex items-center gap-6">

                <div>
                  <div className="text-xs text-slate-500 mb-1">
                    Sentiment{" "}
                    {symbol}{" "}
                    (24h)
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
                  {
                    sentiment.newsCount24h
                  }{" "}
                  bài 24h
                </div>
              </div>
            )}

            {(newsData?.items ??
              []).map(
              (news) => (
                <a
                  key={
                    news.id
                  }
                  href={
                    news.link
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="panel flex items-start gap-3 p-3 hover:border-slate-600"
                >
                  <div className="flex-1 min-w-0">

                    <div className="text-sm font-medium leading-snug">
                      {
                        news.title
                      }
                    </div>

                    <div className="mt-1 text-[11px] text-slate-500">

                      {
                        news.sourceName
                      }{" "}
                      ·{" "}
                      {timeAgo(
                        news.publishedAt,
                      )}

                      <span className="ml-2">
                        <SentimentBadge
                          score={
                            news.sentiment
                          }
                        />
                      </span>
                    </div>
                  </div>
                </a>
              ),
            )}

            {newsData &&
              newsData.items
                .length ===
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
