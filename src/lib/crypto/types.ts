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

/* ─── Phase 2: Order Flow ─────────────────────────────────────────────── */

export interface DepthLevel {
  price: number;
  qty: number;
  notional: number;
  side: "bid" | "ask";
}

export interface WallInfo {
  side: "bid" | "ask";
  price: number;
  qty: number;
  notional: number;
  strength: number;
}

export interface OrderBookImbalance {
  bidPct: number;
  askPct: number;
  ratio: number;
  bias: "BUY_DOMINANT" | "SELL_DOMINANT" | "BALANCED";
  insight: string;
}

export interface OrderBookSnapshot {
  symbol: string;
  bids: DepthLevel[];
  asks: DepthLevel[];
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  spreadBps: number | null;
  imbalance: OrderBookImbalance;
  buyWalls: WallInfo[];
  sellWalls: WallInfo[];
  lastUpdateId: number | null;
  source: string;
  fetchedAt: string;
}

export interface RecentTrade {
  id: number;
  price: number;
  qty: number;
  notional: number;
  side: "BUY" | "SELL";
  time: number;
  isWhale: boolean;
}

export interface OrderFlowIntelligence {
  symbol: string;
  binanceSymbol: string;
  orderBook: OrderBookSnapshot | null;
  recentTrades: RecentTrade[];
  whaleThresholdUsd: number;
  whaleSummary: {
    buyCount: number;
    sellCount: number;
    buyNotional: number;
    sellNotional: number;
    netFlow: number;
  };
  available: boolean;
  errors: string[];
  fetchedAt: string;
}

/* ─── Phase 3: Whale + Liquidation ────────────────────────────────────── */

export type WhaleEventKind = "WHALE" | "LARGE_ORDER" | "ORDER_WALL" | "LIQUIDATION";

export interface WhaleEvent {
  kind: WhaleEventKind;
  side: "BUY" | "SELL";
  price: number;
  qty: number;
  notional: number;
  time: number;
  tradeId: number | null;
}

export interface WhaleActivity {
  windowMinutes: number;
  buyNotional: number;
  sellNotional: number;
  netFlow: number;
  buyCount: number;
  sellCount: number;
  events: WhaleEvent[];
  bias: "ACCUMULATION" | "DISTRIBUTION" | "NEUTRAL";
  insight: string;
}

export interface LiquidationZone {
  price: number;
  side: "LONG" | "SHORT";
  notionalEstimate: number;
  distancePct: number;
  source: "estimated" | "order_wall";
}

export interface WhaleLiquidationIntelligence {
  symbol: string;
  binanceSymbol: string;
  whale: WhaleActivity;
  liquidation: {
    markPrice: number | null;
    zones: LiquidationZone[];
    insight: string;
    method: string;
  };
  takerInsight: string | null;
  assessment: string;
  whaleThresholdUsd: number;
  available: boolean;
  errors: string[];
  fetchedAt: string;
}

/* ─── Phase 4: Sentiment + Divergence ─────────────────────────────────── */

export type SentimentLabel = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface SentimentDistribution {
  bullishPct: number;
  neutralPct: number;
  bearishPct: number;
  sampleSize: number;
}

export interface SentimentDivergence {
  code:
    | "CROWDED_LONG"
    | "SHORT_BUILDUP"
    | "BULLISH_DIVERGENCE"
    | "BEARISH_DIVERGENCE"
    | "SHORT_SQUEEZE_RISK"
    | "ALIGNED_BULLISH"
    | "ALIGNED_BEARISH"
    | "NEUTRAL";
  severity: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  insight: string;
}

export interface CryptoSentimentIntelligence {
  symbol: string;
  label: SentimentLabel;
  score: number;
  confidence: number;
  distribution: SentimentDistribution;
  divergence: SentimentDivergence;
  headlines: Array<{
    title: string;
    link: string;
    source: string;
    publishedAt: string;
    lean: SentimentLabel;
  }>;
  rationale: string;
  scoringSource: string;
  model: string | null;
  displayLabel: string;
  available: boolean;
  errors: string[];
  fetchedAt: string;
}

/* ─── Phase 5: Launchpad / Launchpool ─────────────────────────────────── */

export type LaunchEventKind =
  | "LAUNCHPOOL"
  | "LAUNCHPAD"
  | "SPOT_LISTING"
  | "FUTURES_LISTING"
  | "DELIST"
  | "OTHER";

export interface LaunchEvent {
  id: string;
  code: string;
  title: string;
  kind: LaunchEventKind;
  status: "UPCOMING" | "ONGOING" | "RECENT" | "ENDED";
  symbols: string[];
  primarySymbol: string | null;
  publishedAt: string;
  publishedMs: number;
  url: string;
}

export interface LaunchpadIntelligence {
  summary: {
    total: number;
    launchpool: number;
    launchpad: number;
    spotListings: number;
    futuresListings: number;
    delistings: number;
  };
  highlights: LaunchEvent[];
  launchpool: LaunchEvent[];
  launchpad: LaunchEvent[];
  listings: LaunchEvent[];
  delistings: LaunchEvent[];
  all: LaunchEvent[];
  available: boolean;
  errors: string[];
  source: string;
  fetchedAt: string;
}

/* ─── On-chain layer ──────────────────────────────────────────────────── */

export interface OnChainIntelligence {
  symbol: string;
  defi: {
    protocolName: string | null;
    protocolSlug: string | null;
    tvl: number | null;
    tvlChange1d: number | null;
    tvlChange7d: number | null;
    category: string | null;
    protocolMcap: number | null;
    topChains: Array<{ chain: string; tvl: number }>;
    chainTvl: number | null;
  };
  supply: {
    circulating: number | null;
    totalSupply: number | null;
    maxSupply: number | null;
    circulatingRatio: number | null;
    marketCap: number | null;
    fdv: number | null;
    volume24h: number | null;
  };
  activity: {
    twitterFollowers: number | null;
    redditSubscribers: number | null;
    githubStars: number | null;
    commits4w: number | null;
    exchangeVolumeConcentration: number | null;
  };
  bitcoin: {
    feeFastSatVb: number | null;
    feeHalfHourSatVb: number | null;
    feeHourSatVb: number | null;
    hashrateEh: number | null;
    difficulty: number | null;
  } | null;
  assessment: string;
  available: boolean;
  errors: string[];
  sources: string[];
  fetchedAt: string;
}

/** Unified object for AI + UI. */
export interface CryptoMarketSnapshot {
  symbol: string;
  name: string;
  spot: SpotSnapshot;
  futures: FuturesIntelligence | null;
  orderFlow?: OrderFlowIntelligence | null;
  whaleLiquidation?: WhaleLiquidationIntelligence | null;
  sentimentIntel?: CryptoSentimentIntelligence | null;
  onChain?: OnChainIntelligence | null;
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
