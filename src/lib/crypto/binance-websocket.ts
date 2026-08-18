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

interface BinanceKlinePayload {
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
}

interface BinanceTickerPayload {
  e?: string;
  E?: number;
  s?: string;
  c?: string;
}

interface BinanceKlineMessage {
  e?: string;
  E?: number;
  s?: string;
  k?: BinanceKlinePayload;
}

interface BinanceStreamMessage {
  stream?: string;
  data?: BinanceKlineMessage;
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
): string {
  return symbol
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeTimeframe(
  timeframe: string,
): string {
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

  return allowed.includes(timeframe)
    ? timeframe
    : "1h";
}

/* -------------------------------------------------------------------------- */
/*                               TYPE GUARDS                                  */
/* -------------------------------------------------------------------------- */

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null
  );
}

function isTickerMessage(
  value: unknown,
): value is BinanceTickerPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.e === "24hrTicker" &&
    typeof value.s === "string" &&
    typeof value.c === "string"
  );
}

function isKlineMessage(
  value: unknown,
): value is BinanceKlineMessage {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.e !== "kline" ||
    !isRecord(value.k)
  ) {
    return false;
  }

  const k = value.k;

  return (
    typeof k.t === "number" &&
    typeof k.T === "number" &&
    typeof k.s === "string" &&
    typeof k.i === "string" &&
    typeof k.o === "string" &&
    typeof k.c === "string" &&
    typeof k.h === "string" &&
    typeof k.l === "string" &&
    typeof k.v === "string" &&
    typeof k.x === "boolean"
  );
}

/* -------------------------------------------------------------------------- */
/*                           WEBSOCKET FACTORY                                */
/* -------------------------------------------------------------------------- */

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

  /* ------------------------------------------------------------------------ */
  /* TIMERS                                                                   */
  /* ------------------------------------------------------------------------ */

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

  /* ------------------------------------------------------------------------ */
  /* HEARTBEAT                                                                */
  /* ------------------------------------------------------------------------ */

  function scheduleHeartbeat() {
    if (destroyed) {
      return;
    }

    if (heartbeatTimer) {
      clearTimeout(
        heartbeatTimer,
      );
    }

    heartbeatTimer =
      setTimeout(() => {
        if (
          socket?.readyState ===
          WebSocket.OPEN
        ) {
          try {
            socket.send(
              JSON.stringify({
                method:
                  "LIST_SUBSCRIPTIONS",
                id: Date.now(),
              }),
            );
          } catch {
            // Ignore heartbeat errors.
          }
        }

        scheduleHeartbeat();
      }, 25_000);
  }

  /* ------------------------------------------------------------------------ */
  /* CONNECT                                                                  */
  /* ------------------------------------------------------------------------ */

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

    /* ---------------------------------------------------------------------- */
    /* OPEN                                                                    */
    /* ---------------------------------------------------------------------- */

    socket.onopen = () => {
      reconnectAttempt = 0;

      options.onStatus?.(
        "connected",
      );

      scheduleHeartbeat();
    };

    /* ---------------------------------------------------------------------- */
    /* MESSAGE                                                                */
    /* ---------------------------------------------------------------------- */

    socket.onmessage = (
      event,
    ) => {
      try {
        const parsed: unknown =
          JSON.parse(
            String(event.data),
          );

        /*
         * Binance combined stream:
         *
         * {
         *   stream: "btcusdt@ticker",
         *   data: {...}
         * }
         *
         * Single stream:
         *
         * {
         *   e: "...",
         *   ...
         * }
         */

        let data: unknown =
          parsed;

        if (
          isRecord(parsed) &&
          "data" in parsed &&
          parsed.data !== undefined
        ) {
          data =
            parsed.data;
        }

        /* ------------------------------------------------------------------ */
        /* TICKER                                                              */
        /* ------------------------------------------------------------------ */

        if (
          isTickerMessage(
            data,
          )
        ) {
          options.onTicker?.({
            symbol:
              data.s!,
            price:
              Number(data.c),
            eventTime:
              Number(
                data.E ??
                  Date.now(),
              ),
          });

          return;
        }

        /* ------------------------------------------------------------------ */
        /* KLINE                                                               */
        /* ------------------------------------------------------------------ */

        if (
          isKlineMessage(
            data,
          )
        ) {
          const k =
            data.k!;

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
         * Ignore malformed WebSocket
         * payloads.
         */
      }
    };

    /* ---------------------------------------------------------------------- */
    /* ERROR                                                                  */
    /* ---------------------------------------------------------------------- */

    socket.onerror = () => {
      options.onStatus?.(
        "error",
      );
    };

    /* ---------------------------------------------------------------------- */
    /* CLOSE                                                                  */
    /* ---------------------------------------------------------------------- */

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

  /* ------------------------------------------------------------------------ */
  /* RECONNECT                                                                */
  /* ------------------------------------------------------------------------ */

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

  /* ------------------------------------------------------------------------ */
  /* DISCONNECT                                                               */
  /* ------------------------------------------------------------------------ */

  function disconnect() {
    destroyed = true;

    clearTimers();

    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.onopen = null;

      if (
        socket.readyState ===
          WebSocket.OPEN ||
        socket.readyState ===
          WebSocket.CONNECTING
      ) {
        try {
          socket.close();
        } catch {
          // Ignore close errors.
        }
      }

      socket = null;
    }

    options.onStatus?.(
      "disconnected",
    );
  }

  /* ------------------------------------------------------------------------ */
  /* START                                                                    */
  /* ------------------------------------------------------------------------ */

  connect();

  return {
    disconnect,
  };
}
