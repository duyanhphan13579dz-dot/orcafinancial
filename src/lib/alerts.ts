/**
 * Operational alert dispatcher.
 *
 * - Watches connector circuit breakers on an interval (default 60s).
 * - If a connector has been DOWN for more than `alertAfterMs` (default 5 min),
 *   fires a CRITICAL log and optionally a Slack webhook (env `SLACK_WEBHOOK_URL`).
 * - Keeps an in-memory ring of dispatched alerts and persists every dispatch
 *   to the `connector_alerts` table for the admin dashboard timeline.
 * - Alerts auto-resolve when the connector returns to UP.
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { connectorAlerts } from "@/db/schema";
import { allBreakerStatuses, safeDbQuery } from "@/lib/connectors/core";
import { logger } from "@/lib/logger";

interface DispatchedAlert {
  id?: number;
  provider: string;
  level: "DOWN" | "DEGRADED" | "RECOVERED";
  message: string;
  dispatchedAt: Date;
  resolvedAt: Date | null;
  slackOk: boolean | null;
}

const globalForAlerts = globalThis as typeof globalThis & {
  __orcaAlertsStarted?: boolean;
  __orcaOpenAlerts?: Map<string, DispatchedAlert>;
  __orcaRecentAlerts?: DispatchedAlert[];
};
if (!globalForAlerts.__orcaOpenAlerts) globalForAlerts.__orcaOpenAlerts = new Map();
if (!globalForAlerts.__orcaRecentAlerts) globalForAlerts.__orcaRecentAlerts = [];
const openAlerts = globalForAlerts.__orcaOpenAlerts;
const recentAlerts = globalForAlerts.__orcaRecentAlerts!;
const RECENT_CAP = 100;

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

const ALERT_AFTER_MS = envInt("CONNECTOR_ALERT_AFTER_MS", 5 * 60_000);
const TICK_MS = envInt("CONNECTOR_ALERT_TICK_MS", 60_000);

async function sendSlack(payload: { provider: string; level: string; message: string; since: string }) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `[ORCA] ${payload.level} — ${payload.provider}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${payload.level}* — \`${payload.provider}\`\n${payload.message}\n_Since ${payload.since}_`,
            },
          },
        ],
      }),
    });
    return res.ok;
  } catch (err) {
    logger.warn("slack_dispatch_failed", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

async function persistAlert(alert: DispatchedAlert): Promise<number | null> {
  try {
    return await safeDbQuery("alerts_insert", async () => {
      const res = await db
        .insert(connectorAlerts)
        .values({
          provider: alert.provider,
          level: alert.level,
          message: alert.message,
          dispatchedAt: alert.dispatchedAt,
          resolvedAt: alert.resolvedAt,
          slackOk: alert.slackOk,
        })
        .returning({ id: connectorAlerts.id });
      return res[0]?.id ?? null;
    });
  } catch (err) {
    logger.error("alert_persist_failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function persistResolved(id: number, resolvedAt: Date) {
  try {
    await safeDbQuery("alerts_resolve", () =>
      db.update(connectorAlerts).set({ resolvedAt }).where(eq(connectorAlerts.id, id)),
    );
  } catch (err) {
    logger.error("alert_resolve_persist_failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

function pushRecent(a: DispatchedAlert) {
  recentAlerts.unshift(a);
  if (recentAlerts.length > RECENT_CAP) recentAlerts.length = RECENT_CAP;
}

async function tick() {
  const now = Date.now();
  const statuses = allBreakerStatuses();
  for (const s of statuses) {
    const downSince = s.lastDownAt ? new Date(s.lastDownAt).getTime() : null;
    const isDown = s.status === "DOWN";
    const downFor = downSince && isDown ? now - downSince : 0;
    const open = openAlerts.get(s.name);

    if (isDown && downFor >= ALERT_AFTER_MS && !open) {
      const msg = `Connector ${s.name} đã DOWN ${Math.round(downFor / 1000)}s. Lỗi cuối: ${s.lastError ?? "n/a"} (${s.lastErrorClass ?? "?"}). Ngưỡng ${s.threshold} lần thất bại liên tiếp.`;
      const alert: DispatchedAlert = {
        provider: s.name,
        level: "DOWN",
        message: msg,
        dispatchedAt: new Date(),
        resolvedAt: null,
        slackOk: null,
      };
      logger.critical("connector_down_alert", { provider: s.name, downForMs: downFor, lastError: s.lastError });
      const slack = await sendSlack({
        provider: s.name,
        level: "DOWN",
        message: msg,
        since: new Date(downSince!).toISOString(),
      });
      alert.slackOk = slack;
      const id = await persistAlert(alert);
      if (id) alert.id = id;
      openAlerts.set(s.name, alert);
      pushRecent(alert);
    } else if (!isDown && open) {
      // Recovery
      const recovered: DispatchedAlert = {
        provider: s.name,
        level: "RECOVERED",
        message: `Connector ${s.name} đã khôi phục (UP). Uptime hiện tại ${(s.uptimeMs / 1000).toFixed(0)}s. Success rate ${(s.successRate * 100).toFixed(1)}%.`,
        dispatchedAt: new Date(),
        resolvedAt: new Date(),
        slackOk: null,
      };
      logger.info("connector_recovered", {
        provider: s.name,
        downtimeMs: s.cumulativeDowntimeMs,
        successRate: s.successRate,
      });
      const slack = await sendSlack({
        provider: s.name,
        level: "RECOVERED",
        message: recovered.message,
        since: new Date().toISOString(),
      });
      recovered.slackOk = slack;
      if (open.id) await persistResolved(open.id, recovered.dispatchedAt);
      await persistAlert(recovered);
      openAlerts.delete(s.name);
      pushRecent(recovered);
    }
  }
}

export function startAlertDispatcher() {
  if (globalForAlerts.__orcaAlertsStarted) return;
  globalForAlerts.__orcaAlertsStarted = true;
  logger.info("alert_dispatcher_started", { tickMs: TICK_MS, alertAfterMs: ALERT_AFTER_MS });
  setTimeout(tick, 5_000);
  setInterval(tick, TICK_MS);
}

export function listOpenAlerts(): DispatchedAlert[] {
  return [...openAlerts.values()];
}

export function listRecentAlerts(limit = 50): DispatchedAlert[] {
  return recentAlerts.slice(0, limit);
}

export async function listAlertsFromDb(limit = 100): Promise<
  Array<{
    id: number;
    provider: string;
    level: string;
    message: string;
    dispatchedAt: Date;
    resolvedAt: Date | null;
    slackOk: boolean | null;
  }>
> {
  try {
    const rows = await safeDbQuery("alerts_list", () =>
      db
        .select({
          id: connectorAlerts.id,
          provider: connectorAlerts.provider,
          level: connectorAlerts.level,
          message: connectorAlerts.message,
          dispatchedAt: connectorAlerts.dispatchedAt,
          resolvedAt: connectorAlerts.resolvedAt,
          slackOk: connectorAlerts.slackOk,
        })
        .from(connectorAlerts)
        .orderBy(desc(connectorAlerts.dispatchedAt))
        .limit(limit),
    );
    return rows;
  } catch {
    return [];
  }
}
