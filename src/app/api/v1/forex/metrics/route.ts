import { renderForexPrometheusMetrics } from "@/lib/forex/prometheus";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/forex/metrics
 * Prometheus text exposition for Grafana scraping.
 */
export async function GET() {
  const body = renderForexPrometheusMetrics();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
