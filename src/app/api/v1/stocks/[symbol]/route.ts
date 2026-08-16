import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getCompany, getQuote } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

  try {
    const [quote, company] = await Promise.all([getQuote(symbol), getCompany(symbol)]);
    return ok(
      { quote, company },
      { source: quote.source, confidence: quote.confidence },
    );
  } catch (err) {
    return handleError(err, `stock:${symbol}`);
  }
}
