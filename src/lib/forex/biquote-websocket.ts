import * as signalR from "@microsoft/signalr";
import { bucketStartSec, TF_BUCKET_SEC } from "./realtime";
import { FOREX_BY_SYMBOL } from "./data";
import { alignBarsByTime, combineOhlc, toQuoteContract } from "./normalize";
import type { ForexQuoteContract, ForexRawQuote } from "./types";
import type { Ohlcv } from "@/lib/connectors/core";

const HUB_URL = "https://biquote.io/hubs/tick";
const REST_URL = "https://biquote.io/api";
const QUOTE_THROTTLE_MS = 250;
const STREAM_STALE_MS = 20_000;
const WATCHDOG_INTERVAL_MS = 5_000;
const HISTORY_TIMEOUT_MS = 7_000;
const MAX_RECONNECT_MS = 15_000;

export type BiquoteForexStatus =
  | "connecting"
  | "syncing"
  | "live"
  | "reconnecting"
  | "stale"
  | "error"
  | "disconnected";

export interface BiquoteTick {
  symbol?: unknown;
  description?: unknown;
  bid?: unknown;
  ask?: unknown;
  mid?: unknown;
  spread?: unknown;
  last?: unknown;
  volume?: unknown;
  high?: unknown;
  low?: unknown;
  direction?: unknown;
  dayDiffPercent?: unknown;
  timestamp?: unknown;
  source?: unknown;
  time?: unknown;
}

export interface BiquoteForexBar extends Ohlcv {
  isClosed: boolean;
  tickVolume?: number;
}

export interface BiquoteHistory {
  bars: BiquoteForexBar[];
  hasMore: boolean;
  source: "biquote-ohlc";
}

export interface BiquoteForexOptions {
  symbol: string;
  timeframe: string;
  onQuote?: (quote: ForexQuoteContract) => void;
  onBar?: (bar: BiquoteForexBar) => void;
  onStatus?: (status: BiquoteForexStatus, detail?: string) => void;
}

function finitePositive(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }
  return null;
}

function normalizeTimeframe(timeframe: string): string {
  return TF_BUCKET_SEC[timeframe] ? timeframe : "1h";
}

export function mapBiquoteRawTick(symbol: string, tick: BiquoteTick): ForexRawQuote | null {
  const bid = finitePositive(tick.bid);
  const ask = finitePositive(tick.ask);
  const mid = finitePositive(tick.mid) ?? (bid !== null && ask !== null ? (bid + ask) / 2 : null);
  if (mid === null) return null;
  const timestamp = parseTimestamp(tick.timestamp) ?? parseTimestamp(tick.time) ?? Math.floor(Date.now() / 1000);
  const changePercent = Number(tick.dayDiffPercent);
  return {
    symbol: symbol.toUpperCase(),
    price: mid,
    bid,
    ask,
    change: null,
    changePercent: Number.isFinite(changePercent) ? changePercent : null,
    source: typeof tick.source === "string" && tick.source ? `Biquote · ${tick.source}` : "Biquote WebSocket",
    timestamp: new Date(timestamp * 1000),
  };
}

export function combineDerivedQuote(symbol: string, left: ForexRawQuote, right: ForexRawQuote): ForexRawQuote | null {
  const def = FOREX_BY_SYMBOL.get(symbol)?.derived;
  if (!def) return null;
  const f = (a: number, b: number) => def.op === "multiply" ? a * b : b === 0 ? NaN : a / b;
  const price = f(left.price, right.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  let bid: number | null = null;
  let ask: number | null = null;
  if (left.bid !== null && left.ask !== null && right.bid !== null && right.ask !== null) {
    if (def.op === "multiply") {
      bid = left.bid * right.bid;
      ask = left.ask * right.ask;
    } else {
      bid = left.bid / right.ask;
      ask = left.ask / right.bid;
    }
  }
  return {
    symbol,
    price,
    bid: bid !== null && Number.isFinite(bid) && bid > 0 ? bid : null,
    ask: ask !== null && Number.isFinite(ask) && ask > 0 ? ask : null,
    change: null,
    changePercent: null,
    source: "Biquote WebSocket · derived",
    // Use the newest leg for display freshness; the caller separately degrades
    // the quote when the two legs drift too far apart.
    timestamp: new Date(Math.max(left.timestamp.getTime(), right.timestamp.getTime())),
  };
}

function mapBar(raw: unknown): BiquoteForexBar | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const time = parseTimestamp(value.openTime ?? value.time ?? value.timestamp);
  const open = finitePositive(value.open);
  const high = finitePositive(value.high);
  const low = finitePositive(value.low);
  const close = finitePositive(value.close);
  if (time === null || open === null || high === null || low === null || close === null || high < low) return null;
  const tickVolume = Number(value.tickVolume ?? value.volume ?? 0);
  return {
    time,
    open,
    high,
    low,
    close,
    volume: Number.isFinite(tickVolume) && tickVolume >= 0 ? tickVolume : 0,
    tickVolume: Number.isFinite(tickVolume) && tickVolume >= 0 ? tickVolume : 0,
    isClosed: value.isOpen !== true,
  };
}

async function fetchDirectBiquoteOhlc(
  symbol: string,
  timeframe: string,
  limit: number,
  to?: number,
): Promise<BiquoteHistory> {
  const safeLimit = Math.max(10, Math.min(2_000, Math.floor(limit)));
  const params = new URLSearchParams({
    interval: normalizeTimeframe(timeframe),
    limit: String(safeLimit),
  });
  if (to != null && Number.isFinite(to) && to > 0) {
    params.set("to", new Date(Math.max(0, to - 1) * 1000).toISOString());
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HISTORY_TIMEOUT_MS);
  try {
    const response = await fetch(`${REST_URL}/${encodeURIComponent(symbol.toUpperCase())}/ohlc?${params}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Biquote OHLC HTTP ${response.status}`);
    const payload = (await response.json()) as { bars?: unknown[] };
    const bars = (payload.bars ?? [])
      .map(mapBar)
      .filter((bar): bar is BiquoteForexBar => Boolean(bar))
      .sort((a, b) => a.time - b.time)
      .slice(-safeLimit);
    if (bars.length < Math.min(10, safeLimit)) throw new Error("Biquote OHLC returned too few bars");
    return { bars, hasMore: bars.length >= safeLimit, source: "biquote-ohlc" };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBiquoteOhlc(
  symbol: string,
  timeframe: string,
  limit = 300,
  to?: number,
): Promise<BiquoteHistory> {
  const normalizedSymbol = symbol.toUpperCase();
  const derived = FOREX_BY_SYMBOL.get(normalizedSymbol)?.derived;
  if (!derived) return fetchDirectBiquoteOhlc(normalizedSymbol, timeframe, limit, to);
  const [left, right] = await Promise.all([
    fetchDirectBiquoteOhlc(derived.left, timeframe, limit, to),
    fetchDirectBiquoteOhlc(derived.right, timeframe, limit, to),
  ]);
  const pairs = alignBarsByTime(left.bars, right.bars, (TF_BUCKET_SEC[normalizeTimeframe(timeframe)] ?? 3600) * 2);
  const bars = pairs.reduce<BiquoteForexBar[]>((out, { left: l, right: r }) => {
    const combined = combineOhlc(derived.op, l, r);
    if (combined) {
      out.push({
        ...combined,
        time: l.time,
        volume: l.volume + r.volume,
        tickVolume: (l.tickVolume ?? 0) + (r.tickVolume ?? 0),
        isClosed: l.isClosed && r.isClosed,
      });
    }
    return out;
  }, []).sort((a, b) => a.time - b.time);
  if (bars.length < Math.min(10, Math.max(10, Math.floor(limit)))) throw new Error(`Biquote derived OHLC returned too few bars for ${normalizedSymbol}`);
  return { bars, hasMore: bars.length >= limit, source: "biquote-ohlc" };
}

export function createBiquoteForexWebSocket(options: BiquoteForexOptions) {
  const symbol = options.symbol.toUpperCase();
  const timeframe = normalizeTimeframe(options.timeframe);
  let connection: signalR.HubConnection | null = null;
  let destroyed = false;
  let startPromise: Promise<void> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;
  let quoteTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let lastTickAt = 0;
  let lastTickTimestamp = 0;
  let currentBar: BiquoteForexBar | null = null;
  let pendingQuote: ForexQuoteContract | null = null;
  let pendingBar: BiquoteForexBar | null = null;
  const pairDef = FOREX_BY_SYMBOL.get(symbol);
  const streamSymbols = pairDef?.derived ? [pairDef.derived.left, pairDef.derived.right] : [symbol];
  const latestRawQuotes = new Map<string, ForexRawQuote>();

  const status = (next: BiquoteForexStatus, detail?: string) => options.onStatus?.(next, detail);

  const emitPending = () => {
    quoteTimer = null;
    if (pendingQuote) options.onQuote?.(pendingQuote);
    if (pendingBar) options.onBar?.(pendingBar);
    pendingQuote = null;
    pendingBar = null;
  };

  const scheduleEmit = () => {
    if (quoteTimer === null) quoteTimer = setTimeout(emitPending, QUOTE_THROTTLE_MS);
  };

  const onTick = (raw: BiquoteTick) => {
    const rawSymbol = typeof raw.symbol === "string" ? raw.symbol.toUpperCase() : symbol;
    if (!streamSymbols.includes(rawSymbol)) return;
    const rawQuote = mapBiquoteRawTick(rawSymbol, raw);
    if (!rawQuote) return;
    latestRawQuotes.set(rawSymbol, rawQuote);
    const leftQuote = pairDef?.derived ? latestRawQuotes.get(pairDef.derived.left) : null;
    const rightQuote = pairDef?.derived ? latestRawQuotes.get(pairDef.derived.right) : null;
    const quoteRaw = pairDef?.derived
      ? leftQuote && rightQuote ? combineDerivedQuote(symbol, leftQuote, rightQuote) : null
      : rawQuote;
    if (!quoteRaw) return;
    const legAgeGap = leftQuote && rightQuote
      ? Math.abs(leftQuote.timestamp.getTime() - rightQuote.timestamp.getTime())
      : 0;
    const quote = toQuoteContract(quoteRaw, { forceDegraded: legAgeGap > 30_000 }, Date.now());
    const tickTime = quote.timestamp ? Math.floor(Date.parse(quote.timestamp) / 1000) : Math.floor(Date.now() / 1000);
    if (tickTime < lastTickTimestamp) return;
    lastTickTimestamp = tickTime;
    lastTickAt = Date.now();
    pendingQuote = quote;

    const bucket = bucketStartSec(tickTime, timeframe);
    const price = quote.price;
    if (!currentBar || bucket > currentBar.time) {
      if (currentBar) {
        const closedBar = { ...currentBar, isClosed: true };
        options.onBar?.(closedBar);
      }
      currentBar = { time: bucket, open: price, high: price, low: price, close: price, volume: 0, tickVolume: 0, isClosed: false };
    } else if (bucket === currentBar.time) {
      currentBar = {
        ...currentBar,
        high: Math.max(currentBar.high, price),
        low: Math.min(currentBar.low, price),
        close: price,
      };
    }
    pendingBar = currentBar;
    scheduleEmit();
    status("live");
  };

  const subscribe = async () => {
    if (!connection || connection.state !== signalR.HubConnectionState.Connected) return;
    await connection.invoke("Subscribe", streamSymbols);
  };

  const scheduleReconnect = () => {
    if (destroyed || reconnectTimer) return;
    const delay = Math.min(MAX_RECONNECT_MS, 500 * 2 ** Math.min(reconnectAttempt++, 5));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  };

  const connect = async (): Promise<void> => {
    if (destroyed) return;
    if (startPromise) return startPromise;
    if (!connection) {
      connection = new signalR.HubConnectionBuilder()
        .withUrl(HUB_URL, {
          transport: signalR.HttpTransportType.WebSockets,
          skipNegotiation: true,
        })
        .withAutomaticReconnect([0, 1_000, 2_000, 5_000, 10_000])
        .configureLogging(signalR.LogLevel.Error)
        .build();
      connection.on("ReceiveTick", (raw: BiquoteTick) => onTick(raw));
      connection.onreconnecting((error) => {
        status("reconnecting", error?.message ?? "Biquote WebSocket reconnecting");
      });
      connection.onreconnected(() => {
        reconnectAttempt = 0;
        status("syncing", "Biquote reconnected; resubscribing");
        void subscribe().then(() => status(lastTickAt > 0 ? "live" : "syncing"), (error) => status("error", String(error)));
      });
      connection.onclose((error) => {
        if (destroyed) return;
        status("reconnecting", error?.message ?? "Biquote WebSocket closed");
        scheduleReconnect();
      });
    }
    if (connection.state === signalR.HubConnectionState.Connected) {
      status(lastTickAt > 0 ? "live" : "syncing");
      return;
    }
    startPromise = (async () => {
      status("connecting");
      try {
        await connection!.start();
        reconnectAttempt = 0;
        status("syncing");
        await subscribe();
        status(lastTickAt > 0 ? "live" : "syncing");
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
    if (watchdogTimer) clearInterval(watchdogTimer);
    if (quoteTimer) clearTimeout(quoteTimer);
    reconnectTimer = null;
    watchdogTimer = null;
    quoteTimer = null;
    pendingQuote = null;
    pendingBar = null;
    if (connection) {
      const closing = connection;
      connection = null;
      void closing.stop();
    }
    status("disconnected");
  };

  watchdogTimer = setInterval(() => {
    if (destroyed || !connection || connection.state !== signalR.HubConnectionState.Connected) return;
    if (lastTickAt > 0 && Date.now() - lastTickAt > STREAM_STALE_MS) {
      status("stale", "Biquote has not delivered a tick recently");
      void connection.stop();
    }
  }, WATCHDOG_INTERVAL_MS);

  void connect().catch(() => undefined);

  return { connect, loadHistory: (limit = 300, to?: number) => fetchBiquoteOhlc(symbol, timeframe, limit, to), disconnect };
}
