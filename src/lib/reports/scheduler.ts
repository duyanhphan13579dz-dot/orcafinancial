/**
 * ORCA reports scheduler (v3) — Unlimited Retry & Correct Time Mapping.
 */

import {
  generateMarketSummary,
  generateMorningBrief,
  getStoredReport,
  isVnWeekday,
  vnTodayKey,
} from "./generator";
import { forProvider } from "@/lib/logger";

const log = forProvider("reports-scheduler-v3");

interface JobSpec {
  type: "morning" | "summary";
  targetVn: { hh: number; mm: number };
  run: (d: Date) => Promise<{ persisted?: boolean; html?: string }>;
}

const JOBS: JobSpec[] = [
  {
    type: "morning",
    targetVn: { hh: 7, mm: 30 },
    run: (d) => generateMorningBrief(d),
  },
  {
    type: "summary",
    targetVn: { hh: 15, mm: 15 },
    run: (d) => generateMarketSummary(d),
  },
];

interface JobRuntime {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  attemptsToday: number;
  successesToday: number;
  todayKey: string | null;
  nextRetryAt: number | null;
}

const globalForSched = globalThis as typeof globalThis & {
  __orcaReportsStartedV3?: boolean;
  __orcaReportsRuntimeV3?: Record<string, JobRuntime>;
  __orcaReportsLastTickAtV3?: string | null;
  __orcaReportsTickCountV3?: number;
};

if (!globalForSched.__orcaReportsRuntimeV3) {
  globalForSched.__orcaReportsRuntimeV3 = {
    morning: emptyRuntime(),
    summary: emptyRuntime(),
  };
}
if (globalForSched.__orcaReportsLastTickAtV3 === undefined) {
  globalForSched.__orcaReportsLastTickAtV3 = null;
}
if (globalForSched.__orcaReportsTickCountV3 === undefined) {
  globalForSched.__orcaReportsTickCountV3 = 0;
}

function emptyRuntime(): JobRuntime {
  return {
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    attemptsToday: 0,
    successesToday: 0,
    todayKey: null,
    nextRetryAt: null,
  };
}

function vnNow(): { hh: number; mm: number; key: string; weekday: number } {
  const d = new Date();
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000;
  const vn = new Date(utcMs + 7 * 60 * 60_000);
  return {
    hh: vn.getUTCHours(),
    mm: vn.getUTCMinutes(),
    key: `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, "0")}-${String(vn.getUTCDate()).padStart(2, "0")}`,
    weekday: vn.getUTCDay(),
  };
}

const TICK_MS = 60_000;
const RETRY_DELAY_MS = 5 * 60_000;

async function tick() {
  globalForSched.__orcaReportsLastTickAtV3 = new Date().toISOString();
  globalForSched.__orcaReportsTickCountV3 =
    (globalForSched.__orcaReportsTickCountV3 ?? 0) + 1;
  const now = vnNow();
  const runtime = globalForSched.__orcaReportsRuntimeV3!;

  for (const spec of JOBS) {
    const r = runtime[spec.type];
    if (r.todayKey !== now.key) {
      r.todayKey = now.key;
      r.attemptsToday = 0;
      r.successesToday = 0;
      r.lastError = null;
      r.nextRetryAt = null;
    }
  }

  if (!isVnWeekday()) return;

  const nowMinutes = now.hh * 60 + now.mm;

  for (const spec of JOBS) {
    const r = runtime[spec.type];
    if (r.successesToday > 0) continue;

    const existing = await getStoredReport(spec.type, now.key).catch(() => null);
    if (existing) {
      r.successesToday = 1;
      continue;
    }

    const targetMinutes = spec.targetVn.hh * 60 + spec.targetVn.mm;
    if (nowMinutes < targetMinutes) continue;
    if (r.nextRetryAt && Date.now() < r.nextRetryAt) continue;

    r.lastAttemptAt = new Date().toISOString();
    r.attemptsToday += 1;
    log.info("report_job_attempt", {
      type: spec.type,
      date: now.key,
      attempt: r.attemptsToday,
    });

    try {
      const res = await spec.run(new Date());
      const verified = await getStoredReport(spec.type, now.key).catch(() => null);
      // Success if DB row exists OR generator returned HTML (memory fallback)
      if (!verified && !(res?.html && res.html.length > 100)) {
        throw new Error("generation completed but no content available");
      }

      r.successesToday = 1;
      r.lastSuccessAt = new Date().toISOString();
      r.lastError = null;
      r.nextRetryAt = null;
      log.info("report_job_success", {
        type: spec.type,
        date: now.key,
        attempt: r.attemptsToday,
        persisted: res?.persisted ?? Boolean(verified),
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      r.lastError = errMsg;
      r.nextRetryAt = Date.now() + RETRY_DELAY_MS;
      log.warn("report_job_failed_will_retry", {
        type: spec.type,
        date: now.key,
        attempt: r.attemptsToday,
        nextRetryInMin: 5,
        error: errMsg,
      });
      if (r.attemptsToday >= 10) {
        log.critical("report_job_excessive_failures", {
          type: spec.type,
          date: now.key,
          attempts: r.attemptsToday,
          lastError: errMsg,
        });
      }
    }
  }
}

export function startReportScheduler() {
  if (globalForSched.__orcaReportsStartedV3) return;
  globalForSched.__orcaReportsStartedV3 = true;
  log.info("scheduler_started_v3", { tickMs: TICK_MS, retryDelayMs: RETRY_DELAY_MS });
  setTimeout(() => void tick(), 4_000);
  setInterval(() => void tick(), TICK_MS);
}

export function getSchedulerStatus() {
  const now = vnNow();
  const runtime = globalForSched.__orcaReportsRuntimeV3!;
  const jobs: Record<string, unknown> = {};
  for (const spec of JOBS) {
    const r = runtime[spec.type];
    const targetMin = spec.targetVn.hh * 60 + spec.targetVn.mm;
    const nowMin = now.hh * 60 + now.mm;
    const diff = targetMin - nowMin;
    jobs[spec.type] = {
      ...r,
      target: `${String(spec.targetVn.hh).padStart(2, "0")}:${String(spec.targetVn.mm).padStart(2, "0")}`,
      minutesUntilTarget: diff > 0 ? diff : null,
      isTimeReached: nowMin >= targetMin,
      nextRetryInSec: r.nextRetryAt
        ? Math.max(0, Math.round((r.nextRetryAt - Date.now()) / 1000))
        : null,
    };
  }
  return {
    started: !!globalForSched.__orcaReportsStartedV3,
    version: "v3-unlimited-retry",
    tickMs: TICK_MS,
    maxRetry: 999,
    lastTickAt: globalForSched.__orcaReportsLastTickAtV3 ?? null,
    tickCount: globalForSched.__orcaReportsTickCountV3 ?? 0,
    vnNow: { ...now, isWeekday: isVnWeekday() },
    jobs,
  };
}
