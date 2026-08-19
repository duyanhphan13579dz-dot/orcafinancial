import { DataValidator, fetchWithRetry, getBreaker, ProviderError, readJsonSafe, cached, type Ohlcv } from "@/lib/connectors/core";
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

const BIQUOTE: Record<string, string> = {
  EURUSD: "EURUSD", GBPUSD: "GBPUSD", USDJPY: "USDJPY", AUDUSD: "AUDUSD",
  USDCAD: "USDCAD", USDCHF: "USDCHF", USDSGD: "USDSGD", USDHKD: "USDHKD",
  USDCNY: "USDCNY", USDTHB: "USDTHB", USDVND: "USDVND", XAUUSD: "XAUUSD",
  BRENTUSD: "XBRUSD", WTIUSD: "XTIUSD", DXY: "USDX",
};

function deriveValue(def: ForexPairDef, map: Map<string, ForexQuote>): ForexQuote | null {
  if (!def.derived) return null;
  const l = map.get(def.derived.left), r = map.get(def.derived.right);
  if (!l || !r || !r.price) return null;
  const apply = (a: number, b: number) => (def.derived!.op === "multiply" ? a * b : a / b);
  const price = apply(l.price, r.price);
  const lPrev = l.change !== null ? l.price - l.change : null;
  const rPrev = r.change !== null ? r.price - r.change : null;
  const prev = lPrev !== null && rPrev !== null && rPrev !== 0 ? apply(lPrev, rPrev) : null;
  return {
    symbol: def.symbol, price, bid: null, ask: null,
    change: prev !== null ? price - prev : null,
    changePercent: prev ? ((price - prev) / prev) * 100 : null,
    source: l.source,
    timestamp: new Date(Math.min(l.timestamp.getTime(), r.timestamp.getTime())),
  };
}

function completeDerived(map: Map<string, ForexQuote>): ForexQuote[] {
  for (const def of FOREX_PAIRS) {
    if (!def.derived || map.has(def.symbol)) continue;
    const q = deriveValue(def, map);
    if (q) map.set(def.symbol, q);
  }
  return FOREX_PAIRS.map((p) => map.get(p.symbol)).filter(Boolean) as ForexQuote[];
}

async function fetchBiquoteTick(symbol: string): Promise<ForexQuote> {
  const ticker = BIQUOTE[symbol] ?? symbol;
  const url = `https://biquote.io/api/${encodeURIComponent(ticker)}`;
  const res = await fetchWithRetry(url, { provider: "biquote", timeoutMs: 4000, retries: 1 });
  const data = await readJsonSafe<Record<string, unknown>>(res, "biquote", url);
  const price = Number(data.mid ?? data.price);
  if (!Number.isFinite(price) || price <= 0) throw new ProviderError("biquote", `bad tick ${symbol}`);
  const changePercent = typeof data.dayDiffPercent === "number" ? data.dayDiffPercent as number
    : typeof data.changePercent === "number" ? data.changePercent as number : null;
  const change = typeof data.dayDiff === "number" ? data.dayDiff as number
    : changePercent !== null ? (price * changePercent) / 100 : null;
  return {
    symbol, price,
    bid: typeof data.bid === "number" ? data.bid as number : null,
    ask: typeof data.ask === "number" ? data.ask as number : null,
    change, changePercent, source: "biquote", timestamp: new Date(),
  };
}

async function fetchBiquoteSnapshot(): Promise<ForexQuote[]> {
  const keys = Object.keys(BIQUOTE);
  const settled = await Promise.allSettled(keys.map((s) => fetchBiquoteTick(s)));
  const map = new Map<string, ForexQuote>();
  let ok = 0;
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "fulfilled") { map.set(keys[i], s.value); ok++; }
  }
  if (ok < 5) throw new ProviderError("biquote", `only ${ok} ticks`);
  return completeDerived(map);
}

async function fetchBiquoteBars(symbol: string, tf: string, limit: number): Promise<Ohlcv[]> {
  const ticker = BIQUOTE[symbol];
  if (!ticker) throw new ProviderError("biquote", `no map ${symbol}`);
  const url = `https://biquote.io/api/${encodeURIComponent(ticker)}/ohlc?interval=${tf}&limit=${Math.min(limit, 1000)}`;
  const res = await fetchWithRetry(url, { provider: "biquote", timeoutMs: 8000, retries: 1 });
  const data = await readJsonSafe<{ bars?: Array<Record<string, unknown>> }>(res, "biquote", url);
  const bars: Ohlcv[] = [];
  for (const b of data.bars ?? []) {
    if (b.isOpen) continue;
    let t = 0;
    if (typeof b.openTime === "string") t = Math.floor(new Date(b.openTime).getTime() / 1000);
    else if (typeof b.time === "number") t = (b.time as number) > 1e12 ? Math.floor((b.time as number) / 1000) : (b.time as number);
    const valid = DataValidator.ohlcv({
      time: t, open: Number(b.open), high: Number(b.high), low: Number(b.low),
      close: Number(b.close), volume: Number(b.volume ?? b.tickVolume ?? 0),
    }, { provider: "biquote", symbol });
    if (valid) bars.push(valid);
  }
  bars.sort((a, b) => a.time - b.time);
  if (bars.length < 10) throw new ProviderError("biquote", `few bars ${symbol}`);
  return bars.slice(-limit);
}

async function fetchYahooOne(yahooSymbol: string, base: string, provider: string): Promise<ForexQuote> {
  const url = `${base}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1m&range=1d`;
  const res = await fetchWithRetry(url, { provider, timeoutMs: 10000, retries: 2 });
  const data = await readJsonSafe<YahooChart>(res, provider, url);
  const result = data.chart.result?.[0];
  const meta = result?.meta;
  const price = meta?.regularMarketPrice;
  const prev = meta?.previousClose ?? meta?.chartPreviousClose;
  if (!result || !meta || typeof price !== "number" || !Number.isFinite(price) || price <= 0)
    throw new ProviderError(provider, data.chart.error?.description ?? `Invalid quote ${yahooSymbol}`);
  const previous = typeof prev === "number" && Number.isFinite(prev) && prev > 0 ? prev : null;
  return {
    symbol: yahooSymbol, price,
    bid: typeof meta.bid === "number" && Number.isFinite(meta.bid) ? meta.bid : null,
    ask: typeof meta.ask === "number" && Number.isFinite(meta.ask) ? meta.ask : null,
    change: previous !== null ? price - previous : null,
    changePercent: previous !== null ? ((price - previous) / previous) * 100 : null,
    source: provider,
    timestamp: new Date((meta.regularMarketTime ?? Date.now() / 1000) * 1000),
  };
}

async function fetchYahooSnapshot(base: string, provider: string): Promise<ForexQuote[]> {
  const direct = FOREX_PAIRS.filter((p) => p.yahooSymbol);
  const settled = await Promise.allSettled(
    direct.map((p) => fetchYahooOne(p.yahooSymbol!, base, provider).then((q) => ({ def: p, q }))),
  );
  const map = new Map<string, ForexQuote>();
  let ok = 0;
  for (const x of settled) {
    if (x.status === "fulfilled") { map.set(x.value.def.symbol, { ...x.value.q, symbol: x.value.def.symbol }); ok++; }
  }
  if (ok < 5) throw new ProviderError(provider, `${ok}/${direct.length} ok`);
  return completeDerived(map);
}

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
      time: g[0].time, open: g[0].open,
      high: Math.max(...g.map((x) => x.high)), low: Math.min(...g.map((x) => x.low)),
      close: g[g.length - 1].close, volume: g.reduce((s, x) => s + x.volume, 0),
    });
  }
  return out;
}

async function fetchDirectBars(def: ForexPairDef, tf: string, limit: number, base: string, provider: string): Promise<Ohlcv[]> {
  const p = yahooParams(tf, limit);
  const url = `${base}/v8/finance/chart/${encodeURIComponent(def.yahooSymbol!)}?interval=${p.interval}&range=${p.range}`;
  const res = await fetchWithRetry(url, { provider, timeoutMs: 12000, retries: 2 });
  const data = await readJsonSafe<YahooChart>(res, provider, url);
  const r = data.chart.result?.[0], q = r?.indicators.quote?.[0];
  if (!r?.timestamp || !q) throw new ProviderError(provider, `No OHLC for ${def.symbol}`);
  const bars: Ohlcv[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const valid = DataValidator.ohlcv({
      time: r.timestamp[i], open: q.open[i] as number, high: q.high[i] as number,
      low: q.low[i] as number, close: q.close[i] as number, volume: Number(q.volume[i] ?? 0),
    }, { provider, symbol: def.symbol });
    if (valid) bars.push(valid);
  }
  return (tf === "4h" ? aggregate4h(bars) : bars).slice(-limit);
}

function deriveBars(def: ForexPairDef, left: Ohlcv[], right: Ohlcv[]): Ohlcv[] {
  const rm = new Map(right.map((b) => [b.time, b]));
  const out: Ohlcv[] = [];
  const op = (a: number, b: number) => (def.derived!.op === "multiply" ? a * b : a / b);
  for (const l of left) {
    const r = rm.get(l.time);
    if (!r?.open || !r.high || !r.low || !r.close) continue;
    const values = [op(l.open, r.open), op(l.high, r.high), op(l.low, r.low), op(l.close, r.close)];
    out.push({ time: l.time, open: values[0], high: Math.max(...values), low: Math.min(...values), close: values[3], volume: 0 });
  }
  return out;
}

async function fetchYahooBarsFrom(symbol: string, tf: string, limit: number, base: string, provider: string): Promise<Ohlcv[]> {
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

async function fetchStooqDaily(symbol: string, limit: number): Promise<Ohlcv[]> {
  const map: Record<string, string> = {
    EURUSD: "eurusd", GBPUSD: "gbpusd", USDJPY: "usdjpy", AUDUSD: "audusd",
    USDCAD: "usdcad", USDCHF: "usdchf", XAUUSD: "xauusd",
  };
  const ticker = map[symbol];
  if (!ticker) throw new ProviderError("stooq", `no map ${symbol}`);
  const url = `https://stooq.com/q/d/l/?s=${ticker}&i=d`;
  const res = await fetchWithRetry(url, { provider: "stooq", timeoutMs: 10000, retries: 1, headers: { Accept: "text/csv,*/*" } });
  const text = await res.text();
  const bars: Ohlcv[] = [];
  for (const line of text.trim().split("\n").slice(1)) {
    const [date, o, h, l, c, v] = line.split(",");
    if (!date || date === "Date") continue;
    const valid = DataValidator.ohlcv({
      time: Math.floor(new Date(date + "T00:00:00Z").getTime() / 1000),
      open: Number(o), high: Number(h), low: Number(l), close: Number(c), volume: Number(v) || 0,
    }, { provider: "stooq", symbol });
    if (valid) bars.push(valid);
  }
  if (bars.length < 10) throw new ProviderError("stooq", `few bars ${symbol}`);
  return bars.slice(-limit);
}

const VALID = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);

export async function fetchForexSnapshot(): Promise<{ quotes: ForexQuote[]; source: string }> {
  return cached("forex:snapshot:v3", 4000, async () => {
    const attempts: Array<{ name: string; fn: () => Promise<ForexQuote[]> }> = [
      { name: "biquote", fn: () => getBreaker("biquote").exec(fetchBiquoteSnapshot) },
      { name: YAHOO1, fn: () => getBreaker(YAHOO1).exec(() => fetchYahooSnapshot("https://query1.finance.yahoo.com", YAHOO1)) },
      { name: YAHOO2, fn: () => getBreaker(YAHOO2).exec(() => fetchYahooSnapshot("https://query2.finance.yahoo.com", YAHOO2)) },
    ];
    const errors: string[] = [];
    for (const a of attempts) {
      try {
        const quotes = await a.fn();
        if (quotes.length >= 5) {
          log.info("snapshot_ok", { source: a.name, count: quotes.length });
          return { quotes, source: a.name };
        }
      } catch (err) {
        errors.push(`${a.name}: ${err instanceof Error ? err.message : String(err)}`);
        log.warn("snapshot_source_failed", { source: a.name, error: String(err) });
      }
    }
    throw new ProviderError("forex-snapshot", `all failed: ${errors.join(" | ")}`);
  });
}

export async function fetchForexBars(symbol: string, timeframe: string, limit = 300): Promise<{ bars: Ohlcv[]; source: string }> {
  if (!VALID.has(timeframe)) throw new Error("Invalid timeframe");
  const ttl = timeframe === "1m" ? 20000 : timeframe === "5m" ? 40000 : timeframe === "15m" ? 60000 : timeframe === "1h" ? 120000 : 300000;
  return cached(`forex:ohlcv:${symbol}:${timeframe}:${limit}`, ttl, async () => {
    const attempts: Array<{ name: string; fn: () => Promise<Ohlcv[]> }> = [];
    if (BIQUOTE[symbol] && timeframe !== "4h") {
      attempts.push({ name: "biquote", fn: () => getBreaker("biquote").exec(() => fetchBiquoteBars(symbol, timeframe, limit)) });
    }
    attempts.push(
      { name: YAHOO1, fn: () => getBreaker(YAHOO1).exec(() => fetchYahooBarsFrom(symbol, timeframe, limit, "https://query1.finance.yahoo.com", YAHOO1)) },
      { name: YAHOO2, fn: () => getBreaker(YAHOO2).exec(() => fetchYahooBarsFrom(symbol, timeframe, limit, "https://query2.finance.yahoo.com", YAHOO2)) },
    );
    if (timeframe === "1d") {
      attempts.push({ name: "stooq", fn: () => getBreaker("stooq").exec(() => fetchStooqDaily(symbol, limit)) });
    }
    const errors: string[] = [];
    for (const a of attempts) {
      try {
        const bars = await a.fn();
        if (bars.length >= 10) {
          log.info("ohlcv_ok", { source: a.name, symbol, timeframe, bars: bars.length });
          return { bars, source: a.name };
        }
      } catch (err) {
        errors.push(`${a.name}: ${err instanceof Error ? err.message : String(err)}`);
        log.warn("ohlcv_source_failed", { source: a.name, symbol, timeframe, error: String(err) });
      }
    }
    throw new ProviderError("forex-ohlcv", `all failed ${symbol}/${timeframe}: ${errors.join(" | ")}`);
  });
}
