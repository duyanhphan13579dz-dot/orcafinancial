import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { getCryptoCoin } from "@/lib/crypto/service";
import { fetchSentimentIntelligence } from "@/lib/crypto/sentiment-engine";

export const dynamic = "force-dynamic";

/**
 * Phase 4 — Crypto Sentiment + Divergence
 * GET /api/v1/crypto/[symbol]/sentiment-intel
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
    let name: string | null = null;
    let change24h: number | null = null;
    try {
      const detail = await getCryptoCoin(base);
      name = detail?.coin.name ?? null;
      change24h =
        detail?.price?.change24h != null ? Number(detail.price.change24h) : null;
    } catch {
      /* ignore */
    }

    const data = await fetchSentimentIntelligence(base, { name, change24h });
    const response = ok(data, {
      timezone: "Asia/Ho_Chi_Minh",
      source: data.scoringSource,
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=180",
    );
    return response;
  } catch (e) {
    return handleError(e, `crypto_sentiment_intel:${base}`);
  }
}
