import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { buildFundamentalChart } from "@/lib/fundamental-chart";
import { loadPreferredQuarterlyFinancials } from "@/lib/financial-ingestion";
import { loadLiveQuarterlyFinancials } from "@/lib/connectors/live-financials-server";
import { evaluateHealthDetail } from "@/lib/financial-health-detail";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  const { symbol: raw } = await ctx.params;
  const symbol = raw.toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) return fail("Invalid symbol", 400);

  try {
    // Prefer already-ingested & verified DB rows; they are the most trustworthy.
    const preferred = await loadPreferredQuarterlyFinancials(symbol, 4);
    let qs = preferred.quarters;
    const warnings = [...preferred.warnings];

    // When the DB has no verified rows yet, fetch live from the company feeds
    // (vnstock → VNDirect → Vietstock). Server has outbound internet on prod, so
    // this keeps the "Cơ bản" tab populated even before the ingestion cron runs.
    if (qs.length === 0) {
      const live = await loadLiveQuarterlyFinancials(symbol, 4);
      qs = live.quarters;
      warnings.push(...live.warnings);
    }

    const health = evaluateHealthDetail(symbol, qs);
    const chart = buildFundamentalChart(symbol, qs, health);
    return ok(
      chart,
      {
        source: preferred.providerBacked ? preferred.source : "live",
        providerBacked: preferred.providerBacked || qs.length > 0,
        warnings,
        quarters: qs.length,
      },
      { cacheSeconds: 300 },
    );
  } catch (err) {
    return handleError(err, `fundamental-chart:${symbol}`);
  }
}
