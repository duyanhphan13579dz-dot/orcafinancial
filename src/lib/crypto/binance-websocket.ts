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

type BinanceMessage =
  | BinanceKlineMessage
  | BinanceTickerMessage;

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

/* -------------------------------------------------------------------------- */
/* CONFIG                                                                     */
/* -------------------------------------------------------------------------- */

const WS_BASE =
  "wss://stream.binance.com:9443/stream";

const RECONNECT_BASE_DELAY = 1000;

const MAX_RECONNECT_DELAY = 10000;

const HEARTBEAT_INTERVAL = 25000;

/* -------------------------------------------------------------------------- */
/* NORMALIZATION                                                              */
/* -------------------------------------------------------------------------- */

function normalizeSymbol(
  symbol: string,
) {
  return symbol
    .trim()
    .toLowerCase()
    .replace(
      /[^a-z0-9]/g,
      "",
    );
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

/* -------------------------------------------------------------------------- */
/* WEBSOCKET                                                                  */
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

  let heartbeatTimer:
    | ReturnType<typeof setTimeout>
    | null = null;

  let reconnectAttempt = 0;

  let connectionGeneration = 0;

  /* ------------------------------------------------------------------------ */
  /* TIMERS                                                                   */
  /* ------------------------------------------------------------------------ */

  function clearReconnectTimer() {
    if (
      reconnectTimer !==
      null
    ) {
      clearTimeout(
        reconnectTimer,
      );

      reconnectTimer = null;
    }
  }

  function clearHeartbeatTimer() {
    if (
      heartbeatTimer !==
      null
    ) {
      clearTimeout(
        heartbeatTimer,
      );

      heartbeatTimer = null;
    }
  }

  function clearTimers() {
    clearReconnectTimer();
    clearHeartbeatTimer();
  }

  /* ------------------------------------------------------------------------ */
  /* HEARTBEAT                                                                */
  /* ------------------------------------------------------------------------ */

  function scheduleHeartbeat(
    generation: number,
  ) {
    clearHeartbeatTimer();

    if (
      destroyed ||
      generation !==
        connectionGeneration
    ) {
      return;
    }

    heartbeatTimer =
      setTimeout(() => {
        if (
          destroyed ||
          generation !==
            connectionGeneration
        ) {
          return;
        }

        /*
         * Binance WebSocket server
         * tự quản lý ping/pong.
         *
         * Browser WebSocket không cho
         * gửi raw Pong frame.
         *
         * Vì vậy không gửi
         * LIST_SUBSCRIPTIONS liên tục.
         *
         * Chỉ kiểm tra connection còn OPEN.
         */

        if (
          socket?.readyState ===
          WebSocket.OPEN
        ) {
          scheduleHeartbeat(
            generation,
          );
        }
      }, HEARTBEAT_INTERVAL);
  }

  /* ------------------------------------------------------------------------ */
  /* RECONNECT                                                                */
  /* ------------------------------------------------------------------------ */

  function scheduleReconnect() {
    if (
      destroyed ||
      reconnectTimer !==
        null
    ) {
      return;
    }

    reconnectAttempt += 1;

    const exponent =
      Math.min(
        reconnectAttempt - 1,
        4,
      );

    const delay =
      Math.min(
        MAX_RECONNECT_DELAY,
        RECONNECT_BASE_DELAY *
          Math.pow(
            2,
            exponent,
          ),
      );

    reconnectTimer =
      setTimeout(() => {
        reconnectTimer =
          null;

        connect();
      }, delay);
  }

  /* ------------------------------------------------------------------------ */
  /* CONNECT                                                                  */
  /* ------------------------------------------------------------------------ */

  function connect() {
    if (destroyed) {
      return;
    }

    clearReconnectTimer();

    const generation =
      ++connectionGeneration;

    options.onStatus?.(
      reconnectAttempt >
        0
        ? "reconnecting"
        : "connecting",
    );

    const streams = [
      `${symbol}@ticker`,
      `${symbol}@kline_${timeframe}`,
    ].join("/");

    const url =
      `${WS_BASE}?streams=${streams}`;

    let newSocket: WebSocket;

    try {
      newSocket =
        new WebSocket(url);
    } catch {
      if (
        generation !==
        connectionGeneration
      ) {
        return;
      }

      options.onStatus?.(
        "error",
      );

      scheduleReconnect();

      return;
    }

    socket = newSocket;

    /* ---------------------------------------------------------------------- */
    /* OPEN                                                                   */
    /* ---------------------------------------------------------------------- */

    newSocket.onopen = () => {
      if (
        destroyed ||
        generation !==
          connectionGeneration
      ) {
        newSocket.close();
        return;
      }

      /*
       * Connection đã thành công.
       *
       * Reset backoff.
       */
      reconnectAttempt = 0;

      options.onStatus?.(
        "connected",
      );

      scheduleHeartbeat(
        generation,
      );
    };

    /* ---------------------------------------------------------------------- */
    /* MESSAGE                                                                */
    /* ---------------------------------------------------------------------- */

    newSocket.onmessage = (
      event,
    ) => {
      if (
        destroyed ||
        generation !==
          connectionGeneration
      ) {
        return;
      }

      try {
        const message =
          JSON.parse(
            event.data,
          ) as {
            stream?: string;
            data?: BinanceMessage;
          };

        /*
         * Combined stream:
         *
         * {
         *   stream: "btcusdt@ticker",
         *   data: {...}
         * }
         */

        const data =
          message.data ??
          message;

        /* ------------------------------------------------------------------ */
        /* TICKER                                                             */
        /* ------------------------------------------------------------------ */

        if (
          data.e ===
            "24hrTicker" &&
          data.s &&
          data.c
        ) {
          const price =
            Number(
              data.c,
            );

          if (
            Number.isFinite(
              price,
            )
          ) {
            options.onTicker?.({
              symbol:
                data.s,

              price,

              eventTime:
                Number(
                  data.E ??
                    Date.now(),
                ),
            });
          }

          return;
        }

        /* ------------------------------------------------------------------ */
        /* KLINE                                                              */
        /* ------------------------------------------------------------------ */

        if (
          data.e ===
            "kline" &&
          data.k
        ) {
          const k =
            data.k;

          const open =
            Number(k.o);

          const high =
            Number(k.h);

          const low =
            Number(k.l);

          const close =
            Number(k.c);

          const volume =
            Number(k.v);

          if (
            !Number.isFinite(
              open,
            ) ||
            !Number.isFinite(
              high,
            ) ||
            !Number.isFinite(
              low,
            ) ||
            !Number.isFinite(
              close,
            ) ||
            !Number.isFinite(
              volume,
            )
          ) {
            return;
          }

          options.onKline?.({
            symbol:
              k.s,

            interval:
              k.i,

            startTime:
              Number(k.t),

            closeTime:
              Number(k.T),

            open,

            high,

            low,

            close,

            volume,

            isClosed:
              Boolean(k.x),
          });
        }
      } catch {
        /*
         * Ignore malformed messages.
         */
      }
    };

    /* ---------------------------------------------------------------------- */
    /* ERROR                                                                  */
    /* ---------------------------------------------------------------------- */

    newSocket.onerror = () => {
      if (
        destroyed ||
        generation !==
          connectionGeneration
      ) {
        return;
      }

      options.onStatus?.(
        "error",
      );

      /*
       * Không reconnect trực tiếp
       * ở đây.
       *
       * Browser sẽ gọi onclose.
       */
    };

    /* ---------------------------------------------------------------------- */
    /* CLOSE                                                                  */
    /* ---------------------------------------------------------------------- */

    newSocket.onclose = () => {
      if (
        generation !==
        connectionGeneration
      ) {
        return;
      }

      clearHeartbeatTimer();

      if (
        socket ===
        newSocket
      ) {
        socket = null;
      }

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
  /* DISCONNECT                                                               */
  /* ------------------------------------------------------------------------ */

  function disconnect() {
    if (destroyed) {
      return;
    }

    destroyed = true;

    /*
     * Invalidate toàn bộ callback
     * của socket cũ.
     */
    connectionGeneration += 1;

    clearTimers();

    const currentSocket =
      socket;

    socket = null;

    if (currentSocket) {
      currentSocket.onopen =
        null;

      currentSocket.onmessage =
        null;

      currentSocket.onerror =
        null;

      currentSocket.onclose =
        null;

      if (
        currentSocket.readyState ===
          WebSocket.OPEN ||
        currentSocket.readyState ===
          WebSocket.CONNECTING
      ) {
        try {
          currentSocket.close();
        } catch {
          /* ignore */
        }
      }
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
