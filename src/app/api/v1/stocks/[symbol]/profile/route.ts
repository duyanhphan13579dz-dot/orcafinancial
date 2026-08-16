import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getProfile, getSwot } from "@/lib/company-service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

  try {
    const [profile, swot] = await Promise.all([
      getProfile(symbol),
      getSwot(symbol).catch((err) => {
        return null as null | Awaited<ReturnType<typeof getSwot>>;
      }),
    ]);
    return ok({ profile, swot }, { source: "rule-based-profiler", confidence: 0.7 });
  } catch (err) {
    return handleError(err, `profile:${symbol}`);
  }
}
