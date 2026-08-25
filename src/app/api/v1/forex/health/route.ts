import { handleError, ok } from "@/lib/api";
import {
  getForexHealthReport,
  withProviderTiming,
} from "@/lib/forex/observability";
import { getDbHealth } from "@/db";
import { buildMacroContextLive } from "@/lib/forex/macro";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    try {
      await withProviderTiming("macro-calendar", () =>
        buildMacroContextLive("EURUSD"),
      );
    } catch {
      /* recorded inside withProviderTiming */
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
