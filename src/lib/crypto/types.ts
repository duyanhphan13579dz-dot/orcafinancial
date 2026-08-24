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

/** Unified object for AI + UI (Phase 0–3). */
export interface CryptoMarketSnapshot {
  symbol: string;
  name: string;
  spot: SpotSnapshot;
  futures: FuturesIntelligence | null;
  orderFlow?: OrderFlowIntelligence | null;
  whaleLiquidation?: WhaleLiquidationIntelligence | null;
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
