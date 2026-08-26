import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { sharedCacheGetOrSet } from "@/lib/connectors/redis-cache";
import { getForexScalpingResult } from "@/lib/forex/scalping-service";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req, 60);
  if (limited) return limited;
  const { symbol } = await ctx.params;
  const normalized = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,15}$/.test(normalized)) return new Response(JSON.stringify({ error: "Invalid symbol" }), { status: 400 });
  const key = `forex:v1:scalping:${normalized}`;
  try {
    const cached = await sharedCacheGetOrSet(key, 5_000, () => getForexScalpingResult(normalized), { staleTtlMs: 45_000 });
    const response = ok(cached.value, { cacheHit: cached.hit, paperOnly: true, executionEnabled: false, source: "Biquote-first" });
    response.headers.set("Cache-Control", "public, s-maxage=5, stale-while-revalidate=45");
    response.headers.set("X-Cache-Hit", cached.hit);
    return response;
  } catch (error) {
    return handleError(error, `forex_scalping:${normalized}`);
  }
}
