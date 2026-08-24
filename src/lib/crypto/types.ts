/**
 * Phase 0 — Crypto Data Layer
 * Unified snapshot used by AI, dashboard, and detail page.
 */

export type FundingBias = "LONG_CROWDED" | "NEUTRAL" | "SHORT_CROWDED";
export type LongShortBias = "LONG_DOMINANT" | "BALANCED" | "SHORT_DOMINANT";
export type OiPriceSetup =
  | "LONG_BUILDUP"
  | "SHORT_BUILDUP"
  | "SHORT_COVERING"
  | "LONG_LIQUIDATION"
  | "NEUTRAL"
  | "UNKNOWN";

export interface SpotSnapshot {
  price: number | null;
  change24h: number | null;
  volume24h: number | null;
  marketCap: number | null;
  source: string | null;
  timestamp: string | null;
}

export interface FundingSnapshot {
  rate: number | null;
  ratePct: number | null;
  nextFundingTime: string | null;
  markPrice: number | null;
  indexPrice: number | null;
  bias: FundingBias;
  insight: string;
  source: string;
}

export interface LongShortSnapshot {
  longAccountPct: number | null;
  shortAccountPct: number | null;
  ratio: number | null;
  bias: LongShortBias;
  insight: string;
  period: string;
  source: string;
}

export interface OpenInterestSnapshot {
  openInterest: number | null;
  openInterestUsd: number | null;
  changePct: number | null;
  priceChangePct: number | null;
  setup: OiPriceSetup;
  insight: string;
  source: string;
}

export interface FuturesIntelligence {
  symbol: string;
  binanceFuturesSymbol: string;
  funding: FundingSnapshot;
  longShort: LongShortSnapshot;
  openInterest: OpenInterestSnapshot;
  fetchedAt: string;
  available: boolean;
  errors: string[];
}

/** Unified object for AI + UI (Phase 0 target). */
export interface CryptoMarketSnapshot {
  symbol: string;
  name: string;
  spot: SpotSnapshot;
  futures: FuturesIntelligence | null;
  sentiment: {
    score: number | null;
    label: string | null;
    source?: string | null;
  } | null;
  technical: {
    recommendation: string | null;
    confidence: number | null;
    reasons: string[];
  } | null;
  generatedAt: string;
}
