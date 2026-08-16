import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { ingestCycle } from "@/lib/commodities/ingest";
import { initializeCommodities, initializeStockImpacts } from "@/lib/commodities/service";
import { getCommodityScannerStatus } from "@/lib/commodities/scheduler";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/commodities/refresh
 *
 * Forces one ingestion cycle immediately instead of waiting for the scanner.
 * Both sources are probed; data from exactly one of them is persisted.
 */
export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 20);
  if (limited) return limited;

  try {
    await initializeCommodities();
    await initializeStockImpacts();

    const result = await ingestCycle({ force: true });

    return ok(
      {
        success: result.ok,
        selectedSource: result.source,
        reason: result.reason,
        quotesReceived: result.quotesReceived,
        rowsWritten: result.rowsWritten,
        rowsChanged: result.rowsChanged,
        vnTime: result.vnTime,
        durationMs: result.durationMs,
        probes: result.probes,
        scanner: getCommodityScannerStatus(),
      },
      { source: result.source ?? "none" },
    );
  } catch (err) {
    return handleError(err, "commodities_refresh");
  }
}
