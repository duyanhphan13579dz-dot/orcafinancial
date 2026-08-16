import { NextRequest } from "next/server";
import { desc, sql } from "drizzle-orm";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { db } from "@/db";
import { exchangeRates } from "@/db/schema";
import { safeDbQuery } from "@/lib/connectors/core";
import { getIngestHistory, getLastIngest } from "@/lib/commodities/ingest";
import { getCommodityScannerStatus } from "@/lib/commodities/scheduler";
import { getPrimarySource, getSecondarySource } from "@/lib/commodities/sources";
import { vnLabel } from "@/lib/commodities/time";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/commodities/sources/status
 *
 * Live health of both data sources, which one is currently authoritative,
 * scanner statistics, FX freshness, and per-source row counts in storage.
 */
export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 120);
  if (limited) return limited;

  try {
    const last = getLastIngest();
    const history = getIngestHistory(10);

    // How many stored snapshots came from each source (last 24h).
    const bySource = await safeDbQuery("rows_by_source", () =>
      db.execute(sql`
        SELECT source, count(*)::int AS rows, max(date) AS latest
        FROM commodity_prices
        WHERE date > NOW() - INTERVAL '24 hours'
        GROUP BY source
        ORDER BY rows DESC
      `),
    ).catch(() => ({ rows: [] as unknown[] }));

    const fx = await safeDbQuery("fx_latest", () =>
      db
        .select({
          currency: exchangeRates.currency,
          rate: exchangeRates.rate,
          source: exchangeRates.source,
          date: exchangeRates.date,
        })
        .from(exchangeRates)
        .orderBy(desc(exchangeRates.date))
        .limit(12),
    ).catch(() => []);

    // Collapse to the newest rate per currency.
    const fxLatest = new Map<string, (typeof fx)[number]>();
    for (const r of fx) if (!fxLatest.has(r.currency)) fxLatest.set(r.currency, r);

    return ok({
      policy: {
        rule: "single-source-per-cycle",
        description:
          "Cả hai nguồn được quét liên tục để theo dõi tình trạng, nhưng mỗi lần lưu chỉ dùng dữ liệu từ MỘT nguồn. Không trung bình cộng.",
        primary: getPrimarySource(),
        secondary: getSecondarySource(),
      },
      currentAuthority: last?.source ?? null,
      lastCycle: last,
      recentCycles: history,
      scanner: getCommodityScannerStatus(),
      storageBySource: (bySource as { rows: unknown[] }).rows,
      exchangeRates: [...fxLatest.values()],
      vnTime: vnLabel(),
    });
  } catch (err) {
    return handleError(err, "commodity_sources_status");
  }
}
