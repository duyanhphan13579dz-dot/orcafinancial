import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { buildFundamentalChart } from "@/lib/fundamental-chart";
import { ensureQuarterlyFinancials } from "@/lib/company-service";
import { evaluateHealthDetail } from "@/lib/financial-health-detail";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

  try {
    const qs = await ensureQuarterlyFinancials(symbol, 4);
    const health = evaluateHealthDetail(symbol, qs);
    const chart = buildFundamentalChart(symbol, qs, health);
    return ok(chart, { source: "fundamental-chart-service", quarters: qs.length });
  } catch (err) {
    return handleError(err, `fundamental-chart:${symbol}`);
  }
}
