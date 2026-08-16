import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getValueChain } from "@/lib/company-service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

  const force = req.nextUrl.searchParams.get("refresh") === "1";
  try {
    const chain = await getValueChain(symbol, force);
    return ok({ symbol, ...chain }, { source: `value-chain (${chain.modelVersion})`, cached: !force });
  } catch (err) {
    return handleError(err, `value-chain:${symbol}`);
  }
}
