import { NextRequest } from "next/server";

import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { ensureMarketTables } from "@/db/ensure-market-tables";
import { getCryptoOhlcv } from "@/lib/crypto/service";
import { fetchBinanceKlines } from "@/lib/crypto/connectors";

export const dynamic = "force-dynamic";

const VALID = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ symbol: string }> },
) {
  const limited = checkRateLimit(req, 120);
  if (limited) return limited;

  const { symbol } = await ctx.params;
  const normalized = symbol.toUpperCase();

  const timeframe = req.nextUrl.searchParams.get("timeframe") ?? "1h";
  if (!VALID.has(timeframe)) {
    return fail("Invalid timeframe", 400);
  }

  const requestedLimit = Number(req.nextUrl.searchParams.get("limit") ?? 300);
  const limit = Math.min(
    500,
    Math.max(50, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 300),
  );

  try {
    await ensureMarketTables().catch(() => undefined);

    let bars;
    let source = "binance-crypto";

    try {
      const data = await getCryptoOhlcv(normalized, timeframe, limit);
      bars = data.bars;
      source = data.source;
    } catch (inner) {
      // DB/coin missing — still serve chart from Binance directly
      const pair = `${normalized}USDT`;
      bars = await fetchBinanceKlines(pair, timeframe, limit);
      source = "binance-crypto-direct";
      console.warn(
        "[crypto_ohlcv] service failed, used direct Binance",
        normalized,
        inner instanceof Error ? inner.message : inner,
      );
    }

    const response = ok(
      { symbol: normalized, timeframe, bars },
      { source, timezone: "Asia/Ho_Chi_Minh" },
    );

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
    return handleError(err, `crypto_ohlcv:${normalized}:${timeframe}`);
  }
}
