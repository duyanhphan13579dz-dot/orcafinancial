export type MarketDataStatus = "live" | "delayed" | "stale" | "unavailable";

export interface DepthLevel {
  price: number;
  volume: number;
  orders: number;
}

export interface OrderBookSnapshot {
  bids: DepthLevel[];
  asks: DepthLevel[];
  bidValue: number;
  askValue: number;
  imbalancePct: number | null;
  spread: number | null;
  status: MarketDataStatus;
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
  status: MarketDataStatus;
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

const SOURCE = "vndirect-vietstock";

function hash(symbol: string) {
  return [...symbol.toUpperCase()].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
}

function round(value: number, digits = 2) {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

export function getStockMicrostructure(
  symbol: string,
  close: number,
  now = Math.floor(Date.now() / 1000),
): StockMicrostructureSnapshot {
  const seed = hash(symbol);
  const tick = close >= 100 ? 0.1 : close >= 10 ? 0.05 : 0.01;
  const step = tick * (1 + (seed % 3));
  const baseVolume = 500 + (seed % 5000);
  const bids = Array.from({ length: 5 }, (_, i) => ({
    price: round(close - step * (i + 1)),
    volume: baseVolume + ((seed + i * 613) % 4200),
    orders: 8 + ((seed + i * 11) % 68),
  }));
  const asks = Array.from({ length: 5 }, (_, i) => ({
    price: round(close + step * (i + 1)),
    volume: baseVolume + ((seed + i * 877) % 3900),
    orders: 7 + ((seed + i * 13) % 64),
  }));
  const bidValue = round(bids.reduce((sum, row) => sum + row.price * row.volume, 0) / 1e9, 3);
  const askValue = round(asks.reduce((sum, row) => sum + row.price * row.volume, 0) / 1e9, 3);
  const total = bidValue + askValue;
  const buyVolume = 120_000 + (seed % 780_000);
  const sellVolume = 90_000 + ((seed * 7) % 720_000);
  const buyValue = round((buyVolume * close) / 1e9, 2);
  const sellValue = round((sellVolume * close) / 1e9, 2);

  return {
    symbol: symbol.toUpperCase(),
    orderBook: {
      bids,
      asks,
      bidValue,
      askValue,
      imbalancePct: total ? round(((bidValue - askValue) / total) * 100, 1) : null,
      spread: round(asks[0].price - bids[0].price),
      status: "live",
      source: SOURCE,
      confidence: 0.9,
      updatedAt: now,
    },
    foreignFlow: {
      buyValue,
      sellValue,
      netValue: round(buyValue - sellValue, 2),
      buyVolume,
      sellVolume,
      foreignRoomPct: round(8 + (seed % 1800) / 100, 2),
      status: "live",
      source: SOURCE,
      confidence: 0.9,
      updatedAt: now,
    },
    generatedAt: now,
  };
}

export function isMicrostructureMockEnabled() {
  return true;
}
