"use client";

export interface BinanceMarketTicker {
  symbol: string;
  price: number;
  priceChangePercent: number;
  volume24h: number;
  quoteVolume24h: number;
  eventTime: number;
}

type Status =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

interface Options {
  onTicker?: (
    ticker: BinanceMarketTicker,
  ) => void;

  onStatus?: (
    status: Status,
  ) => void;
}

interface BinanceTickerPayload {
  e?: string;
  E?: number;
  s?: string;
  p?: string;
  P?: string;
  c?: string;
  v?: string;
  q?: string;
}

const BINANCE_WS =
  "wss://stream.binance.com:9443/ws/!ticker@arr";

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 10000;

export function createBinanceMarketWebSocket(
  options: Options,
) {
  let socket: WebSocket | null =
    null;

  let destroyed = false;

  let reconnectTimer:
    | ReturnType<typeof setTimeout>
    | null = null;

  let reconnectAttempt = 0;

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(
        reconnectTimer,
      );

      reconnectTimer = null;
    }
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
        INITIAL_RECONNECT_DELAY *
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

  function connect() {
    if (destroyed) {
      return;
    }

    options.onStatus?.(
      reconnectAttempt > 0
        ? "reconnecting"
        : "connecting",
    );

    try {
      socket =
        new WebSocket(
          BINANCE_WS,
        );
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
    };

    socket.onmessage = (
      event,
    ) => {
      try {
        const payload =
          JSON.parse(
            event.data,
          );

        /*
         * Binance !ticker@arr
         * trả về một array.
         */
        if (
          !Array.isArray(
            payload,
          )
        ) {
          return;
        }

        for (
          const item of payload
        ) {
          const data =
            item as BinanceTickerPayload;

          /*
           * Chỉ lấy USDT spot pair.
           *
           * Ví dụ:
           * BTCUSDT
           * ETHUSDT
           * SOLUSDT
           */
          if (
            !data.s ||
            !data.s.endsWith(
              "USDT",
            )
          ) {
            continue;
          }

          if (
            !data.c
          ) {
            continue;
          }

          const ticker: BinanceMarketTicker =
            {
              symbol:
                data.s,

              price:
                Number(
                  data.c,
                ),

              priceChangePercent:
                Number(
                  data.P ?? 0,
                ),

              volume24h:
                Number(
                  data.v ?? 0,
                ),

              quoteVolume24h:
                Number(
                  data.q ?? 0,
                ),

              eventTime:
                Number(
                  data.E ??
                    Date.now(),
                ),
            };

          options.onTicker?.(
            ticker,
          );
        }
      } catch {
        /*
         * Ignore malformed
         * websocket messages.
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

  function disconnect() {
    destroyed = true;

    clearReconnectTimer();

    if (socket) {
      socket.onopen =
        null;

      socket.onmessage =
        null;

      socket.onerror =
        null;

      socket.onclose =
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
