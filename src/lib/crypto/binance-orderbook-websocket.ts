"use client";

import { api } from "@/lib/client";
import { isDepthEventContiguous } from "./binance-orderbook-sequence";

export type LiveOrderBookStatus =
  | "connecting"
  | "syncing"
  | "live"
  | "resyncing"
  | "reconnecting"
  | "stale"
  | "error"
  | "disconnected";

export interface LiveBookLevel {
  price: number;
  qty: number;
  notional: number;
}

export interface LiveLiquidityProfileBin {
  price: number;
  bidNotional: number;
  askNotional: number;
  totalNotional: number;
}

export interface LiveExecutedVolumeProfileBin {
  price: number;
  buyNotional: number;
  sellNotional: number;
  totalNotional: number;
}

export interface LiveExecutedTrade {
  price: number;
  qty: number;
  notional: number;
  aggressor: "BUY" | "SELL";
  time: number;
  id: number | null;
}

export interface LiveOrderBookState {
  symbol: string;
  status: LiveOrderBookStatus;
  synced: boolean;
  bids: LiveBookLevel[];
  asks: LiveBookLevel[];
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  spreadBps: number | null;
  bidDepthUsd: number;
  askDepthUsd: number;
  imbalancePct: number;
  pressure: "BUY_PRESSURE" | "SELL_PRESSURE" | "BALANCED";
  liquidityProfile: {
    binSize: number;
    poc: number | null;
    valueAreaLow: number | null;
    valueAreaHigh: number | null;
    bins: LiveLiquidityProfileBin[];
  };
  executedVolumeProfile: {
    windowMs: number;
    binSize: number;
    poc: number | null;
    valueAreaLow: number | null;
    valueAreaHigh: number | null;
    hvn: number[];
    lvn: number[];
    bins: LiveExecutedVolumeProfileBin[];
  };
  executedTrades: number;
  aggressiveBuyNotional: number;
  aggressiveSellNotional: number;
  aggressiveFlow: "BUY" | "SELL" | "BALANCED";
  cvd: number;
  cvdDelta: number;
  lastTradeTime: number | null;
  lastUpdateId: number | null;
  eventTime: number | null;
  receivedAt: number;
  error: string | null;
}

interface BinanceDepthEvent {
  e?: string;
  E?: number;
  s?: string;
  U?: number;
  u?: number;
  b?: Array<[string, string]>;
  a?: Array<[string, string]>;
}

interface BinanceAggTradeEvent {
  e?: string;
  E?: number;
  s?: string;
  a?: number;
  p?: string;
  q?: string;
  T?: number;
  m?: boolean;
}

interface BinanceCombinedEvent {
  stream?: string;
  data?: BinanceDepthEvent | BinanceAggTradeEvent;
  e?: string;
}

interface Snapshot {
  lastUpdateId?: number;
  bids?: Array<[string, string]>;
  asks?: Array<[string, string]>;
}

interface TradeRecord {
  price: number;
  qty: number;
  notional: number;
  aggressor: "BUY" | "SELL";
  time: number;
  id: number | null;
}

const WS_BASE = "wss://stream.binance.com:9443/stream?streams=";
const RENDER_INTERVAL_MS = 250;
const STALE_AFTER_MS = 8_000;
const SNAPSHOT_TIMEOUT_MS = 4_000;
const MAX_RECONNECT_DELAY_MS = 8_000;
const MAX_LEVELS_PER_SIDE = 100;
const EXECUTED_PROFILE_WINDOW_MS = 15 * 60_000;
const MAX_TRADE_RECORDS = 12_000;

function toSymbol(symbol: string) {
  return symbol.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function finitePositive(value: string | number | undefined): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseLevels(rows: Array<[string, string]> | undefined) {
  const levels = new Map<number, number>();
  for (const row of rows ?? []) {
    const price = finitePositive(row?.[0]);
    const qty = Number(row?.[1]);
    if (price == null || !Number.isFinite(qty) || qty < 0) continue;
    if (qty === 0) levels.delete(price);
    else levels.set(price, qty);
  }
  return levels;
}

function applyUpdates(target: Map<number, number>, rows: Array<[string, string]> | undefined) {
  for (const row of rows ?? []) {
    const price = finitePositive(row?.[0]);
    const qty = Number(row?.[1]);
    if (price == null || !Number.isFinite(qty) || qty < 0) continue;
    if (qty === 0) target.delete(price);
    else target.set(price, qty);
  }
}

function topLevels(levels: Map<number, number>, side: "bid" | "ask"): LiveBookLevel[] {
  return [...levels.entries()]
    .map(([price, qty]) => ({ price, qty, notional: price * qty }))
    .sort((a, b) => side === "bid" ? b.price - a.price : a.price - b.price)
    .slice(0, MAX_LEVELS_PER_SIDE);
}

function relativeBinSize(mid: number | null) {
  return mid && mid > 0 ? mid * 0.0005 : 1;
}

function valueArea<T extends { price: number; totalNotional: number }>(ordered: T[]) {
  const poc = ordered.reduce<T | null>((best, bin) => !best || bin.totalNotional > best.totalNotional ? bin : best, null);
  const target = ordered.reduce((sum, bin) => sum + bin.totalNotional, 0) * 0.7;
  const included = new Set<number>();
  let covered = 0;
  if (poc) {
    for (const bin of [...ordered].sort((a, b) => Math.abs(a.price - poc.price) - Math.abs(b.price - poc.price))) {
      included.add(bin.price);
      covered += bin.totalNotional;
      if (covered >= target) break;
    }
  }
  const area = ordered.filter((bin) => included.has(bin.price));
  return {
    poc: poc?.price ?? null,
    valueAreaLow: area.length ? area[0].price : null,
    valueAreaHigh: area.length ? area[area.length - 1].price : null,
  };
}

function buildLiquidityProfile(bids: LiveBookLevel[], asks: LiveBookLevel[], mid: number | null) {
  const binSize = relativeBinSize(mid);
  const bins = new Map<number, LiveLiquidityProfileBin>();
  const add = (level: LiveBookLevel, side: "bid" | "ask") => {
    const price = Math.round(level.price / binSize) * binSize;
    const current = bins.get(price) ?? { price, bidNotional: 0, askNotional: 0, totalNotional: 0 };
    if (side === "bid") current.bidNotional += level.notional;
    else current.askNotional += level.notional;
    current.totalNotional = current.bidNotional + current.askNotional;
    bins.set(price, current);
  };
  bids.forEach((level) => add(level, "bid"));
  asks.forEach((level) => add(level, "ask"));
  const ordered = [...bins.values()].sort((a, b) => a.price - b.price);
  return { binSize, ...valueArea(ordered), bins: ordered };
}

function buildExecutedVolumeProfile(trades: TradeRecord[], mid: number | null) {
  const binSize = relativeBinSize(mid);
  const bins = new Map<number, LiveExecutedVolumeProfileBin>();
  for (const trade of trades) {
    const price = Math.round(trade.price / binSize) * binSize;
    const current = bins.get(price) ?? { price, buyNotional: 0, sellNotional: 0, totalNotional: 0 };
    if (trade.aggressor === "BUY") current.buyNotional += trade.notional;
    else current.sellNotional += trade.notional;
    current.totalNotional = current.buyNotional + current.sellNotional;
    bins.set(price, current);
  }
  const ordered = [...bins.values()].sort((a, b) => a.price - b.price);
  const profile = valueArea(ordered);
  const positive = ordered.filter((bin) => bin.totalNotional > 0);
  const max = Math.max(...positive.map((bin) => bin.totalNotional), 0);
  const min = Math.min(...positive.map((bin) => bin.totalNotional), Infinity);
  const hvn = positive.filter((bin) => bin.totalNotional >= max * 0.8).map((bin) => bin.price);
  const lvn = positive.length > 2 ? positive.filter((bin) => bin.totalNotional <= min + (max - min) * 0.2).map((bin) => bin.price) : [];
  return {
    windowMs: EXECUTED_PROFILE_WINDOW_MS,
    binSize,
    ...profile,
    hvn,
    lvn,
    bins: ordered,
  };
}

function makeState(
  symbol: string,
  status: LiveOrderBookStatus,
  bidMap: Map<number, number>,
  askMap: Map<number, number>,
  trades: TradeRecord[],
  lastUpdateId: number | null,
  eventTime: number | null,
  error: string | null,
): LiveOrderBookState {
  const bids = topLevels(bidMap, "bid");
  const asks = topLevels(askMap, "ask");
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
  const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk;
  const bidDepthUsd = bids.reduce((sum, level) => sum + level.notional, 0);
  const askDepthUsd = asks.reduce((sum, level) => sum + level.notional, 0);
  const total = bidDepthUsd + askDepthUsd;
  const imbalancePct = total > 0 ? ((bidDepthUsd - askDepthUsd) / total) * 100 : 0;
  const pressure = imbalancePct >= 8 ? "BUY_PRESSURE" : imbalancePct <= -8 ? "SELL_PRESSURE" : "BALANCED";
  const aggressiveBuyNotional = trades.reduce((sum, trade) => sum + (trade.aggressor === "BUY" ? trade.notional : 0), 0);
  const aggressiveSellNotional = trades.reduce((sum, trade) => sum + (trade.aggressor === "SELL" ? trade.notional : 0), 0);
  const cvd = aggressiveBuyNotional - aggressiveSellNotional;
  const lastTradeTime = trades[trades.length - 1]?.time ?? null;
  const lastTrade = trades[trades.length - 1];
  const cvdDelta = lastTrade ? (lastTrade.aggressor === "BUY" ? lastTrade.notional : -lastTrade.notional) : 0;
  const aggressiveFlow = cvd >= Math.max(100, (aggressiveBuyNotional + aggressiveSellNotional) * 0.08) ? "BUY" : cvd <= -Math.max(100, (aggressiveBuyNotional + aggressiveSellNotional) * 0.08) ? "SELL" : "BALANCED";
  return {
    symbol: symbol.toUpperCase(),
    status,
    synced: status === "live" || status === "stale",
    bids,
    asks,
    bestBid,
    bestAsk,
    spread,
    spreadBps: spread != null && mid && mid > 0 ? (spread / mid) * 10_000 : null,
    bidDepthUsd,
    askDepthUsd,
    imbalancePct,
    pressure,
    liquidityProfile: buildLiquidityProfile(bids, asks, mid),
    executedVolumeProfile: buildExecutedVolumeProfile(trades, mid),
    executedTrades: trades.length,
    aggressiveBuyNotional,
    aggressiveSellNotional,
    aggressiveFlow,
    cvd,
    cvdDelta,
    lastTradeTime,
    lastUpdateId,
    eventTime,
    receivedAt: Date.now(),
    error,
  };
}

export interface BinanceOrderBookOptions {
  symbol: string;
  depthLimit?: number;
  onState: (state: LiveOrderBookState) => void;
}

export function createBinanceOrderBookWebSocket(options: BinanceOrderBookOptions) {
  const displaySymbol = options.symbol.trim().toUpperCase().replace(/USDT$/i, "");
  const streamSymbol = toSymbol(`${displaySymbol}USDT`);
  const depthLimit = Math.min(1000, Math.max(100, Math.floor(options.depthLimit ?? 1000)));
  let socket: WebSocket | null = null;
  let destroyed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let staleTimer: ReturnType<typeof setTimeout> | null = null;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let syncing = false;
  let resyncRequestedReason: string | null = null;
  let lastUpdateId: number | null = null;
  let eventTime: number | null = null;
  let bidMap = new Map<number, number>();
  let askMap = new Map<number, number>();
  let buffered: BinanceDepthEvent[] = [];
  let bufferedMode = true;
  let trades: TradeRecord[] = [];
  let latestState: LiveOrderBookState | null = null;

  const emit = (status: LiveOrderBookStatus, error: string | null = null) => {
    latestState = makeState(displaySymbol, status, bidMap, askMap, trades, lastUpdateId, eventTime, error);
    options.onState(latestState);
  };

  const scheduleRender = () => {
    if (renderTimer || destroyed) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (lastUpdateId != null) emit("live");
    }, RENDER_INTERVAL_MS);
  };

  const scheduleStaleCheck = () => {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
      if (destroyed) return;
      emit("stale", "order book stream không có update trong 8 giây");
      try { socket?.close(); } catch { /* reconnect via onclose */ }
    }, STALE_AFTER_MS);
  };

  const pruneTrades = (now: number) => {
    const cutoff = now - EXECUTED_PROFILE_WINDOW_MS;
    while (trades.length && (trades[0].time < cutoff || trades.length > MAX_TRADE_RECORDS)) trades.shift();
  };

  const applyTrade = (event: BinanceAggTradeEvent) => {
    const price = finitePositive(event.p);
    const qty = finitePositive(event.q);
    if (price == null || qty == null) return;
    const time = Number(event.T ?? event.E ?? Date.now());
    if (!Number.isFinite(time) || time <= 0) return;
    trades.push({
      price,
      qty,
      notional: price * qty,
      aggressor: event.m ? "SELL" : "BUY",
      time,
      id: Number.isFinite(Number(event.a)) ? Number(event.a) : null,
    });
    pruneTrades(time);
    eventTime = Math.max(eventTime ?? 0, Number(event.E ?? time));
    scheduleRender();
  };

  const resetBook = () => {
    lastUpdateId = null;
    eventTime = null;
    bidMap = new Map();
    askMap = new Map();
    buffered = [];
    bufferedMode = true;
    trades = [];
  };

  const applyEvent = (event: BinanceDepthEvent) => {
    if (event.U == null || event.u == null || event.u <= 0) return;
    if (lastUpdateId == null) return;
    if (event.u <= lastUpdateId) return;
    if (!isDepthEventContiguous(lastUpdateId, event)) {
      if (event.u <= lastUpdateId) return;
      const reason = "depth sequence gap — bắt buộc resync";
      if (syncing) resyncRequestedReason = reason;
      else void startSync(true, reason);
      return;
    }
    applyUpdates(bidMap, event.b);
    applyUpdates(askMap, event.a);
    lastUpdateId = event.u;
    eventTime = event.E ?? Date.now();
    scheduleStaleCheck();
    scheduleRender();
  };

  const applySnapshot = (snapshot: Snapshot) => {
    const snapshotId = Number(snapshot.lastUpdateId);
    if (!Number.isFinite(snapshotId) || snapshotId <= 0) throw new Error("snapshot thiếu lastUpdateId");
    bidMap = parseLevels(snapshot.bids);
    askMap = parseLevels(snapshot.asks);
    lastUpdateId = snapshotId;
    bufferedMode = false;
    const pending = buffered;
    buffered = [];
    const first = pending.find((event) => event.u != null && event.u > snapshotId);
    if (first && !isDepthEventContiguous(snapshotId, first)) {
      throw new Error("snapshot không nối được với diff sequence");
    }
    if (first) {
      const start = pending.indexOf(first);
      for (const event of pending.slice(start)) applyEvent(event);
    }
    if (resyncRequestedReason) throw new Error(resyncRequestedReason);
    emit("live");
    scheduleStaleCheck();
  };

  async function startSync(resync = false, reason: string | null = null) {
    if (destroyed || syncing) return;
    syncing = true;
    bufferedMode = true;
    buffered = [];
    emit(resync ? "resyncing" : "syncing", reason);
    try {
      const response = await api<Snapshot>(
        `/crypto/${encodeURIComponent(displaySymbol)}/orderbook?limit=${depthLimit}`,
        { timeoutMs: SNAPSHOT_TIMEOUT_MS, skipCache: true },
      );
      if (destroyed) return;
      applySnapshot(response.data);
      reconnectAttempt = 0;
    } catch (error) {
      if (!destroyed) {
        emit("error", error instanceof Error ? error.message : String(error));
        try { socket?.close(); } catch { /* reconnect via onclose */ }
      }
    } finally {
      syncing = false;
      const queuedReason = resyncRequestedReason;
      resyncRequestedReason = null;
      if (queuedReason && !destroyed) void startSync(true, queuedReason);
    }
  }

  const scheduleReconnect = () => {
    if (destroyed || reconnectTimer) return;
    reconnectAttempt += 1;
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 500 * 2 ** Math.min(reconnectAttempt - 1, 4));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (destroyed) return;
    resetBook();
    emit(reconnectAttempt > 0 ? "reconnecting" : "connecting");
    try {
      const streams = `${streamSymbol}@depth@100ms/${streamSymbol}@aggTrade`;
      socket = new WebSocket(`${WS_BASE}${streams}`);
    } catch (error) {
      emit("error", error instanceof Error ? error.message : String(error));
      scheduleReconnect();
      return;
    }
    socket.onopen = () => {
      void startSync(reconnectAttempt > 0);
    };
    socket.onmessage = (message) => {
      try {
        const envelope = JSON.parse(String(message.data)) as BinanceCombinedEvent;
        const event = envelope.data ?? envelope;
        if (event.e === "depthUpdate") {
          const depth = event as BinanceDepthEvent;
          if (depth.U == null || depth.u == null) return;
          if (bufferedMode) {
            buffered.push(depth);
            if (buffered.length > 2_000) buffered.splice(0, buffered.length - 2_000);
          } else applyEvent(depth);
          scheduleStaleCheck();
        } else if (event.e === "aggTrade") {
          applyTrade(event as BinanceAggTradeEvent);
          scheduleStaleCheck();
        }
      } catch {
        emit("error", "payload Binance không hợp lệ");
      }
    };
    socket.onerror = () => emit("error", "Binance order book WebSocket error");
    socket.onclose = () => {
      if (destroyed) return;
      socket = null;
      syncing = false;
      scheduleReconnect();
    };
  };

  const disconnect = () => {
    destroyed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (staleTimer) clearTimeout(staleTimer);
    if (renderTimer) clearTimeout(renderTimer);
    reconnectTimer = null;
    staleTimer = null;
    renderTimer = null;
    try { socket?.close(); } catch { /* ignore */ }
    socket = null;
    emit("disconnected");
  };

  connect();
  return {
    disconnect,
    resync: () => {
      if (!destroyed) void startSync(true, "manual resync");
    },
    getState: () => latestState,
  };
}
