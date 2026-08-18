import { forProvider } from "@/lib/logger";
import {
  cached,
  DataValidator,
  fetchWithRetry,
  getBreaker,
  markStale,
  ProviderError,
  readJsonSafe,
  readTextSafe,
  type NewsItem,
  type Ohlcv,
  type Quote,
  type SymbolInfo,
  type Timeframe,
} from "@/lib/connectors/core";

/* ═══════════════════════════════════════════════════════════════════════
   VNDirect dchart — PRIMARY (priority 1): history, quotes, indices, search
   ═══════════════════════════════════════════════════════════════════════ */

const VNDIRECT = "vndirect-dchart";

interface DchartHistory {
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v?: number[];
  s: string;
}

export async function vndirectHistory(
  symbol: string,
  from: number,
  to: number,
  resolution: Timeframe,
): Promise<Ohlcv[]> {
  return getBreaker(VNDIRECT).exec(async () => {
    const url = `https://dchart-api.vndirect.com.vn/dchart/history?symbol=${encodeURIComponent(
      symbol,
    )}&resolution=${resolution}&from=${from}&to=${to}`;
    const res = await fetchWithRetry(url, { provider: VNDIRECT });
    const data = await readJsonSafe<DchartHistory>(res, VNDIRECT, url);
    if (!Array.isArray(data.t) || data.t.length === 0) {
      throw new ProviderError(VNDIRECT, `no data for ${symbol} (status=${data.s ?? "?"})`, {
        status_field: data.s,
      });
    }
    const bars: Ohlcv[] = [];
    let rejected = 0;
    for (let i = 0; i < data.t.length; i++) {
      const raw = {
        time: data.t[i],
        open: data.o[i],
        high: data.h[i],
        low: data.l[i],
        close: data.c[i],
        volume: data.v?.[i] ?? 0,
      };
      const v = DataValidator.ohlcv(raw, { provider: VNDIRECT, symbol });
      if (v) bars.push(v);
      else rejected += 1;
    }
    if (bars.length === 0) {
      throw new ProviderError(VNDIRECT, `all ${data.t.length} bars failed validation for ${symbol}`);
    }
    if (rejected > 0) {
      forProvider(VNDIRECT).warn("history_some_bars_rejected", { symbol, total: data.t.length, rejected });
    }
    return bars;
  });
}

export async function vndirectQuote(symbol: string): Promise<Quote> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 86400 * 14;
  const bars = await vndirectHistory(symbol, from, to, "D");
  const last = bars[bars.length - 1];
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;
  const validated = DataValidator.quote(
    {
      symbol,
      time: last.time,
      open: last.open,
      high: last.high,
      low: last.low,
      close: last.close,
      volume: last.volume,
      prevClose: prev ? prev.close : null,
      changePct: prev ? ((last.close - prev.close) / prev.close) * 100 : null,
      source: VNDIRECT,
      confidence: 0.95,
    },
    { provider: VNDIRECT },
  );
  if (!validated) throw new ProviderError(VNDIRECT, `quote validation failed for ${symbol}`);
  return validated;
}

interface DchartSearchRow {
  symbol: string;
  full_name: string;
  description: string;
  exchange: string;
  type: string;
}

export async function vndirectSearch(query: string, limit = 20): Promise<SymbolInfo[]> {
  return getBreaker(VNDIRECT).exec(async () => {
    const safeLimit = Math.max(1, Math.min(50, limit));
    const url = `https://dchart-api.vndirect.com.vn/dchart/search?query=${encodeURIComponent(
      query,
    )}&limit=${safeLimit}&type=&exchange=`;
    const res = await fetchWithRetry(url, { provider: VNDIRECT });
    const rows = await readJsonSafe<DchartSearchRow[]>(res, VNDIRECT, url);
    if (!Array.isArray(rows)) throw new ProviderError(VNDIRECT, "unexpected search payload");
    return rows.map((r) => ({
      symbol: r.symbol,
      name: r.description || r.full_name,
      exchange: r.exchange ?? "",
      type: r.type ?? "stock",
      source: VNDIRECT,
    }));
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   Yahoo Finance — FALLBACK (priority 2) for VN equities (.VN suffix)
   ═══════════════════════════════════════════════════════════════════════ */

const YAHOO = "yahoo-finance";

interface YahooChart {
  chart: {
    result?: Array<{
      timestamp?: number[];
      indicators: { quote: Array<{ open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }> };
    }>;
    error?: { description?: string } | null;
  };
}

export async function yahooHistory(symbol: string, from: number, to: number, resolution: Timeframe): Promise<Ohlcv[]> {
  return getBreaker(YAHOO).exec(async () => {
    const interval = resolution === "D" ? "1d" : resolution === "60" ? "60m" : "15m";
    const ySymbol = /^[A-Z0-9]{3}$/.test(symbol) ? `${symbol}.VN` : symbol;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      ySymbol,
    )}?period1=${from}&period2=${to}&interval=${interval}`;
    const res = await fetchWithRetry(url, { provider: YAHOO });
    const data = await readJsonSafe<YahooChart>(res, YAHOO, url);
    const result = data.chart.result?.[0];
    if (!result?.timestamp?.length) {
      throw new ProviderError(YAHOO, data.chart.error?.description ?? `no data for ${ySymbol}`, {
        chartError: data.chart.error,
      });
    }
    const q = result.indicators.quote[0];
    const bars: Ohlcv[] = [];
    let rejected = 0;
    for (let i = 0; i < result.timestamp.length; i++) {
      const raw = {
        time: result.timestamp[i],
        open: q.open[i],
        high: q.high[i],
        low: q.low[i],
        close: q.close[i],
        volume: q.volume[i] ?? 0,
      };
      const v = DataValidator.ohlcv(raw, { provider: YAHOO, symbol });
      if (v) bars.push(v);
      else rejected += 1;
    }
    if (bars.length === 0) {
      throw new ProviderError(YAHOO, `all ${result.timestamp.length} bars failed validation for ${ySymbol}`);
    }
    if (rejected > 0) {
      forProvider(YAHOO).warn("history_some_bars_rejected", { symbol, total: result.timestamp.length, rejected });
    }
    return bars;
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   Crypto providers — CoinGecko (primary) + Binance Vision (fallback)
   ═══════════════════════════════════════════════════════════════════════ */

export interface CryptoQuote {
  id: string;
  symbol: string;
  priceUsd: number;
  change24hPct: number;
  source: string;
}

const COINGECKO = "coingecko";
const BINANCE = "binance-vision";

export async function coingeckoPrices(): Promise<CryptoQuote[]> {
  return getBreaker(COINGECKO).exec(async () => {
    const ids = "bitcoin,ethereum,binancecoin,solana";
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
    const res = await fetchWithRetry(url, { provider: COINGECKO });
    const data = await readJsonSafe<Record<string, { usd: number; usd_24h_change: number }>>(res, COINGECKO, url);
    const symbolMap: Record<string, string> = {
      bitcoin: "BTC",
      ethereum: "ETH",
      binancecoin: "BNB",
      solana: "SOL",
    };
    const out: CryptoQuote[] = [];
    for (const [id, v] of Object.entries(data)) {
      if (typeof v?.usd !== "number" || !Number.isFinite(v.usd)) {
        forProvider(COINGECKO).warn("crypto_bad_record", { id, raw: v });
        continue;
      }
      out.push({
        id,
        symbol: symbolMap[id] ?? id.toUpperCase(),
        priceUsd: v.usd,
        change24hPct: typeof v.usd_24h_change === "number" ? v.usd_24h_change : 0,
        source: COINGECKO,
      });
    }
    if (out.length === 0) throw new ProviderError(COINGECKO, "empty payload");
    return out;
  });
}

interface Binance24hr {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
}

export async function binancePrices(): Promise<CryptoQuote[]> {
  return getBreaker(BINANCE).exec(async () => {
    const symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"];
    // Binance Vision public endpoint (not geo-blocked like api.binance.com)
    const results = await Promise.all(
      symbols.map(async (sym) => {
        const url = `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${sym}`;
        const res = await fetchWithRetry(url, { provider: BINANCE, retries: 1 });
        const data = await readJsonSafe<Binance24hr>(res, BINANCE, url);
        const price = parseFloat(data.lastPrice);
        const pct = parseFloat(data.priceChangePercent);
        if (!Number.isFinite(price) || price <= 0) {
          throw new ProviderError(BINANCE, `bad price for ${sym}`, { lastPrice: data.lastPrice });
        }
        return {
          id: sym.toLowerCase(),
          symbol: sym.replace("USDT", ""),
          priceUsd: price,
          change24hPct: Number.isFinite(pct) ? pct : 0,
          source: BINANCE,
        } satisfies CryptoQuote;
      }),
    );
    return results;
  });
}

/** Primary + fallback chain for crypto. Marks stale if both fail. */
export async function cryptoPricesWithFallback(): Promise<CryptoQuote[]> {
  try {
    return await coingeckoPrices();
  } catch (primaryErr) {
    forProvider("crypto-chain").warn("coingecko_failed_trying_binance", {
      error: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
    });
    try {
      return await binancePrices();
    } catch (secondaryErr) {
      markStale("crypto", null, `coingecko + binance both failed: ${secondaryErr instanceof Error ? secondaryErr.message : String(secondaryErr)}`);
      forProvider("crypto-chain").error("all_crypto_providers_failed", {
        coingecko: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
        binance: secondaryErr instanceof Error ? secondaryErr.message : String(secondaryErr),
      });
      return [];
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   RSS news connectors — VnExpress, CafeF, Vietstock (real feeds)
   ═══════════════════════════════════════════════════════════════════════ */

const RSS_SOURCES = [
  { name: "VnExpress", provider: "vnexpress-rss", url: "https://vnexpress.net/rss/kinh-doanh.rss" },
  { name: "CafeF", provider: "cafef-rss", url: "https://cafef.vn/thi-truong-chung-khoan.rss" },
  { name: "Vietstock", provider: "vietstock-rss", url: "https://vietstock.vn/830/chung-khoan/co-phieu.rss" },
] as const;

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? stripCdata(m[1]).trim() : "";
}

function parseRss(xml: string, sourceName: string, provider: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  if (blocks.length === 0) {
    forProvider(provider).warn("rss_no_items_found", { rawSnippet: xml.slice(0, 500) });
  }
  for (const block of blocks) {
    const title = decodeEntities(tag(block, "title"));
    const link = tag(block, "link");
    if (!title || !link) continue;
    const rawDesc = tag(block, "description");
    const imgMatch =
      rawDesc.match(/<img[^>]+src=["']([^"']+)["']/i) ?? block.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
    const description = decodeEntities(rawDesc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 500);
    const pubDate = tag(block, "pubDate");
    const publishedAt = pubDate ? new Date(pubDate) : new Date();
    const validated = DataValidator.news(
      {
        guid: tag(block, "guid") || link,
        title,
        link,
        description,
        imageUrl: imgMatch ? imgMatch[1] : null,
        sourceName,
        publishedAt: Number.isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
      },
      { provider },
    );
    if (validated) items.push(validated);
  }
  return items;
}

/** Per-source 5-minute cache so upstream hiccups do not cascade into the UI. */
const RSS_CACHE_MS = 5 * 60_000;

export async function fetchAllRssNews(): Promise<{ items: NewsItem[]; errors: string[] }> {
  const results = await Promise.allSettled(
    RSS_SOURCES.map((src) =>
      cached<NewsItem[]>(`rss:${src.provider}`, RSS_CACHE_MS, () =>
        getBreaker(src.provider).exec(async () => {
          const res = await fetchWithRetry(src.url, { timeoutMs: 15_000, provider: src.provider, retries: 3 });
          const xml = await readTextSafe(res, src.provider, src.url);
          const items = parseRss(xml, src.name, src.provider);
          if (items.length === 0) {
            forProvider(src.provider).error("rss_empty_after_parse", { rawSnippet: xml.slice(0, 500) });
            throw new ProviderError(src.provider, "no items parsed", { rawSnippet: xml.slice(0, 200) });
          }
          return items;
        }),
      ),
    ),
  );
  const items: NewsItem[] = [];
  const errors: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") items.push(...r.value);
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }
  if (items.length === 0 && errors.length > 0) {
    markStale("news", null, `all RSS feeds failed: ${errors.join("; ")}`);
  }
  return { items, errors };
}

import { forProvider, logger, recentLogs } from "@/lib/logger";

/* ═══════════════════════════════════════════════════════════════════════
   Domain types (unchanged)
   ═══════════════════════════════════════════════════════════════════════ */

export type Timeframe = "1" | "15" | "60" | "D";

export interface Ohlcv {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  symbol: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  prevClose: number | null;
  changePct: number | null;
  source: string;
  confidence: number;
}

export interface SymbolInfo {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  source: string;
}

export interface NewsItem {
  guid: string;
  title: string;
  link: string;
  description: string;
  imageUrl: string | null;
  sourceName: string;
  publishedAt: Date;
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public meta?: Record<string, unknown>,
  ) {
    super(`[${provider}] ${message}`);
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   Environment-driven config
   ═══════════════════════════════════════════════════════════════════════ */

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const CONNECTOR_CONFIG = {
  /** Consecutive failures before opening the circuit. Default 5. */
  failureThreshold: envInt("CIRCUIT_BREAKER_THRESHOLD", 5),
  /** How long (ms) the circuit stays open. Default 60 000. */
  cooldownMs: envInt("CIRCUIT_BREAKER_TIMEOUT", 60_000),
  /** Retry attempts per fetch call (default 3 → 4 total attempts). */
  retryAttempts: envInt("CONNECTOR_RETRY_ATTEMPTS", 3),
  /** Base delay (ms) for exponential backoff. */
  retryBaseMs: envInt("CONNECTOR_RETRY_BASE_MS", 1000),
  /** Per-request timeout. */
  fetchTimeoutMs: envInt("CONNECTOR_FETCH_TIMEOUT_MS", 10_000),
  /** How long (ms) without a success before we mark the provider DOWN. */
  staleAfterMs: envInt("CONNECTOR_STALE_AFTER_MS", 15 * 60_000),
  /** How long (ms) before we consider a provider degraded. */
  degradedAfterMs: envInt("CONNECTOR_DEGRADED_AFTER_MS", 5 * 60_000),
};

/* ═══════════════════════════════════════════════════════════════════════
   Circuit breaker (env-configured, uptime-aware)
   ═══════════════════════════════════════════════════════════════════════ */

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private lastError: string | null = null;
  private lastErrorClass: string | null = null;
  private lastSuccessAt = 0;
  private lastAttemptAt = 0;
  private lastDownAt: number | null = null;
  private cumulativeDowntimeMs = 0;
  private totalCalls = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;
  private readonly startedAt = Date.now();

  constructor(
    public readonly name: string,
    private failureThreshold = CONNECTOR_CONFIG.failureThreshold,
    private cooldownMs = CONNECTOR_CONFIG.cooldownMs,
  ) {}

  get state(): "closed" | "open" | "half-open" {
    if (this.openedAt === 0) return "closed";
    if (Date.now() - this.openedAt > this.cooldownMs) return "half-open";
    return "open";
  }

  /** UP / DEGRADED / DOWN — used by health and dashboard. */
  get status3(): "UP" | "DEGRADED" | "DOWN" {
    if (this.state === "open") return "DOWN";
    const sinceSuccess = this.lastSuccessAt === 0 ? Infinity : Date.now() - this.lastSuccessAt;
    if (sinceSuccess > CONNECTOR_CONFIG.staleAfterMs) return "DOWN";
    if (sinceSuccess > CONNECTOR_CONFIG.degradedAfterMs) return "DEGRADED";
    if (this.failures > 0) return "DEGRADED";
    return "UP";
  }

  get uptimeMs(): number {
    const now = Date.now();
    let down = this.cumulativeDowntimeMs;
    if (this.openedAt !== 0) down += now - this.openedAt;
    return Math.max(0, now - this.startedAt - down);
  }

  get successRate(): number {
    return this.totalCalls === 0 ? 1 : this.totalSuccesses / this.totalCalls;
  }

  status() {
    return {
      name: this.name,
      state: this.state,
      status: this.status3,
      consecutiveFailures: this.failures,
      lastError: this.lastError,
      lastErrorClass: this.lastErrorClass,
      lastSuccessAt: this.lastSuccessAt ? new Date(this.lastSuccessAt).toISOString() : null,
      lastAttemptAt: this.lastAttemptAt ? new Date(this.lastAttemptAt).toISOString() : null,
      lastDownAt: this.lastDownAt ? new Date(this.lastDownAt).toISOString() : null,
      cumulativeDowntimeMs: this.cumulativeDowntimeMs + (this.openedAt ? Date.now() - this.openedAt : 0),
      uptimeMs: this.uptimeMs,
      totalCalls: this.totalCalls,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      successRate: Number(this.successRate.toFixed(3)),
      startedAt: new Date(this.startedAt).toISOString(),
      threshold: this.failureThreshold,
      cooldownMs: this.cooldownMs,
    };
  }

  /** Manual reset from the admin dashboard. */
  reset() {
    this.failures = 0;
    this.openedAt = 0;
    this.lastError = null;
    this.lastErrorClass = null;
    this.lastDownAt = null;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls += 1;
    this.lastAttemptAt = Date.now();
    if (this.state === "open") {
      this.totalFailures += 1;
      throw new ProviderError(this.name, "circuit open (cooling down)", { state: "open" });
    }
    try {
      const result = await fn();
      const wasOpen = this.openedAt !== 0;
      this.failures = 0;
      if (wasOpen) {
        // Closed from half-open — count downtime
        this.cumulativeDowntimeMs += Date.now() - this.openedAt;
      }
      this.openedAt = 0;
      this.lastSuccessAt = Date.now();
      this.totalSuccesses += 1;
      return result;
    } catch (err) {
      this.failures += 1;
      this.totalFailures += 1;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.lastErrorClass = err instanceof Error ? err.name : "Unknown";
      if (this.failures >= this.failureThreshold && this.openedAt === 0) {
        this.openedAt = Date.now();
        this.lastDownAt = this.openedAt;
        logger.warn("circuit_opened", {
          provider: this.name,
          failures: this.failures,
          error: this.lastError,
          errorClass: this.lastErrorClass,
          cooldownMs: this.cooldownMs,
        });
      }
      throw err;
    }
  }
}

const breakers = new Map<string, CircuitBreaker>();
export function getBreaker(name: string): CircuitBreaker {
  let b = breakers.get(name);
  if (!b) {
    b = new CircuitBreaker(name);
    breakers.set(name, b);
  }
  return b;
}
export function allBreakerStatuses() {
  return [...breakers.values()].map((b) => b.status());
}
export function resetBreaker(name: string) {
  breakers.get(name)?.reset();
}

/* ═══════════════════════════════════════════════════════════════════════
   Stale data registry — marks which (symbol, kind) tuples are stale
   when ALL providers for that tuple have failed.
   ═══════════════════════════════════════════════════════════════════════ */

export interface StaleFlag {
  key: string;
  kind: string;
  symbol: string | null;
  since: string;
  reason: string;
}

const staleMap = new Map<string, StaleFlag>();

export function markStale(kind: string, symbol: string | null, reason: string) {
  const key = `${kind}:${symbol ?? "*"}`;
  staleMap.set(key, { key, kind, symbol, since: new Date().toISOString(), reason });
  logger.warn("data_marked_stale", { kind, symbol, reason });
}

export function clearStale(kind: string, symbol: string | null) {
  staleMap.delete(`${kind}:${symbol ?? "*"}`);
}

export function isStale(kind: string, symbol: string | null): StaleFlag | null {
  return staleMap.get(`${kind}:${symbol ?? "*"}`) ?? null;
}

export function getStaleFlags(): StaleFlag[] {
  return [...staleMap.values()];
}

/* ═══════════════════════════════════════════════════════════════════════
   Data Validator — rejects obviously-bad records BEFORE they hit the DB.
   ═══════════════════════════════════════════════════════════════════════ */

export const DataValidator = {
  ohlcv(b: Partial<Ohlcv>, ctx: { provider: string; symbol?: string }): Ohlcv | null {
    const reasons: string[] = [];
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
    const open = num(b.open);
    const high = num(b.high);
    const low = num(b.low);
    const close = num(b.close);
    const volume = num(b.volume);
    const time = num(b.time);
    if (!Number.isFinite(open)) reasons.push("open missing/NaN");
    if (!Number.isFinite(high)) reasons.push("high missing/NaN");
    if (!Number.isFinite(low)) reasons.push("low missing/NaN");
    if (!Number.isFinite(close)) reasons.push("close missing/NaN");
    if (!Number.isFinite(volume) || volume < 0) reasons.push("volume <0 or missing");
    if (!Number.isFinite(time) || time <= 0) reasons.push("time invalid");
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) reasons.push("non-positive price");
    if (high < low) reasons.push("high<low");
    if (high < Math.max(open, close) - 1e-6) reasons.push("high<max(o,c)");
    if (low > Math.min(open, close) + 1e-6) reasons.push("low>min(o,c)");
    if (reasons.length > 0) {
      logger.warn("validator_rejected_ohlcv", {
        provider: ctx.provider,
        symbol: ctx.symbol,
        reasons,
        raw: { open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, time: b.time },
      });
      return null;
    }
    return { open, high, low, close, volume, time };
  },

  quote(q: Partial<Quote> & { symbol: string; source: string }, ctx: { provider: string }): Quote | null {
    const base = this.ohlcv(q, ctx);
    if (!base) return null;
    if (!q.symbol || q.symbol.length === 0) {
      logger.warn("validator_rejected_quote", { provider: ctx.provider, reason: "missing symbol" });
      return null;
    }
    return {
      ...base,
      symbol: q.symbol,
      prevClose: typeof q.prevClose === "number" && Number.isFinite(q.prevClose) ? q.prevClose : null,
      changePct: typeof q.changePct === "number" && Number.isFinite(q.changePct) ? q.changePct : null,
      source: q.source,
      confidence: typeof q.confidence === "number" ? Math.max(0, Math.min(1, q.confidence)) : 0.9,
    };
  },

  news(n: Partial<NewsItem>, ctx: { provider: string }): NewsItem | null {
    const reasons: string[] = [];
    if (!n.guid || n.guid.length === 0) reasons.push("missing guid");
    if (!n.title || n.title.length === 0) reasons.push("missing title");
    if (!n.link || n.link.length === 0) reasons.push("missing link");
    if (!n.sourceName || n.sourceName.length === 0) reasons.push("missing sourceName");
    if (!n.publishedAt || !(n.publishedAt instanceof Date) || Number.isNaN(n.publishedAt.getTime()))
      reasons.push("invalid publishedAt");
    if (reasons.length > 0) {
      logger.warn("validator_rejected_news", { provider: ctx.provider, reasons, title: n.title?.slice(0, 80) });
      return null;
    }
    return {
      guid: n.guid!,
      title: n.title!,
      link: n.link!,
      description: n.description ?? "",
      imageUrl: n.imageUrl ?? null,
      sourceName: n.sourceName!,
      publishedAt: n.publishedAt!,
    };
  },
};

/* ═══════════════════════════════════════════════════════════════════════
   fetchWithRetry — exponential backoff with jitter + rich structured logs
   ═══════════════════════════════════════════════════════════════════════ */

export interface FetchOpts extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  /** Provider tag attached to logs. */
  provider?: string;
  /** If true, do not retry on 4xx (default true). */
  noRetryOnClientError?: boolean;
  /** If true, capture raw response body on parse failure (max 500 chars) for logs. */
  captureRawOnError?: boolean;
}

function classifyError(err: unknown, status?: number): { retryable: boolean; code: string; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "Unknown";
  // Network errors
  if (name === "AbortError") return { retryable: true, code: "TIMEOUT", message: msg };
  if (name === "TypeError") return { retryable: true, code: "NETWORK", message: msg };
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|EAI_AGAIN|UND_ERR_/i.test(msg))
    return { retryable: true, code: "NETWORK", message: msg };
  // HTTP status
  if (status !== undefined) {
    if (status >= 500) return { retryable: true, code: `HTTP_${status}`, message: msg };
    if (status === 429) return { retryable: true, code: "HTTP_429", message: msg };
    if (status >= 400) return { retryable: false, code: `HTTP_${status}`, message: msg };
  }
  return { retryable: false, code: name, message: msg };
}

export async function fetchWithRetry(url: string, init: FetchOpts = {}): Promise<Response> {
  const {
    timeoutMs = CONNECTOR_CONFIG.fetchTimeoutMs,
    retries = CONNECTOR_CONFIG.retryAttempts,
    provider = "unknown",
    noRetryOnClientError = true,
    ...rest
  } = init;
  const log = forProvider(provider);

  let lastErr: unknown;
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...rest,
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "application/json, text/xml, application/xml, */*",
          ...(rest.headers ?? {}),
        },
        cache: "no-store",
      });
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      lastStatus = res.status;
      if (!res.ok) {
        const cls = classifyError(new Error(`HTTP ${res.status}`), res.status);
        log.warn("http_non_ok", {
          url,
          method: rest.method ?? "GET",
          status: res.status,
          attempt,
          durationMs,
          retryable: cls.retryable,
        });
        if (!cls.retryable || (noRetryOnClientError && res.status >= 400 && res.status < 500)) {
          throw new ProviderError(provider, `HTTP ${res.status} for ${url}`, { status: res.status, code: cls.code });
        }
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      log.debug("http_ok", {
        url,
        method: rest.method ?? "GET",
        status: res.status,
        attempt,
        durationMs,
      });
      return res;
    } catch (err) {
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      lastErr = err;
      if (err instanceof ProviderError && err.meta?.code && String(err.meta.code).startsWith("HTTP_4")) {
        // Non-retryable client error
        throw err;
      }
      const cls = classifyError(err, lastStatus);
      log.warn("fetch_attempt_failed", {
        url,
        method: rest.method ?? "GET",
        attempt,
        retries,
        durationMs,
        code: cls.code,
        retryable: cls.retryable,
        error: cls.message.slice(0, 300),
      });
      if (!cls.retryable || attempt === retries) break;
      // Exponential backoff with jitter: 1s, 2s, 4s * (1 ± 0.2)
      const base = CONNECTOR_CONFIG.retryBaseMs * Math.pow(2, attempt);
      const jitter = base * 0.2 * (Math.random() * 2 - 1);
      const wait = Math.round(base + jitter);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  // Capture raw body snippet when configured (useful for parser debugging).
  const finalErr = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  log.error("fetch_all_retries_exhausted", {
    url,
    method: rest.method ?? "GET",
    attempts: retries + 1,
    lastStatus,
    error: finalErr.message.slice(0, 300),
  });
  throw finalErr;
}

/**
 * Read a response body as JSON with parse-error logging (captures raw body
 * snippet on failure so operators can diagnose upstream format changes).
 */
export async function readJsonSafe<T = unknown>(res: Response, provider: string, url: string): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const log = forProvider(provider);
    log.error("json_parse_failed", {
      url,
      contentType: res.headers.get("content-type"),
      rawSnippet: text.slice(0, 500),
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ProviderError(provider, `JSON parse failed for ${url}`, { rawSnippet: text.slice(0, 500) });
  }
}

/** Read a response body as text with error logging. */
export async function readTextSafe(res: Response, provider: string, url: string): Promise<string> {
  try {
    return await res.text();
  } catch (err) {
    forProvider(provider).error("text_read_failed", {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ProviderError(provider, `text read failed for ${url}`);
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   Database retry wrapper — handles P1001/P1002/P1008 (transient).
   ═══════════════════════════════════════════════════════════════════════ */

function isTransientDbError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string })?.code ?? "";
  if (/P1001|P1002|P1008|P1009|P1017|connection terminated|connection refused|connection reset|timeout/i.test(msg))
    return true;
  if (/P1001|P1002|P1008/.test(code)) return true;
  return false;
}

export async function safeDbQuery<T>(
  label: string,
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 800;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || i === attempts - 1) {
        logger.error("db_query_failed", {
          label,
          attempt: i + 1,
          attempts,
          transient: isTransientDbError(err),
          error: err instanceof Error ? err.message : String(err),
          code: (err as { code?: string })?.code,
        });
        throw err;
      }
      logger.warn("db_transient_error_retrying", {
        label,
        attempt: i + 1,
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((r) => setTimeout(r, baseMs * Math.pow(2, i)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/* ═══════════════════════════════════════════════════════════════════════
   In-memory TTL cache and rate limiter (unchanged semantics)
   ═══════════════════════════════════════════════════════════════════════ */

const cache = new Map<string, { value: unknown; expiresAt: number }>();
export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await loader();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/** Read-through cache that returns the last-known-good value when loader fails. */
export async function cachedWithStaleFallback<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<{ value: T; stale: boolean }> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return { value: hit.value as T, stale: false };
  try {
    const value = await loader();
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    return { value, stale: false };
  } catch (err) {
    if (hit) {
      logger.warn("cache_stale_fallback_used", { key, error: err instanceof Error ? err.message : String(err) });
      return { value: hit.value as T, stale: true };
    }
    throw err;
  }
}

const rateBuckets = new Map<string, number[]>();
export function rateLimit(key: string, limit = 120, windowMs = 60_000): boolean {
  const now = Date.now();
  const arr = (rateBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    rateBuckets.set(key, arr);
    return false;
  }
  arr.push(now);
  rateBuckets.set(key, arr);
  return true;
}

export { recentLogs };
