import { NextRequest } from "next/server";

import {
  checkRateLimit,
  fail,
  handleError,
  ok,
} from "@/lib/api";

import {
  getForexDetailBundle,
} from "@/lib/forex/service";

const VALID_TIMEFRAMES = new Set([
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
]);

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: {
    params: Promise<{
      symbol: string;
    }>;
  },
) {
  const rateLimit = checkRateLimit(
    req,
    90,
  );

  if (rateLimit) {
    return rateLimit;
  }

  const { symbol } = await context.params;

  const timeframe =
    req.nextUrl.searchParams.get(
      "timeframe",
    ) ?? "1h";

  if (!VALID_TIMEFRAMES.has(timeframe)) {
    return fail(
      "Invalid timeframe",
      400,
    );
  }

  const rawLimit = Number(
    req.nextUrl.searchParams.get(
      "limit",
    ) ?? 300,
  );

  const limit = Math.min(
    1000,
    Math.max(
      20,
      Number.isFinite(rawLimit)
        ? Math.floor(rawLimit)
        : 300,
    ),
  );

  try {
    const data =
      await getForexDetailBundle(
        symbol.toUpperCase(),
        timeframe,
        limit,
      );

    const response = ok(data, {
      timezone:
        "Asia/Ho_Chi_Minh",
      source: data.source,
    });

    /*
     * CDN/SWR cache.
     *
     * 10 giây fresh
     * 45 giây stale-while-revalidate
     *
     * Không dùng tham số thứ 3 của ok()
     * vì helper hiện tại chỉ nhận 1-2 arguments.
     */
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=10, stale-while-revalidate=45",
    );

    return response;
  } catch (error) {
    return handleError(
      error,
      `forex_bundle:${symbol}`,
    );
  }
}
