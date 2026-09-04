/**
 * SSI FastConnect WebSocket client — market DATA channel.
 *
 *   wss://stream.ssi.com.vn
 *   { method: "SUBSCRIBE" | "UNSUBSCRIBE" | "LIST_SUBSCRIPTION" | "PING" | "PONG",
 *     channel: "DATA", topics: ["trade.SSI", "quote.SSI", "room.vn30", "market.hose"] }
 *
 * Topics: trade | quote | room | put | oddlot | market
 *   topic.[index | exchange | sym-sym | *] [@tick | @1m | @5m]
 *
 * Rules that drive this implementation:
 *  - The server pings every 30s; the client must answer PONG or be dropped.
 *  - After a reconnect every topic must be re-subscribed from scratch.
 *  - `quote` will move to incremental (delta-only) payloads in a future
 *    release, so consumers must not assume a full book on every message.
 *
 * Order/position/FCO events live on the TRADING channel, which needs an
 * OTP-backed token. This project does not use that channel at all.
 *
 * IMPORTANT: run this from a long-lived process (worker), never from a
 * serverless request handler.
 */

import { forProvider } from "@/lib/logger";
import { getSsiAccessToken } from "@/lib/connectors/ssi/auth";
import { SSI_PROVIDER, SSI_TIMEOUTS, isSsiWsEnabled, num, parseSsiDate, ssiConfig } from "@/lib/connectors/ssi/config";

const log = forProvider(SSI_PROVIDER);

export type SsiTopicKind = "trade" | "quote" | "room" | "put" | "oddlot" | "market";

export interface SsiTradeEvent {
  kind: "trade";
  symbol: string;
  time: number | null;
  price: number | null;
  quantity: number | null;
  avgPrice: number | null;
  /** `"B"` = buyer-initiated (mua chủ động), `"S"` = seller-initiated. */
  side: "B" | "S" | null;
  open: number | null;
  high: number | null;
  low: number | null;
  totalVolume: number | null;
}

export interface SsiQuoteEvent {
  kind: "quote";
  symbol: string;
  time: number | null;
  /** `[price, quantity]` pairs — SSI does NOT publish order counts. */
  bids: Array<{ price: number; volume: number }>;
  asks: Array<{ price: number; volume: number }>;
}

export interface SsiRoomEvent {
  kind: "room";
  symbol: string;
  time: number | null;
  totalRoom: number | null;
  currentRoom: number | null;
  buyQuantity: number | null;
  buyValue: number | null;
  sellQuantity: number | null;
  sellValue: number | null;
}

export interface SsiPutEvent {
  kind: "put";
  symbol: string;
  time: number | null;
  price: number | null;
  quantity: number | null;
  totalQuantity: number | null;
  totalValue: number | null;
}

export interface SsiOddlotEvent {
  kind: "oddlot";
  symbol: string;
  time: number | null;
  price: number | null;
  quantity: number | null;
}

export interface SsiMarketEvent {
  kind: "market";
  symbol: string | null;
  board: string | null;
  tradingDate: number | null;
  ceiling: number | null;
  floor: number | null;
  refPrice: number | null;
}

/** Session flag message: `ATO` / `LO` / `ATC` / … */
export interface SsiSessionFlagEvent {
  kind: "session";
  board: string | null;
  time: number | null;
  flag: string | null;
}

export type SsiMarketEventData =
  | SsiTradeEvent
  | SsiQuoteEvent
  | SsiRoomEvent
  | SsiPutEvent
  | SsiOddlotEvent
  | SsiMarketEvent
  | SsiSessionFlagEvent;

export interface SsiStreamHandlers {
  onEvent?: (event: SsiMarketEventData) => void;
  onConnected?: () => void;
  onReconnect?: (attempt: number) => void;
  onError?: (error: Error) => void;
  onRaw?: (payload: unknown) => void;
}

function toLevels(raw: unknown): Array<{ price: number; volume: number }> {
  if (!Array.isArray(raw)) return [];
  const levels: Array<{ price: number; volume: number }> = [];
  for (const entry of raw) {
    if (Array.isArray(entry)) {
      const price = num(entry[0]);
      const volume = num(entry[1]);
      if (price != null && volume != null) levels.push({ price, volume });
    } else if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const price = num(record.p ?? record.price ?? record[0]);
      const volume = num(record.q ?? record.volume ?? record.quantity ?? record[1]);
      if (price != null && volume != null) levels.push({ price, volume });
    }
  }
  return levels;
}

/**
 * Normalise an inbound frame into one of the known DATA events.
 *
 * The public docs describe field names but not the exact inbound envelope, so
 * this is intentionally defensive: it reads an explicit kind/channel/topic when
 * present and otherwise infers from the payload shape. Unknown frames are
 * surfaced via `onRaw` instead of being dropped silently, so the real envelope
 * can be confirmed against live traffic.
 */
export function normalizeSsiDataEvent(raw: unknown): SsiMarketEventData | null {
  if (!raw || typeof raw !== "object") return null;
  const frame = raw as Record<string, unknown>;

  // Some envelopes wrap the payload: { channel, topic, data } or { method, data }.
  const nested = frame.data ?? frame.payload ?? frame.message;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const inner = normalizeSsiDataEvent(nested);
    if (inner) return inner;
  }

  const kindHint = [
    typeof frame.channel === "string" && frame.channel !== "DATA" ? frame.channel : null,
    typeof frame.topic === "string" ? frame.topic.split(".")[0] : null,
    typeof frame.method === "string" ? frame.method : null,
    typeof frame.eventType === "string" ? frame.eventType : null,
    typeof frame.RType === "string" ? frame.RType.replace("X-", "").toLowerCase() : null,
  ]
    .filter((v): v is string => Boolean(v))
    .map((v) => v.toLowerCase());

  const symbol = typeof frame.s === "string" ? frame.s.toUpperCase() : null;
  const has = (key: string) => frame[key] !== undefined;

  // market.<board> session flag: { b, t, f }
  if (has("f") && has("b")) {
    return {
      kind: "session",
      board: typeof frame.b === "string" ? frame.b : null,
      time: parseSsiDate(frame.t) ?? num(frame.t),
      flag: typeof frame.f === "string" ? frame.f : null,
    };
  }

  // room: { tr, cr, bq, bv, sq, sv }
  if (has("tr") || has("cr") || has("bq") || has("sv")) {
    return {
      kind: "room",
      symbol: symbol ?? "",
      time: parseSsiDate(frame.t),
      totalRoom: num(frame.tr),
      currentRoom: num(frame.cr),
      buyQuantity: num(frame.bq),
      buyValue: num(frame.bv),
      sellQuantity: num(frame.sq),
      sellValue: num(frame.sv),
    };
  }

  // quote: { bids, asks }
  if (has("bids") || has("asks")) {
    return {
      kind: "quote",
      symbol: symbol ?? "",
      time: parseSsiDate(frame.t),
      bids: toLevels(frame.bids),
      asks: toLevels(frame.asks),
    };
  }

  // put-through: { tq, tv }
  if (has("tq") || has("tv")) {
    return {
      kind: "put",
      symbol: symbol ?? "",
      time: parseSsiDate(frame.t),
      price: num(frame.p),
      quantity: num(frame.q),
      totalQuantity: num(frame.tq),
      totalValue: num(frame.tv),
    };
  }

  // market (start-of-day bands): { ce, fl, ref }
  if (has("ce") || has("fl") || has("ref")) {
    return {
      kind: "market",
      symbol,
      board: typeof frame.b === "string" ? frame.b : null,
      tradingDate: parseSsiDate(frame.t),
      ceiling: num(frame.ce ?? frame.ceilingPrice),
      floor: num(frame.fl ?? frame.floorPrice),
      refPrice: num(frame.ref ?? frame.refPrice),
    };
  }

  // trade: { p, q, si, ... }
  if (has("p") || has("q") || has("si")) {
    const side = frame.si ?? frame.side;
    return {
      kind: "trade",
      symbol: symbol ?? "",
      time: parseSsiDate(frame.t),
      price: num(frame.p ?? frame.price),
      quantity: num(frame.q ?? frame.quantity),
      avgPrice: num(frame.a ?? frame.avgPrice),
      side: side === "B" || side === "b" ? "B" : side === "S" || side === "s" ? "S" : null,
      open: num(frame.o ?? frame.openPrice),
      high: num(frame.h ?? frame.highPrice),
      low: num(frame.l ?? frame.lowPrice),
      totalVolume: num(frame.v ?? frame.totalVol),
    };
  }

  if (kindHint.includes("oddlot")) return null;
  return null;
}

const MAX_BACKOFF_MS = 60_000;

export class SsiMarketStream {
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = false;
  private readonly topics = new Set<string>();

  constructor(
    private readonly handlers: SsiStreamHandlers = {},
    private readonly initialTopics: string[] = [],
  ) {
    for (const topic of initialTopics) this.topics.add(topic);
  }

  get subscribedTopics(): string[] {
    return [...this.topics];
  }

  /** Start the connection. Safe to call once; reconnects are internal. */
  async start(): Promise<void> {
    if (!isSsiWsEnabled()) {
      throw new Error("SSI_WS_ENABLED is not set — refusing to start the stream worker");
    }
    const config = ssiConfig();
    if (!config) throw new Error("SSI credentials not configured");
    if (typeof WebSocket === "undefined") {
      throw new Error("No global WebSocket implementation (requires Node 22+)");
    }
    this.stopped = false;
    await this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeat = null;
    this.reconnectTimer = null;
    try {
      this.socket?.close();
    } catch {
      /* ignore close races */
    }
    this.socket = null;
  }

  subscribe(topics: string[]): void {
    for (const topic of topics) this.topics.add(topic);
    this.send({ method: "SUBSCRIBE", channel: "DATA", topics });
  }

  unsubscribe(topics: string[]): void {
    for (const topic of topics) this.topics.delete(topic);
    this.send({ method: "UNSUBSCRIBE", channel: "DATA", topics });
  }

  listSubscriptions(): void {
    this.send({ method: "LIST_SUBSCRIPTION" });
  }

  private send(payload: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    try {
      this.socket.send(JSON.stringify(payload));
    } catch (error) {
      this.handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async open(): Promise<void> {
    const config = ssiConfig();
    if (!config) return;
    const token = await getSsiAccessToken();

    const socket = new WebSocket(config.wsUrl);
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      log.info("ssi_ws_connected", { url: config.wsUrl, topics: this.topics.size });

      // The docs describe an auth frame carrying the credential pair plus the
      // access token. Harmless when the gateway only expects the header, and
      // required when it does not — verify against live traffic.
      if (config.clientId) {
        this.send({
          client_id: config.clientId,
          api_key: config.apiKey,
          api_secret: config.apiSecret,
          access_token: token,
        });
      }

      // Re-subscribe everything: the server drops all topics on reconnect.
      if (this.topics.size > 0) {
        this.send({ method: "SUBSCRIBE", channel: "DATA", topics: [...this.topics] });
      }
      this.startHeartbeat();
      this.handlers.onConnected?.();
    };

    socket.onmessage = (event: MessageEvent) => {
      let parsed: unknown;
      try {
        parsed = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return; // non-JSON keepalive
      }

      // Answer server heartbeats immediately or the connection is dropped.
      if (parsed && typeof parsed === "object") {
        const frame = parsed as Record<string, unknown>;
        const method = typeof frame.method === "string" ? frame.method.toUpperCase() : "";
        if (method === "PING") {
          this.send({ method: "PONG", channel: "HEARTBEAT" });
          return;
        }
        if (method === "PONG") return;
      }

      this.handlers.onRaw?.(parsed);
      const normalized = normalizeSsiDataEvent(parsed);
      if (normalized) this.handlers.onEvent?.(normalized);
    };

    socket.onerror = () => {
      const error = new Error("SSI WebSocket error");
      log.warn("ssi_ws_error", {});
      this.handlers.onError?.(error);
    };

    socket.onclose = () => {
      this.stopHeartbeat();
      if (this.stopped) return;
      this.scheduleReconnect();
    };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      this.send({ method: "PING", channel: "HEARTBEAT" });
    }, SSI_TIMEOUTS.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private scheduleReconnect(): void {
    this.attempt += 1;
    // Exponential backoff with jitter; cap so a long outage cannot hot-loop.
    const base = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** Math.min(this.attempt, 6));
    const delay = Math.round(base * (0.5 + Math.random() * 0.5));
    log.warn("ssi_ws_reconnect_scheduled", { attempt: this.attempt, delayMs: delay });
    this.handlers.onReconnect?.(this.attempt);
    this.reconnectTimer = setTimeout(() => {
      void this.open().catch((error) => {
        log.error("ssi_ws_reconnect_failed", {
          attempt: this.attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        this.scheduleReconnect();
      });
    }, delay);
  }
}

/** Build topic strings from a symbol list, chunked for readability. */
export function buildTopics(
  kinds: SsiTopicKind[],
  symbols: string[],
  interval?: "tick" | "1m" | "5m",
): string[] {
  const topics: string[] = [];
  for (const kind of kinds) {
    if (kind === "market") {
      // `market` has no interval suffix.
      topics.push(`market.${symbols.join("-")}`);
      continue;
    }
    const suffix = interval ? `@${interval}` : "";
    topics.push(`${kind}.${symbols.join("-")}${suffix}`);
  }
  return topics;
}
