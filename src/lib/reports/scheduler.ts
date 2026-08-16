/**
 * ORCA reports scheduler (v3) — Unlimited Retry & Correct Time Mapping.
 *
 * Requirements:
 * 1. Morning Brief at 07:30 AM (VN local time, UTC+7).
 * 2. Market Summary at 15:15 PM (VN local time, UTC+7).
 * 3. Unlimited retry every 5 minutes (300,000ms) until successful for the current trading day.
 * 4. Correct service mapping: morning-brief calls generateMorningBrief, market-summary calls generateMarketSummary.
 * 5. Robust logging and alert escalation if retries exceed 10 attempts.
 */

import { generateMarketSummary, generateMorningBrief, getStoredReport, isVnWeekday, vnTodayKey } from "./generator";
import { forProvider, logger } from "@/lib/logger";

const log = forProvider("reports-scheduler-v3");

interface JobSpec {
  type: "morning" | "summary";
  targetVn: { hh: number; mm: number };
  run: (d: Date) => Promise<unknown>;
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
if (globalForSched.__orcaReportsLastTickAtV3 === undefined) globalForSched.__orcaReportsLastTickAtV3 = null;
if (globalForSched.__orcaReportsTickCountV3 === undefined) globalForSched.__orcaReportsTickCountV3 = 0;

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

const TICK_MS = 60_000; // check every 60s
const RETRY_DELAY_MS = 5 * 60_000; // 5 minutes fixed backoff

async function tick() {
  globalForSched.__orcaReportsLastTickAtV3 = new Date().toISOString();
  globalForSched.__orcaReportsTickCountV3 = (globalForSched.__orcaReportsTickCountV3 ?? 0) + 1;
  const now = vnNow();
  const runtime = globalForSched.__orcaReportsRuntimeV3!;

  // Reset daily counters at VN midnight.
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

    // Check if already successfully generated for today
    if (r.successesToday > 0) continue;

    // Double check DB
    const existing = await getStoredReport(spec.type, now.key).catch(() => null);
    if (existing) {
      r.successesToday = 1;
      continue;
    }

    const targetMinutes = spec.targetVn.hh * 60 + spec.targetVn.mm;

    // We only start attempting once current VN time has reached or passed target time.
    if (nowMinutes < targetMinutes) continue;

    // If there's a scheduled retry timestamp, check if it's time yet.
    if (r.nextRetryAt && Date.now() < r.nextRetryAt) continue;

    // Execute generation with unlimited retry loop semantics (triggered via tick interval)
    r.lastAttemptAt = new Date().toISOString();
    r.attemptsToday += 1;
    log.info("report_job_attempt", { type: spec.type, date: now.key, attempt: r.attemptsToday });

    try {
      const res = await spec.run(new Date());
      const verified = await getStoredReport(spec.type, now.key);
      if (!verified) throw new Error("generation completed but row missing in DB");

      r.successesToday = 1;
      r.lastSuccessAt = new Date().toISOString();
      r.lastError = null;
      r.nextRetryAt = null;
      log.info("report_job_success", { type: spec.type, date: now.key, attempt: r.attemptsToday });
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
  const jobs: Record<string, any> = {};
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
      nextRetryInSec: r.nextRetryAt ? Math.max(0, Math.round((r.nextRetryAt - Date.now()) / 1000)) : null,
    };
  }
  return {
    started: !!globalForSched.__orcaReportsStartedV3,
    version: "v3-unlimited-retry",
    tickMs: TICK_MS,
    lastTickAt: globalForSched.__orcaReportsLastTickAtV3 ?? null,
    tickCount: globalForSched.__orcaReportsTickCountV3 ?? 0,
    vnNow: { ...now, isWeekday: isVnWeekday() },
    jobs,
  };
}
