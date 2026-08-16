import { desc } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { connectorAlerts, jobLogs } from "@/db/schema";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { allBreakerStatuses, getStaleFlags, recentLogs, safeDbQuery } from "@/lib/connectors/core";
import { listOpenAlerts, listRecentAlerts, listAlertsFromDb } from "@/lib/alerts";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const REGISTRY = [
  { name: "vndirect-dchart", priority: 1, role: "primary", capabilities: ["history", "quotes", "indices", "search"] },
  { name: "yahoo-finance", priority: 2, role: "fallback", capabilities: ["history", "quotes"] },
  { name: "coingecko", priority: 3, role: "crypto-primary", capabilities: ["crypto-prices"] },
  { name: "binance-vision", priority: 4, role: "crypto-fallback", capabilities: ["crypto-prices"] },
  { name: "vnexpress-rss", priority: 5, role: "news", capabilities: ["news", "sentiment"] },
  { name: "cafef-rss", priority: 6, role: "news", capabilities: ["news", "sentiment"] },
  { name: "vietstock-rss", priority: 7, role: "news", capabilities: ["news", "sentiment"] },
  { name: "fundamental-engine", priority: 0, role: "module", capabilities: ["financial-health", "eps", "roe", "dupont", "dcf", "graham", "ddm", "reverse-dcf"] },
  { name: "technical-engine", priority: 0, role: "module", capabilities: ["candlestick-patterns", "chart-patterns", "h&s", "double-top", "cup-handle"] },
  { name: "sentiment-nlp", priority: 0, role: "module", capabilities: ["vietnamese-sentiment", "news-scoring"] },
];

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req);
  if (limited) return limited;
  try {
    const breakers = allBreakerStatuses();
    const staleFlags = getStaleFlags();
    const openAlerts = listOpenAlerts();
    const recentAlertsMem = listRecentAlerts(30);

    // DB alerts (last 50)
    const dbAlerts = await listAlertsFromDb(50).catch(() => []);

    // Recent logs per provider (last 10 each for connectors that have been called)
    const logsByProvider: Record<string, ReturnType<typeof recentLogs>> = {};
    for (const b of breakers) {
      logsByProvider[b.name] = recentLogs({ provider: b.name, limit: 10 });
    }
    // Also include any logs without provider tag (e.g. DB errors)
    logsByProvider["_system"] = recentLogs({ limit: 20 });

    // Recent job logs
    const recentJobs = await safeDbQuery(
      "admin_job_logs",
      () => db.select().from(jobLogs).orderBy(desc(jobLogs.createdAt)).limit(30),
      { attempts: 2 },
    ).catch((err) => {
      logger.error("admin_jobs_query_failed", { error: String(err) });
      return [];
    });

    const connectors = REGISTRY.map((c) => {
      const b = breakers.find((x) => x.name === c.name);
      return {
        ...c,
        circuit: b ?? {
          name: c.name,
          state: "closed",
          status: "UP",
          consecutiveFailures: 0,
          lastError: null,
          lastErrorClass: null,
          lastSuccessAt: null,
          lastAttemptAt: null,
          lastDownAt: null,
          cumulativeDowntimeMs: 0,
          uptimeMs: 0,
          totalCalls: 0,
          totalSuccesses: 0,
          totalFailures: 0,
          successRate: 1,
          startedAt: null,
          threshold: 0,
          cooldownMs: 0,
        },
        recentLogs: logsByProvider[c.name] ?? [],
      };
    });

    return ok({
      connectors,
      staleFlags,
      openAlerts,
      recentAlerts: recentAlertsMem,
      dbAlerts,
      recentJobs,
      systemLogs: logsByProvider["_system"],
      config: {
        circuitBreakerThreshold: process.env.CIRCUIT_BREAKER_THRESHOLD ?? "5",
        circuitBreakerTimeoutMs: process.env.CIRCUIT_BREAKER_TIMEOUT ?? "60000",
        retryAttempts: process.env.CONNECTOR_RETRY_ATTEMPTS ?? "3",
        retryBaseMs: process.env.CONNECTOR_RETRY_BASE_MS ?? "1000",
        fetchTimeoutMs: process.env.CONNECTOR_FETCH_TIMEOUT_MS ?? "10000",
        staleAfterMs: process.env.CONNECTOR_STALE_AFTER_MS ?? "900000",
        degradedAfterMs: process.env.CONNECTOR_DEGRADED_AFTER_MS ?? "300000",
        alertAfterMs: process.env.CONNECTOR_ALERT_AFTER_MS ?? "300000",
        slackWebhookConfigured: Boolean(process.env.SLACK_WEBHOOK_URL),
      },
    });
  } catch (err) {
    return handleError(err, "admin_connectors");
  }
}
