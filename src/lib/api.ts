import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/connectors/core";
import { logger } from "@/lib/logger";

export type ApiMeta = Record<string, unknown>;

export type ApiResponseOptions = {
  /** CDN / browser cache TTL in seconds (sets Cache-Control when > 0). */
  cacheSeconds?: number;
};

/**
 * Standard success envelope: `{ data, meta }`.
 *
 * @param data - Payload under `data`
 * @param meta - Merged into response `meta` (timestamp is always added)
 * @param options - HTTP/cache options (not part of JSON body)
 */
export function ok<T>(
  data: T,
  meta: ApiMeta = {},
  options: ApiResponseOptions = {},
): NextResponse {
  const response = NextResponse.json({
    data,
    meta: { timestamp: new Date().toISOString(), ...meta },
  });

  if (
    typeof options.cacheSeconds === "number" &&
    Number.isFinite(options.cacheSeconds) &&
    options.cacheSeconds > 0
  ) {
    const sec = Math.floor(options.cacheSeconds);
    response.headers.set(
      "Cache-Control",
      `public, s-maxage=${sec}, stale-while-revalidate=${sec}`,
    );
  }

  return response;
}

export function fail(
  message: string,
  status = 500,
  meta: ApiMeta = {},
): NextResponse {
  return NextResponse.json(
    {
      error: message,
      meta: {
        timestamp: new Date().toISOString(),
        ...meta,
      },
    },
    { status },
  );
}

/** Returns null when allowed, otherwise a 429 response. */
export function checkRateLimit(
  req: NextRequest,
  limit = 240,
): NextResponse | null {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

  if (!rateLimit(`ip:${ip}`, limit, 60_000)) {
    logger.warn("rate_limited", {
      ip,
      path: req.nextUrl.pathname,
    });

    return fail("Rate limit exceeded. Try again in a minute.", 429);
  }

  return null;
}

/** Hide internal DB/SQL details from API consumers. */
function publicMessage(raw: string): string {
  if (
    /Failed query|relation .* does not exist|does not exist|ECONNREFUSED|ECONNRESET|timeout|password authentication|SSL|syntax error/i.test(
      raw,
    )
  ) {
    return "Dữ liệu tạm thời không khả dụng. Hệ thống đang đồng bộ — thử lại sau vài giây.";
  }

  if (raw.length > 200) {
    return "Dữ liệu tạm thời không khả dụng.";
  }

  return raw;
}

export function handleError(err: unknown, context: string): NextResponse {
  const message = err instanceof Error ? err.message : String(err);

  logger.error("api_error", {
    context,
    error: message,
  });

  return fail(`Upstream data unavailable: ${publicMessage(message)}`, 502, {
    context,
  });
}
