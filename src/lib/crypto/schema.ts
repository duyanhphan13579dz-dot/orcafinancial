import { doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const cryptoCoins = pgTable("crypto_coins", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: varchar("symbol", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  binanceSymbol: varchar("binance_symbol", { length: 30 }).unique(),
  coingeckoId: varchar("coingecko_id", { length: 120 }),
  coinpaprikaId: varchar("coinpaprika_id", { length: 120 }),
  marketCapRank: integer("market_cap_rank"),
  website: text("website"),
  description: text("description"),
  logoUrl: text("logo_url"),
  circulatingSupply: doublePrecision("circulating_supply"),
  totalSupply: doublePrecision("total_supply"),
  maxSupply: doublePrecision("max_supply"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crypto_coins_rank_idx").on(t.marketCapRank), index("crypto_coins_binance_idx").on(t.binanceSymbol)]);

export const cryptoPrices = pgTable("crypto_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  coinId: uuid("coin_id").notNull().references(() => cryptoCoins.id, { onDelete: "cascade" }),
  price: doublePrecision("price").notNull(),
  priceVnd: doublePrecision("price_vnd"),
  volume24h: doublePrecision("volume_24h"),
  marketCap: doublePrecision("market_cap"),
  change24h: doublePrecision("change_24h"),
  source: varchar("source", { length: 40 }).notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("crypto_prices_coin_time_uq").on(t.coinId, t.timestamp), index("crypto_prices_time_idx").on(t.timestamp)]);

export const cryptoOhlcv = pgTable("crypto_ohlcv", {
  id: uuid("id").primaryKey().defaultRandom(),
  coinId: uuid("coin_id").notNull().references(() => cryptoCoins.id, { onDelete: "cascade" }),
  timeframe: varchar("timeframe", { length: 8 }).notNull(),
  time: timestamp("time", { withTimezone: true }).notNull(),
  open: doublePrecision("open").notNull(), high: doublePrecision("high").notNull(),
  low: doublePrecision("low").notNull(), close: doublePrecision("close").notNull(),
  volume: doublePrecision("volume").notNull(),
  source: varchar("source", { length: 40 }).notNull(),
}, (t) => [uniqueIndex("crypto_ohlcv_coin_tf_time_uq").on(t.coinId, t.timeframe, t.time), index("crypto_ohlcv_lookup_idx").on(t.coinId, t.timeframe, t.time)]);

export const cryptoSentiment = pgTable("crypto_sentiment", {
  id: uuid("id").primaryKey().defaultRandom(),
  coinId: uuid("coin_id").notNull().references(() => cryptoCoins.id, { onDelete: "cascade" }),
  sentiment: doublePrecision("sentiment").notNull(),
  source: varchar("source", { length: 40 }).notNull(),
  details: jsonb("details").$type<Record<string, unknown>>(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crypto_sentiment_lookup_idx").on(t.coinId, t.timestamp)]);

export const cryptoAnalysis = pgTable("crypto_analysis", {
  id: uuid("id").primaryKey().defaultRandom(),
  coinId: uuid("coin_id").notNull().references(() => cryptoCoins.id, { onDelete: "cascade" }),
  timeframe: varchar("timeframe", { length: 8 }).notNull().default("1h"),
  technicalSignals: jsonb("technical_signals").notNull().$type<Record<string, unknown>>(),
  patterns: jsonb("patterns").$type<Record<string, unknown>>(),
  recommendation: varchar("recommendation", { length: 20 }).notNull(),
  entryPrice: doublePrecision("entry_price"), stopLoss: doublePrecision("stop_loss"),
  takeProfit: doublePrecision("take_profit"), confidence: doublePrecision("confidence"),
  reason: text("reason"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crypto_analysis_lookup_idx").on(t.coinId, t.timeframe, t.timestamp)]);
