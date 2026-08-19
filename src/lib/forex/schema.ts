import { doublePrecision, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const forexPairs = pgTable("forex_pairs", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: varchar("symbol", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  category: varchar("category", { length: 30 }).notNull(),
  baseCurrency: varchar("base_currency", { length: 10 }).notNull(),
  quoteCurrency: varchar("quote_currency", { length: 10 }).notNull(),
  yahooSymbol: varchar("yahoo_symbol", { length: 30 }),
  source: varchar("source", { length: 40 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("forex_pairs_category_idx").on(t.category)]);

export const forexPrices = pgTable("forex_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  pairId: uuid("pair_id").notNull().references(() => forexPairs.id, { onDelete: "cascade" }),
  price: doublePrecision("price").notNull(),
  bid: doublePrecision("bid"), ask: doublePrecision("ask"),
  change: doublePrecision("change"), changePercent: doublePrecision("change_percent"),
  source: varchar("source", { length: 40 }).notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("forex_prices_pair_time_uq").on(t.pairId, t.timestamp), index("forex_prices_time_idx").on(t.timestamp)]);

export const forexOhlcv = pgTable("forex_ohlcv", {
  id: uuid("id").primaryKey().defaultRandom(),
  pairId: uuid("pair_id").notNull().references(() => forexPairs.id, { onDelete: "cascade" }),
  timeframe: varchar("timeframe", { length: 8 }).notNull(),
  time: timestamp("time", { withTimezone: true }).notNull(),
  open: doublePrecision("open").notNull(), high: doublePrecision("high").notNull(),
  low: doublePrecision("low").notNull(), close: doublePrecision("close").notNull(),
  volume: doublePrecision("volume"), source: varchar("source", { length: 40 }).notNull(),
}, (t) => [uniqueIndex("forex_ohlcv_pair_tf_time_uq").on(t.pairId, t.timeframe, t.time), index("forex_ohlcv_lookup_idx").on(t.pairId, t.timeframe, t.time)]);

export const forexAnalysis = pgTable("forex_analysis", {
  id: uuid("id").primaryKey().defaultRandom(),
  pairId: uuid("pair_id").notNull().references(() => forexPairs.id, { onDelete: "cascade" }),
  timeframe: varchar("timeframe", { length: 8 }).notNull().default("1h"),
  technicalSignals: jsonb("technical_signals").notNull().$type<Record<string, unknown>>(),
  patterns: jsonb("patterns").$type<Record<string, unknown>>(),
  recommendation: varchar("recommendation", { length: 20 }).notNull(),
  entryPrice: doublePrecision("entry_price"), stopLoss: doublePrecision("stop_loss"),
  takeProfit: doublePrecision("take_profit"), confidence: doublePrecision("confidence"),
  reason: text("reason"), timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("forex_analysis_lookup_idx").on(t.pairId, t.timeframe, t.timestamp)]);
