import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { sharedCacheGetOrSet } from "@/lib/connectors/redis-cache";
import { scanCryptoScalping } from "@/lib/crypto/scalping-service";
import { POPULAR } from "@/lib/crypto/service";

export const dynamic = "force-dynamic";
export const maxDuration = 25;

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 20);
  if (limited) return limited;
  const raw = req.nextUrl.searchParams.get("symbols");
  const symbols = (raw ? raw.split(",") : POPULAR.slice(0, 12))
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9]{2,15}$/.test(symbol))
    .slice(0, 20);
  const includeOrderFlow = req.nextUrl.searchParams.get("orderFlow") === "1";
  if (!symbols.length) return ok({ symbols: [], results: [] }, { cacheHit: "none" });
  const key = `crypto:v1:scalping-scan:${symbols.join("-")}:${includeOrderFlow ? "flow" : "technical"}`;

  try {
    const cached = await sharedCacheGetOrSet(
      key,
      includeOrderFlow ? 5_000 : 8_000,
      () => scanCryptoScalping(symbols, { includeOrderFlow, concurrency: 2 }),
      { staleTtlMs: 60_000 },
    );
    const results = cached.value;
    const response = ok(
      {
        symbols,
        results,
        generatedAt: new Date().toISOString(),
        paperOnly: true,
        executionEnabled: false,
      },
      { cacheHit: cached.hit, orderFlow: includeOrderFlow },
    );
    response.headers.set(
      "Cache-Control",
      `public, s-maxage=${includeOrderFlow ? 5 : 8}, stale-while-revalidate=30`,
    );
    response.headers.set("X-Cache-Hit", cached.hit);
    return response;
  } catch (error) {
    return handleError(error, "crypto_scalping_scan");
  }
}
