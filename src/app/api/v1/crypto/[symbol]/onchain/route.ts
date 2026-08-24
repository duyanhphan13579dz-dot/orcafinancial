import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { fetchOnChainIntelligence } from "@/lib/crypto/onchain";
import { getCryptoCoin } from "@/lib/crypto/service";

export const dynamic = "force-dynamic";

/**
 * On-chain intelligence
 * GET /api/v1/crypto/[symbol]/onchain
 */
export async function GET(
  req: NextRequest,
  c: { params: Promise<{ symbol: string }> },
) {
  const limited = checkRateLimit(req, 40);
  if (limited) return limited;

  const { symbol } = await c.params;
  const base = symbol.toUpperCase().replace(/USDT$/i, "");

  try {
    let coingeckoId: string | null = null;
    try {
      const detail = await getCryptoCoin(base);
      coingeckoId =
        (detail?.coin as { coingeckoId?: string | null } | undefined)?.coingeckoId ??
        null;
    } catch {
      /* ignore */
    }

    const data = await fetchOnChainIntelligence(base, { coingeckoId });
    const response = ok(data, {
      timezone: "Asia/Ho_Chi_Minh",
      source: data.sources.join(",") || "onchain",
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=120, stale-while-revalidate=300",
    );
    return response;
  } catch (e) {
    return handleError(e, `crypto_onchain:${base}`);
  }
}
