"use client";

/* ============================================================
 * STOCK WEBSOCKET CLIENT
 *
 * Purpose:
 * - Maintain one WebSocket connection per stock
 * - Subscribe / unsubscribe symbol
 * - Automatic reconnect
 * - Heartbeat
 * - Normalize incoming quote messages
 * - Safe browser-only implementation
 * ============================================================ */

export interface StockWSQuote {
  symbol: string;
  time: number;

  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;

  prevClose: number | null;
  changePct: number | null;

  source?: string;
  confidence?: number;
}

export interface StockWSTrade {
  symbol: string;
  time: number;
  price: number;
  volume: number;
  side?: "buy" | "sell" | "unknown";
}

export interface StockWSBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockWSMessage {
  type:
    | "connected"
    | "subscribed"
    | "unsubscribed"
    | "quote"
    | "trade"
    | "bar"
    | "heartbeat"
    | "error"
    | "snapshot"
    | string;

  symbol?: string;

  data?: unknown;

  quote?: StockWSQuote;

  trade?: StockWSTrade;

  bar?: StockWSBar;

  message?: string;

  timestamp?: number;
}

export interface StockWebSocketOptions {
  url?: string;

  symbol: string;

  reconnect?: boolean;

  reconnectDelay?: number;

  maxReconnectDelay?: number;

  heartbeatInterval?: number;

  onOpen?: () => void;

  onClose?: () => void;

  onError?: (error: Event) => void;

  onMessage?: (
    message: StockWSMessage,
  ) => void;

  onQuote?: (
    quote: StockWSQuote,
  ) => void;

  onTrade?: (
    trade: StockWSTrade,
  ) => void;

  onBar?: (
    bar: StockWSBar,
  ) => void;
}

/* ============================================================
 * DEFAULT CONFIG
 * ============================================================ */

const DEFAULT_RECONNECT_DELAY = 1000;

const DEFAULT_MAX_RECONNECT_DELAY = 15000;

const DEFAULT_HEARTBEAT_INTERVAL = 20000;

/* ============================================================
 * WS URL
 * ============================================================ */

function getDefaultWebSocketUrl(): string {
  if (
    typeof window ===
    "undefined"
  ) {
    return "";
  }

  /*
   * Priority:
   *
   * NEXT_PUBLIC_STOCK_WS_URL
   *
   * Example:
   *
   * NEXT_PUBLIC_STOCK_WS_URL=wss://api.example.com/ws/stocks
   *
   * If not defined:
   *
   * current host + /ws/stocks
   */

  const configured =
    process.env
      .NEXT_PUBLIC_STOCK_WS_URL;

  if (configured) {
    return configured;
  }

  const protocol =
    window.location.protocol ===
    "https:"
      ? "wss:"
      : "ws:";

  return `${protocol}//${window.location.host}/ws/stocks`;
}

/* ============================================================
 * NUMBER HELPERS
 * ============================================================ */

function toNumber(
  value: unknown,
): number | null {
  if (
    typeof value ===
    "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (
    typeof value === "string"
  ) {
    const parsed =
      Number(value);

    if (
      Number.isFinite(parsed)
    ) {
      return parsed;
    }
  }

  return null;
}

/* ============================================================
 * TIME NORMALIZER
 * ============================================================ */

function normalizeTime(
  value: unknown,
): number {
  const n =
    toNumber(value);

  if (n === null) {
    return Math.floor(
      Date.now() / 1000,
    );
  }

  /*
   * Detect milliseconds.
   *
   * Unix seconds ~ 1.7e9
   * Unix milliseconds ~ 1.7e12
   */

  if (n > 100000000000) {
    return Math.floor(
      n / 1000,
    );
  }

  return Math.floor(n);
}

/* ============================================================
 * QUOTE NORMALIZER
 * ============================================================ */

function normalizeQuote(
  raw: unknown,
  fallbackSymbol: string,
): StockWSQuote | null {
  if (
    !raw ||
    typeof raw !==
      "object"
  ) {
    return null;
  }

  const data =
    raw as Record<
      string,
      unknown
    >;

  const symbolValue =
    data.symbol ??
    data.ticker ??
    data.code ??
    fallbackSymbol;

  const symbol =
    String(
      symbolValue,
    ).toUpperCase();

  const close =
    toNumber(
      data.close ??
        data.price ??
        data.last ??
        data.lastPrice,
    );

  if (close === null) {
    return null;
  }

  const open =
    toNumber(
      data.open,
    ) ?? close;

  const high =
    toNumber(
      data.high,
    ) ?? close;

  const low =
    toNumber(
      data.low,
    ) ?? close;

  const volume =
    toNumber(
      data.volume ??
        data.vol ??
        data.totalVolume,
    ) ?? 0;

  const prevClose =
    toNumber(
      data.prevClose ??
        data.previousClose ??
        data.referencePrice ??
        data.refPrice,
    );

  let changePct =
    toNumber(
      data.changePct ??
        data.changePercent ??
        data.pctChange,
    );

  /*
   * Calculate percentage when
   * backend does not send it.
   */

  if (
    changePct === null &&
    prevClose !== null &&
    prevClose !== 0
  ) {
    changePct =
      ((close -
        prevClose) /
        prevClose) *
      100;
  }

  return {
    symbol,
    time: normalizeTime(
      data.time ??
        data.timestamp ??
        data.ts ??
        data.updatedAt,
    ),

    open,
    high,
    low,
    close,
    volume,

    prevClose,
    changePct,

    source:
      data.source
        ? String(
            data.source,
          )
        : undefined,

    confidence:
      toNumber(
        data.confidence,
      ) ?? undefined,
  };
}

/* ============================================================
 * TRADE NORMALIZER
 * ============================================================ */

function normalizeTrade(
  raw: unknown,
  fallbackSymbol: string,
): StockWSTrade | null {
  if (
    !raw ||
    typeof raw !==
      "object"
  ) {
    return null;
  }

  const data =
    raw as Record<
      string,
      unknown
    >;

  const price =
    toNumber(
      data.price ??
        data.close ??
        data.last,
    );

  if (price === null) {
    return null;
  }

  const sideValue =
    String(
      data.side ??
        data.direction ??
        "unknown",
    ).toLowerCase();

  const side =
    sideValue === "buy" ||
    sideValue === "sell"
      ? sideValue
      : "unknown";

  return {
    symbol:
      String(
        data.symbol ??
          data.ticker ??
          fallbackSymbol,
      ).toUpperCase(),

    time: normalizeTime(
      data.time ??
        data.timestamp ??
        data.ts,
    ),

    price,

    volume:
      toNumber(
        data.volume ??
          data.qty ??
          data.quantity,
      ) ?? 0,

    side,
  };
}

/* ============================================================
 * BAR NORMALIZER
 * ============================================================ */

function normalizeBar(
  raw: unknown,
): StockWSBar | null {
  if (
    !raw ||
    typeof raw !==
      "object"
  ) {
    return null;
  }

  const data =
    raw as Record<
      string,
      unknown
    >;

  const open =
    toNumber(
      data.open,
    );

  const high =
    toNumber(
      data.high,
    );

  const low =
    toNumber(
      data.low,
    );

  const close =
    toNumber(
      data.close,
    );

  if (
    open === null ||
    high === null ||
    low === null ||
    close === null
  ) {
    return null;
  }

  return {
    time: normalizeTime(
      data.time ??
        data.timestamp ??
        data.ts,
    ),

    open,
    high,
    low,
    close,

    volume:
      toNumber(
        data.volume ??
          data.vol,
      ) ?? 0,
  };
}

/* ============================================================
 * STOCK WEBSOCKET CLASS
 * ============================================================ */

export class StockWebSocket {
  private socket:
    | WebSocket
    | null = null;

  private readonly symbol: string;

  private readonly url: string;

  private readonly shouldReconnect: boolean;

  private readonly reconnectDelay: number;

  private readonly maxReconnectDelay: number;

  private readonly heartbeatInterval: number;

  private reconnectTimer:
    | ReturnType<
        typeof setTimeout
      >
    | null = null;

  private heartbeatTimer:
    | ReturnType<
        typeof setInterval
      >
    | null = null;

  private currentReconnectDelay: number;

  private manuallyClosed =
    false;

  private connected =
    false;

  private options: StockWebSocketOptions;

  constructor(
    options: StockWebSocketOptions,
  ) {
    this.options =
      options;

    this.symbol =
      options.symbol
        .toUpperCase();

    this.url =
      options.url ??
      getDefaultWebSocketUrl();

    this.shouldReconnect =
      options.reconnect ??
      true;

    this.reconnectDelay =
      options.reconnectDelay ??
      DEFAULT_RECONNECT_DELAY;

    this.maxReconnectDelay =
      options.maxReconnectDelay ??
      DEFAULT_MAX_RECONNECT_DELAY;

    this.heartbeatInterval =
      options.heartbeatInterval ??
      DEFAULT_HEARTBEAT_INTERVAL;

    this.currentReconnectDelay =
      this.reconnectDelay;
  }

  /* ==========================================================
   * CONNECT
   * ========================================================== */

  connect() {
    if (
      typeof window ===
      "undefined"
    ) {
      return;
    }

    if (
      !this.url ||
      !this.symbol
    ) {
      return;
    }

    if (
      this.socket &&
      (
        this.socket.readyState ===
          WebSocket.OPEN ||
        this.socket.readyState ===
          WebSocket.CONNECTING
      )
    ) {
      return;
    }

    this.manuallyClosed =
      false;

    this.clearReconnectTimer();

    try {
      const wsUrl =
        this.buildUrl();

      this.socket =
        new WebSocket(
          wsUrl,
        );

      this.socket.onopen =
        () => {
          this.connected =
            true;

          this.currentReconnectDelay =
            this.reconnectDelay;

          this.startHeartbeat();

          this.subscribe();

          this.options.onOpen?.();
        };

      this.socket.onmessage =
        (event) => {
          this.handleMessage(
            event.data,
          );
        };

      this.socket.onerror =
        (event) => {
          this.options.onError?.(
            event,
          );
        };

      this.socket.onclose =
        () => {
          this.connected =
            false;

          this.stopHeartbeat();

          this.options.onClose?.();

          if (
            !this.manuallyClosed &&
            this.shouldReconnect
          ) {
            this.scheduleReconnect();
          }
        };
    } catch (error) {
      this.connected =
        false;

      this.options.onError?.(
        error as Event,
      );

      if (
        !this.manuallyClosed &&
        this.shouldReconnect
      ) {
        this.scheduleReconnect();
      }
    }
  }

  /* ==========================================================
   * URL
   * ========================================================== */

  private buildUrl(): string {
    const url =
      new URL(
        this.url,
        window.location.href,
      );

    /*
     * We intentionally send
     * the symbol in query params
     * as well as through subscribe().
     *
     * This supports simple
     * WebSocket backends.
     */

    url.searchParams.set(
      "symbol",
      this.symbol,
    );

    return url.toString();
  }

  /* ==========================================================
   * SUBSCRIBE
   * ========================================================== */

  private subscribe() {
    this.send({
      type: "subscribe",
      symbol:
        this.symbol,
    });
  }

  /* ==========================================================
   * UNSUBSCRIBE
   * ========================================================== */

  private unsubscribe() {
    this.send({
      type: "unsubscribe",
      symbol:
        this.symbol,
    });
  }

  /* ==========================================================
   * SEND
   * ========================================================== */

  private send(
    payload: unknown,
  ) {
    if (
      !this.socket ||
      this.socket.readyState !==
        WebSocket.OPEN
    ) {
      return;
    }

    try {
      this.socket.send(
        JSON.stringify(
          payload,
        ),
      );
    } catch {
      // Ignore failed sends.
    }
  }

  /* ==========================================================
   * MESSAGE
   * ========================================================== */

  private handleMessage(
    rawMessage: unknown,
  ) {
    let raw: unknown =
      rawMessage;

    if (
      typeof rawMessage ===
      "string"
    ) {
      try {
        raw =
          JSON.parse(
            rawMessage,
          );
      } catch {
        return;
      }
    }

    if (
      !raw ||
      typeof raw !==
        "object"
    ) {
      return;
    }

    const message =
      raw as Record<
        string,
        unknown
      >;

    const type =
      String(
        message.type ??
          message.event ??
          message.channel ??
          "",
      ).toLowerCase();

    /*
     * Support payloads such as:
     *
     * {
     *   type: "quote",
     *   data: {...}
     * }
     *
     * or:
     *
     * {
     *   type: "quote",
     *   quote: {...}
     * }
     *
     * or:
     *
     * {
     *   event: "price",
     *   data: {...}
     * }
     */

    const payload =
      message.data ??
      message.quote ??
      message.payload ??
      message;

    /* --------------------------------------------------------
     * HEARTBEAT
     * -------------------------------------------------------- */

    if (
      type ===
        "ping" ||
      type ===
        "heartbeat"
    ) {
      this.send({
        type: "pong",
        timestamp:
          Date.now(),
      });

      return;
    }

    if (
      type ===
      "pong"
    ) {
      return;
    }

    /* --------------------------------------------------------
     * QUOTE
     * -------------------------------------------------------- */

    if (
      type.includes(
        "quote",
      ) ||
      type.includes(
        "price",
      ) ||
      type ===
        "snapshot"
    ) {
      const quote =
        normalizeQuote(
          payload,
          this.symbol,
        );

      if (quote) {
        this.options.onQuote?.(
          quote,
        );
      }

      this.options.onMessage?.({
        type:
          type ||
          "quote",

        symbol:
          quote?.symbol ??
          this.symbol,

        data:
          payload,

        quote:
          quote ??
          undefined,

        timestamp:
          Date.now(),
      });

      return;
    }

    /* --------------------------------------------------------
     * TRADE
     * -------------------------------------------------------- */

    if (
      type.includes(
        "trade",
      ) ||
      type ===
        "tick"
    ) {
      const trade =
        normalizeTrade(
          payload,
          this.symbol,
        );

      if (trade) {
        this.options.onTrade?.(
          trade,
        );
      }

      this.options.onMessage?.({
        type:
          type ||
          "trade",

        symbol:
          trade?.symbol ??
          this.symbol,

        data:
          payload,

        trade:
          trade ??
          undefined,

        timestamp:
          Date.now(),
      });

      return;
    }

    /* --------------------------------------------------------
     * BAR / CANDLE
     * -------------------------------------------------------- */

    if (
      type.includes(
        "bar",
      ) ||
      type.includes(
        "candle",
      )
    ) {
      const bar =
        normalizeBar(
          payload,
        );

      if (bar) {
        this.options.onBar?.(
          bar,
        );
      }

      this.options.onMessage?.({
        type:
          type ||
          "bar",

        symbol:
          this.symbol,

        data:
          payload,

        bar:
          bar ??
          undefined,

        timestamp:
          Date.now(),
      });

      return;
    }

    /* --------------------------------------------------------
     * GENERIC MESSAGE
     * -------------------------------------------------------- */

    this.options.onMessage?.({
      type:
        type ||
        "message",

      symbol:
        String(
          message.symbol ??
            this.symbol,
        ).toUpperCase(),

      data:
        payload,

      message:
        typeof message.message ===
        "string"
          ? message.message
          : undefined,

      timestamp:
        Date.now(),
    });
  }

  /* ==========================================================
   * RECONNECT
   * ========================================================== */

  private scheduleReconnect() {
    if (
      this.reconnectTimer
    ) {
      return;
    }

    this.reconnectTimer =
      setTimeout(
        () => {
          this.reconnectTimer =
            null;

          this.connect();

          this.currentReconnectDelay =
            Math.min(
              this.currentReconnectDelay *
                2,
              this.maxReconnectDelay,
            );
        },
        this.currentReconnectDelay,
      );
  }

  /* ==========================================================
   * HEARTBEAT
   * ========================================================== */

  private startHeartbeat() {
    this.stopHeartbeat();

    this.heartbeatTimer =
      setInterval(
        () => {
          if (
            this.socket?.readyState ===
            WebSocket.OPEN
          ) {
            this.send({
              type: "ping",
              timestamp:
                Date.now(),
            });
          }
        },
        this.heartbeatInterval,
      );
  }

  private stopHeartbeat() {
    if (
      this.heartbeatTimer
    ) {
      clearInterval(
        this.heartbeatTimer,
      );

      this.heartbeatTimer =
        null;
    }
  }

  /* ==========================================================
   * RECONNECT TIMER
   * ========================================================== */

  private clearReconnectTimer() {
    if (
      this.reconnectTimer
    ) {
      clearTimeout(
        this.reconnectTimer,
      );

      this.reconnectTimer =
        null;
    }
  }

  /* ==========================================================
   * DISCONNECT
   * ========================================================== */

  disconnect() {
    this.manuallyClosed =
      true;

    this.clearReconnectTimer();

    this.stopHeartbeat();

    if (
      this.socket
    ) {
      try {
        this.unsubscribe();
      } catch {
        // Ignore.
      }

      try {
        this.socket.close(
          1000,
          "client disconnect",
        );
      } catch {
        // Ignore.
      }
    }

    this.socket =
      null;

    this.connected =
      false;
  }

  /* ==========================================================
   * STATE
   * ========================================================== */

  isConnected(): boolean {
    return (
      this.connected &&
      this.socket?.readyState ===
        WebSocket.OPEN
    );
  }

  getSocket(): WebSocket | null {
    return this.socket;
  }
}
