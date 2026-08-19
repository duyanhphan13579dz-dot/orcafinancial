import { DataValidator, fetchWithRetry, getBreaker, ProviderError, readJsonSafe, type Ohlcv } from "@/lib/connectors/core";
import { FOREX_BY_SYMBOL, FOREX_PAIRS, type ForexPairDef } from "./data";
import { forProvider } from "@/lib/logger";

const YAHOO1 = "yahoo-forex-primary",
  YAHOO2 = "yahoo-forex-fallback";
const log = forProvider("forex-connectors");

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

function deriveValue(def: ForexPairDef, map: Map<string, ForexQuote>): ForexQuote | null {
  if (!def.derived) return null;
  const l = map.get(def.derived.left),
    r = map.get(def.derived.right);
  if (!l || !r || !r.price) return null;
  const apply = (a: number, b: number) => (def.derived!.op === "multiply" ? a * b : a / b);
  const price = apply(l.price, r.price);
  const lPrev = l.change !== null ? l.price - l.change : null,
    rPrev = r.change !== null ? r.price - r.change : null;
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

async function fetchYahooOne(
  yahooSymbol: string,
  base: string,
  provider: string,
): Promise<{ quote: ForexQuote; bars?: Ohlcv[] }> {
  const encoded = encodeURIComponent(yahooSymbol);
  const url = `${base}/v8/finance/chart/${encoded}?interval=1m&range=1d`;
  const res = await fetchWithRetry(url, { provider, timeoutMs: 15000, retries: 3 });
  const data = await readJsonSafe<YahooChart>(res, provider, url);
  const result = data.chart.result?.[0];
  const meta = result?.meta,
    price = meta?.regularMarketPrice,
    prev = meta?.previousClose ?? meta?.chartPreviousClose;
  if (!result || !meta || typeof price !== "number" || !Number.isFinite(price) || price <= 0)
    throw new ProviderError(provider, data.chart.error?.description ?? `Invalid quote ${yahooSymbol}`);
  const bid = typeof meta.bid === "number" && Number.isFinite(meta.bid) ? meta.bid : null,
    ask = typeof meta.ask === "number" && Number.isFinite(meta.ask) ? meta.ask : null;
  const previous = typeof prev === "number" && Number.isFinite(prev) && prev > 0 ? prev : null;
  return {
    quote: {
      symbol: yahooSymbol,
      price,
      bid,
      ask,
      change: previous !== null ? price - previous : null,
      changePercent: previous !== null ? ((price - previous) / previous) * 100 : null,
      source: provider,
      timestamp: new Date((meta.regularMarketTime ?? Date.now() / 1000) * 1000),
    },
  };
}

async function fetchSnapshotFrom(base: string, provider: string): Promise<ForexQuote[]> {
  const direct = FOREX_PAIRS.filter((p) => p.yahooSymbol);
  const settled = await Promise.allSettled(
    direct.map((p) => fetchYahooOne(p.yahooSymbol!, base, provider).then((x) => ({ def: p, q: x.quote }))),
  );
  const failed = settled.filter((x) => x.status === "rejected");
  if (failed.length)
    throw new ProviderError(provider, `${failed.length}/${direct.length} direct forex tickers failed`);
  const map = new Map<string, ForexQuote>();
  for (const x of settled)
    if (x.status === "fulfilled") map.set(x.value.def.symbol, { ...x.value.q, symbol: x.value.def.symbol });
  for (const def of FOREX_PAIRS)
    if (def.derived) {
      const q = deriveValue(def, map);
      if (!q) throw new ProviderError(provider, `Cannot derive ${def.symbol}`);
      map.set(def.symbol, q);
    }
  return FOREX_PAIRS.map((p) => map.get(p.symbol)!).filter(Boolean);
}

export async function fetchForexSnapshot(): Promise<{ quotes: ForexQuote[]; source: string }> {
  try {
    return {
      quotes: await getBreaker(YAHOO1).exec(() => fetchSnapshotFrom("https://query1.finance.yahoo.com", YAHOO1)),
      source: YAHOO1,
    };
  } catch (err) {
    log.warn("yahoo_primary_failed", { error: String(err) });
    return {
      quotes: await getBreaker(YAHOO2).exec(() => fetchSnapshotFrom("https://query2.finance.yahoo.com", YAHOO2)),
      source: YAHOO2,
    };
  }
}

const VALID = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);

function yahooParams(tf: string, limit: number) {
  if (tf === "4h") return { interval: "1h", range: limit > 300 ? "2y" : "3mo" };
  if (tf === "1d") return { interval: "1d", range: limit > 365 ? "5y" : "2y" };
  if (tf === "1h") return { interval: "1h", range: "3mo" };
  return { interval: tf, range: tf === "1m" ? "7d" : "60d" };
}

function aggregate4h(bars: Ohlcv[]): Ohlcv[] {
  const out: Ohlcv[] = [];
  for (let i = 0; i < bars.length; i += 4) {
    const g = bars.slice(i, i + 4);
    if (g.length < 4) continue;
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
  const p = yahooParams(tf, limit),
    url = `${base}/v8/finance/chart/${encodeURIComponent(def.yahooSymbol!)}?interval=${p.interval}&range=${p.range}`;
  const res = await fetchWithRetry(url, { provider, timeoutMs: 15000, retries: 3 });
  const data = await readJsonSafe<YahooChart>(res, provider, url);
  const r = data.chart.result?.[0],
    q = r?.indicators.quote?.[0];
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
  const final = tf === "4h" ? aggregate4h(bars) : bars;
  return final.slice(-limit);
}

function deriveBars(def: ForexPairDef, left: Ohlcv[], right: Ohlcv[]): Ohlcv[] {
  const rm = new Map(right.map((b) => [b.time, b])),
    out: Ohlcv[] = [];
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
  const left = FOREX_BY_SYMBOL.get(def.derived!.left)!,
    right = FOREX_BY_SYMBOL.get(def.derived!.right)!;
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
  limit = 300,
): Promise<{ bars: Ohlcv[]; source: string }> {
  if (!VALID.has(timeframe)) throw new Error("Invalid timeframe");
  try {
    return {
      bars: await getBreaker(YAHOO1).exec(() =>
        fetchBarsFrom(symbol, timeframe, limit, "https://query1.finance.yahoo.com", YAHOO1),
      ),
      source: YAHOO1,
    };
  } catch (err) {
    log.warn("yahoo_ohlcv_primary_failed", { symbol, timeframe, error: String(err) });
    return {
      bars: await getBreaker(YAHOO2).exec(() =>
        fetchBarsFrom(symbol, timeframe, limit, "https://query2.finance.yahoo.com", YAHOO2),
      ),
      source: YAHOO2,
    };
  }
}
