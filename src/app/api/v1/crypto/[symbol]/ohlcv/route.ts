import { NextRequest } from "next/server";

import {
  checkRateLimit,
  fail,
  handleError,
  ok,
} from "@/lib/api";

import {
  getCryptoOhlcv,
} from "@/lib/crypto/service";

export const dynamic =
  "force-dynamic";

const VALID = new Set([
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
]);

export async function GET(
  req: NextRequest,
  ctx: {
    params: Promise<{
      symbol: string;
    }>;
  },
) {
  const limited =
    checkRateLimit(
      req,
      120,
    );

  if (limited) {
    return limited;
  }

  const { symbol } =
    await ctx.params;

  const normalized =
    symbol.toUpperCase();

  const timeframe =
    req.nextUrl.searchParams.get(
      "timeframe",
    ) ?? "1h";

  if (
    !VALID.has(timeframe)
  ) {
    return fail(
      "Invalid timeframe",
      400,
    );
  }

  const requestedLimit =
    Number(
      req.nextUrl.searchParams.get(
        "limit",
      ) ?? 300,
    );

  const limit = Math.min(
    500,
    Math.max(
      50,
      Number.isFinite(
        requestedLimit,
      )
        ? Math.floor(
            requestedLimit,
          )
        : 300,
    ),
  );

  try {
    const data =
      await getCryptoOhlcv(
        normalized,
        timeframe,
        limit,
      );

    const response =
      ok(
        {
          symbol:
            data.coin.symbol,

          timeframe,

          bars:
            data.bars,
        },
        {
          source:
            data.source,

          timezone:
            "Asia/Ho_Chi_Minh",
        },
      );

    /*
     * Chart lịch sử:
     *
     * Cache 15 giây tại CDN.
     *
     * Candle realtime hiện tại
     * vẫn đến từ Binance WebSocket,
     * nên cache này không làm mất realtime.
     */
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=15, stale-while-revalidate=60",
    );

    response.headers.set(
      "CDN-Cache-Control",
      "public, s-maxage=15, stale-while-revalidate=60",
    );

    response.headers.set(
      "Vercel-CDN-Cache-Control",
      "public, s-maxage=15, stale-while-revalidate=60",
    );

    return response;
  } catch (err) {
    return handleError(
      err,
      `crypto_ohlcv:${normalized}:${timeframe}`,
    );
  }
}
