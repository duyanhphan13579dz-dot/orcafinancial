"use client";

export interface BinanceTicker {
  symbol: string;
  price: number;
  eventTime: number;
}

export interface BinanceKline {
  symbol: string;
  interval: string;
  startTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
}

interface BinanceKlineMessage {
  e?: string;
  E?: number;
  s?: string;
  k?: {
    t: number;
    T: number;
    s: string;
    i: string;
    o: string;
    c: string;
    h: string;
    l: string;
    v: string;
    x: boolean;
  };
}

interface BinanceTickerMessage {
  e?: string;
  E?: number;
  s?: string;
  c?: string;
}

interface BinanceWebSocketOptions {
  symbol: string;
  timeframe: string;

  onTicker?: (
    ticker: BinanceTicker,
  ) => void;

  onKline?: (
    kline: BinanceKline,
  ) => void;

  onStatus?: (
    status:
      | "connecting"
      | "connected"
      | "reconnecting"
      | "disconnected"
      | "error",
  ) => void;
}

const WS_BASE =
  "wss://stream.binance.com:9443/stream";

const RECONNECT_BASE_DELAY = 1000;
const MAX_RECONNECT_DELAY = 10000;

function normalizeSymbol(
  symbol: string,
) {
  return symbol
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeTimeframe(
  timeframe: string,
) {
  const allowed = [
    "1m",
    "3m",
    "5m",
    "15m",
    "30m",
    "1h",
    "2h",
    "4h",
    "6h",
    "8h",
    "12h",
    "1d",
  ];

  return allowed.includes(
    timeframe,
  )
    ? timeframe
    : "1h";
}

export function createBinanceWebSocket(
  options: BinanceWebSocketOptions,
) {
  const symbol =
    normalizeSymbol(
      options.symbol,
    );

  const timeframe =
    normalizeTimeframe(
      options.timeframe,
    );

  let socket: WebSocket | null =
    null;

  let destroyed = false;

  let reconnectTimer:
    | ReturnType<typeof setTimeout>
    | null = null;

  let reconnectAttempt = 0;

  let heartbeatTimer:
    | ReturnType<typeof setTimeout>
    | null = null;

  function clearTimers() {
    if (reconnectTimer) {
      clearTimeout(
        reconnectTimer,
      );

      reconnectTimer = null;
    }

    if (heartbeatTimer) {
      clearTimeout(
        heartbeatTimer,
      );

      heartbeatTimer = null;
    }
  }

  function scheduleHeartbeat() {
    if (destroyed) {
      return;
    }

    if (heartbeatTimer) {
      clearTimeout(
        heartbeatTimer,
      );
    }

    /*
     * Binance stream có thể bị đóng nếu
     * connection không còn hoạt động.
     *
     * Chủ động kiểm tra định kỳ.
     */
    heartbeatTimer =
      setTimeout(() => {
        if (
          socket?.readyState ===
          WebSocket.OPEN
        ) {
          socket.send(
            JSON.stringify({
              method: "LIST_SUBSCRIPTIONS",
              id: Date.now(),
            }),
          );
        }

        scheduleHeartbeat();
      }, 25_000);
  }

  function connect() {
    if (destroyed) {
      return;
    }

    options.onStatus?.(
      reconnectAttempt > 0
        ? "reconnecting"
        : "connecting",
    );

    const streams = [
      `${symbol}@ticker`,
      `${symbol}@kline_${timeframe}`,
    ].join("/");

    const url =
      `${WS_BASE}?streams=${streams}`;

    try {
      socket =
        new WebSocket(url);
    } catch {
      options.onStatus?.(
        "error",
      );

      scheduleReconnect();

      return;
    }

    socket.onopen = () => {
      reconnectAttempt = 0;

      options.onStatus?.(
        "connected",
      );

      scheduleHeartbeat();
    };

    socket.onmessage = (
      event,
    ) => {
      try {
        const message =
          JSON.parse(
            event.data,
          );

        const data =
          message.data ?? message;

        /*
         * ------------------------------------------------------
         * TICKER
         * ------------------------------------------------------
         */
        if (
          data.e ===
            "24hrTicker" &&
          data.s &&
          data.c
        ) {
          options.onTicker?.({
            symbol: data.s,
            price: Number(
              data.c,
            ),
            eventTime:
              Number(
                data.E ??
                  Date.now(),
              ),
          });

          return;
        }

        /*
         * ------------------------------------------------------
         * KLINE
         * ------------------------------------------------------
         */
        if (
          data.e === "kline" &&
          data.k
        ) {
          const k =
            data.k;

          options.onKline?.({
            symbol:
              k.s,

            interval:
              k.i,

            startTime:
              Number(k.t),

            closeTime:
              Number(k.T),

            open:
              Number(k.o),

            high:
              Number(k.h),

            low:
              Number(k.l),

            close:
              Number(k.c),

            volume:
              Number(k.v),

            isClosed:
              Boolean(k.x),
          });
        }
      } catch {
        /*
         * Ignore malformed websocket payload.
         */
      }
    };

    socket.onerror = () => {
      options.onStatus?.(
        "error",
      );
    };

    socket.onclose = () => {
      socket = null;

      clearTimers();

      if (destroyed) {
        options.onStatus?.(
          "disconnected",
        );

        return;
      }

      options.onStatus?.(
        "reconnecting",
      );

      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (
      destroyed ||
      reconnectTimer
    ) {
      return;
    }

    reconnectAttempt += 1;

    const delay =
      Math.min(
        MAX_RECONNECT_DELAY,
        RECONNECT_BASE_DELAY *
          Math.pow(
            2,
            Math.min(
              reconnectAttempt - 1,
              4,
            ),
          ),
      );

    reconnectTimer =
      setTimeout(() => {
        reconnectTimer = null;

        connect();
      }, delay);
  }

  function disconnect() {
    destroyed = true;

    clearTimers();

    if (socket) {
      socket.onclose =
        null;

      socket.onerror =
        null;

      socket.onmessage =
        null;

      if (
        socket.readyState ===
          WebSocket.OPEN ||
        socket.readyState ===
          WebSocket.CONNECTING
      ) {
        socket.close();
      }

      socket = null;
    }

    options.onStatus?.(
      "disconnected",
    );
  }

  connect();

  return {
    disconnect,
  };
}
