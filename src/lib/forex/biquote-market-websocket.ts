import * as signalR from "@microsoft/signalr";
import { FOREX_PAIRS, FOREX_BY_SYMBOL } from "./data";
import { combineDerivedQuote, mapBiquoteRawTick, type BiquoteTick } from "./biquote-websocket";
import { toQuoteContract } from "./normalize";
import type { ForexQuoteContract, ForexRawQuote } from "./types";

const HUB_URL = "https://biquote.io/hubs/tick";
const THROTTLE_MS = 250;
const STALE_MS = 20_000;
const MAX_RECONNECT_MS = 15_000;

export type BiquoteMarketStatus = "connecting" | "live" | "reconnecting" | "stale" | "error" | "disconnected";

export interface BiquoteMarketOptions {
  symbols?: string[];
  onQuote?: (quote: ForexQuoteContract) => void;
  onStatus?: (status: BiquoteMarketStatus, detail?: string) => void;
}

export function createBiquoteMarketWebSocket(options: BiquoteMarketOptions) {
  const requested = options.symbols?.map((symbol) => symbol.toUpperCase()) ?? FOREX_PAIRS.map((pair) => pair.symbol);
  const symbols = [...new Set(requested.flatMap((symbol) => {
    const derived = FOREX_BY_SYMBOL.get(symbol)?.derived;
    return derived ? [derived.left, derived.right] : [symbol];
  }))];
  const visibleSymbols = [...new Set(requested)];
  const latest = new Map<string, ForexRawQuote>();
  const pending = new Map<string, ForexQuoteContract>();
  let connection: signalR.HubConnection | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;
  let startPromise: Promise<void> | null = null;
  let destroyed = false;
  let reconnectAttempt = 0;
  let lastTickAt = 0;

  const status = (next: BiquoteMarketStatus, detail?: string) => options.onStatus?.(next, detail);
  const emit = () => {
    emitTimer = null;
    for (const quote of pending.values()) options.onQuote?.(quote);
    pending.clear();
  };
  const scheduleEmit = () => {
    if (emitTimer === null) emitTimer = setTimeout(emit, THROTTLE_MS);
  };
  const publish = (raw: ForexRawQuote) => {
    latest.set(raw.symbol, raw);
    for (const visible of visibleSymbols) {
      const derived = FOREX_BY_SYMBOL.get(visible)?.derived;
      const left = derived ? latest.get(derived.left) : null;
      const right = derived ? latest.get(derived.right) : null;
      const combined = derived ? (left && right ? combineDerivedQuote(visible, left, right) : null) : raw.symbol === visible ? raw : latest.get(visible);
      if (combined) pending.set(visible, toQuoteContract(combined, {}, Date.now()));
    }
    scheduleEmit();
  };
  const onTick = (raw: BiquoteTick) => {
    const rawSymbol = typeof raw.symbol === "string" ? raw.symbol.toUpperCase() : "";
    if (!symbols.includes(rawSymbol)) return;
    const quote = mapBiquoteRawTick(rawSymbol, raw);
    if (!quote) return;
    lastTickAt = Date.now();
    publish(quote);
    status("live");
  };
  const subscribe = async () => {
    if (connection?.state === signalR.HubConnectionState.Connected) await connection.invoke("Subscribe", symbols);
  };
  const scheduleReconnect = () => {
    if (destroyed || reconnectTimer) return;
    const delay = Math.min(MAX_RECONNECT_MS, 500 * 2 ** Math.min(reconnectAttempt++, 5));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect().catch(() => undefined);
    }, delay);
  };
  const connect = async (): Promise<void> => {
    if (destroyed || startPromise) return startPromise ?? Promise.resolve();
    if (!connection) {
      connection = new signalR.HubConnectionBuilder()
        .withUrl(HUB_URL, { transport: signalR.HttpTransportType.WebSockets, skipNegotiation: true })
        .withAutomaticReconnect([0, 1_000, 2_000, 5_000, 10_000])
        .configureLogging(signalR.LogLevel.Error)
        .build();
      connection.on("ReceiveTick", (raw: BiquoteTick) => onTick(raw));
      connection.onreconnecting((error) => status("reconnecting", error?.message));
      connection.onreconnected(() => {
        reconnectAttempt = 0;
        status("reconnecting", "Biquote reconnected; resubscribing");
        void subscribe().then(() => status(lastTickAt > 0 ? "live" : "connecting"), (error) => status("error", String(error)));
      });
      connection.onclose((error) => {
        if (destroyed) return;
        status("reconnecting", error?.message ?? "Biquote market stream closed");
        scheduleReconnect();
      });
    }
    if (connection.state === signalR.HubConnectionState.Connected) return;
    startPromise = (async () => {
      status("connecting");
      try {
        await connection!.start();
        reconnectAttempt = 0;
        await subscribe();
        status(lastTickAt > 0 ? "live" : "connecting");
      } catch (error) {
        status("error", error instanceof Error ? error.message : String(error));
        scheduleReconnect();
        throw error;
      } finally {
        startPromise = null;
      }
    })();
    return startPromise;
  };
  const disconnect = () => {
    destroyed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (emitTimer) clearTimeout(emitTimer);
    if (watchdogTimer) clearInterval(watchdogTimer);
    reconnectTimer = null;
    emitTimer = null;
    watchdogTimer = null;
    pending.clear();
    if (connection) {
      const closing = connection;
      connection = null;
      void closing.stop();
    }
    status("disconnected");
  };
  watchdogTimer = setInterval(() => {
    if (destroyed || !connection || connection.state !== signalR.HubConnectionState.Connected) return;
    if (lastTickAt > 0 && Date.now() - lastTickAt > STALE_MS) {
      status("stale", "Biquote market stream has no recent tick");
      void connection.stop();
    }
  }, 5_000);
  void connect().catch(() => undefined);
  return { connect, disconnect };
}
