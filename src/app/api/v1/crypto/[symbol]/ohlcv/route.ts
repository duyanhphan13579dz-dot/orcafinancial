import { NextRequest } from "next/server";

import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getCryptoOhlcv } from "@/lib/crypto/service";
import { fetchBinanceKlines } from "@/lib/crypto/connectors";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const VALID = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);
const HARD_MS = 5_500;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}_timeout`)), ms),
    ),
  ]);
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ symbol: string }> },
) {
  const limited = checkRateLimit(req, 180);
  if (limited) return limited;

  const { symbol } = await ctx.params;
  const normalized = symbol.toUpperCase();

  const timeframe = req.nextUrl.searchParams.get("timeframe") ?? "1h";
  if (!VALID.has(timeframe)) {
    return fail("Invalid timeframe", 400);
  }

  const requestedLimit = Number(req.nextUrl.searchParams.get("limit") ?? 200);
  const limit = Math.min(
    300,
    Math.max(50, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 200),
  );

  const pair = `${normalized}USDT`;

  try {
    let bars;
    let source = "binance-crypto";

    try {
      const data = await withTimeout(
        getCryptoOhlcv(normalized, timeframe, limit),
        HARD_MS,
        "crypto_ohlcv_svc",
      );
      bars = data.bars;
      source = data.source;
    } catch (inner) {
      bars = await withTimeout(
        fetchBinanceKlines(pair, timeframe, limit),
        HARD_MS,
        "binance_klines",
      );
      source = "binance-crypto-direct";
      console.warn(
        "[crypto_ohlcv] service/timeout → direct Binance",
        normalized,
        timeframe,
        inner instanceof Error ? inner.message : inner,
      );
    }

    if (!bars?.length) {
      return fail(`Không có dữ liệu chart cho ${normalized} (${timeframe})`, 502);
    }

    const response = ok(
      { symbol: normalized, timeframe, bars },
      { source, timezone: "Asia/Ho_Chi_Minh" },
    );

    response.headers.set(
      "Cache-Control",
      "public, s-maxage=20, stale-while-revalidate=90",
    );
    response.headers.set(
      "Vercel-CDN-Cache-Control",
      "public, s-maxage=20, stale-while-revalidate=90",
    );

    return response;
  } catch (err) {
    return handleError(err, `crypto_ohlcv:${normalized}:${timeframe}`);
  }
}
