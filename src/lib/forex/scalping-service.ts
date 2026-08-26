import type { Ohlcv } from "@/lib/connectors/core";
import { FOREX_BY_SYMBOL, FOREX_PAIRS } from "./data";
import { combineDerivedQuote, fetchBiquoteOhlc, mapBiquoteRawTick, type BiquoteTick } from "./biquote-websocket";
import type { ForexRawQuote } from "./types";
import { getSessionInfo } from "./fx-intelligence";
import { buildMacroContextLive } from "./macro";
import { forexPairMeta, runForexScalping, type ForexScalpingConfig, type ForexScalpingMarketData, type ForexScalpingResult } from "./scalping";

const TIMEFRAMES = ["1m", "5m", "15m"] as const;
const LIMITS = { "1m": 240, "5m": 120, "15m": 80 } as const;
type LiveQuote = NonNullable<ForexScalpingMarketData["quote"]>;

function toOhlcv(bars: Array<Ohlcv & { isClosed?: boolean }>): Ohlcv[] {
  return bars.filter((bar) => bar.isClosed !== false).map(({ time, open, high, low, close, volume }) => ({ time, open, high, low, close, volume }));
}

async function fetchBiquoteRawQuote(symbol: string): Promise<ForexRawQuote | null> {
  const def = FOREX_BY_SYMBOL.get(symbol);
  if (def?.derived) {
    const [left, right] = await Promise.all([fetchBiquoteRawQuote(def.derived.left), fetchBiquoteRawQuote(def.derived.right)]);
    return left && right ? combineDerivedQuote(symbol, left, right) : null;
  }
  const response = await fetch(`https://biquote.io/api/${encodeURIComponent(symbol)}`, { cache: "no-store", signal: AbortSignal.timeout(4_000) });
  if (!response.ok) throw new Error(`Biquote quote HTTP ${response.status}`);
  return mapBiquoteRawTick(symbol, (await response.json()) as BiquoteTick);
}

function quoteForScalping(raw: ForexRawQuote | null, pipSize: number): LiveQuote | null {
  if (!raw || !Number.isFinite(raw.price) || raw.price <= 0) return null;
  const spreadPips = raw.bid != null && raw.ask != null ? Math.max(0, raw.ask - raw.bid) / pipSize : null;
  return { price: raw.price, bid: raw.bid, ask: raw.ask, spreadPips, timestamp: raw.timestamp.toISOString() };
}

function fallback(symbol: string, reason: string): ForexScalpingResult {
  const now = Date.now();
  return { symbol, generatedAt: new Date(now).toISOString(), signal: "WAIT", state: "HALTED", paperOnly: true, executionEnabled: false, dataQuality: { coverage: { "1m": 0, "5m": 0, "15m": 0 }, latestAgeSec: { "1m": null, "5m": null, "15m": null }, gaps: [reason], score: 0, ok: false }, candidates: [], bestCandidate: null, blockers: [reason, "paper-only: không có execution path"], config: { parameterVersion: "forex-scalping-1.0.0", minSetupScore: 65, riskPerTrade: 0.0015, maxOpenRisk: 0.0075 } };
}

export async function getForexScalpingResult(symbol: string, overrides: Partial<ForexScalpingConfig> = {}): Promise<ForexScalpingResult> {
  const normalized = symbol.toUpperCase();
  const def = FOREX_BY_SYMBOL.get(normalized);
  if (!def) return fallback(normalized, "Forex pair không tồn tại");
  try {
    const [quoteRaw, macro, ...history] = await Promise.all([fetchBiquoteRawQuote(normalized), buildMacroContextLive(normalized), ...TIMEFRAMES.map((tf) => fetchBiquoteOhlc(normalized, tf, LIMITS[tf]))]);
    const meta = forexPairMeta(def, { accountCurrency: overrides.accountCurrency ?? "USD" });
    const bars = { "1m": toOhlcv(history[0].bars), "5m": toOhlcv(history[1].bars), "15m": toOhlcv(history[2].bars) };
    const session = getSessionInfo(new Date());
    const input: ForexScalpingMarketData = { meta, bars, quote: quoteForScalping(quoteRaw, meta.pipSize), sessionAllowed: session.id !== "off", sessionLabel: session.label, newsLock: macro.stance === "wait", newsState: `${macro.source}:${macro.eventRisk}`, secondsToRollover: null, nowMs: Date.now() };
    return runForexScalping(input, overrides);
  } catch (error) {
    return fallback(normalized, `Biquote scalping pipeline failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function scanForexScalping(symbols?: string[], overrides: Partial<ForexScalpingConfig> = {}) {
  const requested = symbols?.length ? symbols : FOREX_PAIRS.filter((pair) => pair.category === "usd_cross").map((pair) => pair.symbol);
  const unique = [...new Set(requested.map((symbol) => symbol.toUpperCase()))].filter((symbol) => FOREX_BY_SYMBOL.has(symbol)).slice(0, 24);
  const results = await mapPool(unique, 4, (symbol) => getForexScalpingResult(symbol, overrides));
  return { results: results.sort((a, b) => (b.bestCandidate?.score ?? 0) - (a.bestCandidate?.score ?? 0)), generatedAt: new Date().toISOString(), paperOnly: true as const, executionEnabled: false as const };
}

async function mapPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = []; let cursor = 0;
  async function run() { while (cursor < items.length) { const index = cursor++; output[index] = await worker(items[index]); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => run()));
  return output;
}
