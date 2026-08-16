/**
 * Commodities Service — Business logic layer
 * 
 * Functions:
 * - saveExchangeRates: Lưu tỷ giá vào DB
 * - saveCommodityPrices: Lưu giá hàng hóa (đã quy đổi VND)
 * - getLatestPrices: Lấy giá mới nhất của tất cả commodities
 * - getCommodityHistory: Lấy lịch sử giá một commodity
 * - getCommodityImpact: Lấy danh sách cổ phiếu bị ảnh hưởng
 * - getStockCommodityImpact: Lấy commodities ảnh hưởng đến một cổ phiếu
 * - calculateVolatility: Tính biến động ngày/tháng/năm
 */

import { db } from "@/db";
import { eq, and, gte, lte, desc, sql, inArray } from "drizzle-orm";
import {
  exchangeRates,
  commodities,
  commodityPrices,
  commodityStockImpact,
} from "./schema";
import type { CommodityPriceData, ExchangeRateData } from "./connectors";
import { COMMODITIES_LIST } from "./data";
import { forProvider } from "@/lib/logger";

const log = forProvider("commodities-service");

/* ═══════════════════════════════════════════════════════════════════════
 * Save Exchange Rates
 * ═══════════════════════════════════════════════════════════════════════ */

export async function saveExchangeRates(rates: ExchangeRateData[]): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let saved = 0;
  for (const rate of rates) {
    try {
      await db
        .insert(exchangeRates)
        .values({
          currency: rate.currency,
          rate: rate.rate,
          source: rate.source,
          date: today,
        })
        .onConflictDoUpdate({
          target: [exchangeRates.currency, exchangeRates.date],
          set: {
            rate: rate.rate,
            source: rate.source,
          },
        });
      saved++;
    } catch (err) {
      log.error("save_exchange_rate_failed", {
        currency: rate.currency,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  
  log.info("exchange_rates_saved", { count: saved });
  return saved;
}

/* ═══════════════════════════════════════════════════════════════════════
 * Get Latest Exchange Rate
 * ═══════════════════════════════════════════════════════════════════════ */

export async function getLatestExchangeRate(currency: string): Promise<number | null> {
  const result = await db
    .select({ rate: exchangeRates.rate })
    .from(exchangeRates)
    .where(eq(exchangeRates.currency, currency))
    .orderBy(desc(exchangeRates.date))
    .limit(1);
  
  return result[0]?.rate ?? null;
}

/* ═══════════════════════════════════════════════════════════════════════
 * Initialize Commodities List (idempotent)
 * ═══════════════════════════════════════════════════════════════════════ */

export async function initializeCommodities(): Promise<void> {
  const today = new Date();
  
  for (const item of COMMODITIES_LIST) {
    try {
      await db
        .insert(commodities)
        .values({
          symbol: item.symbol,
          name: item.name,
          nameEn: item.nameEn,
          group: item.group,
          unit: item.unit,
          currency: item.currency,
          source: item.source,
          displayOrder: item.displayOrder,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: commodities.symbol,
          set: {
            name: item.name,
            nameEn: item.nameEn,
            updatedAt: today,
          },
        });
    } catch (err) {
      log.error("initialize_commodity_failed", {
        symbol: item.symbol,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  
  log.info("commodities_initialized", { count: COMMODITIES_LIST.length });
}

/* ═══════════════════════════════════════════════════════════════════════
 * Save Commodity Prices (with VND conversion)
 * ═══════════════════════════════════════════════════════════════════════ */

export async function saveCommodityPrices(prices: CommodityPriceData[]): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let saved = 0;
  
  for (const price of prices) {
    try {
      // Get commodity ID
      const commodityResult = await db
        .select({ id: commodities.id })
        .from(commodities)
        .where(eq(commodities.symbol, price.symbol))
        .limit(1);
      
      if (!commodityResult.length) {
        log.warn("commodity_not_found", { symbol: price.symbol });
        continue;
      }
      
      const commodityId = commodityResult[0].id;
      
      // Convert to VND if needed
      let priceVnd = price.price;
      let currencyRate: number | null = null;
      
      if (price.currency !== "VND") {
        const rate = await getLatestExchangeRate(price.currency);
        if (rate) {
          priceVnd = price.price * rate;
          currencyRate = rate;
        } else {
          log.warn("exchange_rate_not_found", { currency: price.currency });
          continue; // Skip if no exchange rate
        }
      }
      
      // VND-denominated changes derived from the source's own percentages.
      const rate = currencyRate ?? 1;
      const prevCloseVnd =
        typeof price.prevClose === "number" && Number.isFinite(price.prevClose)
          ? price.prevClose * rate
          : null;

      const row = {
        commodityId,
        price: price.price,
        priceVnd,
        currencyRate,
        prevClose: prevCloseVnd,
        changePct1d: price.changePct1d ?? null,
        changePct7d: price.changePct7d ?? null,
        changePct30d: price.changePct30d ?? null,
        changePctYtd: price.changePctYtd ?? null,
        changePct1y: price.changePct1y ?? null,
        high52w:
          typeof price.high52w === "number" && Number.isFinite(price.high52w)
            ? price.high52w * rate
            : null,
        low52w:
          typeof price.low52w === "number" && Number.isFinite(price.low52w)
            ? price.low52w * rate
            : null,
        date: today,
        source: price.source,
      };

      // Save price
      await db
        .insert(commodityPrices)
        .values(row)
        .onConflictDoUpdate({
          target: [commodityPrices.commodityId, commodityPrices.date],
          set: {
            price: row.price,
            priceVnd: row.priceVnd,
            currencyRate: row.currencyRate,
            prevClose: row.prevClose,
            changePct1d: row.changePct1d,
            changePct7d: row.changePct7d,
            changePct30d: row.changePct30d,
            changePctYtd: row.changePctYtd,
            changePct1y: row.changePct1y,
            high52w: row.high52w,
            low52w: row.low52w,
            source: row.source,
          },
        });
      
      saved++;
    } catch (err) {
      log.error("save_commodity_price_failed", {
        symbol: price.symbol,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  
  log.info("commodity_prices_saved", { count: saved });
  return saved;
}

/* ═══════════════════════════════════════════════════════════════════════
 * Initialize Stock Impact Mappings (idempotent)
 * ═══════════════════════════════════════════════════════════════════════ */

export async function initializeStockImpacts(): Promise<void> {
  for (const item of COMMODITIES_LIST) {
    if (!item.stockImpacts.length) continue;
    
    try {
      const commodityResult = await db
        .select({ id: commodities.id })
        .from(commodities)
        .where(eq(commodities.symbol, item.symbol))
        .limit(1);
      
      if (!commodityResult.length) continue;
      
      const commodityId = commodityResult[0].id;
      
      for (const impact of item.stockImpacts) {
        await db
          .insert(commodityStockImpact)
          .values({
            commodityId,
            symbol: impact.symbol,
            impactType: impact.impactType,
            impactScore: 0.7, // Default score, can be updated manually
            reason: impact.reason,
          })
          .onConflictDoUpdate({
            target: [commodityStockImpact.commodityId, commodityStockImpact.symbol],
            set: {
              impactType: impact.impactType,
              reason: impact.reason,
              updatedAt: new Date(),
            },
          });
      }
    } catch (err) {
      log.error("initialize_stock_impact_failed", {
        commodity: item.symbol,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  
  log.info("stock_impacts_initialized");
}

/* ═══════════════════════════════════════════════════════════════════════
 * Get Latest Prices (for all active commodities)
 * ═══════════════════════════════════════════════════════════════════════ */

export interface CommodityPriceWithDetails {
  symbol: string;
  name: string;
  nameEn: string;
  group: string;
  unit: string;
  price: number;
  priceVnd: number;
  currency: string;
  date: Date;
  source: string | null;
  prevClose: number | null;
  high52w: number | null;
  low52w: number | null;
  changeDay: number | null;
  changeDayPct: number | null;
  changeWeekPct: number | null;
  changeMonth: number | null;
  changeMonthPct: number | null;
  changeYtdPct: number | null;
  changeYear: number | null;
  changeYearPct: number | null;
}

export async function getLatestCommodityPrices(): Promise<CommodityPriceWithDetails[]> {
  // Latest row per commodity. Percentage changes come straight from the
  // upstream board (Simplize) when present; otherwise we fall back to
  // comparing against our own stored history.
  const result = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (cp.commodity_id)
        cp.commodity_id, cp.price, cp.price_vnd, cp.date, cp.prev_close,
        cp.change_pct_1d, cp.change_pct_7d, cp.change_pct_30d,
        cp.change_pct_ytd, cp.change_pct_1y, cp.high_52w, cp.low_52w, cp.source
      FROM commodity_prices cp
      ORDER BY cp.commodity_id, cp.date DESC
    ),
    prev_day AS (
      SELECT DISTINCT ON (cp.commodity_id) cp.commodity_id, cp.price_vnd
      FROM commodity_prices cp
      WHERE cp.date < DATE_TRUNC('day', NOW())
      ORDER BY cp.commodity_id, cp.date DESC
    ),
    prev_month AS (
      SELECT DISTINCT ON (cp.commodity_id) cp.commodity_id, cp.price_vnd
      FROM commodity_prices cp
      WHERE cp.date < NOW() - INTERVAL '25 days'
      ORDER BY cp.commodity_id, cp.date DESC
    ),
    prev_year AS (
      SELECT DISTINCT ON (cp.commodity_id) cp.commodity_id, cp.price_vnd
      FROM commodity_prices cp
      WHERE cp.date < NOW() - INTERVAL '330 days'
      ORDER BY cp.commodity_id, cp.date DESC
    )
    SELECT
      c.symbol, c.name, c.name_en AS "nameEn", c.group, c.unit, c.currency,
      l.price, l.price_vnd AS "priceVnd", l.date, l.source,
      l.prev_close AS "prevClose",
      l.change_pct_1d AS "srcDay", l.change_pct_7d AS "srcWeek",
      l.change_pct_30d AS "srcMonth", l.change_pct_ytd AS "srcYtd",
      l.change_pct_1y AS "srcYear",
      l.high_52w AS "high52w", l.low_52w AS "low52w",
      pd.price_vnd AS "histDay", pm.price_vnd AS "histMonth", py.price_vnd AS "histYear"
    FROM commodities c
    JOIN latest l ON l.commodity_id = c.id
    LEFT JOIN prev_day  pd ON pd.commodity_id = c.id
    LEFT JOIN prev_month pm ON pm.commodity_id = c.id
    LEFT JOIN prev_year  py ON py.commodity_id = c.id
    WHERE c.is_active = true
    ORDER BY c.display_order, c.symbol
  `);

  const num = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  };

  return (result.rows as any[]).map((row) => {
    const priceVnd = num(row.priceVnd) ?? 0;

    // Prefer upstream percentages; fall back to our own history.
    const pctFromHistory = (past: number | null): number | null =>
      past && past > 0 ? ((priceVnd - past) / past) * 100 : null;

    const changeDayPct = num(row.srcDay) ?? pctFromHistory(num(row.histDay));
    const changeMonthPct = num(row.srcMonth) ?? pctFromHistory(num(row.histMonth));
    const changeYearPct = num(row.srcYear) ?? pctFromHistory(num(row.histYear));

    const absFromPct = (pct: number | null): number | null =>
      pct === null ? null : priceVnd - priceVnd / (1 + pct / 100);

    return {
      symbol: row.symbol,
      name: row.name,
      nameEn: row.nameEn,
      group: row.group,
      unit: row.unit,
      price: num(row.price) ?? 0,
      priceVnd,
      currency: row.currency,
      date: new Date(row.date),
      source: row.source ?? null,
      prevClose: num(row.prevClose),
      high52w: num(row.high52w),
      low52w: num(row.low52w),
      changeDay: absFromPct(changeDayPct),
      changeDayPct,
      changeWeekPct: num(row.srcWeek),
      changeMonth: absFromPct(changeMonthPct),
      changeMonthPct,
      changeYtdPct: num(row.srcYtd),
      changeYear: absFromPct(changeYearPct),
      changeYearPct,
    };
  });
}

/* ═══════════════════════════════════════════════════════════════════════
 * Get Commodity History
 * ═══════════════════════════════════════════════════════════════════════ */

export interface CommodityPriceHistory {
  date: Date;
  price: number;
  priceVnd: number;
}

export async function getCommodityHistory(
  symbol: string,
  from: Date,
  to: Date
): Promise<CommodityPriceHistory[]> {
  const result = await db
    .select({
      date: commodityPrices.date,
      price: commodityPrices.price,
      priceVnd: commodityPrices.priceVnd,
    })
    .from(commodityPrices)
    .innerJoin(commodities, eq(commodities.id, commodityPrices.commodityId))
    .where(
      and(
        eq(commodities.symbol, symbol),
        gte(commodityPrices.date, from),
        lte(commodityPrices.date, to)
      )
    )
    .orderBy(commodityPrices.date);
  
  return result.map((r) => ({
    date: r.date,
    price: r.price,
    priceVnd: r.priceVnd,
  }));
}

/* ═══════════════════════════════════════════════════════════════════════
 * Get Stock Impacts for a Commodity
 * ═══════════════════════════════════════════════════════════════════════ */

export interface StockImpact {
  symbol: string;
  impactType: "positive" | "negative" | "neutral";
  impactScore: number;
  reason: string | null;
}

export async function getCommodityStockImpacts(commoditySymbol: string): Promise<StockImpact[]> {
  const result = await db
    .select({
      symbol: commodityStockImpact.symbol,
      impactType: commodityStockImpact.impactType,
      impactScore: commodityStockImpact.impactScore,
      reason: commodityStockImpact.reason,
    })
    .from(commodityStockImpact)
    .innerJoin(commodities, eq(commodities.id, commodityStockImpact.commodityId))
    .where(eq(commodities.symbol, commoditySymbol));
  
  return result.map((r) => ({
    symbol: r.symbol,
    impactType: r.impactType as "positive" | "negative" | "neutral",
    impactScore: r.impactScore,
    reason: r.reason,
  }));
}

/* ═══════════════════════════════════════════════════════════════════════
 * Get Commodities Impacting a Stock
 * ═══════════════════════════════════════════════════════════════════════ */

export interface CommodityImpactOnStock {
  symbol: string;
  name: string;
  group: string;
  impactType: "positive" | "negative" | "neutral";
  impactScore: number;
  reason: string | null;
  currentPrice: number | null;
  changeDayPct: number | null;
  changeMonthPct: number | null;
}

export async function getStockCommodityImpacts(stockSymbol: string): Promise<CommodityImpactOnStock[]> {
  const result = await db.execute(sql`
    SELECT
      c.symbol,
      c.name,
      c.group,
      csi.impact_type as "impactType",
      csi.impact_score as "impactScore",
      csi.reason,
      lp.price_vnd as "currentPrice",
      lp.change_pct_1d as "changeDayPct",
      lp.change_pct_30d as "changeMonthPct"
    FROM commodity_stock_impact csi
    JOIN commodities c ON c.id = csi.commodity_id
    LEFT JOIN LATERAL (
      SELECT price_vnd, change_pct_1d, change_pct_30d
      FROM commodity_prices
      WHERE commodity_id = c.id
      ORDER BY date DESC
      LIMIT 1
    ) lp ON true
    WHERE csi.symbol = ${stockSymbol.toUpperCase()}
    ORDER BY csi.impact_score DESC, c.display_order
  `);
  
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  };

  return (result.rows as any[]).map((row) => ({
    symbol: row.symbol,
    name: row.name,
    group: row.group,
    impactType: row.impactType as "positive" | "negative" | "neutral",
    impactScore: num(row.impactScore) ?? 0,
    reason: row.reason,
    currentPrice: num(row.currentPrice),
    changeDayPct: num(row.changeDayPct),
    changeMonthPct: num(row.changeMonthPct),
  }));
}
