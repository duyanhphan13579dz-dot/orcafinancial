import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { startIngestCycle } from "@/lib/commodities/ingest";
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
    // Never hold the HTTP request open while scraping upstream HTML. The
    // scheduler and the shared promise below coalesce concurrent refreshes.
    void startIngestCycle({ force: true }).catch(() => undefined);
    return ok(
      {
        accepted: true,
        running: true,
        message: "Đã bắt đầu làm mới dữ liệu ở chế độ nền.",
        scanner: getCommodityScannerStatus(),
      },
      { source: "commodities-engine" },
    );
  } catch (err) {
    return handleError(err, "commodities_refresh");
  }
}
