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

export async function vndirectSearch(query: string): Promise<SymbolInfo[]> {
  return getBreaker(VNDIRECT).exec(async () => {
    const url = `https://dchart-api.vndirect.com.vn/dchart/search?query=${encodeURIComponent(
      query,
    )}&limit=20&type=&exchange=`;
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
