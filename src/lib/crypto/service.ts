import { desc, eq, ilike, or, sql, and } from "drizzle-orm";
import { db } from "@/db";
import { exchangeRates } from "@/lib/commodities/schema";
import {
  cryptoAnalysis,
  cryptoCoins,
  cryptoOhlcv,
  cryptoPrices,
  cryptoSentiment,
} from "./schema";
import {
  fetchBinanceKlines,
  fetchCoinGeckoMarkets,
  fetchCoinGeckoProfile,
  fetchCryptoMarketsWithFallback,
  fetchCryptoNews,
} from "./connectors";
import { analyzeCrypto } from "./analysis";
import { scoreCryptoSentimentHybrid } from "./sentiment-hybrid";
import { fetchFuturesIntelligence } from "./futures";
import type { CryptoMarketSnapshot, FuturesIntelligence } from "./types";
import { forProvider } from "@/lib/logger";
import type { Ohlcv } from "@/lib/connectors/core";

const log = forProvider("crypto-service");
const BINANCE_SOURCE = "binance-crypto";

const POPULAR = [
  "BTC", "ETH", "BNB", "SOL", "XRP", "DOGE", "ADA", "TRX",
  "AVAX", "LINK", "DOT", "LTC", "BCH", "SUI", "TON",
];

const STABLECOINS = new Set([
  "USDT", "USDC", "FDUSD", "TUSD", "DAI", "BUSD", "USDE", "USD1", "PYUSD",
]);

export function isStablecoin(symbol: string): boolean {
  return STABLECOINS.has(symbol.trim().toUpperCase());
}

interface CryptoSyncResult {
  source: string;
  coins: number;
  prices: number;
  timestamp: Date;
  durationMs: number;
}

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

type CryptoCoinDetail =
  | {
      coin: typeof cryptoCoins.$inferSelect;
      price: typeof cryptoPrices.$inferSelect | undefined;
    }
  | null;

const FRESHNESS_CACHE_TTL = 5_000;
const LATEST_PRICES_CACHE_TTL = 8_000;
const COIN_CACHE_TTL = 3_000;
const USD_VND_CACHE_TTL = 10 * 60_000;
const FUTURES_CACHE_TTL = 20_000;

const OHLCV_SOFT_TTL: Record<string, number> = {
  "1m": 15_000, "5m": 30_000, "15m": 60_000,
  "1h": 120_000, "4h": 300_000, "1d": 900_000,
};
const OHLCV_HARD_TTL: Record<string, number> = {
  "1m": 60_000, "5m": 120_000, "15m": 300_000,
  "1h": 600_000, "4h": 1_800_000, "1d": 3_600_000,
};

const PROFILE_CACHE_TTL = 30 * 60_000;
const SENTIMENT_CACHE_TTL = 15 * 60_000;

const profileCache = new Map<string, CacheEntry<CryptoCoinDetail>>();
const sentimentCache = new Map<
  string,
  CacheEntry<{
    score: number; label: string; articles?: unknown[];
    source?: string; model?: string; confidence?: number;
    rationale?: string; timestamp: Date;
  }>
>();
const coinCache = new Map<string, CacheEntry<CryptoCoinDetail>>();
const latestPricesCache = new Map<number, CacheEntry<unknown[]>>();
const futuresCache = new Map<string, CacheEntry<FuturesIntelligence>>();

let freshnessCache: CacheEntry<{
  refreshed: boolean; latestAt?: string; source?: string;
  coins?: number; prices?: number; timestamp?: Date; durationMs?: number;
}> | null = null;
let usdVndCache: CacheEntry<number | null> | null = null;

const syncPromises: Record<"market" | "catalog", Promise<CryptoSyncResult> | null> = {
  market: null, catalog: null,
};
let lastMarketSyncAt = 0;

function cacheIsFresh<T>(entry: CacheEntry<T> | undefined, ttl: number) {
  return Boolean(entry && Date.now() - entry.timestamp < ttl);
}
function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}
function normalizeLimit(limit: number, min = 20, max = 1000) {
  return Math.min(max, Math.max(min, Number.isFinite(limit) ? Math.floor(limit) : min));
}
function clearMarketCaches() {
  freshnessCache = null;
  latestPricesCache.clear();
  coinCache.clear();
}

async function usdVndRate() {
  if (usdVndCache && Date.now() - usdVndCache.timestamp < USD_VND_CACHE_TTL) {
    return usdVndCache.value;
  }
  try {
    const [row] = await db
      .select()
      .from(exchangeRates)
      .where(eq(exchangeRates.currency, "USD"))
      .orderBy(desc(exchangeRates.date))
      .limit(1);
    const rate = row?.rate ?? null;
    usdVndCache = { value: rate, timestamp: Date.now() };
    return rate;
  } catch {
    return null;
  }
}

export async function syncCryptoMarket(limit = 100, syncAllCoins = false) {
  const safeLimit = Math.min(250, Math.max(1, Math.floor(limit)));
  const key = syncAllCoins ? "catalog" : "market";
  if (syncPromises[key]) return syncPromises[key]!;

  syncPromises[key] = (async () => {
    const started = Date.now();
    const market = await fetchCryptoMarketsWithFallback(safeLimit);
    const tickerMap = new Map(
      market.prices.map((price) => [normalizeSymbol(price.symbol), price]),
    );
    const coinMap = new Map(
      market.coins.map((coin) => [normalizeSymbol(coin.symbol), coin]),
    );
    const selectedCoins = (
      syncAllCoins
        ? market.coins
        : market.prices
            .map((price) => coinMap.get(normalizeSymbol(price.symbol)))
            .filter((coin): coin is NonNullable<typeof coin> => Boolean(coin))
            .slice(0, safeLimit)
    ).filter((c) => !STABLECOINS.has(normalizeSymbol(c.symbol)));

    if (!selectedCoins.length) {
      throw new Error("Crypto market returned no usable coins");
    }

    const coinValues = selectedCoins.map((coin) => ({
      symbol: normalizeSymbol(coin.symbol),
      name: coin.name,
      binanceSymbol: coin.binanceSymbol,
      coingeckoId: coin.coingeckoId,
      coinpaprikaId: coin.coinpaprikaId,
      marketCapRank: coin.rank,
      logoUrl: coin.logoUrl,
      circulatingSupply: coin.circulatingSupply,
      totalSupply: coin.totalSupply,
      maxSupply: coin.maxSupply,
    }));

    const coinRows = await db
      .insert(cryptoCoins)
      .values(coinValues)
      .onConflictDoUpdate({
        target: cryptoCoins.symbol,
        set: {
          name: sql`excluded.name`,
          binanceSymbol: sql`excluded.binance_symbol`,
          coingeckoId: sql`excluded.coingecko_id`,
          coinpaprikaId: sql`excluded.coinpaprika_id`,
          marketCapRank: sql`excluded.market_cap_rank`,
          logoUrl: sql`excluded.logo_url`,
          circulatingSupply: sql`excluded.circulating_supply`,
          totalSupply: sql`excluded.total_supply`,
          maxSupply: sql`excluded.max_supply`,
          updatedAt: new Date(),
        },
      })
      .returning();

    const rate = await usdVndRate().catch(() => null);
    const timestamp = new Date(Math.floor(Date.now() / 5000) * 5000);
    const priceValues = coinRows
      .map((coin) => {
        const price = tickerMap.get(normalizeSymbol(coin.symbol));
        if (!price) return null;
        return {
          coinId: coin.id,
          price: price.price,
          priceVnd: rate ? price.price * rate : null,
          volume24h: price.volume24h,
          marketCap: price.marketCap,
          change24h: price.change24h,
          source: market.source,
          timestamp,
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value));

    if (priceValues.length) {
      await db
        .insert(cryptoPrices)
        .values(priceValues)
        .onConflictDoUpdate({
          target: [cryptoPrices.coinId, cryptoPrices.timestamp],
          set: {
            price: sql`excluded.price`,
            priceVnd: sql`excluded.price_vnd`,
            volume24h: sql`excluded.volume_24h`,
            marketCap: sql`excluded.market_cap`,
            change24h: sql`excluded.change_24h`,
            source: sql`excluded.source`,
          },
        });
    }

    lastMarketSyncAt = Date.now();
    clearMarketCaches();
    const durationMs = Date.now() - started;
    log.info("crypto_market_synced", {
      source: market.source, coins: coinRows.length, prices: priceValues.length, durationMs,
    });
    return { source: market.source, coins: coinRows.length, prices: priceValues.length, timestamp, durationMs };
  })().finally(() => {
    syncPromises[key] = null;
  });

  return syncPromises[key]!;
}

export async function ensureCryptoFresh(maxAgeMs = 15_000) {
  if (freshnessCache && Date.now() - freshnessCache.timestamp < FRESHNESS_CACHE_TTL) {
    return freshnessCache.value;
  }
  if (lastMarketSyncAt > 0 && Date.now() - lastMarketSyncAt <= maxAgeMs) {
    const result = { refreshed: false, latestAt: new Date(lastMarketSyncAt).toISOString() };
    freshnessCache = { value: result, timestamp: Date.now() };
    return result;
  }

  let latest = 0;
  try {
    const result = await db.execute(sql`SELECT MAX(created_at) AS latest FROM crypto_prices`);
    const raw = (result.rows[0] as { latest?: Date | string | null } | undefined)?.latest;
    latest = raw ? new Date(raw).getTime() : 0;
  } catch {
    return { refreshed: false };
  }

  if (!latest) {
    try {
      const refreshed = await syncCryptoMarket(100);
      const value = { refreshed: true, ...refreshed };
      freshnessCache = { value, timestamp: Date.now() };
      return value;
    } catch (err) {
      log.warn("ensure_crypto_cold_sync_failed", { error: String(err) });
      return { refreshed: false };
    }
  }

  if (Date.now() - latest > maxAgeMs) {
    void syncCryptoMarket(100).catch((e) =>
      log.warn("bg_crypto_sync_failed", { error: String(e) }),
    );
  }

  lastMarketSyncAt = latest;
  const value = { refreshed: false, latestAt: new Date(latest).toISOString() };
  freshnessCache = { value, timestamp: Date.now() };
  return value;
}

export async function listCryptoCoins(opts: { search?: string; page?: number; limit?: number } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 30));
  const search = opts.search?.trim();
  const condition = search
    ? or(ilike(cryptoCoins.symbol, `%${search}%`), ilike(cryptoCoins.name, `%${search}%`))
    : undefined;
  const rows = await db
    .select()
    .from(cryptoCoins)
    .where(condition)
    .orderBy(sql`${cryptoCoins.marketCapRank} asc nulls last`, cryptoCoins.symbol)
    .limit(limit)
    .offset((page - 1) * limit);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cryptoCoins)
    .where(condition);
  return { coins: rows, total: count, page, limit };
}

export async function latestCryptoPrices(limit = 100) {
  const safeLimit = Math.min(250, Math.max(1, Math.floor(limit)));
  const cached = latestPricesCache.get(safeLimit);
  if (cached && Date.now() - cached.timestamp < LATEST_PRICES_CACHE_TTL) {
    return cached.value;
  }
  const result = await db.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (c.id)
          c.symbol, c.name, c.logo_url AS "logoUrl", c.market_cap_rank AS "marketCapRank",
          p.price, p.price_vnd AS "priceVnd", p.volume_24h AS "volume24h",
          p.market_cap AS "marketCap", p.change_24h AS "change24h", p.source, p.timestamp
        FROM crypto_coins c
        JOIN crypto_prices p ON p.coin_id = c.id
        WHERE c.symbol NOT IN ('USDT','USDC','FDUSD','TUSD','DAI','BUSD','USDE','USD1','PYUSD')
        ORDER BY c.id, p.timestamp DESC
      )
      SELECT * FROM latest
      ORDER BY "volume24h" DESC NULLS LAST
      LIMIT ${safeLimit}
    `);
  latestPricesCache.set(safeLimit, { value: result.rows, timestamp: Date.now() });
  return result.rows;
}

async function loadCryptoCoin(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  const cached = coinCache.get(normalized);
  if (cached && Date.now() - cached.timestamp < COIN_CACHE_TTL) return cached.value;

  const [coin] = await db
    .select()
    .from(cryptoCoins)
    .where(eq(cryptoCoins.symbol, normalized))
    .limit(1);
  if (!coin) {
    coinCache.set(normalized, { value: null, timestamp: Date.now() });
    return null;
  }
  const [price] = await db
    .select()
    .from(cryptoPrices)
    .where(eq(cryptoPrices.coinId, coin.id))
    .orderBy(desc(cryptoPrices.timestamp))
    .limit(1);
  const result = { coin, price };
  coinCache.set(normalized, { value: result, timestamp: Date.now() });
  return result;
}

const coinInflight = new Map<string, Promise<CryptoCoinDetail>>();

export function getCryptoCoin(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  const existing = coinInflight.get(normalized);
  if (existing) return existing;
  const pending = loadCryptoCoin(normalized).finally(() => {
    coinInflight.delete(normalized);
  });
  coinInflight.set(normalized, pending);
  return pending;
}

export async function enrichCryptoProfile(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  const cached = profileCache.get(normalized);
  if (cached && cacheIsFresh(cached, PROFILE_CACHE_TTL)) return cached.value;

  let existing = await getCryptoCoin(normalized);
  if (!existing) {
    await syncCryptoMarket();
    existing = await getCryptoCoin(normalized);
  }
  if (!existing) return null;

  let id = existing.coin.coingeckoId;
  if (!id) {
    try {
      const gecko = await fetchCoinGeckoMarkets(150);
      const match = gecko.coins.find((coin) => normalizeSymbol(coin.symbol) === normalized);
      if (match?.coingeckoId) {
        id = match.coingeckoId;
        await db.update(cryptoCoins).set({
          coingeckoId: id, name: match.name, logoUrl: match.logoUrl,
          marketCapRank: match.rank, circulatingSupply: match.circulatingSupply,
          totalSupply: match.totalSupply, maxSupply: match.maxSupply, updatedAt: new Date(),
        }).where(eq(cryptoCoins.id, existing.coin.id));
      }
    } catch { /* keep */ }
  }
  if (id && (!existing.coin.description || !existing.coin.website)) {
    try {
      const profile = await fetchCoinGeckoProfile(id);
      await db.update(cryptoCoins).set({
        name: profile.name, website: profile.website, description: profile.description,
        logoUrl: profile.logoUrl, marketCapRank: profile.rank,
        circulatingSupply: profile.circulatingSupply, totalSupply: profile.totalSupply,
        maxSupply: profile.maxSupply, updatedAt: new Date(),
      }).where(eq(cryptoCoins.id, existing.coin.id));
    } catch { /* ignore */ }
  }
  const result = await getCryptoCoin(normalized);
  profileCache.set(normalized, { value: result, timestamp: Date.now() });
  return result;
}

interface DbOhlcv { bars: Ohlcv[]; source: string; newestMs: number; }

async function readCryptoOhlcvFromDb(coinId: string, timeframe: string, limit: number): Promise<DbOhlcv | null> {
  try {
    const rows = await db.select().from(cryptoOhlcv)
      .where(and(eq(cryptoOhlcv.coinId, coinId), eq(cryptoOhlcv.timeframe, timeframe)))
      .orderBy(desc(cryptoOhlcv.time)).limit(limit);
    if (rows.length < Math.min(15, limit)) return null;
    const newest = rows[0]?.time;
    if (!newest) return null;
    const bars: Ohlcv[] = rows.map((r) => ({
      time: Math.floor(new Date(r.time).getTime() / 1000),
      open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume ?? 0,
    })).reverse();
    return { bars, source: rows[0]?.source ?? "db-cache", newestMs: new Date(newest).getTime() };
  } catch {
    return null;
  }
}

async function persistCryptoBars(coinId: string, timeframe: string, bars: Ohlcv[], source: string) {
  const chunk = 50;
  for (let i = 0; i < bars.length; i += chunk) {
    await Promise.all(
      bars.slice(i, i + chunk).map((b) =>
        db.insert(cryptoOhlcv).values({
          coinId, timeframe, time: new Date(b.time * 1000),
          open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, source,
        }).onConflictDoUpdate({
          target: [cryptoOhlcv.coinId, cryptoOhlcv.timeframe, cryptoOhlcv.time],
          set: { open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, source },
        }),
      ),
    );
  }
}

async function loadCryptoOhlcv(symbol: string, timeframe = "1h", limit = 200) {
  const normalized = normalizeSymbol(symbol);
  const safeLimit = normalizeLimit(limit, 20, 1000);

  if (isStablecoin(normalized)) {
    throw new Error(
      `${normalized} là stablecoin (đồng định giá ~$1), không có cặp ${normalized}/USDT trên Binance. Hãy mở BTC, ETH, SOL…`,
    );
  }

  let found = await getCryptoCoin(normalized).catch(() => null);
  if (!found) {
    try {
      await syncCryptoMarket();
      found = await getCryptoCoin(normalized);
    } catch {
      found = null;
    }
  }

  const binanceSymbol = found?.coin.binanceSymbol || `${normalized}USDT`;
  const soft = OHLCV_SOFT_TTL[timeframe] ?? 120_000;
  const hard = OHLCV_HARD_TTL[timeframe] ?? 600_000;

  if (found?.coin.id) {
    const cached = await readCryptoOhlcvFromDb(found.coin.id, timeframe, safeLimit);
    const age = cached ? Date.now() - cached.newestMs : Infinity;
    if (cached && age <= soft) {
      return { coin: found.coin, bars: cached.bars, source: cached.source, stale: false };
    }
    if (cached && age <= hard) {
      void fetchBinanceKlines(binanceSymbol, timeframe, safeLimit)
        .then((bars) => persistCryptoBars(found!.coin.id, timeframe, bars, BINANCE_SOURCE))
        .catch((e) => log.warn("ohlcv_bg_refresh_failed", { symbol: normalized, error: String(e) }));
      return { coin: found.coin, bars: cached.bars, source: `${cached.source}+swr`, stale: true };
    }
  }

  const bars = await fetchBinanceKlines(binanceSymbol, timeframe, safeLimit);
  if (found?.coin.id) {
    void persistCryptoBars(found.coin.id, timeframe, bars, BINANCE_SOURCE).catch((e) =>
      log.warn("ohlcv_persist_failed", { symbol: normalized, error: String(e) }),
    );
  }

  const coin =
    found?.coin ??
    ({
      id: "00000000-0000-0000-0000-000000000000",
      symbol: normalized,
      name: normalized,
      binanceSymbol,
      coingeckoId: null,
      coinpaprikaId: null,
      marketCapRank: null,
      website: null,
      description: null,
      logoUrl: null,
      circulatingSupply: null,
      totalSupply: null,
      maxSupply: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as typeof cryptoCoins.$inferSelect);

  return { coin, bars, source: BINANCE_SOURCE, stale: false };
}

const ohlcvInflight = new Map<
  string,
  Promise<Awaited<ReturnType<typeof loadCryptoOhlcv>>>
>();

export function syncCryptoOhlcv(symbol: string, timeframe = "1h", limit = 200) {
  const normalized = normalizeSymbol(symbol);
  const safeLimit = normalizeLimit(limit, 20, 1000);
  const key = `${normalized}:${timeframe}:${safeLimit}`;
  const existing = ohlcvInflight.get(key);
  if (existing) return existing;

  const pending = loadCryptoOhlcv(normalized, timeframe, safeLimit).finally(() => {
    ohlcvInflight.delete(key);
  });
  ohlcvInflight.set(key, pending);
  return pending;
}

export async function getCryptoOhlcv(symbol: string, timeframe: string, limit: number) {
  return syncCryptoOhlcv(symbol, timeframe, limit);
}

export async function updateCryptoSentiment(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  const found = await getCryptoCoin(normalized);
  if (!found) throw new Error("Coin not found");
  const news = await fetchCryptoNews();
  const needle = [
    found.coin.symbol.toLowerCase(),
    found.coin.name.toLowerCase(),
    found.coin.binanceSymbol?.toLowerCase().replace("usdt", ""),
  ].filter(Boolean) as string[];
  const relevant = news
    .filter((item) => {
      const text = `${item.title} ${item.summary}`;
      return needle.some((value) => text.toLowerCase().includes(value));
    })
    .slice(0, 30);
  const sourceNews = relevant.length ? relevant : news.slice(0, 15);
  const texts = sourceNews.map((item) => `${item.title} ${item.summary}`);
  const hybrid = await scoreCryptoSentimentHybrid(normalized, texts);
  const timestamp = new Date();
  const articles = relevant.slice(0, 10);
  await db.insert(cryptoSentiment).values({
    coinId: found.coin.id,
    sentiment: hybrid.score,
    source:
      hybrid.source === "hybrid" || hybrid.source === "llm"
        ? `rss+llm(${hybrid.model ?? "multi"})`
        : "coindesk+cointelegraph-rss",
    details: {
      articles, relevantCount: relevant.length, confidence: hybrid.confidence,
      rationale: hybrid.rationale, scoringSource: hybrid.source, model: hybrid.model ?? null,
    },
    timestamp,
  });
  const result = {
    score: hybrid.score, label: hybrid.label, confidence: hybrid.confidence,
    rationale: hybrid.rationale, source: hybrid.source, model: hybrid.model, articles, timestamp,
  };
  sentimentCache.set(normalized, { value: result, timestamp: Date.now() });
  return result;
}

export async function getLatestCryptoSentiment(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  const cached = sentimentCache.get(normalized);
  if (cached && cacheIsFresh(cached, SENTIMENT_CACHE_TTL)) return cached.value;
  const found = await getCryptoCoin(normalized);
  if (!found) return updateCryptoSentiment(normalized);
  const [row] = await db
    .select()
    .from(cryptoSentiment)
    .where(eq(cryptoSentiment.coinId, found.coin.id))
    .orderBy(desc(cryptoSentiment.timestamp))
    .limit(1);
  if (row && Date.now() - row.timestamp.getTime() < SENTIMENT_CACHE_TTL) {
    const details = (row.details ?? {}) as Record<string, unknown>;
    const result = {
      score: row.sentiment,
      label: row.sentiment > 0.3 ? "Tích cực" : row.sentiment < -0.3 ? "Tiêu cực" : "Trung lập",
      source: row.source,
      ...details,
      timestamp: row.timestamp,
    };
    sentimentCache.set(normalized, {
      value: result as { score: number; label: string; articles?: unknown[]; source?: string; timestamp: Date },
      timestamp: Date.now(),
    });
    return result;
  }
  return updateCryptoSentiment(normalized);
}

export async function runCryptoAnalysis(symbol: string, timeframe = "1h") {
  const [ohlcv, sentiment] = await Promise.all([
    syncCryptoOhlcv(symbol, timeframe, 200),
    getLatestCryptoSentiment(symbol).catch(() => ({ score: 0 })),
  ]);
  const result = analyzeCrypto(ohlcv.bars, Number(sentiment.score));
  if (ohlcv.coin.id && ohlcv.coin.id !== "00000000-0000-0000-0000-000000000000") {
    await db.insert(cryptoAnalysis).values({
      coinId: ohlcv.coin.id,
      timeframe,
      technicalSignals: result.indicators,
      patterns: { candlestick: result.candlestickPatterns, chart: result.chartPatterns },
      recommendation: result.recommendation,
      entryPrice: result.entryPrice,
      stopLoss: result.stopLoss,
      takeProfit: result.takeProfit,
      confidence: result.confidence,
      reason: result.reasons.join("; "),
      timestamp: new Date(),
    }).catch((e) => log.warn("analysis_persist_failed", { error: String(e) }));
  }
  return {
    symbol: ohlcv.coin.symbol,
    timeframe,
    sentiment: Number(sentiment.score),
    ...result,
    disclaimer: "Chỉ là tín hiệu định lượng tham khảo, không phải lời khuyên đầu tư.",
  };
}

/** Cached futures intelligence (Phase 1). */
export async function getCryptoFutures(
  symbol: string,
  change24h?: number | null,
): Promise<FuturesIntelligence> {
  const normalized = normalizeSymbol(symbol);
  const cached = futuresCache.get(normalized);
  if (cached && Date.now() - cached.timestamp < FUTURES_CACHE_TTL) {
    return cached.value;
  }
  const data = await fetchFuturesIntelligence(normalized, change24h ?? null);
  futuresCache.set(normalized, { value: data, timestamp: Date.now() });
  return data;
}

/** Phase 0 unified snapshot for AI / dashboards. */
export async function getCryptoMarketSnapshot(
  symbol: string,
  timeframe = "1h",
): Promise<CryptoMarketSnapshot> {
  const sym = normalizeSymbol(symbol);
  const [detail, analysis, sentiment, futures] = await Promise.all([
    getCryptoCoin(sym).catch(() => null),
    runCryptoAnalysis(sym, timeframe).catch(() => null),
    getLatestCryptoSentiment(sym).catch(() => null),
    getCryptoFutures(
      sym,
      undefined,
    ).catch(() => null),
  ]);

  const change24h =
    detail?.price?.change24h != null ? Number(detail.price.change24h) : null;

  let futuresFinal = futures;
  if (futures && change24h != null && futures.openInterest.priceChangePct == null) {
    futuresFinal = await getCryptoFutures(sym, change24h).catch(() => futures);
  }

  return {
    symbol: sym,
    name: detail?.coin.name ?? sym,
    spot: {
      price: detail?.price?.price ?? null,
      change24h,
      volume24h: detail?.price?.volume24h ?? null,
      marketCap: detail?.price?.marketCap ?? null,
      source: detail?.price?.source ?? null,
      timestamp: detail?.price?.timestamp
        ? new Date(detail.price.timestamp).toISOString()
        : null,
    },
    futures: futuresFinal,
    sentiment: sentiment
      ? {
          score: Number(sentiment.score),
          label: String(sentiment.label ?? ""),
          source: sentiment.source ?? null,
        }
      : null,
    technical: analysis
      ? {
          recommendation: analysis.recommendation,
          confidence: analysis.confidence,
          reasons: analysis.reasons ?? [],
        }
      : null,
    generatedAt: new Date().toISOString(),
  };
}

export async function getCryptoDetailBundle(
  symbol: string,
  timeframe = "1h",
  limit = 200,
  options: { light?: boolean } = {},
) {
  const sym = normalizeSymbol(symbol);
  if (isStablecoin(sym)) {
    throw new Error(
      `${sym} là stablecoin (đồng định giá ~$1), không có cặp ${sym}/USDT trên Binance để vẽ chart. Chọn BTC, ETH, SOL hoặc coin khác.`,
    );
  }

  const detailPromise = (async () => {
    await ensureCryptoFresh(12_000).catch(() => undefined);
    return getCryptoCoin(sym).catch(() => null);
  })();
  const ohlcvPromise = syncCryptoOhlcv(sym, timeframe, limit);

  if (options.light) {
    const [detail, ohlcv] = await Promise.all([detailPromise, ohlcvPromise]);
    return {
      coin: detail?.coin ?? ohlcv.coin,
      price: detail?.price ?? null,
      bars: ohlcv.bars,
      timeframe,
      source: ohlcv.source,
      analysis: null,
      futures: null,
      light: true,
    };
  }

  const [detail, ohlcv, analysis] = await Promise.all([
    detailPromise,
    ohlcvPromise,
    runCryptoAnalysis(sym, timeframe).catch(() => null),
  ]);

  // Futures/order-flow/whale data is already delivered by the batched /intel
  // endpoint on the client. Keeping it out of the first-paint bundle avoids
  // four additional upstream calls on the critical path.
  return {
    coin: detail?.coin ?? ohlcv.coin,
    price: detail?.price ?? null,
    bars: ohlcv.bars,
    timeframe,
    source: ohlcv.source,
    analysis,
    futures: null,
  };
}

export { POPULAR, STABLECOINS };
