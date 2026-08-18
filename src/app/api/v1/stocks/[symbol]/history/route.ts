import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import type { Timeframe } from "@/lib/connectors/core";
import { getHistory } from "@/lib/market";

export const dynamic = "force-dynamic";

const TF_MAP: Record<string, Timeframe> = {
  "1m": "1",
  "15m": "15",
  "1h": "60",
  "1d": "D",
  "1w": "D",
  "1M": "D",
};

const DEFAULT_LIMIT: Record<string, number> = {
  "15m": 1000,
  "1h": 1000,
  "1d": 1000,
  "1w": 600,
  "1M": 240,
};

function getSpanSeconds(
  requestedTf: string,
  limit: number,
): number {
  switch (requestedTf) {
    case "15m":
      return Math.max(
        7 * 86400,
        limit * 15 * 60 * 2,
      );

    case "1h":
      return Math.max(
        30 * 86400,
        limit * 60 * 60 * 2,
      );

    case "1w":
      return Math.max(
        10 * 365 * 86400,
        limit * 7 * 86400 * 2,
      );

    case "1M":
      return Math.max(
        15 * 365 * 86400,
        limit * 31 * 86400 * 2,
      );

    case "1d":
    default:
      return Math.max(
        365 * 86400,
        limit * 86400 * 2,
      );
  }
}

type HistoryBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function aggregateWeekly(
  bars: HistoryBar[],
): HistoryBar[] {
  const groups = new Map<number, HistoryBar[]>();

  for (const bar of bars) {
    const date = new Date(bar.time * 1000);

    const day = date.getUTCDay();

    const mondayOffset =
      day === 0 ? 6 : day - 1;

    const monday = new Date(date);

    monday.setUTCDate(
      date.getUTCDate() - mondayOffset,
    );

    monday.setUTCHours(0, 0, 0, 0);

    const key = Math.floor(
      monday.getTime() / 1000,
    );

    const group =
      groups.get(key) ?? [];

    group.push(bar);

    groups.set(key, group);
  }

  return Array.from(
    groups.entries(),
  )
    .map(([time, group]) => ({
      time,
      open: group[0].open,
      high: Math.max(
        ...group.map((b) => b.high),
      ),
      low: Math.min(
        ...group.map((b) => b.low),
      ),
      close:
        group[group.length - 1].close,
      volume: group.reduce(
        (sum, b) => sum + b.volume,
        0,
      ),
    }))
    .sort(
      (a, b) => a.time - b.time,
    );
}

function aggregateMonthly(
  bars: HistoryBar[],
): HistoryBar[] {
  const groups = new Map<number, HistoryBar[]>();

  for (const bar of bars) {
    const date = new Date(bar.time * 1000);

    const first = new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        1,
      ),
    );

    const key = Math.floor(
      first.getTime() / 1000,
    );

    const group =
      groups.get(key) ?? [];

    group.push(bar);

    groups.set(key, group);
  }

  return Array.from(
    groups.entries(),
  )
    .map(([time, group]) => ({
      time,
      open: group[0].open,
      high: Math.max(
        ...group.map((b) => b.high),
      ),
      low: Math.min(
        ...group.map((b) => b.low),
      ),
      close:
        group[group.length - 1].close,
      volume: group.reduce(
        (sum, b) => sum + b.volume,
        0,
      ),
    }))
    .sort(
      (a, b) => a.time - b.time,
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

  const { symbol: raw } =
    await ctx.params;

  const symbol =
    raw.toUpperCase();

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

  const sp =
    req.nextUrl.searchParams;

  const requestedTf =
    sp.get("timeframe") ??
    "1d";

  const backendTf =
    TF_MAP[requestedTf] ??
    "D";

  const limitRaw =
    Number(sp.get("limit"));

  const limit = Math.max(
    50,
    Math.min(
      5000,
      Number.isFinite(limitRaw) &&
        limitRaw > 0
        ? Math.floor(limitRaw)
        : DEFAULT_LIMIT[
            requestedTf
          ] ?? 1000,
    ),
  );

  const beforeRaw =
    Number(sp.get("before"));

  const hasBefore =
    Number.isFinite(
      beforeRaw,
    ) &&
    beforeRaw > 0;

  const to = hasBefore
    ? beforeRaw - 1
    : Math.floor(
        Date.now() / 1000,
      );

  const from =
    to -
    getSpanSeconds(
      requestedTf,
      limit,
    );

  try {
    const result =
      await getHistory(
        symbol,
        from,
        to,
        backendTf,
      );

    let bars =
      result.bars as HistoryBar[];

    /*
     * Backend currently provides
     * daily data for weekly/monthly.
     *
     * Aggregate it here so the
     * frontend does not need to
     * know how the connector works.
     */
    if (
      requestedTf === "1w"
    ) {
      bars =
        aggregateWeekly(
          bars,
        );
    }

    if (
      requestedTf === "1M"
    ) {
      bars =
        aggregateMonthly(
          bars,
        );
    }

    bars.sort(
      (a, b) => a.time - b.time,
    );

    /*
     * Keep the newest `limit`
     * bars for initial requests.
     */
    if (
      bars.length > limit
    ) {
      bars =
        bars.slice(-limit);
    }

    /*
     * When loading older pages,
     * the backend query ends before
     * the current oldest timestamp.
     *
     * A full page means there may
     * still be more history.
     */
    const hasMore =
      bars.length >= limit;

    return ok(
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
  } catch (err) {
    return handleError(
      err,
      `history:${symbol}`,
    );
  }
}
