import { NextRequest } from "next/server";
import {
  checkRateLimit,
  fail,
  handleError,
  ok,
} from "@/lib/api";
import type { Timeframe } from "@/lib/connectors/core";
import { getHistory } from "@/lib/market";

export const dynamic = "force-dynamic";

/**
 * Backend source timeframes.
 *
 * The stock connector provides:
 * - 1m
 * - 15m
 * - 1h
 * - Daily
 *
 * Higher timeframes are aggregated server-side.
 */
const TF_MAP: Record<string, Timeframe> = {
  "1m": "1",
  "15m": "15",
  "1h": "60",
  "4h": "60",
  "1d": "D",
  "1w": "D",
  "1M": "D",
  "12M": "D",
};

const DEFAULT_LIMIT: Record<string, number> = {
  "15m": 600,
  "1h": 600,
  "4h": 500,
  "1d": 800,
  "1w": 300,
  "1M": 120,
  "12M": 20,
};

type HistoryBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/**
 * Calculate how much raw history should be requested.
 *
 * We deliberately request more raw candles than the final
 * number of candles because aggregation needs enough source
 * data to produce the requested timeframe.
 */
function getSpanSeconds(
  requestedTf: string,
  limit: number,
): number {
  switch (requestedTf) {
    case "15m":
      return Math.max(
        30 * 86400,
        limit * 15 * 60 * 2,
      );

    case "1h":
      return Math.max(
        90 * 86400,
        limit * 60 * 60 * 2,
      );

    case "4h":
      return Math.max(
        365 * 86400,
        limit * 4 * 60 * 60 * 2,
      );

    case "1W":
      return Math.max(
        10 * 365 * 86400,
        limit * 7 * 86400 * 2,
      );

    case "1M":
      return Math.max(
        15 * 365 * 86400,
        limit * 31 * 86400 * 2,
      );

    case "12M":
      return Math.max(
        30 * 365 * 86400,
        limit * 365 * 86400 * 2,
      );

    case "1d":
    default:
      return Math.max(
        365 * 86400,
        limit * 86400 * 2,
      );
  }
}

/**
 * Generic OHLCV aggregation.
 */
function aggregateBars(
  bars: HistoryBar[],
  bucketSeconds: number,
  getBucket?: (
    bar: HistoryBar,
  ) => number,
): HistoryBar[] {
  const groups =
    new Map<number, HistoryBar[]>();

  for (const bar of bars) {
    const key = getBucket
      ? getBucket(bar)
      : Math.floor(
          bar.time / bucketSeconds,
        ) * bucketSeconds;

    const group =
      groups.get(key) ?? [];

    group.push(bar);
    groups.set(key, group);
  }

  return Array.from(
    groups.entries(),
  )
    .map(
      ([time, group]) => {
        const sorted =
          [...group].sort(
            (a, b) =>
              a.time - b.time,
          );

        return {
          time,

          open:
            sorted[0].open,

          high: Math.max(
            ...sorted.map(
              (bar) =>
                bar.high,
            ),
          ),

          low: Math.min(
            ...sorted.map(
              (bar) =>
                bar.low,
            ),
          ),

          close:
            sorted[
              sorted.length - 1
            ].close,

          volume:
            sorted.reduce(
              (sum, bar) =>
                sum + bar.volume,
              0,
            ),
        };
      },
    )
    .sort(
      (a, b) =>
        a.time - b.time,
    );
}

/**
 * 4H candles from 1H candles.
 *
 * UTC buckets are used intentionally so Vercel
 * deployments in different regions produce the
 * same candle boundaries.
 */
function aggregateFourHour(
  bars: HistoryBar[],
): HistoryBar[] {
  return aggregateBars(
    bars,
    4 * 60 * 60,
  );
}

/**
 * Weekly candles from daily candles.
 *
 * Week starts Monday.
 */
function aggregateWeekly(
  bars: HistoryBar[],
): HistoryBar[] {
  return aggregateBars(
    bars,
    7 * 86400,
    (bar) => {
      const date =
        new Date(
          bar.time * 1000,
        );

      const day =
        date.getUTCDay();

      const mondayOffset =
        day === 0
          ? 6
          : day - 1;

      const monday =
        new Date(date);

      monday.setUTCDate(
        date.getUTCDate() -
          mondayOffset,
      );

      monday.setUTCHours(
        0,
        0,
        0,
        0,
      );

      return Math.floor(
        monday.getTime() /
          1000,
      );
    },
  );
}

/**
 * Monthly candles from daily candles.
 */
function aggregateMonthly(
  bars: HistoryBar[],
): HistoryBar[] {
  return aggregateBars(
    bars,
    31 * 86400,
    (bar) => {
      const date =
        new Date(
          bar.time * 1000,
        );

      return Math.floor(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          1,
        ) / 1000,
      );
    },
  );
}

/**
 * 12M candles.
 *
 * One candle = one calendar year.
 */
function aggregateYearly(
  bars: HistoryBar[],
): HistoryBar[] {
  return aggregateBars(
    bars,
    365 * 86400,
    (bar) => {
      const date =
        new Date(
          bar.time * 1000,
        );

      return Math.floor(
        Date.UTC(
          date.getUTCFullYear(),
          0,
          1,
        ) / 1000,
      );
    },
  );
}

export async function GET(
  req: NextRequest,
  ctx: {
    params: Promise<{
      symbol: string;
    }>;
  },
) {
  const limited =
    checkRateLimit(req);

  if (limited) {
    return limited;
  }

  const {
    symbol: raw,
  } = await ctx.params;

  const symbol =
    raw.toUpperCase();

  /**
   * Vietnamese stock symbols are normally
   * alphanumeric. Keep this strict so the
   * endpoint cannot receive arbitrary paths.
   */
  if (
    !/^[A-Z0-9]{1,15}$/.test(
      symbol,
    )
  ) {
    return fail(
      "Invalid symbol",
      400,
    );
  }

  const sp = req.nextUrl.searchParams;

  /**
   * Supported timeframes:
   * 15m, 1h, 4h, 1D (or 1d), 1W (or 1w), 1M, 12M
   */
  const rawTf = (sp.get("timeframe") ?? "1D").trim();
  const tfUpper = rawTf.toUpperCase();
  const requestedTf =
    tfUpper === "15M" ? "15m" :
    tfUpper === "1H" ? "1h" :
    tfUpper === "4H" ? "4h" :
    tfUpper === "1D" ? "1D" :
    tfUpper === "1W" ? "1W" :
    tfUpper === "1M" ? "1M" :
    tfUpper === "12M" ? "12M" : "1D";

  const backendTf = TF_MAP[requestedTf] ?? TF_MAP[rawTf] ?? "D";

  const limitRaw =
    Number(
      sp.get("limit"),
    );

  const limit =
    Math.max(
      50,
      Math.min(
        5000,
        Number.isFinite(
          limitRaw,
        ) &&
          limitRaw > 0
          ? Math.floor(
              limitRaw,
            )
          : DEFAULT_LIMIT[
              requestedTf
            ] ?? 800,
      ),
    );

  /**
   * `before` is used by the chart when
   * the user scrolls backwards.
   *
   * Example:
   *
   * /history?symbol=VCB&timeframe=1d&before=...
   */
  const beforeRaw =
    Number(
      sp.get("before"),
    );

  const hasBefore =
    Number.isFinite(
      beforeRaw,
    ) &&
    beforeRaw > 0;

  const to = hasBefore
    ? beforeRaw - 1
    : Math.floor(
        Date.now() /
          1000,
      );

  const from =
    to -
    getSpanSeconds(
      requestedTf,
      limit,
    );

  try {
    /**
     * Get raw history from the existing
     * market connector.
     */
    const result =
      await getHistory(
        symbol,
        from,
        to,
        backendTf,
      );

    let bars =
      result.bars as HistoryBar[];

    /**
     * Build requested higher timeframe.
     */
    switch (
      requestedTf
    ) {
      case "4h":
        bars =
          aggregateFourHour(
            bars,
          );
        break;

      case "1W":
        bars =
          aggregateWeekly(
            bars,
          );
        break;

      case "1M":
        bars =
          aggregateMonthly(
            bars,
          );
        break;

      case "12M":
        bars =
          aggregateYearly(
            bars,
          );
        break;

      default:
        /**
         * 15m / 1h / 1d already come
         * directly from the connector.
         */
        break;
    }

    /**
     * Always keep chronological order.
     */
    bars.sort(
      (a, b) =>
        a.time - b.time,
    );

    /**
     * Only return the requested amount.
     *
     * This is important for chart speed:
     * the browser does not receive unnecessary
     * candles.
     */
    if (
      bars.length > limit
    ) {
      bars =
        bars.slice(
          -limit,
        );
    }

    /**
     * A full page normally means there can
     * be more history available.
     */
    const hasMore =
      bars.length >=
      limit;

    const response =
      ok(
        {
          symbol,

          timeframe:
            requestedTf,

          bars,
        },
        {
          source:
            result.source,

          confidence:
            result.confidence,

          count:
            bars.length,

          hasMore,
        },
      );

    /**
     * Short edge cache.
     *
     * This improves repeated timeframe
     * switching without making the chart
     * feel stale for a long time.
     */
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=20, stale-while-revalidate=60",
    );

    return response;
  } catch (err) {
    return handleError(
      err,
      `history:${symbol}`,
    );
  }
}
