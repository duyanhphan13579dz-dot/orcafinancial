import { generateMarketSummary, generateMorningBrief, getStoredReport, isVnWeekday } from "./generator";
import { forProvider } from "@/lib/logger";
import { ingestFinancialSources } from "@/lib/financial-ingestion";

const log = forProvider("reports-scheduler-v4");
type ReportType = "morning" | "summary";
interface JobSpec { type: ReportType; targetVn: { hh: number; mm: number }; run: (d: Date) => Promise<{ persisted?: boolean; html?: string }>; }
const JOBS: JobSpec[] = [
  { type: "morning", targetVn: { hh: 7, mm: 30 }, run: (d) => generateMorningBrief(d) },
  { type: "summary", targetVn: { hh: 15, mm: 15 }, run: (d) => generateMarketSummary(d) },
];
interface JobRuntime { lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null; attemptsToday: number; successesToday: number; todayKey: string | null; nextRetryAt: number | null; }
const g = globalThis as typeof globalThis & { __orcaReportsStartedV4?: boolean; __orcaReportsRuntimeV4?: Record<ReportType, JobRuntime>; __orcaReportsLastTickAtV4?: string | null; __orcaReportsTickCountV4?: number; __orcaReportsTickInFlightV4?: boolean; __orcaQuarterlyKeyV4?: string | null; __orcaQuarterlyRetryAtV4?: number | null; };
const emptyRuntime = (): JobRuntime => ({ lastAttemptAt: null, lastSuccessAt: null, lastError: null, attemptsToday: 0, successesToday: 0, todayKey: null, nextRetryAt: null });
g.__orcaReportsRuntimeV4 ??= { morning: emptyRuntime(), summary: emptyRuntime() };
g.__orcaReportsTickCountV4 ??= 0;
g.__orcaReportsLastTickAtV4 ??= null;
g.__orcaQuarterlyKeyV4 ??= null;
g.__orcaQuarterlyRetryAtV4 ??= null;
function vnNow() { const d = new Date(); const shifted = new Date(d.getTime() + 7 * 60 * 60_000); return { hh: shifted.getUTCHours(), mm: shifted.getUTCMinutes(), key: `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`, weekday: shifted.getUTCDay() }; }
const TICK_MS = 60_000;
const RETRY_DELAY_MS = 5 * 60_000;
const QUARTER_MONTHS = new Set([1, 4, 7, 10]);
function quarterlyKey(now: ReturnType<typeof vnNow>): string | null {
  const month = Number(now.key.slice(5, 7));
  return QUARTER_MONTHS.has(month) && Number(now.key.slice(8, 10)) <= 10 ? `${now.key.slice(0, 7)}` : null;
}
async function refreshQuarterly(now: ReturnType<typeof vnNow>) {
  // VnDirect is the default financial provider; the quarterly refresh runs
  // whenever a quarter opens so company filings stay fresh in the DB.
  const key = quarterlyKey(now);
  if (!key || g.__orcaQuarterlyKeyV4 === key || (g.__orcaQuarterlyRetryAtV4 && Date.now() < g.__orcaQuarterlyRetryAtV4)) return;
  const symbols = (process.env.FINANCIAL_INGEST_SYMBOLS ?? "VNM,HPG,FPT,VCB").split(",").map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => /^[A-Z0-9]{1,15}$/.test(symbol)).slice(0, 100);
  if (!symbols.length) return;
  try {
    const result = await ingestFinancialSources(symbols, 8);
    if (!result.ok || result.acceptedFactCount === 0) throw new Error(`VnDirect quarterly refresh accepted no facts (${result.rejectedFactCount} rejected)`);
    g.__orcaQuarterlyKeyV4 = key;
    g.__orcaQuarterlyRetryAtV4 = null;
    log.info("vndirect_quarterly_refresh_success", { key, symbols, acceptedFactCount: result.acceptedFactCount });
  } catch (error) {
    g.__orcaQuarterlyRetryAtV4 = Date.now() + RETRY_DELAY_MS;
    log.warn("vndirect_quarterly_refresh_failed", { key, error: error instanceof Error ? error.message : String(error) });
  }
}
async function tick() {
  if (g.__orcaReportsTickInFlightV4) return;
  g.__orcaReportsTickInFlightV4 = true;
  g.__orcaReportsLastTickAtV4 = new Date().toISOString();
  g.__orcaReportsTickCountV4 = (g.__orcaReportsTickCountV4 ?? 0) + 1;
  try {
    const now = vnNow(); const runtime = g.__orcaReportsRuntimeV4!;
    await refreshQuarterly(now);
    for (const spec of JOBS) { const r = runtime[spec.type]; if (r.todayKey !== now.key) { r.todayKey = now.key; r.attemptsToday = 0; r.successesToday = 0; r.lastError = null; r.nextRetryAt = null; } }
    if (!isVnWeekday()) return;
    const nowMinutes = now.hh * 60 + now.mm;
    for (const spec of JOBS) {
      const r = runtime[spec.type];
      if (r.successesToday > 0) continue;
      const existing = await getStoredReport(spec.type, now.key).catch(() => null);
      if (existing) { r.successesToday = 1; r.lastSuccessAt ??= new Date().toISOString(); continue; }
      if (nowMinutes < spec.targetVn.hh * 60 + spec.targetVn.mm || (r.nextRetryAt && Date.now() < r.nextRetryAt)) continue;
      r.lastAttemptAt = new Date().toISOString(); r.attemptsToday += 1;
      try {
        const res = await spec.run(new Date());
        const verified = await getStoredReport(spec.type, now.key).catch(() => null);
        if (!verified && !(res?.html && res.html.length > 100)) throw new Error("generation completed but no content available");
        r.successesToday = 1; r.lastSuccessAt = new Date().toISOString(); r.lastError = null; r.nextRetryAt = null;
        log.info("report_job_success", { type: spec.type, date: now.key, attempt: r.attemptsToday, persisted: res?.persisted ?? Boolean(verified) });
      } catch (err) { const message = err instanceof Error ? err.message : String(err); r.lastError = message; r.nextRetryAt = Date.now() + RETRY_DELAY_MS; log.warn("report_job_failed_will_retry", { type: spec.type, date: now.key, attempt: r.attemptsToday, error: message }); }
    }
  } finally { g.__orcaReportsTickInFlightV4 = false; }
}
export function startReportScheduler() { if (g.__orcaReportsStartedV4) return; g.__orcaReportsStartedV4 = true; log.info("scheduler_started_v4", { tickMs: TICK_MS, retryDelayMs: RETRY_DELAY_MS }); setTimeout(() => void tick(), 4_000); setInterval(() => void tick(), TICK_MS); }
export function getSchedulerStatus() {
  const now = vnNow(); const jobs: Record<string, unknown> = {};
  for (const spec of JOBS) { const r = g.__orcaReportsRuntimeV4![spec.type]; const target = spec.targetVn.hh * 60 + spec.targetVn.mm; const current = now.hh * 60 + now.mm; jobs[spec.type] = { ...r, target: `${String(spec.targetVn.hh).padStart(2, "0")}:${String(spec.targetVn.mm).padStart(2, "0")}`, minutesUntilTarget: target > current ? target - current : null, isTimeReached: current >= target, nextRetryInSec: r.nextRetryAt ? Math.max(0, Math.round((r.nextRetryAt - Date.now()) / 1000)) : null }; }
  return { started: !!g.__orcaReportsStartedV4, version: "v4-locked-retry", tickMs: TICK_MS, maxRetry: 999, lastTickAt: g.__orcaReportsLastTickAtV4, tickCount: g.__orcaReportsTickCountV4, vnNow: { ...now, isWeekday: isVnWeekday() }, jobs };
}
