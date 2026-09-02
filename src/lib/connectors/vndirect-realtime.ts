import { forProvider } from "@/lib/logger";
import type {
  ForeignFlowSnapshot,
  OrderBookSnapshot,
  StockMicrostructureSnapshot,
} from "./microstructure";

const log = forProvider("vndirect-realtime");

/**
 * VNDirect real-time market feed (public WebSocket).
 *
 * Protocol (see VNDIRECT/price-feed):
 *   - Connect: wss://price-cmc-*.vndirect.com.vn/realtime/websocket
 *   - Subscribe: { type: "registConsumer", data: { sequence, params: { name, codes } } }
 *   - BA ("BidAsk")  -> top-3 bid/ask prices + quantities, match price, totals.
 *   - SP ("StockPartial") -> current price, foreign buy/sell qty, room.
 */
const DEFAULT_WS_HOSTS = [
  "wss://price-cmc-01.vndirect.com.vn/realtime/websocket",
  "wss://price-cmc-02.vndirect.com.vn/realtime/websocket",
  "wss://price-cmc-03.vndirect.com.vn/realtime/websocket",
  "wss://price-cmc-04.vndirect.com.vn/realtime/websocket",
  "wss://price-cmc-05.vndirect.com.vn/realtime/websocket",
];

const SNAPSHOT_TIMEOUT_MS = 4_000;
const CONNECT_TIMEOUT_MS = 3_500;
const BID_ASK = "BA";
const STOCK_PARTIAL = "SP";
const BID_ASK_LEVELS = 3;

interface VndirectRow {
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

/** Parse the BA (BidAsk) array sent by VNDirect. */
function arr2ba(arr: unknown[]): VndirectRow | null {
  const row: VndirectRow = {
    time: arr[0] ?? null,
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
    accumulatedVol: asNumber(arr[14]),
    matchPrice: asNumber(arr[15]),
    matchQtty: asNumber(arr[16]),
    matchValue: asNumber(arr[17]),
    totalOfferQtty: asNumber(arr[18]),
    totalBidQtty: asNumber(arr[19]),
  };
  return row.code ? row : null;
}

/** Parse the SP (StockPartial) array sent by VNDirect. */
function arr2sp(arr: unknown[]): VndirectRow | null {
  const row: VndirectRow = {
    floorCode: arr[0] ?? null,
    tradingDate: arr[1] ?? null,
    time: arr[2] ?? null,
    code: arr[3] ?? null,
    companyName: arr[4] ?? null,
    stockType: arr[5] ?? null,
    totalRoom: asNumber(arr[6]),
    currentRoom: asNumber(arr[7]),
    basicPrice: asNumber(arr[8]),
    openPrice: asNumber(arr[9]),
    closePrice: asNumber(arr[10]),
    currentPrice: asNumber(arr[11]),
    currentQtty: asNumber(arr[12]),
    highestPrice: asNumber(arr[13]),
    lowestPrice: asNumber(arr[14]),
    ceilingPrice: asNumber(arr[15]),
    floorPrice: asNumber(arr[16]),
    averagePrice: asNumber(arr[17]),
    accumulatedVal: asNumber(arr[18]),
    buyForeignQtty: asNumber(arr[19]),
    sellForeignQtty: asNumber(arr[20]),
    projectOpen: asNumber(arr[21]),
    sequence: arr[22] ?? null,
  };
  return row.code ? row : null;
}

function wsHosts(): string[] {
  const fromEnv = process.env.VNDIRECT_REALTIME_WS_URLS?.split(",")
    .map((s) => s.trim())
    .filter((s) => /^wss?:\/\//.test(s));
  return fromEnv?.length ? fromEnv : DEFAULT_WS_HOSTS;
}

function subscribeMessage(name: string, codes: string[]): string {
  return JSON.stringify({
    type: "registConsumer",
    data: {
      sequence: 0,
      params: { name, codes },
    },
  });
}

interface VndirectSnapshotPayload {
  ba: VndirectRow | null;
  sp: VndirectRow | null;
  host: string;
}

/**
 * Open a VNDirect realtime WebSocket, subscribe to BA + SP for the symbol and
 * resolve once a snapshot has been collected (or when the timeout elapses).
 */
async function fetchSnapshotFromHost(
  host: string,
  symbol: string,
): Promise<VndirectSnapshotPayload> {
  return new Promise<VndirectSnapshotPayload>((resolve, reject) => {
    let settled = false;
    let ba: VndirectRow | null = null;
    let sp: VndirectRow | null = null;
    let socket: WebSocket | null = null;
    const connectTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket?.close(); } catch { /* ignore */ }
      reject(new Error(`VNDirect connect timeout for ${host}`));
    }, CONNECT_TIMEOUT_MS);

    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      try { socket?.close(); } catch { /* ignore */ }
      if (ok) {
        resolve({ ba, sp, host });
      } else {
        reject(new Error(`VNDirect snapshot failed for ${symbol} on ${host}`));
      }
    };

    const snapshotTimer = setTimeout(() => {
      // Timeout: return whatever we have (BA is the critical order-book leg).
      if (settled) return;
      if (ba) {
        finish(true);
      } else {
        finish(false);
      }
    }, SNAPSHOT_TIMEOUT_MS);

    try {
      socket = new WebSocket(host);
    } catch (err) {
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(snapshotTimer);
      reject(err instanceof Error ? err : new Error("VNDirect WebSocket construction failed"));
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
        const msgType = obj.type;
        const data = obj.data;
        if (!Array.isArray(data)) return;
        if (msgType === BID_ASK) {
          const row = arr2ba(data);
          if (row && String(row.code).toUpperCase() === symbol) {
            ba = row;
            if (sp) finish(true);
          }
        } else if (msgType === STOCK_PARTIAL) {
          const row = arr2sp(data);
          if (row && String(row.code).toUpperCase() === symbol) {
            sp = row;
            if (ba) finish(true);
          }
        }
      } catch { /* ignore malformed frames */ }
    };

    socket.onerror = () => {
      // Fall through to close / timeout handling.
    };

    socket.onclose = () => {
      if (!settled) {
        clearTimeout(connectTimer);
        clearTimeout(snapshotTimer);
        settle(ba ? true : false);
      }
    };

    // Helper to settle once on close without a second path.
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(snapshotTimer);
      if (ok) resolve({ ba, sp, host });
      else reject(new Error(`VNDirect WebSocket closed before snapshot (${host})`));
    };
  });
}

function buildOrderBook(ba: VndirectRow): OrderBookSnapshot {
  const bids: Array<{ price: number; volume: number }> = [];
  const asks: Array<{ price: number; volume: number }> = [];
  for (let i = 1; i <= BID_ASK_LEVELS; i += 1) {
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
  const spread =
    bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
  const imbalance =
    bidVol + askVol > 0 ? ((bidVol - askVol) / (bidVol + askVol)) * 100 : null;

  // Values below are displayed as "tỷ đồng": price(VND) * qty / 1e9.
  const bidValue = ((totalBidQtty ?? bidVol) * matchPrice) / 1e9;
  const askValue = ((totalOfferQtty ?? askVol) * matchPrice) / 1e9;

  return {
    bids,
    asks,
    bidValue,
    askValue,
    imbalancePct: imbalance != null ? Number(imbalance.toFixed(2)) : null,
    spread,
    status: "live",
    source: "vndirect-realtime",
    confidence: 0.9,
    updatedAt: Date.now() / 1000,
  };
}

function buildForeignFlow(sp: VndirectRow): ForeignFlowSnapshot {
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
    updatedAt: Date.now() / 1000,
  };
}

export async function getVndirectMicrostructure(
  symbol: string,
): Promise<StockMicrostructureSnapshot> {
  const sym = symbol.toUpperCase();
  const hosts = wsHosts();
  let lastError: unknown = null;

  for (const host of hosts) {
    try {
      const { ba, sp } = await fetchSnapshotFromHost(host, sym);
      if (!ba) {
        throw new Error(`VNDirect returned no order book for ${sym}`);
      }
      const orderBook = buildOrderBook(ba);
      const foreignFlow = sp
        ? buildForeignFlow(sp)
        : ({
            buyValue: null,
            sellValue: null,
            netValue: null,
            buyVolume: null,
            sellVolume: null,
            foreignRoomPct: null,
            status: "unavailable" as const,
            source: "vndirect-realtime",
            confidence: 0,
            updatedAt: Date.now() / 1000,
          } as ForeignFlowSnapshot);
      return { symbol: sym, orderBook, foreignFlow, generatedAt: Date.now() / 1000 };
    } catch (err) {
      lastError = err;
      log.warn("vndirect_realtime_host_failed", {
        symbol: sym,
        host,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  throw new Error(
    `VNDirect realtime unavailable for ${sym}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}
