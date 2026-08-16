import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getSwot } from "@/lib/company-service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req, 20);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

  try {
    const swot = await getSwot(symbol, true);
    return ok({ symbol, swot, regenerated: true }, { source: "rule-based-swot-engine" });
  } catch (err) {
    return handleError(err, `swot-generate:${symbol}`);
  }
}
