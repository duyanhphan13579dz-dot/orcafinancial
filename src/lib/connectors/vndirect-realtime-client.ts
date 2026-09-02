"use client";

import type {
  ForeignFlowSnapshot,
  OrderBookSnapshot,
  StockMicrostructureSnapshot,
} from "./microstructure";

const DEFAULT_WS_HOSTS = [
  "wss://price-cmc-01.vndirect.com.vn/realtime/websocket",
  "wss://price-cmc-02.vndirect.com.vn/realtime/websocket",
  "wss://price-cmc-03.vndirect.com.vn/realtime/websocket",
  "wss://price-cmc-04.vndirect.com.vn/realtime/websocket",
  "wss://price-cmc-05.vndirect.com.vn/realtime/websocket",
];

const BID_ASK = "BA";
const STOCK_PARTIAL = "SP";
const LEVELS = 3;
const MAX_RECONNECT_MS = 15_000;

export type VndirectMicroStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "unavailable";

export interface VndirectMicroOptions {
  symbol: string;
  onSnapshot?: (snapshot: StockMicrostructureSnapshot) => void;
  onStatus?: (status: VndirectMicroStatus) => void;
}

interface Row {
  [key: string]: unknown;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function arr2ba(arr: unknown[]): Row | null {
  const row: Row = {
    code: arr[1] ?? null,
    bidPrice01: asNumber(arr[2]),
    bidQtty01: asNumber(arr[3]),
    bidPrice02: asNumber(arr[4]),
    bidQtty02: asNumber(arr[5]),
    bidPrice03: asNumber(arr[6]),
    bidQtty03: asNumber(arr[7]),
    offerPrice01: asNumber(arr[8]),
    offerQtty01: asNumber(arr[9]),
    offerPrice02: asNumber(arr[10]),
    offerQtty02: asNumber(arr[11]),
    offerPrice03: asNumber(arr[12]),
    offerQtty03: asNumber(arr[13]),
    matchPrice: asNumber(arr[15]),
    totalOfferQtty: asNumber(arr[18]),
    totalBidQtty: asNumber(arr[19]),
  };
  return row.code ? row : null;
}

function arr2sp(arr: unknown[]): Row | null {
  const row: Row = {
    code: arr[3] ?? null,
    totalRoom: asNumber(arr[6]),
    currentRoom: asNumber(arr[7]),
    currentPrice: asNumber(arr[11]),
    buyForeignQtty: asNumber(arr[19]),
    sellForeignQtty: asNumber(arr[20]),
  };
  return row.code ? row : null;
}

function buildOrderBook(ba: Row): OrderBookSnapshot {
  const bids: Array<{ price: number; volume: number }> = [];
  const asks: Array<{ price: number; volume: number }> = [];
  for (let i = 1; i <= LEVELS; i += 1) {
    const bidPrice = asNumber(ba[`bidPrice0${i}`]);
    const bidQtty = asNumber(ba[`bidQtty0${i}`]);
    const offerPrice = asNumber(ba[`offerPrice0${i}`]);
    const offerQtty = asNumber(ba[`offerQtty0${i}`]);
    if (bidPrice != null && bidPrice > 0) bids.push({ price: bidPrice, volume: bidQtty ?? 0 });
    if (offerPrice != null && offerPrice > 0) asks.push({ price: offerPrice, volume: offerQtty ?? 0 });
  }
  bids.sort((a, b) => b.price - a.price);
  asks.sort((a, b) => a.price - b.price);

  const matchPrice = asNumber(ba.matchPrice) ?? bids[0]?.price ?? asks[0]?.price ?? 0;
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const totalBidQtty = asNumber(ba.totalBidQtty);
  const totalOfferQtty = asNumber(ba.totalOfferQtty);
  const bidVol = bids.reduce((sum, l) => sum + l.volume, 0);
  const askVol = asks.reduce((sum, l) => sum + l.volume, 0);
  const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
  const imbalance = bidVol + askVol > 0 ? ((bidVol - askVol) / (bidVol + askVol)) * 100 : null;

  return {
    bids,
    asks,
    bidValue: ((totalBidQtty ?? bidVol) * matchPrice) / 1e9,
    askValue: ((totalOfferQtty ?? askVol) * matchPrice) / 1e9,
    imbalancePct: imbalance != null ? Number(imbalance.toFixed(2)) : null,
    spread,
    status: "live",
    source: "vndirect-realtime",
    confidence: 0.9,
    updatedAt: Math.floor(Date.now() / 1000),
  };
}

function buildForeignFlow(sp: Row): ForeignFlowSnapshot {
  const currentPrice = asNumber(sp.currentPrice) ?? 0;
  const buyForeignQtty = asNumber(sp.buyForeignQtty) ?? 0;
  const sellForeignQtty = asNumber(sp.sellForeignQtty) ?? 0;
  const totalRoom = asNumber(sp.totalRoom) ?? 0;
  const currentRoom = asNumber(sp.currentRoom) ?? 0;
  const buyValue = (buyForeignQtty * currentPrice) / 1e9;
  const sellValue = (sellForeignQtty * currentPrice) / 1e9;
  const roomPct = totalRoom > 0 ? (currentRoom / totalRoom) * 100 : null;

  return {
    buyValue,
    sellValue,
    netValue: buyValue - sellValue,
    buyVolume: buyForeignQtty,
    sellVolume: sellForeignQtty,
    foreignRoomPct: roomPct != null ? Number(roomPct.toFixed(2)) : null,
    status: currentPrice > 0 ? "live" : "delayed",
    source: "vndirect-realtime",
    confidence: 0.88,
    updatedAt: Math.floor(Date.now() / 1000),
  };
}

function subscribeMessage(name: string, codes: string[]): string {
  return JSON.stringify({
    type: "registConsumer",
    data: { sequence: 0, params: { name, codes } },
  });
}

/**
 * Open a VNDirect realtime WebSocket directly from the browser and stream the
 * order book (BA) + foreign flow (SP) for a symbol.
 */
export function createVndirectMicrostructureWebSocket(
  options: VndirectMicroOptions,
) {
  const symbol = options.symbol.toUpperCase();
  let destroyed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let hostIndex = 0;
  let ba: Row | null = null;
  let sp: Row | null = null;

  const hosts = DEFAULT_WS_HOSTS;

  const status = (value: VndirectMicroStatus) => options.onStatus?.(value);

  const emit = () => {
    if (destroyed || !ba) return;
    options.onSnapshot?.({
      symbol,
      orderBook: buildOrderBook(ba),
      foreignFlow: sp
        ? buildForeignFlow(sp)
        : ({
            buyValue: null,
            sellValue: null,
            netValue: null,
            buyVolume: null,
            sellVolume: null,
            foreignRoomPct: null,
            status: "unavailable",
            source: "vndirect-realtime",
            confidence: 0,
            updatedAt: Math.floor(Date.now() / 1000),
          } as ForeignFlowSnapshot),
      generatedAt: Math.floor(Date.now() / 1000),
    });
  };

  const open = () => {
    // Skip hosts already tried this session; then cycle.
    const host = hosts[hostIndex % hosts.length];
    hostIndex += 1;
    if (destroyed) return;
    try {
      socket = new WebSocket(host);
    } catch {
      scheduleReconnect();
      return;
    }
    socket.onopen = () => {
      try {
        socket?.send(subscribeMessage(BID_ASK, [symbol]));
        socket?.send(subscribeMessage(STOCK_PARTIAL, [symbol]));
      } catch { /* ignore */ }
    };
    socket.onmessage = (event) => {
      try {
        const text = typeof event.data === "string" ? event.data : String(event.data);
        const obj = JSON.parse(text) as { type?: string; data?: unknown };
        if (!Array.isArray(obj.data)) return;
        if (obj.type === BID_ASK) {
          const row = arr2ba(obj.data);
          if (row && String(row.code).toUpperCase() === symbol) {
            ba = row;
            emit();
            status("live");
          }
        } else if (obj.type === STOCK_PARTIAL) {
          const row = arr2sp(obj.data);
          if (row && String(row.code).toUpperCase() === symbol) {
            sp = row;
            emit();
          }
        }
      } catch { /* ignore malformed frames */ }
    };
    socket.onerror = () => { /* handled by close */ };
    socket.onclose = () => {
      socket = null;
      if (!destroyed) {
        status("reconnecting");
        scheduleReconnect();
      }
    };
  };

  const scheduleReconnect = () => {
    if (destroyed || reconnectTimer) return;
    const delay = Math.min(MAX_RECONNECT_MS, 500 * 2 ** Math.min(reconnectAttempt++, 5));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delay);
  };

  const disconnect = () => {
    destroyed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.onopen = null;
      try { socket.close(); } catch { /* ignore */ }
    }
    socket = null;
  };

  status("connecting");

  const connect = () => {
    reconnectAttempt = 0;
    open();
  };
  connect();

  return { disconnect };
}
