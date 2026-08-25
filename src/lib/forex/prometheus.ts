/**
 * Prometheus text exposition for Forex observability metrics.
 * Scraped by Prometheus → Grafana dashboards.
 */

import { getForexHealthReport } from "./observability";

function escLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function statusCode(s: string): number {
  if (s === "healthy") return 2;
  if (s === "degraded") return 1;
  if (s === "down") return 0;
  return -1;
}

/** OpenMetrics / Prometheus 0.0.4 text format. */
export function renderForexPrometheusMetrics(): string {
  const h = getForexHealthReport();
  const lines: string[] = [];

  const help = (name: string, text: string) => {
    lines.push(`# HELP ${name} ${text}`);
    lines.push(`# TYPE ${name} gauge`);
  };

  help("orca_forex_up", "1 if forex engine overall is not down");
  lines.push(`orca_forex_up ${h.overall === "down" ? 0 : 1}`);

  help("orca_forex_status", "Component status: 2=healthy 1=degraded 0=down -1=unknown");
  lines.push(
    `orca_forex_status{component="overall"} ${statusCode(h.overall)}`,
  );
  for (const [k, v] of Object.entries(h.components)) {
    lines.push(`orca_forex_status{component="${escLabel(k)}"} ${statusCode(v)}`);
  }

  help("orca_forex_uptime_seconds", "Process metrics uptime");
  lines.push(`orca_forex_uptime_seconds ${Math.round(h.uptimeMs / 1000)}`);

  help("orca_forex_provider_success_total", "Provider success count");
  lines.push("# TYPE orca_forex_provider_success_total counter");
  for (const p of h.providers) {
    lines.push(
      `orca_forex_provider_success_total{provider="${escLabel(p.name)}"} ${p.success}`,
    );
  }

  help("orca_forex_provider_error_total", "Provider error count");
  lines.push("# TYPE orca_forex_provider_error_total counter");
  for (const p of h.providers) {
    lines.push(
      `orca_forex_provider_error_total{provider="${escLabel(p.name)}"} ${p.error}`,
    );
  }

  help("orca_forex_provider_success_rate", "Provider success rate percent 0-100");
  for (const p of h.providers) {
    if (p.successRate != null) {
      lines.push(
        `orca_forex_provider_success_rate{provider="${escLabel(p.name)}"} ${p.successRate}`,
      );
    }
  }

  help("orca_forex_provider_latency_avg_ms", "Average provider latency ms");
  for (const p of h.providers) {
    if (p.avgLatencyMs != null) {
      lines.push(
        `orca_forex_provider_latency_avg_ms{provider="${escLabel(p.name)}"} ${p.avgLatencyMs}`,
      );
    }
  }

  help("orca_forex_provider_latency_last_ms", "Last provider latency ms");
  for (const p of h.providers) {
    if (p.lastLatencyMs != null) {
      lines.push(
        `orca_forex_provider_latency_last_ms{provider="${escLabel(p.name)}"} ${p.lastLatencyMs}`,
      );
    }
  }

  help("orca_forex_cache_hits_total", "Cache hits");
  lines.push("# TYPE orca_forex_cache_hits_total counter");
  for (const c of h.caches) {
    lines.push(
      `orca_forex_cache_hits_total{cache="${escLabel(c.name)}"} ${c.hits}`,
    );
  }

  help("orca_forex_cache_misses_total", "Cache misses");
  lines.push("# TYPE orca_forex_cache_misses_total counter");
  for (const c of h.caches) {
    lines.push(
      `orca_forex_cache_misses_total{cache="${escLabel(c.name)}"} ${c.misses}`,
    );
  }

  help("orca_forex_cache_hit_rate", "Cache hit rate percent");
  for (const c of h.caches) {
    if (c.hitRate != null) {
      lines.push(
        `orca_forex_cache_hit_rate{cache="${escLabel(c.name)}"} ${c.hitRate}`,
      );
    }
  }

  help("orca_forex_analysis_success_rate", "Analysis success rate percent");
  if (h.analysis.successRate != null) {
    lines.push(`orca_forex_analysis_success_rate ${h.analysis.successRate}`);
  }

  help("orca_forex_analysis_latency_avg_ms", "Analysis average latency ms");
  if (h.analysis.avgLatencyMs != null) {
    lines.push(`orca_forex_analysis_latency_avg_ms ${h.analysis.avgLatencyMs}`);
  }

  help("orca_forex_analysis_latency_last_ms", "Analysis last latency ms");
  if (h.analysis.lastLatencyMs != null) {
    lines.push(`orca_forex_analysis_latency_last_ms ${h.analysis.lastLatencyMs}`);
  }

  help("orca_forex_ohlcv_freshness_avg_ms", "Average OHLCV age sample ms");
  if (h.ohlcv.avgFreshnessMs != null) {
    lines.push(`orca_forex_ohlcv_freshness_avg_ms ${h.ohlcv.avgFreshnessMs}`);
  }

  help("orca_forex_ohlcv_freshness_max_ms", "Max OHLCV age sample ms");
  if (h.ohlcv.maxFreshnessMs != null) {
    lines.push(`orca_forex_ohlcv_freshness_max_ms ${h.ohlcv.maxFreshnessMs}`);
  }

  lines.push("# EOF");
  return lines.join("\n") + "\n";
}
