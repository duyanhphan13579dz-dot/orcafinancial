/**
 * Commodities Module Schema — Drizzle ORM
 * 
 * Tables:
 * - exchange_rates: Tỷ giá hàng ngày (USD, JPY, CNY → VND)
 * - commodities: Danh mục hàng hóa theo dõi
 * - commodity_prices: Lịch sử giá hàng ngày (đã quy đổi VND)
 * - commodity_stock_impact: Mapping ảnh hưởng đến cổ phiếu
 */

import { pgTable, uuid, varchar, text, timestamp, doublePrecision, integer, boolean, uniqueIndex, index, pgEnum } from "drizzle-orm/pg-core";

export const impactTypeEnum = pgEnum("impact_type", ["positive", "negative", "neutral"]);
export const commodityGroupEnum = pgEnum("commodity_group", [
  "precious_metals",    // Vàng, bạc
  "industrial_metals",  // Thép, đồng, nickel, quặng sắt
  "energy",             // Dầu thô, xăng dầu, khí thiên nhiên, than
  "agriculture",        // Ngô, đậu nành, gạo, cà phê, bông, đường
  "livestock",          // Heo hơi, tôm, cá tra
  "dairy",              // Sữa bột
  "rubber",             // Cao su
  "fertilizer",         // Phân URE
]);

/* ═══════════════════════════════════════════════════════════════════════
 * Exchange Rates — Tỷ giá hàng ngày
 * ═══════════════════════════════════════════════════════════════════════ */

export const exchangeRates = pgTable("exchange_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  currency: varchar("currency", { length: 3 }).notNull(), // USD, JPY, CNY, EUR...
  rate: doublePrecision("rate").notNull(), // 1 đơn vị ngoại tệ = ? VND
  source: varchar("source", { length: 50 }).notNull().default("sbv"), // sbv, vcb, market
  date: timestamp("date", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("exchange_rates_currency_date_uq").on(t.currency, t.date),
  index("exchange_rates_date_idx").on(t.date),
]);

/* ═══════════════════════════════════════════════════════════════════════
 * Commodities — Danh mục hàng hóa
 * ═══════════════════════════════════════════════════════════════════════ */

export const commodities = pgTable("commodities", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: varchar("symbol", { length: 30 }).notNull().unique(), // GOLD_SJC_BUY, WTI_CRUDE, STEEL_D10...
  name: varchar("name", { length: 200 }).notNull(), // "Vàng SJC (mua vào)"
  nameEn: varchar("name_en", { length: 200 }), // "Gold SJC (buy)"
  group: commodityGroupEnum("group").notNull(),
  unit: varchar("unit", { length: 50 }).notNull(), // "VND/lượng", "USD/thùng"
  currency: varchar("currency", { length: 3 }).notNull().default("VND"), // VND, USD, JPY, CNY
  source: varchar("source", { length: 100 }), // Nguồn dữ liệu chính
  isActive: boolean("is_active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("commodities_group_idx").on(t.group),
  index("commodities_active_idx").on(t.isActive),
]);

/* ═══════════════════════════════════════════════════════════════════════
 * Commodity Prices — Lịch sử giá hàng ngày
 * ═══════════════════════════════════════════════════════════════════════ */

export const commodityPrices = pgTable("commodity_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  commodityId: uuid("commodity_id").notNull().references(() => commodities.id),
  price: doublePrecision("price").notNull(), // Giá gốc theo đơn vị currency
  priceVnd: doublePrecision("price_vnd").notNull(), // Giá quy đổi VND
  currencyRate: doublePrecision("currency_rate"), // Tỷ giá sử dụng để quy đổi
  // Giá tham chiếu & biến động lấy TRỰC TIẾP từ nguồn (Simplize) — chính xác hơn
  // so với tự tính từ lịch sử vì DB mới chỉ có vài ngày dữ liệu.
  prevClose: doublePrecision("prev_close"),
  changePct1d: doublePrecision("change_pct_1d"),
  changePct7d: doublePrecision("change_pct_7d"),
  changePct30d: doublePrecision("change_pct_30d"),
  changePctYtd: doublePrecision("change_pct_ytd"),
  changePct1y: doublePrecision("change_pct_1y"),
  high52w: doublePrecision("high_52w"),
  low52w: doublePrecision("low_52w"),
  date: timestamp("date", { withTimezone: true }).notNull(), // Ngày theo giờ VN
  source: varchar("source", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("commodity_prices_commodity_date_uq").on(t.commodityId, t.date),
  index("commodity_prices_date_idx").on(t.date),
]);

/* ═══════════════════════════════════════════════════════════════════════
 * Commodity Stock Impact — Mapping ảnh hưởng đến cổ phiếu
 * ═══════════════════════════════════════════════════════════════════════ */

export const commodityStockImpact = pgTable("commodity_stock_impact", {
  id: uuid("id").primaryKey().defaultRandom(),
  commodityId: uuid("commodity_id").notNull().references(() => commodities.id),
  symbol: varchar("symbol", { length: 20 }).notNull(), // Mã cổ phiếu: HPG, VNM, PLX...
  impactType: impactTypeEnum("impact_type").notNull(), // positive, negative, neutral
  impactScore: doublePrecision("impact_score").notNull(), // 0-1
  reason: text("reason"), // Giải thích ngắn
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("commodity_stock_impact_commodity_symbol_uq").on(t.commodityId, t.symbol),
  index("commodity_stock_impact_symbol_idx").on(t.symbol),
]);
