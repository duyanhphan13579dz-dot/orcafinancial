import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { ensureMarketTables } from "@/db/ensure-market-tables";
import { ensureCryptoFresh, latestCryptoPrices } from "@/lib/crypto/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 180);
  if (limited) return limited;
  try {
    await ensureMarketTables();
    const limit = Math.min(
      100,
      Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50)),
    );
    const freshness = await ensureCryptoFresh();
    const response = ok(
      { prices: await latestCryptoPrices(limit), freshness },
      { timezone: "Asia/Ho_Chi_Minh" },
    );
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=8, stale-while-revalidate=30",
    );
    return response;
  } catch (err) {
    return handleError(err, "crypto_prices");
  }
}
