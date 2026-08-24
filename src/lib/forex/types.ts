/**
 * Forex Data Contract — single source of truth for quote shape across
 * connectors, service, API, and UI.
 *
 * Phase 0/1 (P0): price consistency + freshness + normalization.
 */

export type ForexFreshness =
  | "LIVE"
  | "FRESH"
  | "STALE"
  | "DEGRADED"
  | "OFFLINE";

/** Absolute age thresholds (ms) for freshness classification. */
export const FOREX_FRESHNESS_MS = {
  LIVE: 5_000,
  FRESH: 15_000,
  STALE: 60_000,
  DEGRADED: 5 * 60_000,
} as const;

/**
 * Normalized live quote returned by every price-facing API.
 */
export interface ForexQuoteContract {
  symbol: string;
  name: string;
  category: string;
  baseCurrency: string;
  quoteCurrency: string;

  /** Mid price: (bid+ask)/2 when both present, else last/regularMarketPrice. */
  price: number;
  bid: number | null;
  ask: number | null;
  /** Absolute spread ask - bid. */
  spread: number | null;
  /** Spread in pips (pair-aware pip size). */
  spreadPips: number | null;

  change: number | null;
  changePercent: number | null;

  timestamp: string;
  source: string;
  freshness: ForexFreshness;
  ageMs: number;

  /** Optional consistency fields when candle context is available. */
  lastCandleClose?: number | null;
  priceVsCandleDiff?: number | null;
}

/** Raw quote from a connector before normalization. */
export interface ForexRawQuote {
  symbol: string;
  price: number;
  bid: number | null;
  ask: number | null;
  change: number | null;
  changePercent: number | null;
  source: string;
  timestamp: Date;
}

/** Connector-level quote (may include quality flags). */
export interface ForexQuote extends ForexRawQuote {
  /** True when derived stale-leg, secondary-only, or cross-check diverge. */
  degraded?: boolean;
}

export interface ForexNormalizeMeta {
  name?: string;
  category?: string;
  baseCurrency?: string;
  quoteCurrency?: string;
  /** Force degraded (e.g. derived with stale leg). */
  forceDegraded?: boolean;
}
