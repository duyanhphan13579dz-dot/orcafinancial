import {
  CONNECTOR_CONFIG,
  fetchWithRetry,
  type Ohlcv,
  type Quote,
  type SymbolInfo,
  type Timeframe,
} from "@/lib/connectors/core";

/** Local provider call options (timeout / retries). */
export type ProviderFetchOptions = {
  timeoutMs?: number;
  retries?: number;
};

const VNDIRECT_DCHART = "https://dchart-api.vndirect.com.vn/dchart";

function resolutionToVndirect(resolution: Timeframe): string {
  // core Timeframe = "1" | "15" | "60" | "D"
  if (resolution === "1" || resolution === "15" || resolution === "60") {
    return resolution;
  }
  return "D";
}

function mapBars(raw: unknown): Ohlcv[] {
  if (!raw || typeof raw !== "object") return [];
  const data = raw as Record<string, unknown>;
  const t = Array.isArray(data.t) ? (data.t as number[]) : [];
  const o = Array.isArray(data.o) ? (data.o as number[]) : [];
  const h = Array.isArray(data.h) ? (data.h as number[]) : [];
  const l = Array.isArray(data.l) ? (data.l as number[]) : [];
  const c = Array.isArray(data.c) ? (data.c as number[]) : [];
  const v = Array.isArray(data.v) ? (data.v as number[]) : [];
  const bars: Ohlcv[] = [];
  for (let i = 0; i < t.length; i += 1) {
    bars.push({
      time: Number(t[i]),
      open: Number(o[i]),
      high: Number(h[i]),
      low: Number(l[i]),
      close: Number(c[i]),
      volume: Number(v[i] ?? 0),
    });
  }
  return bars.filter((b) => Number.isFinite(b.time) && Number.isFinite(b.close));
}

export async function vndirectHistory(
  symbol: string,
  from: number,
  to: number,
  resolution: Timeframe,
  options: ProviderFetchOptions = {},
): Promise<Ohlcv[]> {
  const res = resolutionToVndirect(resolution);
  const url = `${VNDIRECT_DCHART}/history?symbol=${encodeURIComponent(symbol)}&resolution=${res}&from=${from}&to=${to}`;
  const response = await fetchWithRetry(url, {
    timeoutMs: options.timeoutMs ?? CONNECTOR_CONFIG.fetchTimeoutMs,
    retries: options.retries ?? CONNECTOR_CONFIG.retryAttempts,
  });
  if (!response.ok) throw new Error(`VnDirect history HTTP ${response.status}`);
  const payload = await response.json();
  return mapBars(payload);
}

export async function vndirectQuote(symbol: string, options: ProviderFetchOptions = {}): Promise<Quote> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 86400 * 10;
  const bars = await vndirectHistory(symbol, from, to, "D", options);
  if (!bars.length) throw new Error(`VnDirect quote empty for ${symbol}`);
  const last = bars[bars.length - 1];
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;
  return {
    symbol: symbol.toUpperCase(),
    time: last.time,
    open: last.open,
    high: last.high,
    low: last.low,
    close: last.close,
    volume: last.volume,
    prevClose: prev?.close ?? null,
    changePct: prev ? ((last.close - prev.close) / prev.close) * 100 : null,
    source: "vndirect-dchart",
  };
}

export async function vndirectSearch(query: string, limit = 20): Promise<SymbolInfo[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `https://api-finfo.vndirect.com.vn/v4/stocks?q=code:${encodeURIComponent(q)}*&size=${Math.min(50, Math.max(1, limit))}`;
  try {
    const response = await fetchWithRetry(url, { timeoutMs: 5_000, retries: 1 });
    if (!response.ok) return [];
    const payload = (await response.json()) as { data?: Array<Record<string, unknown>> };
    const rows = Array.isArray(payload.data) ? payload.data : [];
    return rows
      .slice(0, limit)
      .map((row) => ({
        symbol: String(row.code ?? row.symbol ?? "").toUpperCase(),
        name: String(row.companyName ?? row.name ?? row.code ?? ""),
        exchange: String(row.floor ?? row.exchange ?? ""),
      }))
      .filter((s) => s.symbol);
  } catch {
    return [];
  }
}

export async function yahooHistory(
  symbol: string,
  from: number,
  to: number,
  resolution: Timeframe,
  options: ProviderFetchOptions = {},
): Promise<Ohlcv[]> {
  const ticker = symbol.includes(".") ? symbol : `${symbol}.VN`;
  const interval =
    resolution === "1" || resolution === "15" || resolution === "60"
      ? `${resolution}m`
      : "1d";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${from}&period2=${to}&interval=${interval}`;
  const response = await fetchWithRetry(url, {
    timeoutMs: options.timeoutMs ?? CONNECTOR_CONFIG.fetchTimeoutMs,
    retries: options.retries ?? CONNECTOR_CONFIG.retryAttempts,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) throw new Error(`Yahoo history HTTP ${response.status}`);
  const payload = (await response.json()) as {
    chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<Record<string, number[]>> } }> };
  };
  const result = payload.chart?.result?.[0];
  const ts = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0] ?? {};
  const bars: Ohlcv[] = [];
  for (let i = 0; i < ts.length; i += 1) {
    const close = quote.close?.[i];
    if (close == null || !Number.isFinite(close)) continue;
    bars.push({
      time: ts[i],
      open: quote.open?.[i] ?? close,
      high: quote.high?.[i] ?? close,
      low: quote.low?.[i] ?? close,
      close,
      volume: quote.volume?.[i] ?? 0,
    });
  }
  return bars;
}

export interface CryptoQuote {
  symbol: string;
  name: string;
  priceUsd: number;
  changePct24h: number | null;
  marketCap: number | null;
  volume24h: number | null;
  source: string;
}

export async function coingeckoPrices(): Promise<CryptoQuote[]> {
  const url =
    "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false";
  const response = await fetchWithRetry(url, { timeoutMs: 8_000, retries: 1 });
  if (!response.ok) throw new Error(`CoinGecko HTTP ${response.status}`);
  const rows = (await response.json()) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    symbol: String(row.symbol ?? "").toUpperCase(),
    name: String(row.name ?? ""),
    priceUsd: Number(row.current_price ?? 0),
    changePct24h: row.price_change_percentage_24h == null ? null : Number(row.price_change_percentage_24h),
    marketCap: row.market_cap == null ? null : Number(row.market_cap),
    volume24h: row.total_volume == null ? null : Number(row.total_volume),
    source: "coingecko",
  }));
}

export async function binancePrices(): Promise<CryptoQuote[]> {
  const url = "https://api.binance.com/api/v3/ticker/24hr";
  const response = await fetchWithRetry(url, { timeoutMs: 8_000, retries: 1 });
  if (!response.ok) throw new Error(`Binance HTTP ${response.status}`);
  const rows = (await response.json()) as Array<Record<string, unknown>>;
  const wanted = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT"]);
  return rows
    .filter((row) => wanted.has(String(row.symbol ?? "")))
    .map((row) => ({
      symbol: String(row.symbol ?? "").replace(/USDT$/, ""),
      name: String(row.symbol ?? ""),
      priceUsd: Number(row.lastPrice ?? 0),
      changePct24h: row.priceChangePercent == null ? null : Number(row.priceChangePercent),
      marketCap: null,
      volume24h: row.quoteVolume == null ? null : Number(row.quoteVolume),
      source: "binance",
    }));
}

export async function cryptoPricesWithFallback(): Promise<CryptoQuote[]> {
  try {
    return await coingeckoPrices();
  } catch {
    return binancePrices();
  }
}

export interface NewsItem {
  title: string;
  link: string;
  publishedAt: string | null;
  source: string;
  summary?: string;
}

function parseRssItems(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const block of blocks) {
    const title = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i);
    const link = block.match(/<link>([\s\S]*?)<\/link>/i);
    const pub = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const desc = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([\s\S]*?)<\/description>/i);
    const t = (title?.[1] ?? title?.[2] ?? "").trim();
    const l = (link?.[1] ?? "").trim();
    if (!t || !l) continue;
    items.push({
      title: t,
      link: l,
      publishedAt: pub?.[1]?.trim() ?? null,
      source,
      summary: (desc?.[1] ?? desc?.[2] ?? "").replace(/<[^>]+>/g, " ").trim() || undefined,
    });
  }
  return items;
}

const RSS_FEEDS: Array<{ source: string; url: string }> = [
  { source: "vnexpress", url: "https://vnexpress.net/rss/kinh-doanh.rss" },
  { source: "cafef", url: "https://cafef.vn/thi-truong-chung-khoan.rss" },
];

export async function fetchAllRssNews(): Promise<{ items: NewsItem[]; errors: string[] }> {
  const items: NewsItem[] = [];
  const errors: string[] = [];
  for (const feed of RSS_FEEDS) {
    try {
      const response = await fetchWithRetry(feed.url, { timeoutMs: 8_000, retries: 1 });
      if (!response.ok) {
        errors.push(`${feed.source}: HTTP ${response.status}`);
        continue;
      }
      const xml = await response.text();
      items.push(...parseRssItems(xml, feed.source));
    } catch (e) {
      errors.push(`${feed.source}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { items, errors };
}
