import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { exchangeRates } from "@/lib/commodities/schema";
import { saveExchangeRates } from "@/lib/commodities/service";
import { cryptoAnalysis, cryptoCoins, cryptoOhlcv, cryptoPrices, cryptoSentiment } from "./schema";
import { fetchBinanceKlines, fetchCoinGeckoMarkets, fetchCoinGeckoProfile, fetchCryptoMarketsWithFallback, fetchCryptoNews } from "./connectors";
import { analyzeCrypto, cryptoSentimentScore } from "./analysis";
import { forProvider } from "@/lib/logger";

const log = forProvider("crypto-service");
const POPULAR = ["BTC", "ETH", "BNB", "SOL", "XRP", "DOGE", "ADA", "TRX", "AVAX", "LINK", "DOT", "LTC", "BCH", "SUI", "TON"];
interface CryptoSyncResult { source: string; coins: number; prices: number; timestamp: Date; durationMs: number }
const syncPromises: Record<"market" | "catalog", Promise<CryptoSyncResult> | null> = { market: null, catalog: null };

async function usdVndRate() {
  let [row] = await db.select().from(exchangeRates).where(eq(exchangeRates.currency, "USD")).orderBy(desc(exchangeRates.date)).limit(1);
  if (!row || Date.now() - row.createdAt.getTime() > 24 * 60 * 60_000) {
    const rates = await fetchExchangeRates(); await saveExchangeRates(rates);
    [row] = await db.select().from(exchangeRates).where(eq(exchangeRates.currency, "USD")).orderBy(desc(exchangeRates.date)).limit(1);
  }
  return row?.rate ?? null;
}

export async function syncCryptoMarket(limit = 100, syncAllCoins = false) {
  const key = syncAllCoins ? "catalog" : "market";
  if (syncPromises[key]) return syncPromises[key]!;
  syncPromises[key] = (async () => {
    const started = Date.now();
    const market = await fetchCryptoMarketsWithFallback(limit);
    const tickerMap = new Map(market.prices.map((p) => [p.symbol, p]));
    const coinMap = new Map(market.coins.map((coin) => [coin.symbol, coin]));
    // Price jobs follow ticker volume order; the 12-hour catalog job stores
    // every tradable USDT base asset returned by exchangeInfo.
    const selectedCoins = syncAllCoins
      ? market.coins
      : market.prices.map((price) => coinMap.get(price.symbol)).filter((coin): coin is NonNullable<typeof coin> => Boolean(coin)).slice(0, limit);
    const coinRows = [];
    for (const coin of selectedCoins) {
      const [saved] = await db.insert(cryptoCoins).values({
        symbol: coin.symbol, name: coin.name, binanceSymbol: coin.binanceSymbol,
        coingeckoId: coin.coingeckoId, coinpaprikaId: coin.coinpaprikaId,
        marketCapRank: coin.rank, logoUrl: coin.logoUrl,
        circulatingSupply: coin.circulatingSupply, totalSupply: coin.totalSupply, maxSupply: coin.maxSupply,
      }).onConflictDoUpdate({ target: cryptoCoins.symbol, set: {
        name: coin.name, binanceSymbol: coin.binanceSymbol, coingeckoId: coin.coingeckoId,
        coinpaprikaId: coin.coinpaprikaId, marketCapRank: coin.rank, logoUrl: coin.logoUrl,
        circulatingSupply: coin.circulatingSupply, totalSupply: coin.totalSupply, maxSupply: coin.maxSupply, updatedAt: new Date(),
      }}).returning();
      coinRows.push(saved);
    }
    const rate = await usdVndRate().catch(() => null);
    // One timestamp for an atomic provider snapshot, rounded to 5 seconds.
    const timestamp = new Date(Math.floor(Date.now() / 5000) * 5000);
    let savedPrices = 0;
    for (const coin of coinRows) {
      const price = tickerMap.get(coin.symbol); if (!price) continue;
      await db.insert(cryptoPrices).values({ coinId: coin.id, price: price.price, priceVnd: rate ? price.price * rate : null, volume24h: price.volume24h, marketCap: price.marketCap, change24h: price.change24h, source: market.source, timestamp }).onConflictDoUpdate({ target: [cryptoPrices.coinId, cryptoPrices.timestamp], set: { price: price.price, priceVnd: rate ? price.price * rate : null, volume24h: price.volume24h, marketCap: price.marketCap, change24h: price.change24h, source: market.source }});
      savedPrices++;
    }
    log.info("crypto_market_synced", { source: market.source, coins: coinRows.length, prices: savedPrices, durationMs: Date.now() - started });
    return { source: market.source, coins: coinRows.length, prices: savedPrices, timestamp, durationMs: Date.now() - started };
  })().finally(() => { syncPromises[key] = null; });
  return syncPromises[key]!;
}

export async function ensureCryptoFresh(maxAgeMs = 10_000) {
  const result = await db.execute(sql`SELECT MAX(created_at) AS latest FROM crypto_prices`);
  const raw = (result.rows[0] as { latest?: Date | string | null } | undefined)?.latest;
  const latest = raw ? new Date(raw).getTime() : 0;
  if (!latest || Date.now() - latest > maxAgeMs) return { refreshed: true, ...(await syncCryptoMarket(100)) };
  return { refreshed: false, latestAt: new Date(latest).toISOString() };
}

export async function listCryptoCoins(opts: { search?: string; page?: number; limit?: number } = {}) {
  const page = Math.max(1, opts.page ?? 1), limit = Math.min(100, Math.max(1, opts.limit ?? 30));
  const condition = opts.search ? or(ilike(cryptoCoins.symbol, `%${opts.search}%`), ilike(cryptoCoins.name, `%${opts.search}%`)) : undefined;
  const rows = await db.select().from(cryptoCoins).where(condition).orderBy(sql`${cryptoCoins.marketCapRank} asc nulls last`, cryptoCoins.symbol).limit(limit).offset((page - 1) * limit);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(cryptoCoins).where(condition);
  return { coins: rows, total: count, page, limit };
}

export async function latestCryptoPrices(limit = 100) {
  const result = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (c.id) c.symbol, c.name, c.logo_url AS "logoUrl", c.market_cap_rank AS "marketCapRank",
        p.price, p.price_vnd AS "priceVnd", p.volume_24h AS "volume24h", p.market_cap AS "marketCap",
        p.change_24h AS "change24h", p.source, p.timestamp
      FROM crypto_coins c JOIN crypto_prices p ON p.coin_id=c.id
      ORDER BY c.id, p.timestamp DESC
    )
    SELECT * FROM latest ORDER BY "volume24h" DESC NULLS LAST LIMIT ${limit}
  `);
  return result.rows;
}

export async function getCryptoCoin(symbol: string) {
  const [coin] = await db.select().from(cryptoCoins).where(eq(cryptoCoins.symbol, symbol.toUpperCase())).limit(1);
  if (!coin) return null;
  const [price] = await db.select().from(cryptoPrices).where(eq(cryptoPrices.coinId, coin.id)).orderBy(desc(cryptoPrices.timestamp)).limit(1);
  return { coin, price };
}

export async function enrichCryptoProfile(symbol: string) {
  let existing = await getCryptoCoin(symbol); if (!existing) { await syncCryptoMarket(); existing = await getCryptoCoin(symbol); }
  if (!existing) return null;
  let id = existing.coin.coingeckoId;
  if (!id) {
    try {
      const gecko = await fetchCoinGeckoMarkets(150);
      const match = gecko.coins.find((c) => c.symbol === symbol.toUpperCase());
      if (match?.coingeckoId) { id = match.coingeckoId; await db.update(cryptoCoins).set({ coingeckoId: id, name: match.name, logoUrl: match.logoUrl, marketCapRank: match.rank, circulatingSupply: match.circulatingSupply, totalSupply: match.totalSupply, maxSupply: match.maxSupply, updatedAt: new Date() }).where(eq(cryptoCoins.id, existing.coin.id)); }
    } catch { /* Binance base data remains valid. */ }
  }
  if (id && (!existing.coin.description || !existing.coin.website)) {
    try {
      const profile = await fetchCoinGeckoProfile(id);
      await db.update(cryptoCoins).set({ name: profile.name, website: profile.website, description: profile.description, logoUrl: profile.logoUrl, marketCapRank: profile.rank, circulatingSupply: profile.circulatingSupply, totalSupply: profile.totalSupply, maxSupply: profile.maxSupply, updatedAt: new Date() }).where(eq(cryptoCoins.id, existing.coin.id));
    } catch { /* Return available real data. */ }
  }
  return getCryptoCoin(symbol);
}

export async function syncCryptoOhlcv(symbol: string, timeframe = "1h", limit = 300) {
  let found = await getCryptoCoin(symbol); if (!found) { await syncCryptoMarket(); found = await getCryptoCoin(symbol); }
  if (!found?.coin.binanceSymbol) throw new Error(`${symbol} has no Binance USDT pair`);
  const bars = await fetchBinanceKlines(found.coin.binanceSymbol, timeframe, limit);
  for (const bar of bars) await db.insert(cryptoOhlcv).values({ coinId: found.coin.id, timeframe, time: new Date(bar.time * 1000), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, source: BINANCE_SOURCE }).onConflictDoUpdate({ target: [cryptoOhlcv.coinId, cryptoOhlcv.timeframe, cryptoOhlcv.time], set: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, source: BINANCE_SOURCE } });
  return { coin: found.coin, bars, source: BINANCE_SOURCE };
}
const BINANCE_SOURCE = "binance-crypto";

export async function getCryptoOhlcv(symbol: string, timeframe: string, limit: number) {
  const synced = await syncCryptoOhlcv(symbol, timeframe, limit);
  return synced;
}

export async function updateCryptoSentiment(symbol: string) {
  const found = await getCryptoCoin(symbol); if (!found) throw new Error("Coin not found");
  const news = await fetchCryptoNews();
  const needle = [found.coin.symbol.toLowerCase(), found.coin.name.toLowerCase(), found.coin.binanceSymbol?.toLowerCase().replace("usdt", "")].filter(Boolean) as string[];
  const relevant = news.filter((n) => needle.some((x) => new RegExp(`\\b${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(`${n.title} ${n.summary}`))).slice(0, 30);
  const score = cryptoSentimentScore((relevant.length ? relevant : news.slice(0, 15)).map((n) => `${n.title} ${n.summary}`));
  const timestamp = new Date();
  await db.insert(cryptoSentiment).values({ coinId: found.coin.id, sentiment: score, source: "coindesk+cointelegraph-rss", details: { articles: relevant.slice(0, 10), relevantCount: relevant.length }, timestamp });
  return { score, label: score > .3 ? "Tích cực" : score < -.3 ? "Tiêu cực" : "Trung lập", articles: relevant.slice(0, 10), timestamp };
}

export async function getLatestCryptoSentiment(symbol: string) {
  const found = await getCryptoCoin(symbol); if (!found) return updateCryptoSentiment(symbol);
  const [row] = await db.select().from(cryptoSentiment).where(eq(cryptoSentiment.coinId, found.coin.id)).orderBy(desc(cryptoSentiment.timestamp)).limit(1);
  if (!row || Date.now() - row.timestamp.getTime() > 15 * 60_000) return updateCryptoSentiment(symbol);
  return { score: row.sentiment, label: row.sentiment > .3 ? "Tích cực" : row.sentiment < -.3 ? "Tiêu cực" : "Trung lập", ...(row.details ?? {}), timestamp: row.timestamp };
}

export async function runCryptoAnalysis(symbol: string, timeframe = "1h") {
  const [{ coin, bars }, sentiment] = await Promise.all([syncCryptoOhlcv(symbol, timeframe, 300), getLatestCryptoSentiment(symbol).catch(() => ({ score: 0 }))]);
  const result = analyzeCrypto(bars, Number(sentiment.score));
  await db.insert(cryptoAnalysis).values({ coinId: coin.id, timeframe, technicalSignals: result.indicators, patterns: { candlestick: result.candlestickPatterns, chart: result.chartPatterns }, recommendation: result.recommendation, entryPrice: result.entryPrice, stopLoss: result.stopLoss, takeProfit: result.takeProfit, confidence: result.confidence, reason: result.reasons.join("; "), timestamp: new Date() });
  return { symbol: coin.symbol, timeframe, sentiment: Number(sentiment.score), ...result, disclaimer: "Chỉ là tín hiệu định lượng tham khảo, không phải lời khuyên đầu tư." };
}

export { POPULAR };
