import { handleError, ok } from "@/lib/api";
import { getForexHealthReport } from "@/lib/forex/observability";
import { getDbHealth } from "@/db";
import { buildMacroContextLive } from "@/lib/forex/macro";
import {
  recordProviderError,
  recordProviderSuccess,
  withProviderTiming,
} from "@/lib/forex/observability";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Light probe: macro calendar (records provider metrics)
    const t0 = Date.now();
    try {
      await withProviderTiming("macro-calendar", () =>
        buildMacroContextLive("EURUSD"),
      );
    } catch (err) {
      recordProviderError(
        "macro-calendar",
        err instanceof Error ? err.message : String(err),
        Date.now() - t0,
      );
    }

    const report = getForexHealthReport();
    const db = getDbHealth();

    return ok(
      {
        ...report,
        database: {
          status: db.status,
          lastLatencyMs: db.lastLatencyMs,
          lastError: db.lastError,
        },
      },
      { source: "forex-health" },
    );
  } catch (err) {
    return handleError(err, "forex_health");
  }
}
