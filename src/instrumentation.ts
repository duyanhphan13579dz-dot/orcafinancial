/**
 * Next.js instrumentation hook — runs once per server process on boot.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

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

  try {
    const { startCommoditiesScheduler } = await import("@/lib/commodities/scheduler");
    startCommoditiesScheduler();
  } catch (err) {
    console.error("[instrumentation] commodities scheduler failed to start:", err);
  }

  try {
    const { startCryptoScheduler } = await import("@/lib/crypto/scheduler");
    startCryptoScheduler();
  } catch (err) {
    console.error("[instrumentation] crypto scheduler failed to start:", err);
  }

  try {
    const { startForexScheduler } = await import("@/lib/forex/scheduler");
    startForexScheduler();
  } catch (err) {
    console.error("[instrumentation] forex scheduler failed to start:", err);
  }
}
