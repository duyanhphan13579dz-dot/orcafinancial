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
      
      // Save price
      await db
        .insert(commodityPrices)
        .values({
          commodityId,
          price: price.price,
          priceVnd,
          currencyRate,
          date: today,
          source: price.source,
        })
        .onConflictDoUpdate({
          target: [commodityPrices.commodityId, commodityPrices.date],
          set: {
            price: price.price,
            priceVnd,
            currencyRate,
            source: price.source,
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
  changeDay: number | null;
  changeDayPct: number | null;
  changeMonth: number | null;
  changeMonthPct: number | null;
  changeYear: number | null;
  changeYearPct: number | null;
}

export async function getLatestCommodityPrices(): Promise<CommodityPriceWithDetails[]> {
  const result = await db.execute(sql`
    WITH latest_prices AS (
      SELECT DISTINCT ON (cp.commodity_id)
        cp.commodity_id,
        cp.price,
        cp.price_vnd,
        cp.date,
        cp.currency_rate
      FROM commodity_prices cp
      ORDER BY cp.commodity_id, cp.date DESC
    ),
    yesterday_prices AS (
      SELECT DISTINCT ON (cp.commodity_id)
        cp.commodity_id,
        cp.price_vnd as price_vnd_yesterday
      FROM commodity_prices cp
      WHERE cp.date >= NOW() - INTERVAL '2 days'
        AND cp.date < DATE_TRUNC('day', NOW())
      ORDER BY cp.commodity_id, cp.date DESC
    ),
    month_ago_prices AS (
      SELECT DISTINCT ON (cp.commodity_id)
        cp.commodity_id,
        cp.price_vnd as price_vnd_month
      FROM commodity_prices cp
      WHERE cp.date >= NOW() - INTERVAL '35 days'
        AND cp.date < NOW() - INTERVAL '25 days'
      ORDER BY cp.commodity_id, cp.date DESC
    ),
    year_ago_prices AS (
      SELECT DISTINCT ON (cp.commodity_id)
        cp.commodity_id,
        cp.price_vnd as price_vnd_year
      FROM commodity_prices cp
      WHERE cp.date >= NOW() - INTERVAL '400 days'
        AND cp.date < NOW() - INTERVAL '330 days'
      ORDER BY cp.commodity_id, cp.date DESC
    )
    SELECT
      c.symbol,
      c.name,
      c.name_en as "nameEn",
      c.group,
      c.unit,
      c.currency,
      lp.price,
      lp.price_vnd as "priceVnd",
      lp.date,
      yp.price_vnd_yesterday as "priceVndYesterday",
      mp.price_vnd_month as "priceVndMonth",
      yrp.price_vnd_year as "priceVndYear"
    FROM commodities c
    JOIN latest_prices lp ON lp.commodity_id = c.id
    LEFT JOIN yesterday_prices yp ON yp.commodity_id = c.id
    LEFT JOIN month_ago_prices mp ON mp.commodity_id = c.id
    LEFT JOIN year_ago_prices yrp ON yrp.commodity_id = c.id
    WHERE c.is_active = true
    ORDER BY c.display_order, c.symbol
  `);
  
  const rows = result.rows as any[];
  
  return rows.map((row) => {
    const priceVnd = parseFloat(row.priceVnd);
    const priceVndYesterday = row.priceVndYesterday ? parseFloat(row.priceVndYesterday) : null;
    const priceVndMonth = row.priceVndMonth ? parseFloat(row.priceVndMonth) : null;
    const priceVndYear = row.priceVndYear ? parseFloat(row.priceVndYear) : null;
    
    return {
      symbol: row.symbol,
      name: row.name,
      nameEn: row.nameEn,
      group: row.group,
      unit: row.unit,
      price: parseFloat(row.price),
      priceVnd,
      currency: row.currency,
      date: new Date(row.date),
      changeDay: priceVndYesterday ? priceVnd - priceVndYesterday : null,
      changeDayPct: priceVndYesterday ? ((priceVnd - priceVndYesterday) / priceVndYesterday) * 100 : null,
      changeMonth: priceVndMonth ? priceVnd - priceVndMonth : null,
      changeMonthPct: priceVndMonth ? ((priceVnd - priceVndMonth) / priceVndMonth) * 100 : null,
      changeYear: priceVndYear ? priceVnd - priceVndYear : null,
      changeYearPct: priceVndYear ? ((priceVnd - priceVndYear) / priceVndYear) * 100 : null,
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
      CASE
        WHEN yp.price_vnd IS NOT NULL AND yp.price_vnd > 0
        THEN ((lp.price_vnd - yp.price_vnd) / yp.price_vnd * 100)
        ELSE NULL
      END as "changeDayPct"
    FROM commodity_stock_impact csi
    JOIN commodities c ON c.id = csi.commodity_id
    LEFT JOIN LATERAL (
      SELECT price_vnd
      FROM commodity_prices
      WHERE commodity_id = c.id
      ORDER BY date DESC
      LIMIT 1
    ) lp ON true
    LEFT JOIN LATERAL (
      SELECT price_vnd
      FROM commodity_prices
      WHERE commodity_id = c.id
        AND date >= NOW() - INTERVAL '2 days'
        AND date < DATE_TRUNC('day', NOW())
      ORDER BY date DESC
      LIMIT 1
    ) yp ON true
    WHERE csi.symbol = ${stockSymbol.toUpperCase()}
    ORDER BY csi.impact_score DESC, c.display_order
  `);
  
  return (result.rows as any[]).map((row) => ({
    symbol: row.symbol,
    name: row.name,
    group: row.group,
    impactType: row.impactType as "positive" | "negative" | "neutral",
    impactScore: parseFloat(row.impactScore),
    reason: row.reason,
    currentPrice: row.currentPrice ? parseFloat(row.currentPrice) : null,
    changeDayPct: row.changeDayPct ? parseFloat(row.changeDayPct) : null,
  }));
}
