/**
 * Next.js instrumentation hook — runs once per server process on boot.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { waitForDatabaseReady, startDbSelfPing } = await import("@/db");
    void waitForDatabaseReady().then(async (ready) => {
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "info",
          provider: "database",
          msg: ready ? "database_ready_on_boot" : "database_not_ready_booting_degraded",
        }),
      );
      if (ready) {
        try {
          const { ensureAuthTables } = await import("@/db/ensure-auth-tables");
          await ensureAuthTables();
        } catch (err) {
          console.error(
            "[instrumentation] ensureAuthTables failed:",
            err instanceof Error ? err.message : err,
          );
        }
        try {
          const { ensureAgentTables } = await import("@/db/ensure-agent-tables");
          await ensureAgentTables();
        } catch (err) {
          console.error(
            "[instrumentation] ensureAgentTables failed:",
            err instanceof Error ? err.message : err,
          );
        }
        try {
          const { ensureMarketTables } = await import("@/db/ensure-market-tables");
          await ensureMarketTables();
        } catch (err) {
          console.error(
            "[instrumentation] ensureMarketTables failed:",
            err instanceof Error ? err.message : err,
          );
        }
        try {
          const { ensurePersonalFinanceTables } = await import("@/lib/personal-finance/ensure-tables");
          await ensurePersonalFinanceTables();
        } catch (err) {
          console.error(
            "[instrumentation] ensurePersonalFinanceTables failed:",
            err instanceof Error ? err.message : err,
          );
        }
        try {
          const { ensureCorporateFinanceTables } = await import("@/lib/corporate-finance/ensure-tables");
          await ensureCorporateFinanceTables();
        } catch (err) {
          console.error(
            "[instrumentation] ensureCorporateFinanceTables failed:",
            err instanceof Error ? err.message : err,
          );
        }
      }
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
