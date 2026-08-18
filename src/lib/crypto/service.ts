import { desc, eq, ilike, or, sql } from "drizzle-orm";
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
import { analyzeCrypto, cryptoSentimentScore } from "./analysis";
import { forProvider } from "@/lib/logger";

const log = forProvider("crypto-service");

const BINANCE_SOURCE = "binance-crypto";

const POPULAR = [
  "BTC",
  "ETH",
  "BNB",
  "SOL",
  "XRP",
  "DOGE",
  "ADA",
  "TRX",
  "AVAX",
  "LINK",
  "DOT",
  "LTC",
  "BCH",
  "SUI",
  "TON",
];

interface CryptoSyncResult {
  source: string;
  coins: number;
  prices: number;
  timestamp: Date;
  durationMs: number;
}

/* -------------------------------------------------------------------------- */
/*                                  RUNTIME CACHE                             */
/* -------------------------------------------------------------------------- */

/*
 * Các cache này nằm trong memory của server instance.
 *
 * Trên Vercel, mỗi serverless instance có memory riêng.
 * Vì vậy cache không thay thế database/Redis, nhưng vẫn giảm rất nhiều
 * request lặp lại trong cùng một instance.
 */

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

const OHLCV_CACHE_TTL = 30_000;
const PROFILE_CACHE_TTL = 30 * 60_000;
const SENTIMENT_CACHE_TTL = 15 * 60_000;

const ohlcvCache = new Map<string, CacheEntry<any[]>>();

const profileCache = new Map<
  string,
  CacheEntry<Awaited<ReturnType<typeof getCryptoCoin>>>
>();

const sentimentCache = new Map<
  string,
  CacheEntry<{
    score: number;
    label: string;
    articles?: unknown[];
    timestamp: Date;
  }>
>();

/*
 * Tránh nhiều request cùng lúc cùng sync toàn bộ market.
 */
const syncPromises: Record<
  "market" | "catalog",
  Promise<CryptoSyncResult> | null
> = {
  market: null,
  catalog: null,
};

/*
 * Cache thời điểm market sync cuối cùng trong server instance.
 */
let lastMarketSyncAt = 0;

/* -------------------------------------------------------------------------- */
/*                              SMALL UTILITIES                               */
/* -------------------------------------------------------------------------- */

function cacheIsFresh<T>(
  entry: CacheEntry<T> | undefined,
  ttl: number,
) {
  return Boolean(
    entry && Date.now() - entry.timestamp < ttl,
  );
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

function normalizeLimit(limit: number, min = 20, max = 1000) {
  return Math.min(
    max,
    Math.max(min, Number.isFinite(limit) ? Math.floor(limit) : min),
  );
}

/* -------------------------------------------------------------------------- */
/*                                USD / VND                                   */
/* -------------------------------------------------------------------------- */

async function usdVndRate() {
  const [row] = await db
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.currency, "USD"))
    .orderBy(desc(exchangeRates.date))
    .limit(1);

  return row?.rate ?? null;
}

/* -------------------------------------------------------------------------- */
/*                              MARKET SYNC                                   */
/* -------------------------------------------------------------------------- */

export async function syncCryptoMarket(
  limit = 100,
  syncAllCoins = false,
) {
  const safeLimit = Math.min(
    250,
    Math.max(1, Math.floor(limit)),
  );

  const key = syncAllCoins ? "catalog" : "market";

  if (syncPromises[key]) {
    return syncPromises[key]!;
  }

  syncPromises[key] = (async () => {
    const started = Date.now();

    /*
     * Binance coins + tickers được gọi song song.
     *
     * connectors.ts đã hỗ trợ Promise.all ở tầng provider.
     */
    const market = await fetchCryptoMarketsWithFallback(
      safeLimit,
    );

    const tickerMap = new Map(
      market.prices.map((price) => [
        normalizeSymbol(price.symbol),
        price,
      ]),
    );

    const coinMap = new Map(
      market.coins.map((coin) => [
        normalizeSymbol(coin.symbol),
        coin,
      ]),
    );

    /*
     * Khi syncAllCoins=true:
     * lưu toàn bộ catalog.
     *
     * Khi sync market bình thường:
     * chỉ lưu các coin có ticker nằm trong top volume.
     */
    const selectedCoins = syncAllCoins
      ? market.coins
      : market.prices
          .map((price) =>
            coinMap.get(normalizeSymbol(price.symbol)),
          )
          .filter(
            (
              coin,
            ): coin is NonNullable<typeof coin> =>
              Boolean(coin),
          )
          .slice(0, safeLimit);

    if (!selectedCoins.length) {
      throw new Error(
        "Crypto market returned no usable coins",
      );
    }

    /*
     * ----------------------------------------------------------
     * BATCH UPSERT COINS
     * ----------------------------------------------------------
     *
     * Code cũ:
     *
     * for (...)
     *   await db.insert(...)
     *
     * = N database round trips.
     *
     * Code mới:
     *
     * 1 batch insert/update.
     */
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

    /*
     * USD/VND rate chỉ query một lần.
     */
    const rate = await usdVndRate().catch(
      () => null,
    );

    /*
     * Một timestamp chung cho toàn bộ snapshot.
     */
    const timestamp = new Date(
      Math.floor(Date.now() / 5000) * 5000,
    );

    /*
     * ----------------------------------------------------------
     * BATCH UPSERT PRICES
     * ----------------------------------------------------------
     */
    const priceValues = coinRows
      .map((coin) => {
        const price = tickerMap.get(
          normalizeSymbol(coin.symbol),
        );

        if (!price) {
          return null;
        }

        return {
          coinId: coin.id,
          price: price.price,
          priceVnd: rate
            ? price.price * rate
            : null,
          volume24h: price.volume24h,
          marketCap: price.marketCap,
          change24h: price.change24h,
          source: market.source,
          timestamp,
        };
      })
      .filter(
        (
          value,
        ): value is NonNullable<typeof value> =>
          Boolean(value),
      );

    if (priceValues.length) {
      await db
        .insert(cryptoPrices)
        .values(priceValues)
        .onConflictDoUpdate({
          target: [
            cryptoPrices.coinId,
            cryptoPrices.timestamp,
          ],
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

    const durationMs = Date.now() - started;

    log.info("crypto_market_synced", {
      source: market.source,
      coins: coinRows.length,
      prices: priceValues.length,
      durationMs,
    });

    return {
      source: market.source,
      coins: coinRows.length,
      prices: priceValues.length,
      timestamp,
      durationMs,
    };
  })().finally(() => {
    syncPromises[key] = null;
  });

  return syncPromises[key]!;
}

/* -------------------------------------------------------------------------- */
/*                              FRESHNESS                                     */
/* -------------------------------------------------------------------------- */

export async function ensureCryptoFresh(
  maxAgeMs = 15_000,
) {
  /*
   * Nếu server instance vừa sync market thì không cần query DB
   * MAX(created_at) thêm lần nữa.
   */
  if (
    lastMarketSyncAt > 0 &&
    Date.now() - lastMarketSyncAt <= maxAgeMs
  ) {
    return {
      refreshed: false,
      latestAt: new Date(
        lastMarketSyncAt,
      ).toISOString(),
    };
  }

  const result = await db.execute(
    sql`
      SELECT MAX(created_at) AS latest
      FROM crypto_prices
    `,
  );

  const raw = (
    result.rows[0] as {
      latest?: Date | string | null;
    } | undefined
  )?.latest;

  const latest = raw
    ? new Date(raw).getTime()
    : 0;

  if (
    !latest ||
    Date.now() - latest > maxAgeMs
  ) {
    const refreshed =
      await syncCryptoMarket(100);

    return {
      refreshed: true,
      ...refreshed,
    };
  }

  lastMarketSyncAt = latest;

  return {
    refreshed: false,
    latestAt: new Date(
      latest,
    ).toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/*                              LIST COINS                                    */
/* -------------------------------------------------------------------------- */

export async function listCryptoCoins(
  opts: {
    search?: string;
    page?: number;
    limit?: number;
  } = {},
) {
  const page = Math.max(
    1,
    opts.page ?? 1,
  );

  const limit = Math.min(
    100,
    Math.max(1, opts.limit ?? 30),
  );

  const search = opts.search?.trim();

  const condition = search
    ? or(
        ilike(
          cryptoCoins.symbol,
          `%${search}%`,
        ),
        ilike(
          cryptoCoins.name,
          `%${search}%`,
        ),
      )
    : undefined;

  const rows = await db
    .select()
    .from(cryptoCoins)
    .where(condition)
    .orderBy(
      sql`${cryptoCoins.marketCapRank} asc nulls last`,
      cryptoCoins.symbol,
    )
    .limit(limit)
    .offset((page - 1) * limit);

  const [{ count }] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(cryptoCoins)
    .where(condition);

  return {
    coins: rows,
    total: count,
    page,
    limit,
  };
}

/* -------------------------------------------------------------------------- */
/*                              LATEST PRICES                                 */
/* -------------------------------------------------------------------------- */

export async function latestCryptoPrices(
  limit = 100,
) {
  const safeLimit = Math.min(
    250,
    Math.max(1, Math.floor(limit)),
  );

  const result = await db.execute(
    sql`
      WITH latest AS (
        SELECT DISTINCT ON (c.id)
          c.symbol,
          c.name,
          c.logo_url AS "logoUrl",
          c.market_cap_rank AS "marketCapRank",
          p.price,
          p.price_vnd AS "priceVnd",
          p.volume_24h AS "volume24h",
          p.market_cap AS "marketCap",
          p.change_24h AS "change24h",
          p.source,
          p.timestamp
        FROM crypto_coins c
        JOIN crypto_prices p
          ON p.coin_id = c.id
        ORDER BY
          c.id,
          p.timestamp DESC
      )
      SELECT *
      FROM latest
      ORDER BY
        "volume24h" DESC NULLS LAST
      LIMIT ${safeLimit}
    `,
  );

  return result.rows;
}

/* -------------------------------------------------------------------------- */
/*                              SINGLE COIN                                   */
/* -------------------------------------------------------------------------- */

export async function getCryptoCoin(
  symbol: string,
) {
  const normalized = normalizeSymbol(symbol);

  const [coin] = await db
    .select()
    .from(cryptoCoins)
    .where(
      eq(
        cryptoCoins.symbol,
        normalized,
      ),
    )
    .limit(1);

  if (!coin) {
    return null;
  }

  const [price] = await db
    .select()
    .from(cryptoPrices)
    .where(
      eq(
        cryptoPrices.coinId,
        coin.id,
      ),
    )
    .orderBy(
      desc(cryptoPrices.timestamp),
    )
    .limit(1);

  return {
    coin,
    price,
  };
}

/* -------------------------------------------------------------------------- */
/*                          ENRICH CRYPTO PROFILE                             */
/* -------------------------------------------------------------------------- */

export async function enrichCryptoProfile(
  symbol: string,
) {
  const normalized = normalizeSymbol(symbol);

  /*
   * Profile cache giúp tránh gọi CoinGecko mỗi lần mở trang.
   */
  const cached =
    profileCache.get(normalized);

  if (
    cached &&
    cacheIsFresh(
      cached,
      PROFILE_CACHE_TTL,
    )
  ) {
    return cached.value;
  }

  let existing =
    await getCryptoCoin(normalized);

  /*
   * Chỉ sync market nếu coin chưa tồn tại.
   *
   * Không gọi ensureCryptoFresh() ở đây.
   */
  if (!existing) {
    await syncCryptoMarket();
    existing =
      await getCryptoCoin(normalized);
  }

  if (!existing) {
    return null;
  }

  let id =
    existing.coin.coingeckoId;

  /*
   * Nếu chưa có CoinGecko ID:
   * chỉ tìm một lần rồi cache profile.
   */
  if (!id) {
    try {
      const gecko =
        await fetchCoinGeckoMarkets(
          150,
        );

      const match =
        gecko.coins.find(
          (coin) =>
            normalizeSymbol(
              coin.symbol,
            ) === normalized,
        );

      if (match?.coingeckoId) {
        id = match.coingeckoId;

        await db
          .update(cryptoCoins)
          .set({
            coingeckoId: id,
            name: match.name,
            logoUrl: match.logoUrl,
            marketCapRank:
              match.rank,
            circulatingSupply:
              match.circulatingSupply,
            totalSupply:
              match.totalSupply,
            maxSupply:
              match.maxSupply,
            updatedAt:
              new Date(),
          })
          .where(
            eq(
              cryptoCoins.id,
              existing.coin.id,
            ),
          );
      }
    } catch {
      /*
       * Binance data vẫn có thể sử dụng.
       */
    }
  }

  /*
   * Chỉ gọi CoinGecko detail khi thiếu profile.
   */
  if (
    id &&
    (
      !existing.coin.description ||
      !existing.coin.website
    )
  ) {
    try {
      const profile =
        await fetchCoinGeckoProfile(
          id,
        );

      await db
        .update(cryptoCoins)
        .set({
          name: profile.name,
          website:
            profile.website,
          description:
            profile.description,
          logoUrl:
            profile.logoUrl,
          marketCapRank:
            profile.rank,
          circulatingSupply:
            profile.circulatingSupply,
          totalSupply:
            profile.totalSupply,
          maxSupply:
            profile.maxSupply,
          updatedAt:
            new Date(),
        })
        .where(
          eq(
            cryptoCoins.id,
            existing.coin.id,
          ),
        );
    } catch {
      /*
       * Không fail toàn bộ request chỉ vì CoinGecko.
       */
    }
  }

  const result =
    await getCryptoCoin(normalized);

  profileCache.set(
    normalized,
    {
      value: result,
      timestamp: Date.now(),
    },
  );

  return result;
}

/* -------------------------------------------------------------------------- */
/*                              OHLCV CACHE                                   */
/* -------------------------------------------------------------------------- */

export async function syncCryptoOhlcv(
  symbol: string,
  timeframe = "1h",
  limit = 200,
) {
  const normalized =
    normalizeSymbol(symbol);

  const safeLimit =
    normalizeLimit(
      limit,
      20,
      1000,
    );

  const cacheKey =
    `${normalized}:${timeframe}:${safeLimit}`;

  /*
   * ----------------------------------------------------------
   * CACHE HIT
   * ----------------------------------------------------------
   */
  const cached =
    ohlcvCache.get(cacheKey);

  if (
    cached &&
    cacheIsFresh(
      cached,
      OHLCV_CACHE_TTL,
    )
  ) {
    const found =
      await getCryptoCoin(
        normalized,
      );

    if (found?.coin) {
      return {
        coin: found.coin,
        bars: cached.value,
        source:
          BINANCE_SOURCE,
      };
    }
  }

  /*
   * ----------------------------------------------------------
   * GET COIN
   * ----------------------------------------------------------
   */
  let found =
    await getCryptoCoin(
      normalized,
    );

  if (!found) {
    await syncCryptoMarket();

    found =
      await getCryptoCoin(
        normalized,
      );
  }

  if (
    !found?.coin.binanceSymbol
  ) {
    throw new Error(
      `${normalized} has no Binance USDT pair`,
    );
  }

  /*
   * ----------------------------------------------------------
   * BINANCE KLINES
   * ----------------------------------------------------------
   *
   * Lấy trực tiếp từ Binance.
   *
   * Không ghi 200-300 rows vào DB
   * ở mỗi request.
   */
  const bars =
    await fetchBinanceKlines(
      found.coin.binanceSymbol,
      timeframe,
      safeLimit,
    );

  /*
   * Cache kết quả.
   */
  ohlcvCache.set(
    cacheKey,
    {
      value: bars,
      timestamp: Date.now(),
    },
  );

  return {
    coin: found.coin,
    bars,
    source:
      BINANCE_SOURCE,
  };
}

/* -------------------------------------------------------------------------- */
/*                              GET OHLCV                                     */
/* -------------------------------------------------------------------------- */

export async function getCryptoOhlcv(
  symbol: string,
  timeframe: string,
  limit: number,
) {
  return syncCryptoOhlcv(
    symbol,
    timeframe,
    limit,
  );
}

/* -------------------------------------------------------------------------- */
/*                              SENTIMENT                                     */
/* -------------------------------------------------------------------------- */

export async function updateCryptoSentiment(
  symbol: string,
) {
  const normalized =
    normalizeSymbol(symbol);

  const found =
    await getCryptoCoin(
      normalized,
    );

  if (!found) {
    throw new Error(
      "Coin not found",
    );
  }

  const news =
    await fetchCryptoNews();

  const needle = [
    found.coin.symbol.toLowerCase(),
    found.coin.name.toLowerCase(),
    found.coin.binanceSymbol
      ?.toLowerCase()
      .replace("usdt", ""),
  ].filter(Boolean) as string[];

  const relevant =
    news
      .filter((item) => {
        const text =
          `${item.title} ${item.summary}`;

        return needle.some(
          (value) =>
            text
              .toLowerCase()
              .includes(
                value,
              ),
        );
      })
      .slice(0, 30);

  const sourceNews =
    relevant.length
      ? relevant
      : news.slice(0, 15);

  const score =
    cryptoSentimentScore(
      sourceNews.map(
        (item) =>
          `${item.title} ${item.summary}`,
      ),
    );

  const timestamp =
    new Date();

  const articles =
    relevant.slice(0, 10);

  await db
    .insert(cryptoSentiment)
    .values({
      coinId:
        found.coin.id,
      sentiment: score,
      source:
        "coindesk+cointelegraph-rss",
      details: {
        articles,
        relevantCount:
          relevant.length,
      },
      timestamp,
    });

  const result = {
    score,
    label:
      score > 0.3
        ? "Tích cực"
        : score < -0.3
          ? "Tiêu cực"
          : "Trung lập",
    articles,
    timestamp,
  };

  sentimentCache.set(
    normalized,
    {
      value: result,
      timestamp: Date.now(),
    },
  );

  return result;
}

/* -------------------------------------------------------------------------- */
/*                          LATEST SENTIMENT                                  */
/* -------------------------------------------------------------------------- */

export async function getLatestCryptoSentiment(
  symbol: string,
) {
  const normalized =
    normalizeSymbol(symbol);

  /*
   * Memory cache.
   */
  const cached =
    sentimentCache.get(
      normalized,
    );

  if (
    cached &&
    cacheIsFresh(
      cached,
      SENTIMENT_CACHE_TTL,
    )
  ) {
    return cached.value;
  }

  const found =
    await getCryptoCoin(
      normalized,
    );

  if (!found) {
    return updateCryptoSentiment(
      normalized,
    );
  }

  const [row] =
    await db
      .select()
      .from(cryptoSentiment)
      .where(
        eq(
          cryptoSentiment.coinId,
          found.coin.id,
        ),
      )
      .orderBy(
        desc(
          cryptoSentiment.timestamp,
        ),
      )
      .limit(1);

  /*
   * DB sentiment còn mới:
   * không gọi RSS.
   */
  if (
    row &&
    Date.now() -
      row.timestamp.getTime() <
      SENTIMENT_CACHE_TTL
  ) {
    const result = {
      score: row.sentiment,
      label:
        row.sentiment > 0.3
          ? "Tích cực"
          : row.sentiment < -0.3
            ? "Tiêu cực"
            : "Trung lập",
      ...(row.details ?? {}),
      timestamp:
        row.timestamp,
    };

    sentimentCache.set(
      normalized,
      {
        value:
          result as {
            score: number;
            label: string;
            articles?: unknown[];
            timestamp: Date;
          },
        timestamp: Date.now(),
      },
    );

    return result;
  }

  /*
   * Chỉ gọi RSS khi cache/DB đã hết hạn.
   */
  return updateCryptoSentiment(
    normalized,
  );
}

/* -------------------------------------------------------------------------- */
/*                             CRYPTO ANALYSIS                                */
/* -------------------------------------------------------------------------- */

export async function runCryptoAnalysis(
  symbol: string,
  timeframe = "1h",
) {
  /*
   * OHLCV + sentiment chạy song song.
   *
   * OHLCV sử dụng cache.
   * Sentiment sử dụng cache 15 phút.
   */
  const [ohlcv, sentiment] =
    await Promise.all([
      syncCryptoOhlcv(
        symbol,
        timeframe,
        200,
      ),
      getLatestCryptoSentiment(
        symbol,
      ).catch(() => ({
        score: 0,
      })),
    ]);

  const result =
    analyzeCrypto(
      ohlcv.bars,
      Number(
        sentiment.score,
      ),
    );

  await db
    .insert(cryptoAnalysis)
    .values({
      coinId:
        ohlcv.coin.id,
      timeframe,
      technicalSignals:
        result.indicators,
      patterns: {
        candlestick:
          result.candlestickPatterns,
        chart:
          result.chartPatterns,
      },
      recommendation:
        result.recommendation,
      entryPrice:
        result.entryPrice,
      stopLoss:
        result.stopLoss,
      takeProfit:
        result.takeProfit,
      confidence:
        result.confidence,
      reason:
        result.reasons.join(
          "; ",
        ),
      timestamp:
        new Date(),
    });

  return {
    symbol:
      ohlcv.coin.symbol,
    timeframe,
    sentiment:
      Number(
        sentiment.score,
      ),
    ...result,
    disclaimer:
      "Chỉ là tín hiệu định lượng tham khảo, không phải lời khuyên đầu tư.",
  };
}

/* -------------------------------------------------------------------------- */
/*                                   EXPORTS                                  */
/* -------------------------------------------------------------------------- */

export {
  POPULAR,
};
