/**
 * Commodities Scheduler — Auto-fetch commodities data daily
 * 
 * Schedule:
 * - 8:00 AM Vietnam time: Fetch all commodities (domestic + international)
 * - Every hour: Fetch international commodities only (optional)
 * 
 * Uses setInterval with calculated delay to next 8:00 AM VN time.
 */

import { forProvider } from "@/lib/logger";
import { fetchAllCommoditiesData } from "./connectors";
import {
  saveExchangeRates,
  saveCommodityPrices,
  initializeCommodities,
  initializeStockImpacts,
} from "./service";

const log = forProvider("commodities-scheduler");

const VN_OFFSET_HOURS = 7; // Asia/Ho_Chi_Minh

/**
 * Calculate milliseconds until next 8:00 AM Vietnam time
 */
function msUntilNextRun(): number {
  const now = new Date();
  const vnTime = new Date(now.getTime() + VN_OFFSET_HOURS * 60 * 60 * 1000);
  
  const nextRun = new Date(vnTime);
  nextRun.setHours(8, 0, 0, 0);
  
  // If already past 8 AM today, schedule for tomorrow
  if (vnTime.getHours() >= 8) {
    nextRun.setDate(nextRun.getDate() + 1);
  }
  
  const ms = nextRun.getTime() - vnTime.getTime();
  return ms;
}

/**
 * Fetch and save all commodities data
 */
async function runCommoditiesFetch(): Promise<void> {
  const startedAt = Date.now();
  log.info("commodities_fetch_start", { scheduled: true });
  
  try {
    // Initialize (idempotent)
    await initializeCommodities();
    await initializeStockImpacts();
    
    // Fetch data
    const { prices, exchangeRates, errors } = await fetchAllCommoditiesData();
    
    // Save
    const ratesSaved = await saveExchangeRates(exchangeRates);
    const pricesSaved = await saveCommodityPrices(prices);
    
    const durationMs = Date.now() - startedAt;
    
    log.info("commodities_fetch_complete", {
      pricesFetched: prices.length,
      pricesSaved,
      ratesSaved,
      errorsCount: errors.length,
      durationMs,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    log.error("commodities_fetch_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

let started = false;

export function startCommoditiesScheduler(): void {
  if (started) {
    log.debug("scheduler_already_started");
    return;
  }
  started = true;
  
  const delayMs = msUntilNextRun();
  log.info("commodities_scheduler_started", {
    nextRunInMs: delayMs,
    nextRunAt: new Date(Date.now() + delayMs).toISOString(),
  });
  
  // First run after delay
  setTimeout(() => {
    void runCommoditiesFetch();
    
    // Then run daily
    setInterval(() => {
      void runCommoditiesFetch();
    }, 24 * 60 * 60 * 1000); // 24 hours
  }, delayMs);
}
