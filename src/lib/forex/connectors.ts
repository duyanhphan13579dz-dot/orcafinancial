import {
  DataValidator,
  fetchWithRetry,
  getBreaker,
  ProviderError,
  readJsonSafe,
  type Ohlcv,
} from "@/lib/connectors/core";
import { FOREX_BY_SYMBOL, FOREX_PAIRS, type ForexPairDef } from "./data";
import { forProvider } from "@/lib/logger";

const YAHOO1 = "yahoo-forex-primary";
const YAHOO2 = "yahoo-forex-fallback";
const log = forProvider("forex-connectors");

/** Tight timeouts — chart target 1–3s end-to-end. */
const QUOTE_TIMEOUT_MS = 4_000;
const QUOTE_RETRIES = 0;
const BARS_TIMEOUT_MS = 2_500;
const BARS_RETRIES = 0;

export interface ForexQuote {
  symbol: string;
  price: number;
  bid: number | null;
  ask: number | null;
  change: number | null;
  changePercent: number | null;
  source: string;
  timestamp: Date;
}

interface YahooChart {
  chart: {
    result?: Array<{
      meta: {
        regularMarketPrice?: number;
        previousClose?: number;
        chartPreviousClose?: number;
        regularMarketTime?: number;
        bid?: number;
        ask?: number;
      };
      timestamp?: number[];
      indicators: {
        quote: Array<{
          open: Array<number | null>;
          high: Array<number | null>;
          low: Array<number | null>;
          close: Array<number | null>;
          volume: Array<number | null>;
        }>;
      };
    }>;
    error?: { description?: string } | null;
  };
}

interface YahooQuoteBatch {
  quoteResponse?: {
    result?: Array<{
      symbol: string;
      regularMarketPrice?: number;
      regularMarketChange?: number;
      regularMarketChangePercent?: number;
      regularMarketTime?: number;
      bid?: number;
      ask?: number;
      previousClose?: number;
    }>;
    error?: unknown;
  };
}

function deriveValue(def: ForexPairDef, map: Map<string, ForexQuote>): ForexQuote | null {
  if (!def.derived) return null;
  const l = map.get(def.derived.left);
  const r = map.get(def.derived.right);
  if (!l || !r || !r.price) return null;
  const apply = (a: number, b: number) => (def.derived!.op === "multiply" ? a * b : a / b);
  const price = apply(l.price, r.price);
  const lPrev = l.change !== null ? l.price - l.change : null;
  const rPrev = r.change !== null ? r.price - r.change : null;
  const prev = lPrev !== null && rPrev !== null && rPrev !== 0 ? apply(lPrev, rPrev) : null;
  return {
    symbol: def.symbol,
    price,
    bid: null,
    ask: null,
    change: prev !== null ? price - prev : null,
    changePercent: prev ? ((price - prev) / prev) * 100 : null,
    source: l.source,
    timestamp: new Date(Math.min(l.timestamp.getTime(), r.timestamp.getTime())),
  };
}

async function fetchBatchQuotes(base: string, provider: string): Promise<Map<string, ForexQuote>> {
  const direct = FOREX_PAIRS.filter((p) => p.yahooSymbol);
  const symbols = direct.map((p) => p.yahooSymbol!).join(",");
  const url = `${base}/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`;
  const res = await fetchWithRetry(url, {
    provider,
    timeoutMs: QUOTE_TIMEOUT_MS,
    retries: QUOTE_RETRIES,
  });
  const data = await readJsonSafe<YahooQuoteBatch>(res, provider, url);
  const results = data.quoteResponse?.result ?? [];
  if (!results.length) {
    throw new ProviderError(provider, "Yahoo batch quote returned empty result");
  }

  const byYahoo = new Map(direct.map((p) => [p.yahooSymbol!, p]));
  const map = new Map<string, ForexQuote>();

  for (const row of results) {
    const def = byYahoo.get(row.symbol);
    if (!def) continue;
    const price = row.regularMarketPrice;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
    const change =
      typeof row.regularMarketChange === "number" && Number.isFinite(row.regularMarketChange)
        ? row.regularMarketChange
        : null;
    const changePercent =
      typeof row.regularMarketChangePercent === "number" &&
      Number.isFinite(row.regularMarketChangePercent)
        ? row.regularMarketChangePercent
        : null;
    map.set(def.symbol, {
      symbol: def.symbol,
      price,
      bid: typeof row.bid === "number" && Number.isFinite(row.bid) ? row.bid : null,
      ask: typeof row.ask === "number" && Number.isFinite(row.ask) ? row.ask : null,
      change,
      changePercent,
      source: provider,
      timestamp: new Date((row.regularMarketTime ?? Date.now() / 1000) * 1000),
    });
  }

  if (map.size === 0) {
    throw new ProviderError(provider, "Yahoo batch quote had no valid prices");
  }

  for (const def of FOREX_PAIRS) {
    if (!def.derived) continue;
    const q = deriveValue(def, map);
    if (q) map.set(def.symbol, q);
  }

  log.info("yahoo_batch_quote_ok", {
    provider,
    requested: direct.length,
    received: map.size,
  });

  return map;
}

export async function fetchForexSnapshot(): Promise<{ quotes: ForexQuote[]; source: string }> {
  const tryHost = async (base: string, provider: string) => {
    const map = await getBreaker(provider).exec(() => fetchBatchQuotes(base, provider));
    const quotes = FOREX_PAIRS.map((p) => map.get(p.symbol)).filter(
      (q): q is ForexQuote => Boolean(q),
    );
    if (quotes.length < 5) {
      throw new ProviderError(provider, `Only ${quotes.length} quotes — too sparse`);
    }
    return { quotes, source: provider };
  };

  const attempts = [
    tryHost("https://query1.finance.yahoo.com", YAHOO1),
    tryHost("https://query2.finance.yahoo.com", YAHOO2),
  ];
  const errors: string[] = [];
  return await new Promise<{ quotes: ForexQuote[]; source: string }>((resolve, reject) => {
    let pending = attempts.length;
    let settled = false;
    for (const p of attempts) {
      p.then((v) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      }).catch((e) => {
        errors.push(String(e));
        pending -= 1;
        if (pending === 0 && !settled) {
          reject(new ProviderError("forex-race", `all failed: ${errors.join(" | ")}`));
        }
      });
    }
  });
}

/** All supported TFs including DXY higher-timeframe set. */
const VALID = new Set(["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1mo", "12mo"]);

function yahooParams(tf: string, limit: number) {
  if (tf === "4h") return { interval: "1h", range: limit > 200 ? "3mo" : "1mo" };
  if (tf === "1d") return { interval: "1d", range: limit > 200 ? "5y" : "2y" };
  if (tf === "1w") return { interval: "1wk", range: "10y" };
  if (tf === "1mo") return { interval: "1mo", range: "max" };
  // 12mo yearly bars: pull monthly then aggregate
  if (tf === "12mo") return { interval: "1mo", range: "max" };
  if (tf === "1h") return { interval: "1h", range: "1mo" };
  if (tf === "15m") return { interval: "15m", range: "10d" };
  if (tf === "5m") return { interval: "5m", range: "5d" };
  return { interval: "1m", range: "2d" };
}

function aggregateBars(bars: Ohlcv[], groupSize: number): Ohlcv[] {
  const out: Ohlcv[] = [];
  for (let i = 0; i < bars.length; i += groupSize) {
    const g = bars.slice(i, i + groupSize);
    if (g.length < Math.min(groupSize, 2) && groupSize > 1) continue;
    if (g.length === 0) continue;
    out.push({
      time: g[0].time,
      open: g[0].open,
      high: Math.max(...g.map((x) => x.high)),
      low: Math.min(...g.map((x) => x.low)),
      close: g[g.length - 1].close,
      volume: g.reduce((s, x) => s + x.volume, 0),
    });
  }
  return out;
}

async function fetchDirectBars(
  def: ForexPairDef,
  tf: string,
  limit: number,
  base: string,
  provider: string,
): Promise<Ohlcv[]> {
  const p = yahooParams(tf, limit);
  const url = `${base}/v8/finance/chart/${encodeURIComponent(def.yahooSymbol!)}?interval=${p.interval}&range=${p.range}`;
  const res = await fetchWithRetry(url, {
    provider,
    timeoutMs: BARS_TIMEOUT_MS,
    retries: BARS_RETRIES,
  });
  const data = await readJsonSafe<YahooChart>(res, provider, url);
  const r = data.chart.result?.[0];
  const q = r?.indicators.quote?.[0];
  if (!r?.timestamp || !q) throw new ProviderError(provider, `No OHLC for ${def.symbol}`);
  const bars: Ohlcv[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const valid = DataValidator.ohlcv(
      {
        time: r.timestamp[i],
        open: q.open[i] as number,
        high: q.high[i] as number,
        low: q.low[i] as number,
        close: q.close[i] as number,
        volume: Number(q.volume[i] ?? 0),
      },
      { provider, symbol: def.symbol },
    );
    if (valid) bars.push(valid);
  }

  let final = bars;
  if (tf === "4h") final = aggregateBars(bars, 4);
  if (tf === "12mo") final = aggregateBars(bars, 12);

  return final.slice(-limit);
}

function deriveBars(def: ForexPairDef, left: Ohlcv[], right: Ohlcv[]): Ohlcv[] {
  const rm = new Map(right.map((b) => [b.time, b]));
  const out: Ohlcv[] = [];
  const op = (a: number, b: number) => (def.derived!.op === "multiply" ? a * b : a / b);
  for (const l of left) {
    const r = rm.get(l.time);
    if (!r || !r.open || !r.high || !r.low || !r.close) continue;
    const values = [op(l.open, r.open), op(l.high, r.high), op(l.low, r.low), op(l.close, r.close)];
    out.push({
      time: l.time,
      open: values[0],
      high: Math.max(...values),
      low: Math.min(...values),
      close: values[3],
      volume: 0,
    });
  }
  return out;
}

async function fetchBarsFrom(
  symbol: string,
  tf: string,
  limit: number,
  base: string,
  provider: string,
): Promise<Ohlcv[]> {
  const def = FOREX_BY_SYMBOL.get(symbol);
  if (!def) throw new Error("Forex pair not found");
  if (def.yahooSymbol) return fetchDirectBars(def, tf, limit, base, provider);
  const left = FOREX_BY_SYMBOL.get(def.derived!.left)!;
  const right = FOREX_BY_SYMBOL.get(def.derived!.right)!;
  const [lb, rb] = await Promise.all([
    fetchDirectBars(left, tf, limit, base, provider),
    fetchDirectBars(right, tf, limit, base, provider),
  ]);
  const result = deriveBars(def, lb, rb).slice(-limit);
  if (!result.length) throw new ProviderError(provider, `Cannot derive bars ${symbol}`);
  return result;
}

export async function fetchForexBars(
  symbol: string,
  timeframe: string,
  limit = 120,
): Promise<{ bars: Ohlcv[]; source: string }> {
  if (!VALID.has(timeframe)) throw new Error("Invalid timeframe");

  // Higher TF charts need fewer bars; lower threshold for yearly
  const minBars = timeframe === "12mo" ? 5 : 10;

  const attempts: Array<Promise<{ bars: Ohlcv[]; source: string }>> = [
    getBreaker(YAHOO1)
      .exec(() =>
        fetchBarsFrom(symbol, timeframe, limit, "https://query1.finance.yahoo.com", YAHOO1),
      )
      .then((bars) => ({ bars, source: YAHOO1 })),
    getBreaker(YAHOO2)
      .exec(() =>
        fetchBarsFrom(symbol, timeframe, limit, "https://query2.finance.yahoo.com", YAHOO2),
      )
      .then((bars) => ({ bars, source: YAHOO2 })),
  ];

  const errors: string[] = [];
  return await new Promise<{ bars: Ohlcv[]; source: string }>((resolve, reject) => {
    let pending = attempts.length;
    let settled = false;
    for (const p of attempts) {
      p.then((v) => {
        if (!settled && v.bars.length >= minBars) {
          settled = true;
          resolve(v);
        } else if (!settled) {
          errors.push(`${v.source}:few_bars`);
          pending -= 1;
          if (pending === 0) {
            reject(new ProviderError("forex-ohlcv-race", `all failed: ${errors.join(" | ")}`));
          }
        }
      }).catch((e) => {
        errors.push(String(e));
        pending -= 1;
        if (pending === 0 && !settled) {
          reject(new ProviderError("forex-ohlcv-race", `all failed: ${errors.join(" | ")}`));
        }
      });
    }
  });
}
