import { FEATURED_SYMBOLS, getQuotes } from "@/lib/market";
import { logger } from "@/lib/logger";

export type RealtimeStatus = "LIVE" | "DEGRADED" | "STALE";

type CollectorState = {
  lastCollectedAt: number | null;
  lastReceived: number;
  lastRequested: number;
  inFlight: Promise<void> | null;
};

const state: CollectorState = {
  lastCollectedAt: null,
  lastReceived: 0,
  lastRequested: 0,
  inFlight: null,
};
const COLLECTOR_INTERVAL_MS = 12_000;

export async function collectRealtimeQuotes(symbols: string[] = FEATURED_SYMBOLS) {
  if (state.inFlight) return state.inFlight;
  if (state.lastRequested && Date.now() - state.lastRequested < COLLECTOR_INTERVAL_MS) return;
  state.lastRequested = Date.now();
  state.inFlight = (async () => {
    try {
      const quotes = await getQuotes(symbols);
      state.lastCollectedAt = Date.now();
      state.lastReceived = quotes.length;
      logger.info("heatmap_realtime_collected", { requested: symbols.length, received: quotes.length });
    } catch (err) {
      logger.warn("heatmap_realtime_collect_failed", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      state.inFlight = null;
    }
  })();
  return state.inFlight;
}

export function getRealtimeStatus() {
  const ageSeconds = state.lastCollectedAt == null ? null : Math.max(0, Math.round((Date.now() - state.lastCollectedAt) / 1000));
  const status: RealtimeStatus = ageSeconds == null ? "STALE" : ageSeconds <= 30 ? "LIVE" : ageSeconds <= 120 ? "DEGRADED" : "STALE";
  return {
    status,
    lastCollectedAt: state.lastCollectedAt ? new Date(state.lastCollectedAt).toISOString() : null,
    ageSeconds,
    lastReceived: state.lastReceived,
    collectorIntervalSeconds: COLLECTOR_INTERVAL_MS / 1000,
  };
}
