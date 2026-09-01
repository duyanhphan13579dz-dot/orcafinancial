/**
 * Stock microstructure types.
 * TCBS provider removed — endpoint returns status "unavailable" until a verified provider is wired.
 */

export type MicrostructureStatus = "live" | "delayed" | "stale" | "unavailable";

export interface OrderBookLevel {
  price: number;
  volume: number;
}

export interface OrderBookSnapshot {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  bidValue: number;
  askValue: number;
  imbalancePct: number | null;
  spread: number | null;
  status: MicrostructureStatus;
  source: string;
  confidence: number;
  updatedAt: number;
}

export interface ForeignFlowSnapshot {
  buyValue: number | null;
  sellValue: number | null;
  netValue: number | null;
  buyVolume: number | null;
  sellVolume: number | null;
  foreignRoomPct: number | null;
  status: MicrostructureStatus;
  source: string;
  confidence: number;
  updatedAt: number;
}

export interface StockMicrostructureSnapshot {
  symbol: string;
  orderBook: OrderBookSnapshot;
  foreignFlow: ForeignFlowSnapshot;
  generatedAt: number;
}
