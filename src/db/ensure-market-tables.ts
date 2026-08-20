import { pool } from "@/db";

/**
 * Idempotent DDL for market-data tables used by forex, crypto, commodities.
 * Same rationale as ensure-auth-tables: build-time drizzle push may miss
 * the runtime DATABASE_URL.
 */
let ensured = false;
let ensurePromise: Promise<void> | null = null;

const DDL = `
-- Enums (safe if already exist)
DO $$ BEGIN
  CREATE TYPE impact_type AS ENUM ('positive', 'negative', 'neutral');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE commodity_group AS ENUM (
    'precious_metals', 'industrial_metals', 'energy', 'agriculture',
    'livestock', 'dairy', 'rubber', 'fertilizer'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Crypto ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crypto_coins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol varchar(20) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  binance_symbol varchar(30) UNIQUE,
  coingecko_id varchar(120),
  coinpaprika_id varchar(120),
  market_cap_rank integer,
  website text,
  description text,
  logo_url text,
  circulating_supply double precision,
  total_supply double precision,
  max_supply double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crypto_coins_rank_idx ON crypto_coins (market_cap_rank);
CREATE INDEX IF NOT EXISTS crypto_coins_binance_idx ON crypto_coins (binance_symbol);

CREATE TABLE IF NOT EXISTS crypto_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coin_id uuid NOT NULL REFERENCES crypto_coins(id) ON DELETE CASCADE,
  price double precision NOT NULL,
  price_vnd double precision,
  volume_24h double precision,
  market_cap double precision,
  change_24h double precision,
  source varchar(40) NOT NULL,
  timestamp timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crypto_prices_coin_time_uq ON crypto_prices (coin_id, timestamp);
CREATE INDEX IF NOT EXISTS crypto_prices_time_idx ON crypto_prices (timestamp);

CREATE TABLE IF NOT EXISTS crypto_ohlcv (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coin_id uuid NOT NULL REFERENCES crypto_coins(id) ON DELETE CASCADE,
  timeframe varchar(8) NOT NULL,
  time timestamptz NOT NULL,
  open double precision NOT NULL,
  high double precision NOT NULL,
  low double precision NOT NULL,
  close double precision NOT NULL,
  volume double precision NOT NULL,
  source varchar(40) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS crypto_ohlcv_coin_tf_time_uq ON crypto_ohlcv (coin_id, timeframe, time);
CREATE INDEX IF NOT EXISTS crypto_ohlcv_lookup_idx ON crypto_ohlcv (coin_id, timeframe, time);

CREATE TABLE IF NOT EXISTS crypto_sentiment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coin_id uuid NOT NULL REFERENCES crypto_coins(id) ON DELETE CASCADE,
  sentiment double precision NOT NULL,
  source varchar(40) NOT NULL,
  details jsonb,
  timestamp timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crypto_sentiment_lookup_idx ON crypto_sentiment (coin_id, timestamp);

CREATE TABLE IF NOT EXISTS crypto_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coin_id uuid NOT NULL REFERENCES crypto_coins(id) ON DELETE CASCADE,
  timeframe varchar(8) NOT NULL DEFAULT '1h',
  technical_signals jsonb NOT NULL,
  patterns jsonb,
  recommendation varchar(20) NOT NULL,
  entry_price double precision,
  stop_loss double precision,
  take_profit double precision,
  confidence double precision,
  reason text,
  timestamp timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crypto_analysis_lookup_idx ON crypto_analysis (coin_id, timeframe, timestamp);

-- ── Forex ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forex_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol varchar(20) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  category varchar(30) NOT NULL,
  base_currency varchar(10) NOT NULL,
  quote_currency varchar(10) NOT NULL,
  yahoo_symbol varchar(30),
  source varchar(40),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forex_pairs_category_idx ON forex_pairs (category);

CREATE TABLE IF NOT EXISTS forex_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id uuid NOT NULL REFERENCES forex_pairs(id) ON DELETE CASCADE,
  price double precision NOT NULL,
  bid double precision,
  ask double precision,
  change double precision,
  change_percent double precision,
  source varchar(40) NOT NULL,
  timestamp timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS forex_prices_pair_time_uq ON forex_prices (pair_id, timestamp);
CREATE INDEX IF NOT EXISTS forex_prices_time_idx ON forex_prices (timestamp);

CREATE TABLE IF NOT EXISTS forex_ohlcv (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id uuid NOT NULL REFERENCES forex_pairs(id) ON DELETE CASCADE,
  timeframe varchar(8) NOT NULL,
  time timestamptz NOT NULL,
  open double precision NOT NULL,
  high double precision NOT NULL,
  low double precision NOT NULL,
  close double precision NOT NULL,
  volume double precision,
  source varchar(40) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS forex_ohlcv_pair_tf_time_uq ON forex_ohlcv (pair_id, timeframe, time);
CREATE INDEX IF NOT EXISTS forex_ohlcv_lookup_idx ON forex_ohlcv (pair_id, timeframe, time);

CREATE TABLE IF NOT EXISTS forex_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id uuid NOT NULL REFERENCES forex_pairs(id) ON DELETE CASCADE,
  timeframe varchar(8) NOT NULL DEFAULT '1h',
  technical_signals jsonb NOT NULL,
  patterns jsonb,
  recommendation varchar(20) NOT NULL,
  entry_price double precision,
  stop_loss double precision,
  take_profit double precision,
  confidence double precision,
  reason text,
  timestamp timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forex_analysis_lookup_idx ON forex_analysis (pair_id, timeframe, timestamp);

-- ── Commodities ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  currency varchar(3) NOT NULL,
  rate double precision NOT NULL,
  source varchar(50) NOT NULL DEFAULT 'sbv',
  date timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS exchange_rates_currency_date_uq ON exchange_rates (currency, date);
CREATE INDEX IF NOT EXISTS exchange_rates_date_idx ON exchange_rates (date);

CREATE TABLE IF NOT EXISTS commodities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol varchar(30) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  name_en varchar(200),
  "group" commodity_group NOT NULL,
  unit varchar(50) NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'VND',
  source varchar(100),
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commodities_group_idx ON commodities ("group");
CREATE INDEX IF NOT EXISTS commodities_active_idx ON commodities (is_active);

CREATE TABLE IF NOT EXISTS commodity_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id uuid NOT NULL REFERENCES commodities(id),
  price double precision NOT NULL,
  price_vnd double precision NOT NULL,
  currency_rate double precision,
  prev_close double precision,
  change_pct_1d double precision,
  change_pct_7d double precision,
  change_pct_30d double precision,
  change_pct_ytd double precision,
  change_pct_1y double precision,
  high_52w double precision,
  low_52w double precision,
  date timestamptz NOT NULL,
  source varchar(100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS commodity_prices_commodity_date_uq ON commodity_prices (commodity_id, date);
CREATE INDEX IF NOT EXISTS commodity_prices_date_idx ON commodity_prices (date);

CREATE TABLE IF NOT EXISTS commodity_stock_impact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id uuid NOT NULL REFERENCES commodities(id),
  symbol varchar(20) NOT NULL,
  impact_type impact_type NOT NULL,
  impact_score double precision NOT NULL,
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS commodity_stock_impact_commodity_symbol_uq ON commodity_stock_impact (commodity_id, symbol);
CREATE INDEX IF NOT EXISTS commodity_stock_impact_symbol_idx ON commodity_stock_impact (symbol);
`;

export async function ensureMarketTables(): Promise<void> {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const client = await pool.connect();
    try {
      await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
      await client.query(DDL);
      ensured = true;
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "info",
          provider: "database",
          msg: "market_tables_ensured",
        }),
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          provider: "database",
          msg: "market_tables_ensure_failed",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      throw err;
    } finally {
      client.release();
      ensurePromise = null;
    }
  })();

  return ensurePromise;
}
