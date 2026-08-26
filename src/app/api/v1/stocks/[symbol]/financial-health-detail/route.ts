import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { ensureQuarterlyFinancials } from "@/lib/company-service";
import { evaluateHealthDetail } from "@/lib/financial-health-detail";
import { buildFinancialPeriodSet } from "@/lib/stock-intelligence/canonical";
import { validateFinancialQuarters } from "@/lib/stock-intelligence/validation";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

  try {
    const qs = await ensureQuarterlyFinancials(symbol, 2);
    const detail = evaluateHealthDetail(symbol, qs);
    const validation = validateFinancialQuarters(qs);
    const financialPeriod = buildFinancialPeriodSet(qs.map((quarter) => quarter.period));
    return ok(detail, { source: "sector-synthetic-v1", kind: "estimate", currentStatePeriod: financialPeriod?.latestQuarter.label.replace(/A$/, "E") ?? null, quartersUsed: qs.length, validation }, { cacheSeconds: 300 });
  } catch (err) {
    return handleError(err, `financial-health-detail:${symbol}`);
  }
}
