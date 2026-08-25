import { renderForexPrometheusMetrics } from "@/lib/forex/prometheus";
import { getDbHealth } from "@/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/metrics — aggregate Prometheus metrics (forex + db).
 */
export async function GET() {
  const forex = renderForexPrometheusMetrics().replace(/# EOF\n?$/, "");
  const db = getDbHealth();
  const dbStatus =
    db.status === "up" ? 2 : db.status === "degraded" ? 1 : db.status === "down" ? 0 : -1;

  const extra = [
    "# HELP orca_db_up 1 if database is up",
    "# TYPE orca_db_up gauge",
    `orca_db_up ${db.status === "up" ? 1 : 0}`,
    "# HELP orca_db_status 2=up 1=degraded 0=down -1=unknown",
    "# TYPE orca_db_status gauge",
    `orca_db_status ${dbStatus}`,
    "# HELP orca_db_latency_last_ms Last DB ping latency",
    "# TYPE orca_db_latency_last_ms gauge",
    `orca_db_latency_last_ms ${db.lastLatencyMs ?? 0}`,
    "# HELP orca_db_consecutive_failures Consecutive failed DB pings",
    "# TYPE orca_db_consecutive_failures gauge",
    `orca_db_consecutive_failures ${db.consecutiveFailures}`,
    "# EOF",
  ].join("\n");

  return new Response(`${forex}${extra}\n`, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
