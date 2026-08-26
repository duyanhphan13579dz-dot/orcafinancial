import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { sharedCacheGetOrSet } from "@/lib/connectors/redis-cache";
import { runCryptoAnalysis } from "@/lib/crypto/service";

export const dynamic = "force-dynamic";

const VALID = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);
const CACHE_TTL_MS = 15_000;
const FAST_CACHE_TTL_MS = 8_000;
const FAST_BUDGET_MS = 3_800;
const FULL_BUDGET_MS = 8_500;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms),
    ),
  ]);
}

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
      () =>
        withTimeout(
          runCryptoAnalysis(normalized, timeframe, { fast }),
          fast ? FAST_BUDGET_MS : FULL_BUDGET_MS,
          fast ? "crypto_signal_fast" : "crypto_analysis_full",
        ),
      { staleTtlMs: fast ? 60_000 : 120_000 },
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
