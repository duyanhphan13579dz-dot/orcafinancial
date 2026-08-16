/**
 * Continuous commodity scanner.
 *
 * Runs an ingestion cycle on a fixed interval, forever. Each cycle probes BOTH
 * configured sources (so their health is always current) and persists data from
 * exactly ONE of them — never a blend.
 *
 * Interval is env-tunable:
 *   COMMODITY_SCAN_INTERVAL_MS   default 60000 (60s)
 *   COMMODITY_PRUNE_INTERVAL_MS  default 6h
 *   COMMODITY_RETENTION_DAYS     default 30
 *
 * Design notes:
 *   • Cycles never overlap — a `running` latch skips a tick if the previous
 *     one is still in flight (VietnamBiz can take ~10 s).
 *   • Failures never stop the loop; the next tick simply tries again.
 *   • The catalogue is seeded once on boot so the very first cycle can write.
 */

import { forProvider } from "@/lib/logger";
import { ingestCycle, pruneOldIntraday } from "./ingest";
import { initializeCommodities, initializeStockImpacts } from "./service";
import { getPrimarySource, getSecondarySource } from "./sources";
import { vnLabel } from "./time";

const log = forProvider("commodity-scheduler");

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const SCAN_INTERVAL_MS = envInt("COMMODITY_SCAN_INTERVAL_MS", 60_000);
const PRUNE_INTERVAL_MS = envInt("COMMODITY_PRUNE_INTERVAL_MS", 6 * 60 * 60_000);
const RETENTION_DAYS = envInt("COMMODITY_RETENTION_DAYS", 30);

const globalForSched = globalThis as typeof globalThis & {
  __orcaCommodityScannerStarted?: boolean;
  __orcaCommodityRunning?: boolean;
  __orcaCommodityTicks?: number;
  __orcaCommodityLastTickAt?: string | null;
  __orcaCommoditySkipped?: number;
};
if (globalForSched.__orcaCommodityTicks === undefined) globalForSched.__orcaCommodityTicks = 0;
if (globalForSched.__orcaCommoditySkipped === undefined) globalForSched.__orcaCommoditySkipped = 0;
if (globalForSched.__orcaCommodityLastTickAt === undefined) globalForSched.__orcaCommodityLastTickAt = null;

async function tick(): Promise<void> {
  if (globalForSched.__orcaCommodityRunning) {
    globalForSched.__orcaCommoditySkipped = (globalForSched.__orcaCommoditySkipped ?? 0) + 1;
    log.debug("tick_skipped_overlap");
    return;
  }
  globalForSched.__orcaCommodityRunning = true;
  globalForSched.__orcaCommodityTicks = (globalForSched.__orcaCommodityTicks ?? 0) + 1;
  globalForSched.__orcaCommodityLastTickAt = new Date().toISOString();

  try {
    await ingestCycle();
  } catch (err) {
    log.error("tick_failed", { error: err instanceof Error ? err.message : String(err) });
  } finally {
    globalForSched.__orcaCommodityRunning = false;
  }
}

export function startCommoditiesScheduler(): void {
  if (globalForSched.__orcaCommodityScannerStarted) {
    log.debug("already_started");
    return;
  }
  globalForSched.__orcaCommodityScannerStarted = true;

  log.info("scanner_started", {
    intervalMs: SCAN_INTERVAL_MS,
    primary: getPrimarySource(),
    secondary: getSecondarySource(),
    vnTime: vnLabel(),
  });

  // Seed catalogue + impact map, then start scanning.
  void (async () => {
    try {
      await initializeCommodities();
      await initializeStockImpacts();
    } catch (err) {
      log.warn("catalogue_seed_failed", { error: err instanceof Error ? err.message : String(err) });
    }
    // First scan shortly after boot so the board is populated immediately.
    setTimeout(() => void tick(), 4_000);
    setInterval(() => void tick(), SCAN_INTERVAL_MS);
  })();

  // Periodic retention sweep.
  setInterval(() => {
    void pruneOldIntraday(RETENTION_DAYS).then((n) => {
      if (n > 0) log.info("pruned_intraday", { rows: n, retentionDays: RETENTION_DAYS });
    });
  }, PRUNE_INTERVAL_MS);
}

export interface SchedulerStatus {
  started: boolean;
  running: boolean;
  intervalMs: number;
  ticks: number;
  skippedOverlaps: number;
  lastTickAt: string | null;
  retentionDays: number;
  primarySource: string;
  secondarySource: string;
  vnTime: string;
}

export function getCommodityScannerStatus(): SchedulerStatus {
  return {
    started: !!globalForSched.__orcaCommodityScannerStarted,
    running: !!globalForSched.__orcaCommodityRunning,
    intervalMs: SCAN_INTERVAL_MS,
    ticks: globalForSched.__orcaCommodityTicks ?? 0,
    skippedOverlaps: globalForSched.__orcaCommoditySkipped ?? 0,
    lastTickAt: globalForSched.__orcaCommodityLastTickAt ?? null,
    retentionDays: RETENTION_DAYS,
    primarySource: getPrimarySource(),
    secondarySource: getSecondarySource(),
    vnTime: vnLabel(),
  };
}
