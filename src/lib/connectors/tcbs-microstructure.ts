import {
  getStockMicrostructure,
  StockMicrostructureSnapshot,
} from "@/lib/connectors/stock-microstructure";

export type {
  DepthLevel,
  ForeignFlowSnapshot,
  MarketDataStatus,
  OrderBookSnapshot,
  StockMicrostructureSnapshot,
} from "@/lib/connectors/stock-microstructure";

export function tcbsMockMicrostructure(
  symbol: string,
  close: number,
  now = Math.floor(Date.now() / 1000),
): StockMicrostructureSnapshot {
  return getStockMicrostructure(symbol, close, now);
}

export { isMicrostructureMockEnabled } from "@/lib/connectors/stock-microstructure";
