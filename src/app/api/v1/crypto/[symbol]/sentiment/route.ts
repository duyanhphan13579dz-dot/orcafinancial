import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { getLatestCryptoSentiment } from "@/lib/crypto/service";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ symbol: string }> },
) {
  const limited = checkRateLimit(req, 60);
  if (limited) return limited;
  const { symbol } = await ctx.params;
  try {
    const data = await getLatestCryptoSentiment(symbol.toUpperCase());
    return ok(
      { symbol: symbol.toUpperCase(), ...data },
      {
        source:
          typeof data === "object" && data && "source" in data && data.source
            ? String(data.source)
            : "coindesk+cointelegraph-rss",
      },
      { cacheSeconds: 60 },
    );
  } catch (err) {
    return handleError(err, `crypto_sentiment:${symbol}`);
  }
}
