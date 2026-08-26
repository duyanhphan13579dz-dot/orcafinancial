import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { sharedCacheGetOrSet } from "@/lib/connectors/redis-cache";
import { getCryptoScalpingResult } from "@/lib/crypto/scalping-service";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ symbol: string }> },
) {
  const limited = checkRateLimit(req, 60);
  if (limited) return limited;
  const { symbol } = await ctx.params;
  const normalized = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,15}$/.test(normalized)) {
    return new Response(JSON.stringify({ error: "Invalid symbol" }), { status: 400 });
  }
  const includeOrderFlow = req.nextUrl.searchParams.get("orderFlow") === "1";
  const key = `crypto:v1:scalping:${normalized}:${includeOrderFlow ? "flow" : "technical"}`;

  try {
    const cached = await sharedCacheGetOrSet(
      key,
      includeOrderFlow ? 5_000 : 8_000,
      () => getCryptoScalpingResult(normalized, { includeOrderFlow }),
      { staleTtlMs: 60_000 },
    );
    const response = ok(cached.value, {
      cacheHit: cached.hit,
      paperOnly: true,
      executionEnabled: false,
      orderFlow: includeOrderFlow,
    });
    response.headers.set(
      "Cache-Control",
      `public, s-maxage=${includeOrderFlow ? 5 : 8}, stale-while-revalidate=30`,
    );
    response.headers.set("X-Cache-Hit", cached.hit);
    return response;
  } catch (error) {
    return handleError(error, `crypto_scalping:${normalized}`);
  }
}
