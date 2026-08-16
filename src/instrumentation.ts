/**
 * Next.js instrumentation hook — runs once per server process on boot.
 * Use this for side-effects that must start before any request is served
 * (background dispatchers, schedulers, warming caches, DB readiness wait).
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only run on the server runtime (not edge).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // ─── Database: wait for readiness (bounded retries), then start self-ping ───
  // This does NOT block server startup indefinitely — it retries up to
  // DATABASE_STARTUP_RETRIES times (default 10, 2s apart) then lets the app
  // boot anyway in a "degraded" state. /api/health reflects the real status.
  try {
    const { waitForDatabaseReady, startDbSelfPing } = await import("@/db");
    void waitForDatabaseReady().then((ready) => {
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "info",
          provider: "database",
          msg: ready ? "database_ready_on_boot" : "database_not_ready_booting_degraded",
        }),
      );
    });
    startDbSelfPing();
  } catch (err) {
    console.error("[instrumentation] database readiness/self-ping failed to start:", err);
  }

  try {
    const { startAlertDispatcher } = await import("@/lib/alerts");
    startAlertDispatcher();
  } catch (err) {
    console.error("[instrumentation] alert dispatcher failed to start:", err);
  }

  try {
    const { startReportScheduler } = await import("@/lib/reports/scheduler");
    startReportScheduler();
  } catch (err) {
    console.error("[instrumentation] report scheduler failed to start:", err);
  }

  // ─── Commodities Scheduler ───
  // Runs daily at 8:00 AM Vietnam time to fetch commodities data
  try {
    const { startCommoditiesScheduler } = await import("@/lib/commodities/scheduler");
    startCommoditiesScheduler();
  } catch (err) {
    console.error("[instrumentation] commodities scheduler failed to start:", err);
  }
}
