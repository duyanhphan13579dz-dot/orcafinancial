import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { sharedCacheGetOrSet } from "@/lib/connectors/redis-cache";
import { runCryptoAnalysis } from "@/lib/crypto/service";

export const dynamic = "force-dynamic";

const VALID = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);
const CACHE_TTL_MS = 15_000;
const FAST_CACHE_TTL_MS = 8_000;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ symbol: string }> },
) {
  const limited = checkRateLimit(req, 60);
  if (limited) return limited;

  const { symbol } = await ctx.params;
  const normalized = symbol.toUpperCase();
  const timeframe = req.nextUrl.searchParams.get("timeframe") ?? "1h";
  if (!VALID.has(timeframe)) return fail("Invalid timeframe", 400);
  const fast = req.nextUrl.searchParams.get("fast") === "1";
  const ttlMs = fast ? FAST_CACHE_TTL_MS : CACHE_TTL_MS;

  try {
    const cached = await sharedCacheGetOrSet(
      `crypto:v1:analysis:${normalized}:${timeframe}:${fast ? "fast" : "full"}`,
      ttlMs,
      () => runCryptoAnalysis(normalized, timeframe, { fast }),
    );
    return ok(
      cached.value,
      {
        timezone: "Asia/Ho_Chi_Minh",
        cacheHit: cached.hit,
        fast,
      },
      { cacheSeconds: Math.ceil(ttlMs / 1000) },
    );
  } catch (err) {
    return handleError(err, `crypto_analysis:${normalized}`);
  }
}
