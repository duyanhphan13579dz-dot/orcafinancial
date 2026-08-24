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
import { alignBarsByTime, combineOhlc } from "./normalize";
import type { ForexQuote } from "./types";
import {
  enrichWithSecondary,
  secondaryOnlySnapshot,
  type PipelineResult,
} from "./providers/pipeline";
import {
  classifyYahooError,
  getYahooAuth,
  invalidateYahooAuth,
  yahooBrowserHeaders,
  YAHOO_UA,
} from "./providers/yahoo-auth";

export type { ForexQuote };

const YAHOO1 = "yahoo-forex-primary";
const YAHOO2 = "yahoo-forex-fallback";
const log = forProvider("forex-connectors");

const QUOTE_TIMEOUT_MS = 5_000;
const QUOTE_RETRIES = 0;
const BARS_TIMEOUT_MS = 3_000;
const BARS_RETRIES = 0;
const DERIVED_STALE_LEG_MS = 30_000;

export interface ForexSnapshotResult {
  quotes: ForexQuote[];
  source: string;
  pipeline?: Omit<PipelineResult, "quotes">;
}

interface YahooChart {
  chart: {
    result?: Array<{
      meta: {
        symbol?: string;
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
    error?: { description?: string; code?: string } | null;
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
    error?: { code?: string; description?: string } | null;
  };
  finance?: {
    result?: unknown;
    error?: { code?: string; description?: string } | null;
  };
}

function deriveValue(def: ForexPairDef, map: Map<string, ForexQuote>): ForexQuote | null {
  if (!def.derived) return null;
  const l = map.get(def.derived.left);
  const r = map.get(def.derived.right);
  if (!l || !r || !r.price || !l.price) return null;

  const apply = (a: number, b: number) => (def.derived!.op === "multiply" ? a * b : a / b);
  if (def.derived.op === "divide" && r.price === 0) return null;

  const price = apply(l.price, r.price);
  if (!Number.isFinite(price) || price <= 0) return null;

  const lPrev = l.change !== null ? l.price - l.change : null;
  const rPrev = r.change !== null ? r.price - r.change : null;
  const prev =
    lPrev !== null && rPrev !== null && rPrev !== 0 ? apply(lPrev, rPrev) : null;

  const legAgeGap = Math.abs(l.timestamp.getTime() - r.timestamp.getTime());
  const sourceMismatch = l.source !== r.source;
  const degraded = legAgeGap > DERIVED_STALE_LEG_MS || sourceMismatch;

  let bid: number | null = null;
  let ask: number | null = null;
  if (
    l.bid !== null &&
    l.ask !== null &&
    r.bid !== null &&
    r.ask !== null &&
    l.bid > 0 &&
    r.bid > 0
  ) {
    if (def.derived.op === "multiply") {
      bid = l.bid * r.bid;
      ask = l.ask * r.ask;
    } else {
      bid = Math.min(l.bid / r.ask, l.ask / r.bid, l.bid / r.bid, l.ask / r.ask);
      ask = Math.max(l.bid / r.ask, l.ask / r.bid, l.bid / r.bid, l.ask / r.ask);
      if (!Number.isFinite(bid) || !Number.isFinite(ask) || ask < bid) {
        bid = null;
        ask = null;
      }
    }
  }

  return {
    symbol: def.symbol,
    price,
    bid,
    ask,
    change: prev !== null ? price - prev : null,
    changePercent: prev ? ((price - prev) / prev) * 100 : null,
    source: `${l.source}+derived`,
    timestamp: new Date(Math.min(l.timestamp.getTime(), r.timestamp.getTime())),
    degraded,
  };
}

function applyDerived(map: Map<string, ForexQuote>) {
  for (const def of FOREX_PAIRS) {
    if (!def.derived) continue;
    const q = deriveValue(def, map);
    if (q) map.set(def.symbol, q);
  }
}

async function readYahooJson<T>(
  res: Response,
  provider: string,
  url: string,
): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    const cls = classifyYahooError(res.status, text);
    if (cls.retryAuth) invalidateYahooAuth();
    throw new ProviderError(provider, cls.message, {
      status: res.status,
      code: cls.code,
      retryAuth: cls.retryAuth,
      snippet: text.slice(0, 200),
    });
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError(provider, `JSON parse failed for ${url}`, {
      snippet: text.slice(0, 200),
    });
  }
}

async function fetchBatchQuotesOnce(
  base: string,
  provider: string,
  forceAuthRefresh: boolean,
): Promise<Map<string, ForexQuote>> {
  const direct = FOREX_PAIRS.filter((p) => p.yahooSymbol);
  const symbols = direct.map((p) => p.yahooSymbol!).join(",");

  let auth = await getYahooAuth({
    forceRefresh: forceAuthRefresh,
    preferHost: base.includes("query2") ? "query2" : "query1",
  }).catch((e) => {
    log.warn("yahoo_auth_unavailable", {
      provider,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  });

  const crumbQs = auth?.crumb ? `&crumb=${encodeURIComponent(auth.crumb)}` : "";
  const url = `${base}/v7/finance/quote?symbols=${encodeURIComponent(symbols)}${crumbQs}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      ...yahooBrowserHeaders(auth),
      "User-Agent": YAHOO_UA,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
  });

  const data = await readYahooJson<YahooQuoteBatch>(res, provider, url);

  // Some Yahoo responses nest error under finance
  const apiErr =
    data.quoteResponse?.error ??
    data.finance?.error ??
    null;
  if (apiErr?.description) {
    const cls = classifyYahooError(401, apiErr.description);
    if (cls.retryAuth) invalidateYahooAuth();
    throw new ProviderError(provider, cls.message, {
      code: cls.code,
      retryAuth: cls.retryAuth,
      description: apiErr.description,
    });
  }

  const results = data.quoteResponse?.result ?? [];
  if (!results.length) {
    throw new ProviderError(provider, "Yahoo batch quote returned empty result", {
      code: "EMPTY",
    });
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
      bid: typeof row.bid === "number" && Number.isFinite(row.bid) && row.bid > 0 ? row.bid : null,
      ask: typeof row.ask === "number" && Number.isFinite(row.ask) && row.ask > 0 ? row.ask : null,
      change,
      changePercent,
      source: provider,
      timestamp: new Date((row.regularMarketTime ?? Date.now() / 1000) * 1000),
    });
  }

  if (map.size === 0) {
    throw new ProviderError(provider, "Yahoo batch quote had no valid prices", {
      code: "EMPTY",
    });
  }

  applyDerived(map);
  log.info("yahoo_batch_quote_ok", {
    provider,
    requested: direct.length,
    received: map.size,
    authed: Boolean(auth),
  });
  return map;
}

async function fetchBatchQuotes(
  base: string,
  provider: string,
): Promise<Map<string, ForexQuote>> {
  try {
    return await fetchBatchQuotesOnce(base, provider, false);
  } catch (err) {
    const retryAuth =
      err instanceof ProviderError &&
      (err.meta?.retryAuth === true || err.meta?.code === "INVALID_CRUMB");
    if (retryAuth) {
      log.warn("yahoo_quote_retry_with_fresh_auth", { provider });
      invalidateYahooAuth();
      return fetchBatchQuotesOnce(base, provider, true);
    }
    throw err;
  }
}

/**
 * Fallback when /v7/quote fails: pull regularMarketPrice from chart meta
 * (v8 chart usually does not require crumb).
 */
async function fetchQuotesFromChartMeta(
  base: string,
  provider: string,
): Promise<Map<string, ForexQuote>> {
  const direct = FOREX_PAIRS.filter((p) => p.yahooSymbol);
  const auth = await getYahooAuth({
    preferHost: base.includes("query2") ? "query2" : "query1",
  }).catch(() => null);

  const map = new Map<string, ForexQuote>();
  const concurrency = 4;
  const queue = [...direct];

  async function worker() {
    while (queue.length) {
      const def = queue.shift()!;
      try {
        const url = `${base}/v8/finance/chart/${encodeURIComponent(
          def.yahooSymbol!,
        )}?interval=1d&range=5d`;
        const res = await fetch(url, {
          headers: yahooBrowserHeaders(auth),
          cache: "no-store",
          signal: AbortSignal.timeout(BARS_TIMEOUT_MS),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as YahooChart;
        const meta = data.chart.result?.[0]?.meta;
        const price = meta?.regularMarketPrice;
        if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
        const prev =
          typeof meta?.previousClose === "number"
            ? meta.previousClose
            : typeof meta?.chartPreviousClose === "number"
              ? meta.chartPreviousClose
              : null;
        const change = prev !== null ? price - prev : null;
        map.set(def.symbol, {
          symbol: def.symbol,
          price,
          bid: typeof meta?.bid === "number" && meta.bid > 0 ? meta.bid : null,
          ask: typeof meta?.ask === "number" && meta.ask > 0 ? meta.ask : null,
          change,
          changePercent: prev ? ((price - prev) / prev) * 100 : null,
          source: `${provider}-chart-meta`,
          timestamp: new Date((meta?.regularMarketTime ?? Date.now() / 1000) * 1000),
          degraded: true,
        });
      } catch {
        // skip symbol
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, direct.length) }, () => worker()),
  );

  if (map.size < 3) {
    throw new ProviderError(provider, `chart-meta fallback only ${map.size} quotes`);
  }

  applyDerived(map);
  log.info("yahoo_chart_meta_fallback_ok", { provider, count: map.size });
  return map;
}

async function fetchYahooQuotesWithFallback(
  base: string,
  provider: string,
): Promise<Map<string, ForexQuote>> {
  try {
    return await fetchBatchQuotes(base, provider);
  } catch (batchErr) {
    log.warn("yahoo_batch_failed_trying_chart_meta", {
      provider,
      error: batchErr instanceof Error ? batchErr.message : String(batchErr),
    });
    return fetchQuotesFromChartMeta(base, provider);
  }
}

async function fetchYahooPrimary(): Promise<{ quotes: ForexQuote[]; source: string }> {
  const tryHost = async (base: string, provider: string) => {
    const map = await getBreaker(provider).exec(() =>
      fetchYahooQuotesWithFallback(base, provider),
    );
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

export async function fetchForexSnapshot(): Promise<ForexSnapshotResult> {
  try {
    const primary = await fetchYahooPrimary();
    try {
      const merged = await enrichWithSecondary(primary.quotes, primary.source);
      const { quotes, ...pipeline } = merged;
      return { quotes, source: merged.source, pipeline };
    } catch (e) {
      log.warn("pipeline_enrich_failed_using_primary", {
        error: e instanceof Error ? e.message : String(e),
      });
      return { quotes: primary.quotes, source: primary.source };
    }
  } catch (primaryErr) {
    log.warn("yahoo_primary_failed_trying_secondary", {
      error: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
    });
    try {
      const sec = await secondaryOnlySnapshot();
      const { quotes, ...pipeline } = sec;
      return { quotes, source: sec.source, pipeline };
    } catch (secErr) {
      throw new ProviderError(
        "forex-snapshot",
        `primary+secondary failed: ${String(primaryErr)} | ${String(secErr)}`,
      );
    }
  }
}

const VALID = new Set(["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1mo", "12mo"]);

function yahooParams(tf: string, limit: number) {
  if (tf === "4h") return { interval: "1h", range: limit > 200 ? "3mo" : "1mo" };
  if (tf === "1d") return { interval: "1d", range: limit > 200 ? "5y" : "2y" };
  if (tf === "1w") return { interval: "1wk", range: "10y" };
  if (tf === "1mo") return { interval: "1mo", range: "max" };
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

  const auth = await getYahooAuth({
    preferHost: base.includes("query2") ? "query2" : "query1",
  }).catch(() => null);

  const res = await fetch(url, {
    headers: yahooBrowserHeaders(auth),
    cache: "no-store",
    signal: AbortSignal.timeout(BARS_TIMEOUT_MS),
  });

  const data = await readYahooJson<YahooChart>(res, provider, url);
  const r = data.chart.result?.[0];
  const q = r?.indicators.quote?.[0];
  if (!r?.timestamp || !q) {
    const desc = data.chart.error?.description ?? `No OHLC for ${def.symbol}`;
    throw new ProviderError(provider, desc, { code: data.chart.error?.code });
  }

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
  const aligned = alignBarsByTime(left, right, 180);
  const out: Ohlcv[] = [];
  for (const { left: l, right: r } of aligned) {
    const ohlc = combineOhlc(def.derived!.op, l, r);
    if (!ohlc) continue;
    out.push({
      time: l.time,
      open: ohlc.open,
      high: ohlc.high,
      low: ohlc.low,
      close: ohlc.close,
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

export async function fetchSingleQuote(symbol: string): Promise<ForexQuote | null> {
  try {
    const snap = await fetchForexSnapshot();
    return snap.quotes.find((q) => q.symbol === symbol.toUpperCase()) ?? null;
  } catch {
    return null;
  }
}
