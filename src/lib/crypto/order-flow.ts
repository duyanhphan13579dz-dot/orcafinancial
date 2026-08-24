import {
  fetchWithRetry,
  getBreaker,
  ProviderError,
  readJsonSafe,
} from "@/lib/connectors/core";
import { forProvider } from "@/lib/logger";
import type {
  DepthLevel,
  OrderBookSnapshot,
  OrderFlowIntelligence,
  RecentTrade,
  WallInfo,
} from "./types";

const SPOT = "binance-orderflow";
const BASE = "https://data-api.binance.vision";
const log = forProvider("crypto-orderflow");
const TIMEOUT_MS = 5_000;
const RETRIES = 1;

function pairSymbol(base: string): string {
  const s = base.trim().toUpperCase().replace(/USDT$/i, "");
  return `${s}USDT`;
}

function toLevels(rows: [string, string][], side: "bid" | "ask"): DepthLevel[] {
  return (rows ?? [])
    .map(([p, q]) => {
      const price = Number(p);
      const qty = Number(q);
      if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) {
        return null;
      }
      return { price, qty, notional: price * qty, side };
    })
    .filter((x): x is DepthLevel => Boolean(x));
}

/** Detect walls: level notional ≥ max(median*3, top10% of book side, minUsd). */
function detectWalls(
  levels: DepthLevel[],
  side: "bid" | "ask",
  minUsd = 80_000,
): WallInfo[] {
  if (levels.length < 3) return [];
  const notionals = levels.map((l) => l.notional).sort((a, b) => a - b);
  const median = notionals[Math.floor(notionals.length / 2)] ?? 0;
  const threshold = Math.max(minUsd, median * 3.5);

  return levels
    .filter((l) => l.notional >= threshold)
    .map((l) => ({
      side,
      price: l.price,
      qty: l.qty,
      notional: l.notional,
      strength: l.notional / threshold,
    }))
    .sort((a, b) => b.notional - a.notional)
    .slice(0, 3);
}

function imbalance(bids: DepthLevel[], asks: DepthLevel[]): {
  bidPct: number;
  askPct: number;
  ratio: number;
  bias: "BUY_DOMINANT" | "SELL_DOMINANT" | "BALANCED";
  insight: string;
} {
  const bidLiq = bids.reduce((s, l) => s + l.notional, 0);
  const askLiq = asks.reduce((s, l) => s + l.notional, 0);
  const total = bidLiq + askLiq;
  if (total <= 0) {
    return {
      bidPct: 50,
      askPct: 50,
      ratio: 1,
      bias: "BALANCED",
      insight: "Không đủ thanh khoản order book để đánh giá imbalance.",
    };
  }
  const bidPct = (bidLiq / total) * 100;
  const askPct = (askLiq / total) * 100;
  const ratio = askLiq > 0 ? bidLiq / askLiq : 99;

  if (bidPct >= 58) {
    return {
      bidPct,
      askPct,
      ratio,
      bias: "BUY_DOMINANT",
      insight: `Buy-side liquidity ${bidPct.toFixed(0)}% — thanh khoản mua chiếm ưu thế trên order book hiện tại.`,
    };
  }
  if (askPct >= 58) {
    return {
      bidPct,
      askPct,
      ratio,
      bias: "SELL_DOMINANT",
      insight: `Sell-side liquidity ${askPct.toFixed(0)}% — thanh khoản bán chiếm ưu thế (có thể có sell wall).`,
    };
  }
  return {
    bidPct,
    askPct,
    ratio,
    bias: "BALANCED",
    insight: `Thanh khoản cân bằng (buy ${bidPct.toFixed(0)}% / sell ${askPct.toFixed(0)}%).`,
  };
}

/**
 * Whale threshold: max(absolute floor by symbol tier, fraction of 24h quote volume).
 * Avoids labeling every large retail fill as "whale".
 */
export function whaleNotionalThreshold(
  symbol: string,
  volume24hUsd: number | null | undefined,
): number {
  const base = symbol.replace(/USDT$/i, "").toUpperCase();
  const tierFloor =
    base === "BTC" || base === "ETH"
      ? 150_000
      : base === "BNB" || base === "SOL"
        ? 50_000
        : 20_000;

  const vol = typeof volume24hUsd === "number" && volume24hUsd > 0 ? volume24hUsd : 0;
  // ~0.015% of 24h volume, capped
  const fromVolume = vol > 0 ? Math.min(vol * 0.00015, 2_000_000) : 0;
  return Math.max(tierFloor, fromVolume);
}

interface DepthResponse {
  lastUpdateId?: number;
  bids: [string, string][];
  asks: [string, string][];
}

interface TradeRow {
  id: number;
  price: string;
  qty: string;
  time: number;
  isBuyerMaker: boolean;
  quoteQty?: string;
}

async function fetchDepth(symbol: string, limit = 20): Promise<DepthResponse> {
  return getBreaker(SPOT).exec(async () => {
    const url = `${BASE}/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${Math.min(100, Math.max(5, limit)}`;
    const res = await fetchWithRetry(url, {
      provider: SPOT,
      timeoutMs: TIMEOUT_MS,
      retries: RETRIES,
    });
    const data = await readJsonSafe<DepthResponse>(res, SPOT, url);
    if (!data?.bids?.length && !data?.asks?.length) {
      throw new ProviderError(SPOT, `empty depth for ${symbol}`);
    }
    return data;
  });
}

async function fetchRecentTrades(symbol: string, limit = 40): Promise<TradeRow[]> {
  return getBreaker(SPOT).exec(async () => {
    const url = `${BASE}/api/v3/trades?symbol=${encodeURIComponent(symbol)}&limit=${Math.min(100, Math.max(10, limit)}`;
    const res = await fetchWithRetry(url, {
      provider: SPOT,
      timeoutMs: TIMEOUT_MS,
      retries: RETRIES,
    });
    const rows = await readJsonSafe<TradeRow[]>(res, SPOT, url);
    if (!rows?.length) throw new ProviderError(SPOT, `no trades for ${symbol}`);
    return rows;
  });
}

export async function fetchOrderFlowIntelligence(
  baseSymbol: string,
  opts: { volume24hUsd?: number | null; depthLimit?: number; tradeLimit?: number } = {},
): Promise<OrderFlowIntelligence> {
  const symbol = pairSymbol(baseSymbol);
  const errors: string[] = [];
  let book: OrderBookSnapshot | null = null;
  let trades: RecentTrade[] = [];

  const [depthRes, tradesRes] = await Promise.allSettled([
    fetchDepth(symbol, opts.depthLimit ?? 20),
    fetchRecentTrades(symbol, opts.tradeLimit ?? 40),
  ]);

  if (depthRes.status === "fulfilled") {
    const raw = depthRes.value;
    const bids = toLevels(raw.bids, "bid").sort((a, b) => b.price - a.price);
    const asks = toLevels(raw.asks, "ask").sort((a, b) => a.price - b.price);
    const imb = imbalance(bids, asks);
    const buyWalls = detectWalls(bids, "bid");
    const sellWalls = detectWalls(asks, "ask");
    const bestBid = bids[0]?.price ?? null;
    const bestAsk = asks[0]?.price ?? null;
    const spread =
      bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
    const mid =
      bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
    const spreadBps =
      spread != null && mid && mid > 0 ? (spread / mid) * 10_000 : null;

    book = {
      symbol,
      bids: bids.slice(0, 15),
      asks: asks.slice(0, 15),
      bestBid,
      bestAsk,
      spread,
      spreadBps,
      imbalance: imb,
      buyWalls,
      sellWalls,
      lastUpdateId: raw.lastUpdateId ?? null,
      source: SPOT,
      fetchedAt: new Date().toISOString(),
    };
  } else {
    errors.push(`depth: ${String(depthRes.reason).slice(0, 120)}`);
  }

  const whaleThreshold = whaleNotionalThreshold(symbol, opts.volume24hUsd);

  if (tradesRes.status === "fulfilled") {
    trades = tradesRes.value
      .map((t) => {
        const price = Number(t.price);
        const qty = Number(t.qty);
        const notional =
          typeof t.quoteQty === "string" && Number.isFinite(Number(t.quoteQty))
            ? Number(t.quoteQty)
            : price * qty;
        if (!Number.isFinite(price) || !Number.isFinite(qty)) return null;
        // isBuyerMaker = true → sell aggressor (maker was bid)
        const side: "BUY" | "SELL" = t.isBuyerMaker ? "SELL" : "BUY";
        const isWhale = notional >= whaleThreshold;
        return {
          id: t.id,
          price,
          qty,
          notional,
          side,
          time: t.time,
          isWhale,
        } satisfies RecentTrade;
      })
      .filter((x): x is RecentTrade => Boolean(x))
      .sort((a, b) => b.time - a.time);
  } else {
    errors.push(`trades: ${String(tradesRes.reason).slice(0, 120)}`);
  }

  const whaleBuys = trades.filter((t) => t.isWhale && t.side === "BUY");
  const whaleSells = trades.filter((t) => t.isWhale && t.side === "SELL");
  const whaleBuyUsd = whaleBuys.reduce((s, t) => s + t.notional, 0);
  const whaleSellUsd = whaleSells.reduce((s, t) => s + t.notional, 0);

  const available = Boolean(book) || trades.length > 0;
  if (errors.length) {
    log.warn("orderflow_partial", { symbol, errors: errors.slice(0, 3) });
  }

  return {
    symbol: baseSymbol.trim().toUpperCase(),
    binanceSymbol: symbol,
    orderBook: book,
    recentTrades: trades.slice(0, 30),
    whaleThresholdUsd: whaleThreshold,
    whaleSummary: {
      buyCount: whaleBuys.length,
      sellCount: whaleSells.length,
      buyNotional: whaleBuyUsd,
      sellNotional: whaleSellUsd,
      netFlow: whaleBuyUsd - whaleSellUsd,
    },
    available,
    errors,
    fetchedAt: new Date().toISOString(),
  };
}

export function formatOrderFlowForAgent(o: OrderFlowIntelligence): string {
  if (!o.available) return `orderflow=${o.symbol}:unavailable`;
  const parts: string[] = [`orderflow=${o.symbol}`];
  if (o.orderBook) {
    const b = o.orderBook;
    parts.push(
      `spread=${b.spreadBps != null ? b.spreadBps.toFixed(1) + "bps" : "n/a"}`,
      `imb=${b.imbalance.bias}(${b.imbalance.bidPct.toFixed(0)}/${b.imbalance.askPct.toFixed(0)})`,
    );
    if (b.buyWalls[0]) {
      parts.push(`buyWall=$${Math.round(b.buyWalls[0].notional).toLocaleString()}@${b.buyWalls[0].price}`);
    }
    if (b.sellWalls[0]) {
      parts.push(`sellWall=$${Math.round(b.sellWalls[0].notional).toLocaleString()}@${b.sellWalls[0].price}`);
    }
  }
  if (o.whaleSummary.buyCount + o.whaleSummary.sellCount > 0) {
    parts.push(
      `whale net=$${(o.whaleSummary.netFlow / 1000).toFixed(0)}k (B${o.whaleSummary.buyCount}/S${o.whaleSummary.sellCount})`,
    );
  }
  return parts.join(" | ");
}
