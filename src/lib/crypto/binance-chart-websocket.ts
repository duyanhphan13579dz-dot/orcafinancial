"use client";

export interface BinanceChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime?: number;
  quoteVolume?: number;
  trades?: number;
  takerBuyBaseVolume?: number;
  takerBuyQuoteVolume?: number;
  isClosed?: boolean;
}

export interface BinanceLiveTicker {
  symbol: string;
  price: number;
  eventTime: number;
  change24h: number | null;
  volume24h: number | null;
}

export type BinanceChartStatus =
  | "connecting"
  | "loading-history"
  | "connected"
  | "live"
  | "reconnecting"
  | "error"
  | "stale"
  | "disconnected";

export interface BinanceChartHistory {
  bars: BinanceChartBar[];
  hasMore: boolean;
  source: "binance-websocket-api";
}

export interface BinanceChartWebSocketOptions {
  symbol: string;
  timeframe: string;
  onHistory: (history: BinanceChartHistory) => void;
  onKline: (bar: BinanceChartBar) => void;
  onTicker: (ticker: BinanceLiveTicker) => void;
  onStatus?: (status: BinanceChartStatus, error?: string | null) => void;
}

interface PendingRequest {
  resolve: (value: BinanceChartHistory) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  limit: number;
}

interface StreamMessage {
  stream?: string;
  data?: Record<string, unknown>;
  e?: string;
  E?: number;
  s?: string;
  c?: string;
  P?: string;
  q?: string;
  k?: Record<string, unknown>;
}

const STREAM_BASE = "wss://stream.binance.com:9443/stream?streams=";
const WS_API_URL = "wss://ws-api.binance.com:443/ws-api/v3";
const HISTORY_TIMEOUT_MS = 7_000;
const MAX_RECONNECT_DELAY_MS = 8_000;
const STREAM_STALE_MS = 15_000;
const STREAM_WATCHDOG_INTERVAL_MS = 5_000;
const MAX_HISTORY_LIMIT = 1_000;
const ALLOWED_TIMEFRAMES = new Set([
  "1s", "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M",
]);

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeTimeframe(timeframe: string) {
  return ALLOWED_TIMEFRAMES.has(timeframe) ? timeframe : "1h";
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseKline(row: unknown): BinanceChartBar | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const time = Number(row[0]);
  const open = Number(row[1]);
  const high = Number(row[2]);
  const low = Number(row[3]);
  const close = Number(row[4]);
  const volume = Number(row[5]);
  if (![time, open, high, low, close, volume].every(Number.isFinite)) return null;
  return {
    time: Math.floor(time / 1000),
    open,
    high,
    low,
    close,
    volume,
    closeTime: Number.isFinite(Number(row[6])) ? Number(row[6]) : undefined,
    quoteVolume: Number.isFinite(Number(row[7])) ? Number(row[7]) : undefined,
    trades: Number.isFinite(Number(row[8])) ? Number(row[8]) : undefined,
    takerBuyBaseVolume: Number.isFinite(Number(row[9])) ? Number(row[9]) : undefined,
    takerBuyQuoteVolume: Number.isFinite(Number(row[10])) ? Number(row[10]) : undefined,
    isClosed: Number(row[6]) <= Date.now(),
  };
}

function parseStreamBar(message: StreamMessage): BinanceChartBar | null {
  const k = message.k;
  if (!k || message.e !== "kline") return null;
  const row = [k.t, k.o, k.h, k.l, k.c, k.v, k.T, k.q, k.n, k.V, k.Q];
  const bar = parseKline(row);
  return bar ? { ...bar, isClosed: k.x === true } : null;
}

function unwrap(message: unknown): StreamMessage | null {
  if (!message || typeof message !== "object") return null;
  const value = message as StreamMessage;
  if (value.data && typeof value.data === "object") return value.data as StreamMessage;
  return value;
}

export function createBinanceChartWebSocket(options: BinanceChartWebSocketOptions) {
  const symbol = normalizeSymbol(options.symbol);
  const timeframe = normalizeTimeframe(options.timeframe);
  const streamSymbol = symbol.endsWith("USDT") ? symbol : `${symbol}USDT`;
  const streamName = streamSymbol.toLowerCase();
  const historyQueue: Array<{ id: string; params: Record<string, unknown> }> = [];
  const pending = new Map<string, PendingRequest>();
  let streamSocket: WebSocket | null = null;
  let apiSocket: WebSocket | null = null;
  let destroyed = false;
  let apiReady = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let streamWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  let lastStreamMessageAt = 0;
  let apiReconnectAttempt = 0;
  let apiReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let historyRequestId = 0;

  const status = (value: BinanceChartStatus, error: string | null = null) => {
    if (!destroyed) options.onStatus?.(value, error);
  };

  const scheduleReconnect = () => {
    if (destroyed || reconnectTimer) return;
    reconnectAttempt += 1;
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 500 * 2 ** Math.min(reconnectAttempt - 1, 4));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectStream();
    }, delay);
  };

  const connectStream = () => {
    if (destroyed) return;
    status(reconnectAttempt ? "reconnecting" : "connecting");
    try {
      streamSocket = new WebSocket(`${STREAM_BASE}${streamName}@ticker/${streamName}@kline_${timeframe}`);
    } catch (error) {
      status("error", error instanceof Error ? error.message : String(error));
      scheduleReconnect();
      return;
    }
    streamSocket.onopen = () => {
      reconnectAttempt = 0;
      lastStreamMessageAt = Date.now();
      status("connected");
    };
    streamSocket.onmessage = (event) => {
      try {
        lastStreamMessageAt = Date.now();
        const message = unwrap(JSON.parse(String(event.data)));
        if (!message) return;
      if (message.e === "24hrTicker") {
        const price = positiveNumber(message.c);
        if (price == null) return;
        options.onTicker({
          symbol: String(message.s ?? streamSymbol),
          price,
          eventTime: Number(message.E ?? Date.now()),
          change24h: Number.isFinite(Number(message.P)) ? Number(message.P) : null,
          volume24h: Number.isFinite(Number(message.q)) ? Number(message.q) : null,
        });
        return;
      }
        const bar = parseStreamBar(message);
        if (bar) {
          options.onKline(bar);
          status("live");
        }
      } catch (error) {
        status("error", error instanceof Error ? error.message : "Invalid Binance market stream payload");
      }
    };
    streamSocket.onerror = () => status("error", "Binance market stream error");
    streamSocket.onclose = () => {
      streamSocket = null;
      if (!destroyed) {
        status("reconnecting");
        scheduleReconnect();
      }
    };
  };

  const rejectPending = (message: string) => {
    for (const [id, request] of pending) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
      pending.delete(id);
    }
  };

  const flushHistoryQueue = () => {
    if (!apiSocket || apiSocket.readyState !== WebSocket.OPEN) return;
    for (const request of historyQueue.splice(0)) {
      apiSocket.send(JSON.stringify({ id: request.id, method: "klines", params: request.params }));
    }
  };

  const scheduleApiReconnect = () => {
    if (destroyed || apiReconnectTimer || !historyQueue.length) return;
    apiReconnectAttempt += 1;
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 500 * 2 ** Math.min(apiReconnectAttempt - 1, 4));
    apiReconnectTimer = setTimeout(() => {
      apiReconnectTimer = null;
      connectApi();
    }, delay);
  };

  const connectApi = () => {
    if (destroyed || apiSocket) return;
    try {
      apiSocket = new WebSocket(WS_API_URL);
    } catch (error) {
      status("error", error instanceof Error ? error.message : String(error));
      return;
    }
    apiSocket.onopen = () => {
      apiReconnectAttempt = 0;
      apiReady = true;
      flushHistoryQueue();
    };
    apiSocket.onmessage = (event) => {
      try {
        const response = JSON.parse(String(event.data)) as { id?: string; status?: number; result?: unknown; error?: { msg?: string } };
        if (!response.id) return;
        const request = pending.get(response.id);
        if (!request) return;
        pending.delete(response.id);
        clearTimeout(request.timer);
        if (response.status !== 200 || !Array.isArray(response.result)) {
          request.reject(new Error(response.error?.msg ?? "Binance WebSocket kline history error"));
          return;
        }
        const bars = response.result.map(parseKline).filter((bar): bar is BinanceChartBar => bar !== null).sort((a, b) => a.time - b.time);
        const history = { bars, hasMore: bars.length >= request.limit, source: "binance-websocket-api" as const };
        options.onHistory(history);
        request.resolve(history);
      } catch (error) {
        status("error", error instanceof Error ? error.message : "Invalid Binance WebSocket API payload");
      }
    };
    apiSocket.onerror = () => status("error", "Binance WebSocket API error");
    apiSocket.onclose = () => {
      apiReady = false;
      apiSocket = null;
      if (!destroyed) {
        status("reconnecting", "history socket disconnected; stream remains available");
        scheduleApiReconnect();
      }
    };
  };

  const loadHistory = (limit = 200, endTime?: number) => {
    const safeLimit = Math.min(MAX_HISTORY_LIMIT, Math.max(20, Math.floor(limit)));
    const id = `klines-${Date.now()}-${historyRequestId++}`;
    const params: Record<string, unknown> = { symbol: streamSymbol, interval: timeframe, limit: safeLimit, timeZone: "0" };
    if (endTime != null && Number.isFinite(endTime)) params.endTime = Math.max(0, Math.floor(endTime));
    status("loading-history");
    return new Promise<BinanceChartHistory>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Binance WebSocket kline history timeout"));
      }, HISTORY_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer, limit: safeLimit });
      if (apiReady && apiSocket?.readyState === WebSocket.OPEN) {
        apiSocket.send(JSON.stringify({ id, method: "klines", params }));
      } else {
        historyQueue.push({ id, params });
        if (!apiSocket || apiSocket.readyState === WebSocket.CLOSED || apiSocket.readyState === WebSocket.CLOSING) connectApi();
      }
    });
  };

  const disconnect = () => {
    destroyed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (apiReconnectTimer) clearTimeout(apiReconnectTimer);
    if (streamWatchdogTimer) clearInterval(streamWatchdogTimer);
    reconnectTimer = null;
    apiReconnectTimer = null;
    streamWatchdogTimer = null;
    rejectPending("Binance chart connection closed");
    historyQueue.length = 0;
    for (const socket of [streamSocket, apiSocket]) {
      if (!socket) continue;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.onopen = null;
      try { socket.close(); } catch { /* ignore */ }
    }
    streamSocket = null;
    apiSocket = null;
    status("disconnected");
    options.onStatus?.("disconnected");
  };

  streamWatchdogTimer = setInterval(() => {
    if (destroyed || !streamSocket || streamSocket.readyState !== WebSocket.OPEN) return;
    if (lastStreamMessageAt > 0 && Date.now() - lastStreamMessageAt > STREAM_STALE_MS) {
      status("stale", "Binance market stream is stale; reconnecting");
      try { streamSocket.close(); } catch { /* ignore */ }
    }
  }, STREAM_WATCHDOG_INTERVAL_MS);

  connectStream();
  connectApi();

  return { loadHistory, disconnect };
}
