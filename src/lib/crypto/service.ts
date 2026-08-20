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
import { forProvider } from "@/lib/logger";
import type { Ohlcv } from "@/lib/connectors/core";

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

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

/**
 * Explicit type for getCryptoCoin() result.
 *
 * This avoids circular TypeScript inference:
 *
 * coinCache -> ReturnType<typeof getCryptoCoin>
 * getCryptoCoin -> coinCache
 *
 * The previous implementation caused:
 * "coinCache implicitly has type any because it does not
 * have a type annotation and is referenced directly or
 * indirectly in its own initializer."
 */
type CryptoCoinDetail =
  | {
      coin: typeof cryptoCoins.$inferSelect;
      price:
        | typeof cryptoPrices.$inferSelect
        | undefined;
    }
  | null;

/**
 * Short in-memory cache.
 *
 * These caches are intentionally short because market data is dynamic.
 * They reduce duplicate PostgreSQL work inside the same warm Vercel
 * function instance without making the UI visibly stale.
 */
const FRESHNESS_CACHE_TTL = 5_000;
const LATEST_PRICES_CACHE_TTL = 5_000;
const COIN_CACHE_TTL = 3_000;
const USD_VND_CACHE_TTL = 10 * 60_000;

/** Soft TTL — serve from DB immediately; hard TTL forces network refresh. */
const OHLCV_SOFT_TTL: Record<string, number> = {
  "1m": 15_000,
  "5m": 30_000,
  "15m": 60_000,
  "1h": 120_000,
  "4h": 300_000,
  "1d": 900_000,
};

const OHLCV_HARD_TTL: Record<string, number> = {
  "1m": 60_000,
  "5m": 120_000,
  "15m": 300_000,
  "1h": 600_000,
  "4h": 1_800_000,
  "1d": 3_600_000,
};

const PROFILE_CACHE_TTL = 30 * 60_000;
const SENTIMENT_CACHE_TTL = 15 * 60_000;

const profileCache = new Map<
  string,
  CacheEntry<CryptoCoinDetail>
>();

const sentimentCache = new Map<
  string,
  CacheEntry<{
    score: number;
    label: string;
    articles?: unknown[];
    source?: string;
    model?: string;
    confidence?: number;
    rationale?: string;
    timestamp: Date;
  }>
>();

const coinCache = new Map<
  string,
  CacheEntry<CryptoCoinDetail>
>();

const latestPricesCache = new Map<
  number,
  CacheEntry<unknown[]>
>();

let freshnessCache:
  | CacheEntry<{
      refreshed: boolean;
      latestAt?: string;
      source?: string;
      coins?: number;
      prices?: number;
      timestamp?: Date;
      durationMs?: number;
    }>
  | null = null;

let usdVndCache:
  | CacheEntry<number | null>
  | null = null;

const syncPromises: Record<
  "market" | "catalog",
  Promise<CryptoSyncResult> | null
> = {
  market: null,
  catalog: null,
};

let lastMarketSyncAt = 0;

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

function normalizeLimit(
  limit: number,
  min = 20,
  max = 1000,
) {
  return Math.min(
    max,
    Math.max(
      min,
      Number.isFinite(limit)
        ? Math.floor(limit)
        : min,
    ),
  );
}

function clearMarketCaches() {
  freshnessCache = null;
  latestPricesCache.clear();
  coinCache.clear();
}

async function usdVndRate() {
  if (
    usdVndCache &&
    Date.now() - usdVndCache.timestamp < USD_VND_CACHE_TTL
  ) {
    return usdVndCache.value;
  }

  const [row] = await db
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.currency, "USD"))
    .orderBy(desc(exchangeRates.date))
    .limit(1);

  const rate = row?.rate ?? null;

  usdVndCache = {
    value: rate,
    timestamp: Date.now(),
  };

  return rate;
}

export async function syncCryptoMarket(
  limit = 100,
  syncAllCoins = false,
) {
  const safeLimit = Math.min(
    250,
    Math.max(1, Math.floor(limit)),
  );

  const key = syncAllCoins
    ? "catalog"
    : "market";

  if (syncPromises[key]) {
    return syncPromises[key]!;
  }

  syncPromises[key] = (async () => {
    const started = Date.now();

    const market =
      await fetchCryptoMarketsWithFallback(
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

    const selectedCoins = syncAllCoins
      ? market.coins
      : market.prices
          .map((price) =>
            coinMap.get(
              normalizeSymbol(price.symbol),
            ),
          )
          .filter(
            (
              coin,
            ): coin is NonNullable<
              typeof coin
            > => Boolean(coin),
          )
          .slice(0, safeLimit);

    if (!selectedCoins.length) {
      throw new Error(
        "Crypto market returned no usable coins",
      );
    }

    const coinValues = selectedCoins.map(
      (coin) => ({
        symbol: normalizeSymbol(coin.symbol),
        name: coin.name,
        binanceSymbol: coin.binanceSymbol,
        coingeckoId: coin.coingeckoId,
        coinpaprikaId: coin.coinpaprikaId,
        marketCapRank: coin.rank,
        logoUrl: coin.logoUrl,
        circulatingSupply:
          coin.circulatingSupply,
        totalSupply: coin.totalSupply,
        maxSupply: coin.maxSupply,
      }),
    );

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
          circulatingSupply:
            sql`excluded.circulating_supply`,
          totalSupply:
            sql`excluded.total_supply`,
          maxSupply:
            sql`excluded.max_supply`,
          updatedAt: new Date(),
        },
      })
      .returning();

    const rate =
      await usdVndRate().catch(() => null);

    const timestamp = new Date(
      Math.floor(Date.now() / 5000) * 5000,
    );

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
        ): value is NonNullable<
          typeof value
        > => Boolean(value),
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
            priceVnd:
              sql`excluded.price_vnd`,
            volume24h:
              sql`excluded.volume_24h`,
            marketCap:
              sql`excluded.market_cap`,
            change24h:
              sql`excluded.change_24h`,
            source:
              sql`excluded.source`,
          },
        });
    }

    lastMarketSyncAt = Date.now();

    clearMarketCaches();

    const durationMs =
      Date.now() - started;

    log.info(
      "crypto_market_synced",
      {
        source: market.source,
        coins: coinRows.length,
        prices: priceValues.length,
        durationMs,
      },
    );

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

export async function ensureCryptoFresh(
  maxAgeMs = 15_000,
) {
  if (
    freshnessCache &&
    Date.now() -
      freshnessCache.timestamp <
      FRESHNESS_CACHE_TTL
  ) {
    return freshnessCache.value;
  }

  if (
    lastMarketSyncAt > 0 &&
    Date.now() - lastMarketSyncAt <=
      maxAgeMs
  ) {
    const result = {
      refreshed: false,
      latestAt:
        new Date(
          lastMarketSyncAt,
        ).toISOString(),
    };

    freshnessCache = {
      value: result,
      timestamp: Date.now(),
    };

    return result;
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

    const value = {
      refreshed: true,
      ...refreshed,
    };

    freshnessCache = {
      value,
      timestamp: Date.now(),
    };

    return value;
  }

  lastMarketSyncAt = latest;

  const value = {
    refreshed: false,
    latestAt:
      new Date(latest).toISOString(),
  };

  freshnessCache = {
    value,
    timestamp: Date.now(),
  };

  return value;
}

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

  const search =
    opts.search?.trim();

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
    .offset(
      (page - 1) * limit,
    );

  const [{ count }] = await db
    .select({
      count:
        sql<number>`count(*)::int`,
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

export async function latestCryptoPrices(
  limit = 100,
) {
  const safeLimit = Math.min(
    250,
    Math.max(
      1,
      Math.floor(limit),
    ),
  );

  const cached =
    latestPricesCache.get(
      safeLimit,
    );

  if (
    cached &&
    Date.now() - cached.timestamp <
      LATEST_PRICES_CACHE_TTL
  ) {
    return cached.value;
  }

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

  latestPricesCache.set(
    safeLimit,
    {
      value: result.rows,
      timestamp: Date.now(),
    },
  );

  return result.rows;
}

export async function getCryptoCoin(
  symbol: string,
) {
  const normalized =
    normalizeSymbol(symbol);

  const cached =
    coinCache.get(normalized);

  if (
    cached &&
    Date.now() - cached.timestamp <
      COIN_CACHE_TTL
  ) {
    return cached.value;
  }

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
    coinCache.set(normalized, {
      value: null,
      timestamp: Date.now(),
    });

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
      desc(
        cryptoPrices.timestamp,
      ),
    )
    .limit(1);

  const result = {
    coin,
    price,
  };

  coinCache.set(normalized, {
    value: result,
    timestamp: Date.now(),
  });

  return result;
}