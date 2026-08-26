import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { sharedCacheGetOrSet } from "@/lib/connectors/redis-cache";
import { getCryptoOhlcv } from "@/lib/crypto/service";
import { fetchBinanceKlines } from "@/lib/crypto/connectors";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const VALID = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);
const HARD_MS = 3_800;
const CACHE_TTL_MS: Record<string, number> = {
  "1m": 15_000,
  "5m": 30_000,
  "15m": 60_000,
  "1h": 120_000,
  "4h": 300_000,
  "1d": 900_000,
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}_timeout`)), ms),
    ),
  ]);
}

interface CachedOhlcv {
  symbol: string;
  timeframe: string;
  bars: Awaited<ReturnType<typeof getCryptoOhlcv>>["bars"];
  source: string;
  hasMore?: boolean;
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
  if (!VALID.has(timeframe)) return fail("Invalid timeframe", 400);

  const requestedLimit = Number(req.nextUrl.searchParams.get("limit") ?? 200);
  const limit = Math.min(
    1_000,
    Math.max(50, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 200),
  );
  const beforeRaw = Number(req.nextUrl.searchParams.get("before"));
  const before = Number.isFinite(beforeRaw) && beforeRaw > 0 ? Math.floor(beforeRaw) : undefined;
  const key = `crypto:v1:ohlcv:${normalized}:${timeframe}:${limit}:${before ?? "latest"}`;
  const ttlMs = CACHE_TTL_MS[timeframe] ?? 120_000;

  try {
    const cached = await sharedCacheGetOrSet<CachedOhlcv>(key, ttlMs, async () => {
      const deadline = Date.now() + HARD_MS;
      const remaining = () => Math.max(100, deadline - Date.now());
      try {
        const data = await withTimeout(
          getCryptoOhlcv(normalized, timeframe, limit, before),
          remaining(),
          "crypto_ohlcv_svc",
        );
        return {
          symbol: normalized,
          timeframe,
          bars: data.bars,
          source: data.source,
          hasMore: data.bars.length >= limit,
        };
      } catch (inner) {
        const pair = `${normalized}USDT`;
        const bars = await withTimeout(
          fetchBinanceKlines(pair, timeframe, limit, before),
          remaining(),
          "binance_klines",
        );
        console.warn(
          "[crypto_ohlcv] service/timeout → direct Binance",
          normalized,
          timeframe,
          inner instanceof Error ? inner.message : inner,
        );
        return {
          symbol: normalized,
          timeframe,
          bars,
          source: "binance-crypto-direct",
          hasMore: bars.length >= limit,
        };
      }
    }, { staleTtlMs: 60_000 });

    if (!cached.value.bars?.length) {
      return fail(`Không có dữ liệu chart cho ${normalized} (${timeframe})`, 502);
    }

    const response = ok(
      cached.value,
      {
        source: cached.value.source,
        timezone: "Asia/Ho_Chi_Minh",
        cacheHit: cached.hit,
        hasMore: cached.value.hasMore ?? cached.value.bars.length >= limit,
        oldest: cached.value.bars[0]?.time ?? null,
      },
      { cacheSeconds: Math.max(5, Math.floor(ttlMs / 1000)) },
    );
    response.headers.set(
      "Vercel-CDN-Cache-Control",
      `public, s-maxage=${Math.max(5, Math.floor(ttlMs / 1000))}, stale-while-revalidate=90`,
    );
    response.headers.set("X-Cache-Hit", cached.hit);
    return response;
  } catch (err) {
    return handleError(err, `crypto_ohlcv:${normalized}:${timeframe}`);
  }
}
