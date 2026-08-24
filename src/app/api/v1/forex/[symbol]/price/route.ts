import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import {
  ensureForexFresh,
  getForexPair,
  getLiveQuoteContract,
} from "@/lib/forex/service";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  c: { params: Promise<{ symbol: string }> },
) {
  const l = checkRateLimit(req, 180);
  if (l) return l;
  const { symbol } = await c.params;
  const sym = symbol.toUpperCase();

  try {
    void ensureForexFresh(5_000).catch(() => undefined);

    const [quote, detail] = await Promise.all([
      getLiveQuoteContract(sym),
      getForexPair(sym),
    ]);

    if (!quote && !detail?.price) {
      return fail("Price unavailable", 404);
    }

    // Primary: Data Contract. Legacy `price` nested for older clients.
    return ok(
      {
        pair: detail?.pair ?? {
          symbol: sym,
          name: quote?.name ?? sym,
          category: quote?.category ?? "usd_cross",
          baseCurrency: quote?.baseCurrency ?? "",
          quoteCurrency: quote?.quoteCurrency ?? "",
        },
        quote,
        price: quote
          ? {
              price: quote.price,
              bid: quote.bid,
              ask: quote.ask,
              change: quote.change,
              changePercent: quote.changePercent,
              source: quote.source,
              timestamp: quote.timestamp,
              spread: quote.spread,
              spreadPips: quote.spreadPips,
              freshness: quote.freshness,
              ageMs: quote.ageMs,
            }
          : detail?.price,
        freshness: quote
          ? {
              state: quote.freshness,
              ageMs: quote.ageMs,
              timestamp: quote.timestamp,
              source: quote.source,
            }
          : { state: "OFFLINE" as const },
      },
      { timezone: "Asia/Ho_Chi_Minh", source: quote?.source },
      { cacheSeconds: 5 },
    );
  } catch (e) {
    return handleError(e, `forex_price:${symbol}`);
  }
}
