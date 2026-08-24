import Parser from "rss-parser";
import {
  DataValidator,
  fetchWithRetry,
  getBreaker,
  ProviderError,
  readJsonSafe,
  readTextSafe,
  type Ohlcv,
} from "@/lib/connectors/core";
import { forProvider } from "@/lib/logger";

const BINANCE = "binance-crypto";
const COINGECKO = "coingecko-crypto";
const PAPRIKA = "coinpaprika-crypto";
const log = forProvider("crypto-connectors");
const BINANCE_BASE = "https://data-api.binance.vision";

/** List-path budgets — avoid 15s×3 = 45s+ hangs. */
const FAST_TIMEOUT_MS = 6_000;
const FAST_RETRIES = 1;
const BARS_TIMEOUT_MS = 8_000;

export interface CryptoCoinSource {
  symbol: string;
  name: string;
  binanceSymbol?: string;
  coingeckoId?: string;
  coinpaprikaId?: string;
  rank?: number | null;
  logoUrl?: string | null;
  marketCap?: number | null;
  circulatingSupply?: number | null;
  totalSupply?: number | null;
  maxSupply?: number | null;
}
export interface CryptoTicker {
  symbol: string;
  binanceSymbol?: string;
  price: number;
  volume24h: number | null;
  marketCap: number | null;
  change24h: number | null;
  source: string;
  timestamp: Date;
}
export interface CryptoProfileSource extends CryptoCoinSource {
  website?: string | null;
  description?: string | null;
}
export interface CryptoNewsItem {
  title: string;
  link: string;
  source: string;
  publishedAt: Date;
  summary: string;
}

interface BinanceExchangeInfo {
  symbols: Array<{
    symbol: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
    isSpotTradingAllowed?: boolean;
  }>;
}
interface BinanceTickerRow {
  symbol: string;
  lastPrice: string;
  quoteVolume: string;
  priceChangePercent: string;
  closeTime: number;
}

export async function fetchBinanceCoins(): Promise<CryptoCoinSource[]> {
  return getBreaker(BINANCE).exec(async () => {
    const url = `${BINANCE_BASE}/api/v3/exchangeInfo`;
    const res = await fetchWithRetry(url, {
      provider: BINANCE,
      timeoutMs: FAST_TIMEOUT_MS,
      retries: FAST_RETRIES,
    });
    const data = await readJsonSafe<BinanceExchangeInfo>(res, BINANCE, url);
    const stable = new Set(["USDT", "USDC", "FDUSD", "TUSD", "DAI"]);
    const seen = new Set<string>();
    const rows: CryptoCoinSource[] = [];
    for (const pair of data.symbols ?? []) {
      if (
        pair.quoteAsset !== "USDT" ||
        pair.status !== "TRADING" ||
        pair.isSpotTradingAllowed === false ||
        stable.has(pair.baseAsset)
      )
        continue;
      if (seen.has(pair.baseAsset)) continue;
      seen.add(pair.baseAsset);
      rows.push({ symbol: pair.baseAsset, name: pair.baseAsset, binanceSymbol: pair.symbol });
    }
    if (!rows.length) throw new ProviderError(BINANCE, "exchangeInfo returned no tradable USDT pairs");
    return rows;
  });
}

export async function fetchBinanceTickers(): Promise<CryptoTicker[]> {
  return getBreaker(BINANCE).exec(async () => {
    const url = `${BINANCE_BASE}/api/v3/ticker/24hr`;
    const res = await fetchWithRetry(url, {
      provider: BINANCE,
      timeoutMs: FAST_TIMEOUT_MS,
      retries: FAST_RETRIES,
    });
    const rows = await readJsonSafe<BinanceTickerRow[]>(res, BINANCE, url);
    const out: CryptoTicker[] = [];
    for (const row of rows ?? []) {
      if (!row.symbol.endsWith("USDT")) continue;
      const symbol = row.symbol.slice(0, -4);
      const price = Number(row.lastPrice);
      const volume = Number(row.quoteVolume);
      const change = Number(row.priceChangePercent);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(volume) || volume < 0) continue;
      out.push({
        symbol,
        binanceSymbol: row.symbol,
        price,
        volume24h: volume,
        marketCap: null,
        change24h: Number.isFinite(change) ? change : null,
        source: BINANCE,
        timestamp: new Date(row.closeTime || Date.now()),
      });
    }
    if (!out.length) throw new ProviderError(BINANCE, "ticker returned no valid USDT rows");
    return out.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
  });
}

interface GeckoMarket {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  total_volume: number;
  price_change_percentage_24h: number;
  circulating_supply: number;
  total_supply: number;
  max_supply: number;
}
export async function fetchCoinGeckoMarkets(
  limit = 100,
): Promise<{ coins: CryptoCoinSource[]; prices: CryptoTicker[] }> {
  return getBreaker(COINGECKO).exec(async () => {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${Math.min(250, limit)}&page=1&sparkline=false`;
    const res = await fetchWithRetry(url, {
      provider: COINGECKO,
      timeoutMs: FAST_TIMEOUT_MS,
      retries: FAST_RETRIES,
    });
    const rows = await readJsonSafe<GeckoMarket[]>(res, COINGECKO, url);
    if (!rows?.length) throw new ProviderError(COINGECKO, "markets returned no rows");
    return {
      coins: rows.map((r) => ({
        symbol: r.symbol.toUpperCase(),
        name: r.name,
        coingeckoId: r.id,
        rank: r.market_cap_rank,
        logoUrl: r.image,
        marketCap: r.market_cap,
        circulatingSupply: r.circulating_supply,
        totalSupply: r.total_supply,
        maxSupply: r.max_supply,
      })),
      prices: rows
        .filter((r) => r.current_price > 0)
        .map((r) => ({
          symbol: r.symbol.toUpperCase(),
          price: r.current_price,
          volume24h: r.total_volume,
          marketCap: r.market_cap,
          change24h: r.price_change_percentage_24h,
          source: COINGECKO,
          timestamp: new Date(),
        })),
    };
  });
}

interface PaprikaTicker {
  id: string;
  name: string;
  symbol: string;
  rank: number;
  circulating_supply: number;
  total_supply: number;
  max_supply: number;
  quotes: {
    USD: {
      price: number;
      volume_24h: number;
      market_cap: number;
      percent_change_24h: number;
    };
  };
}
export async function fetchCoinPaprikaMarkets(
  limit = 100,
): Promise<{ coins: CryptoCoinSource[]; prices: CryptoTicker[] }> {
  return getBreaker(PAPRIKA).exec(async () => {
    const url = `https://api.coinpaprika.com/v1/tickers?quotes=USD&limit=${Math.min(250, limit)}`;
    const res = await fetchWithRetry(url, {
      provider: PAPRIKA,
      timeoutMs: FAST_TIMEOUT_MS,
      retries: FAST_RETRIES,
    });
    const rows = await readJsonSafe<PaprikaTicker[]>(res, PAPRIKA, url);
    if (!rows?.length) throw new ProviderError(PAPRIKA, "tickers returned no rows");
    return {
      coins: rows.map((r) => ({
        symbol: r.symbol.toUpperCase(),
        name: r.name,
        coinpaprikaId: r.id,
        rank: r.rank,
        marketCap: r.quotes.USD.market_cap,
        circulatingSupply: r.circulating_supply,
        totalSupply: r.total_supply,
        maxSupply: r.max_supply,
      })),
      prices: rows
        .filter((r) => r.quotes?.USD?.price > 0)
        .map((r) => ({
          symbol: r.symbol.toUpperCase(),
          price: r.quotes.USD.price,
          volume24h: r.quotes.USD.volume_24h,
          marketCap: r.quotes.USD.market_cap,
          change24h: r.quotes.USD.percent_change_24h,
          source: PAPRIKA,
          timestamp: new Date(),
        })),
    };
  });
}

export async function fetchCryptoMarketsWithFallback(
  limit = 100,
): Promise<{ coins: CryptoCoinSource[]; prices: CryptoTicker[]; source: string }> {
  try {
    const binancePrices = await fetchBinanceTickers();
    const coins: CryptoCoinSource[] = binancePrices.map((p) => ({
      symbol: p.symbol,
      name: p.symbol,
      binanceSymbol: p.binanceSymbol,
      coingeckoId: undefined,
      coinpaprikaId: undefined,
      rank: null,
      logoUrl: null,
      marketCap: p.marketCap,
      circulatingSupply: null,
      totalSupply: null,
      maxSupply: null,
    }));
    return { coins, prices: binancePrices.slice(0, limit), source: BINANCE };
  } catch (binanceError) {
    log.warn("binance_market_failed_using_coingecko", { error: String(binanceError) });
    try {
      const data = await fetchCoinGeckoMarkets(limit);
      return { ...data, source: COINGECKO };
    } catch (geckoError) {
      log.warn("coingecko_market_failed_using_paprika", { error: String(geckoError) });
      const data = await fetchCoinPaprikaMarkets(limit);
      return { ...data, source: PAPRIKA };
    }
  }
}

const VALID_INTERVALS = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);
export async function fetchBinanceKlines(
  binanceSymbol: string,
  timeframe: string,
  limit = 300,
): Promise<Ohlcv[]> {
  if (!VALID_INTERVALS.has(timeframe)) throw new Error("Invalid timeframe");
  return getBreaker(BINANCE).exec(async () => {
    const url = `${BINANCE_BASE}/api/v3/klines?symbol=${encodeURIComponent(binanceSymbol)}&interval=${timeframe}&limit=${Math.min(1000, Math.max(20, limit))}`;
    const res = await fetchWithRetry(url, {
      provider: BINANCE,
      timeoutMs: BARS_TIMEOUT_MS,
      retries: FAST_RETRIES,
    });
    const rows = await readJsonSafe<Array<[number, string, string, string, string, string]>>(
      res,
      BINANCE,
      url,
    );
    const bars: Ohlcv[] = [];
    for (const row of rows ?? []) {
      const valid = DataValidator.ohlcv(
        {
          time: Math.floor(row[0] / 1000),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
        },
        { provider: BINANCE, symbol: binanceSymbol },
      );
      if (valid) bars.push(valid);
    }
    if (!bars.length) throw new ProviderError(BINANCE, `no valid klines for ${binanceSymbol}`);
    return bars;
  });
}

interface GeckoDetail {
  id: string;
  symbol: string;
  name: string;
  description: { en?: string };
  image: { large?: string };
  links: { homepage?: string[] };
  market_cap_rank: number;
  market_data: {
    market_cap: { usd?: number };
    total_volume: { usd?: number };
    circulating_supply: number;
    total_supply: number;
    max_supply: number;
  };
}
export async function fetchCoinGeckoProfile(id: string): Promise<CryptoProfileSource> {
  return getBreaker(COINGECKO).exec(async () => {
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`;
    const res = await fetchWithRetry(url, {
      provider: COINGECKO,
      timeoutMs: FAST_TIMEOUT_MS,
      retries: FAST_RETRIES,
    });
    const r = await readJsonSafe<GeckoDetail>(res, COINGECKO, url);
    return {
      symbol: r.symbol.toUpperCase(),
      name: r.name,
      coingeckoId: r.id,
      rank: r.market_cap_rank,
      logoUrl: r.image?.large,
      website: r.links?.homepage?.[0] || null,
      description:
        r.description?.en?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null,
      marketCap: r.market_data?.market_cap?.usd,
      circulatingSupply: r.market_data?.circulating_supply,
      totalSupply: r.market_data?.total_supply,
      maxSupply: r.market_data?.max_supply,
    };
  });
}

const rssParser = new Parser();
/** Phase 4 — multi-source crypto news (Binance Square has no public API). */
const RSS = [
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { source: "Decrypt", url: "https://decrypt.co/feed" },
  { source: "BitcoinMagazine", url: "https://bitcoinmagazine.com/.rss/full/" },
  { source: "TheBlock", url: "https://www.theblock.co/rss.xml" },
];
export async function fetchCryptoNews(): Promise<CryptoNewsItem[]> {
  const settled = await Promise.allSettled(
    RSS.map(async ({ source, url }) => {
      const res = await fetchWithRetry(url, {
        provider: `crypto-news-${source.toLowerCase()}`,
        timeoutMs: FAST_TIMEOUT_MS,
        retries: FAST_RETRIES,
      });
      const xml = await readTextSafe(res, source, url);
      const feed = await rssParser.parseString(xml);
      return (feed.items ?? [])
        .slice(0, 25)
        .map((item) => ({
          title: item.title ?? "",
          link: item.link ?? "",
          source,
          publishedAt:
            item.isoDate || item.pubDate
              ? new Date(item.isoDate ?? item.pubDate!)
              : new Date(),
          summary: String(item.contentSnippet ?? item.content ?? "")
            .replace(/<[^>]+>/g, " ")
            .slice(0, 500),
        }))
        .filter((x) => x.title && x.link);
    }),
  );
  const items = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!items.length) throw new Error("All crypto RSS providers unavailable");
  // Dedupe by title prefix
  const seen = new Set<string>();
  const unique: CryptoNewsItem[] = [];
  for (const item of items.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())) {
    const key = item.title.slice(0, 48).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}
