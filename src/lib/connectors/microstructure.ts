/**
 * Stock microstructure contracts (provider-agnostic).
 *
 * These shapes are deliberately independent of any single vendor. A verified
 * microstructure provider — e.g. SSI FastConnect WebSocket `quote` (bid/ask)
 * and `room` (foreign room) topics — maps into them.
 *
 * Until a provider is wired, the microstructure endpoint returns
 * `status: "unavailable"` with empty levels. The layer must never estimate,
 * interpolate or synthesise order-book or foreign-flow numbers.
 */

export type MicrostructureStatus = "live" | "delayed" | "stale" | "unavailable";

export interface OrderBookLevel {
  price: number;
  volume: number;
  /**
   * Number of resting orders at this price level.
   *
   * `null` when the provider does not publish order counts. Notably, SSI
   * FastConnect `quote` topics return `[price, quantity]` pairs only, so this
   * stays `null` for that source. Never derive or estimate this value — render
   * an em dash instead.
   */
  orderCount?: number | null;
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
