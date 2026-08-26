import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { sharedCacheGetOrSet } from "@/lib/connectors/redis-cache";
import { scanForexScalping } from "@/lib/forex/scalping-service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 30);
  if (limited) return limited;
  const rawSymbols = req.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = rawSymbols.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean).slice(0, 24);
  if (symbols.some((symbol) => !/^[A-Z0-9]{2,15}$/.test(symbol))) return new Response(JSON.stringify({ error: "Invalid symbols" }), { status: 400 });
  const key = `forex:v1:scalping-scan:${symbols.join("-") || "majors"}`;
  try {
    const cached = await sharedCacheGetOrSet(key, 5_000, () => scanForexScalping(symbols), { staleTtlMs: 45_000 });
    const response = ok(cached.value, { cacheHit: cached.hit, paperOnly: true, executionEnabled: false, source: "Biquote-first" });
    response.headers.set("Cache-Control", "public, s-maxage=5, stale-while-revalidate=45");
    response.headers.set("X-Cache-Hit", cached.hit);
    return response;
  } catch (error) {
    return handleError(error, "forex_scalping_scan");
  }
}
