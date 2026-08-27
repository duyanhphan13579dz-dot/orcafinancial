import { asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { companies, companyProfiles, priceSnapshots } from "@/db/schema";
import { FEATURED_SYMBOLS, getQuotes } from "@/lib/market";
import { vndirectSearch } from "@/lib/connectors/providers";
import { cached } from "@/lib/connectors/core";
import { getBenchmarkForSymbol } from "@/lib/industry-benchmarks";
import { logger } from "@/lib/logger";
import { collectRealtimeQuotes, getRealtimeStatus } from "@/lib/heatmap/realtime";

export type MarketStatus = "PRE_MARKET" | "TRADING" | "LUNCH_BREAK" | "POST_MARKET" | "CLOSED";
export type HeatColor = "ceiling" | "up" | "unchanged" | "down" | "floor" | "no-data";

export interface HeatmapItem {
  symbol: string;
  name: string;
  exchange: string;
  sector: string;
  industry: string;
  marketCap: number | null;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  tradingValue: number;
  status: HeatColor;
  color: HeatColor;
  intensity: number;
  source: string | null;
  confidence: number | null;
  updatedAt: string | null;
  ageSeconds: number | null;
  isStale: boolean;
}

/** Soft TTL — enough for UI poll every 12–15s without hammering DB. */
const HEATMAP_CACHE_MS = 12_000;
const VALID_EXCHANGES = new Set(["HOSE", "HNX", "UPCOM"]);
const STALE_AFTER_SECONDS = 90;

function isStockCompany(row: { symbol: string; type?: string | null; exchange?: string | null }) {
  const type = (row.type ?? "").toLocaleUpperCase("vi-VN");
  const exchange = (row.exchange ?? "").toLocaleUpperCase("vi-VN");
  return /^[A-Z]{3}$/.test(row.symbol) &&
    VALID_EXCHANGES.has(exchange) &&
    (type === "STOCK" || type.includes("CỔ PHIẾU") || type.includes("CO PHIEU"));
}

export function vietnamMarketStatus(now = new Date()): MarketStatus {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  if (["Sat", "Sun"].includes(part("weekday"))) return "CLOSED";
  const mins = Number(part("hour")) * 60 + Number(part("minute"));
  if (mins < 9 * 60) return "PRE_MARKET";
  if (mins <= 11 * 60 + 30) return "TRADING";
  if (mins < 13 * 60) return "LUNCH_BREAK";
  if (mins <= 15 * 60) return "TRADING";
  return "POST_MARKET";
}

function classify(change: number | null, forceNeutral: boolean) {
  if (change === null || !Number.isFinite(change))
    return { status: "no-data" as const, color: "no-data" as const, intensity: 0 };
  if (forceNeutral)
    return { status: "unchanged" as const, color: "unchanged" as const, intensity: 0 };
  if (change >= 6.5) return { status: "ceiling" as const, color: "ceiling" as const, intensity: 1 };
  if (change <= -6.5) return { status: "floor" as const, color: "floor" as const, intensity: 1 };
  if (Math.abs(change) < 0.005)
    return { status: "unchanged" as const, color: "unchanged" as const, intensity: 0 };
  return {
    status: change > 0 ? ("up" as const) : ("down" as const),
    color: change > 0 ? ("up" as const) : ("down" as const),
    intensity: Math.min(1, Math.abs(change) / 5),
  };
}

function normalizedSector(symbol: string, sector?: string | null) {
  if (sector?.trim()) return sector.trim();
  return getBenchmarkForSymbol(symbol).sector || "Khác";
}

async function warmFeaturedSnapshots() {
  try {
    await collectRealtimeQuotes(FEATURED_SYMBOLS);
  } catch (err) {
    logger.warn("heatmap_warm_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

const globalUniverse = globalThis as typeof globalThis & {
  __orcaHeatmapUniverseSyncAt?: number;
  __orcaHeatmapUniverseSyncing?: boolean;
  __orcaHeatmapQuoteWarming?: boolean;
};

async function warmMissingQuoteBatch(symbols: string[]) {
  if (globalUniverse.__orcaHeatmapQuoteWarming || !symbols.length) return;
  globalUniverse.__orcaHeatmapQuoteWarming = true;
  const batch = symbols.slice(0, 12);
  try {
    const quotes = await getQuotes(batch);
    logger.info("heatmap_quote_batch_warmed", {
      requested: batch.length,
      received: quotes.length,
    });
  } catch (err) {
    logger.warn("heatmap_quote_batch_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    globalUniverse.__orcaHeatmapQuoteWarming = false;
  }
}

async function syncListedUniverse() {
  if (globalUniverse.__orcaHeatmapUniverseSyncing) return;
  if (
    globalUniverse.__orcaHeatmapUniverseSyncAt &&
    Date.now() - globalUniverse.__orcaHeatmapUniverseSyncAt < 24 * 60 * 60_000
  )
    return;
  globalUniverse.__orcaHeatmapUniverseSyncing = true;
  try {
    const responses = await Promise.allSettled(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((prefix) => vndirectSearch(prefix, 50)),
    );
    const seen = new Map<
      string,
      {
        symbol: string;
        name: string;
        exchange: string;
        type: string;
        source: string;
        sector: string;
        industry: string;
      }
    >();
    for (const response of responses)
      if (response.status === "fulfilled") {
        for (const row of response.value) {
          const type = row.type.toLocaleUpperCase("vi");
          if (
            !/^[A-Z]{3}$/.test(row.symbol) ||
            (!type.includes("CỔ PHIẾU") && !type.includes("STOCK")) ||
            !VALID_EXCHANGES.has(row.exchange.toUpperCase())
          )
            continue;
          const benchmark = getBenchmarkForSymbol(row.symbol);
          seen.set(row.symbol, {
            ...row,
            sector: benchmark.sector,
            industry: benchmark.industry,
          });
        }
      }
    const rows = [...seen.values()];
    for (let i = 0; i < rows.length; i += 100) {
      await db
        .insert(companies)
        .values(rows.slice(i, i + 100))
        .onConflictDoNothing({ target: companies.symbol });
    }
    globalUniverse.__orcaHeatmapUniverseSyncAt = Date.now();
    logger.info("heatmap_universe_synced", { symbols: rows.length });
  } catch (err) {
    logger.warn("heatmap_universe_sync_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    globalUniverse.__orcaHeatmapUniverseSyncing = false;
  }
}

export async function getMarketHeatmap(): Promise<{
  items: HeatmapItem[];
  marketStatus: MarketStatus;
  timestamp: string;
  stats: Record<HeatColor | "total", number>;
  dataQuality: { universeCount: number; validQuoteCount: number; staleCount: number; noDataCount: number; exchanges: string[]; staleAfterSeconds: number };
  realtime: ReturnType<typeof getRealtimeStatus>;
  sectors: Array<{ name: string; count: number; tradingValue: number }>;
  marketCapGroups: Array<{ key: string; name: string; count: number; tradingValue: number }>;
}> {
  return cached("market:heatmap:v3", HEATMAP_CACHE_MS, async () => {
    // Background only — never block the response path
    void warmFeaturedSnapshots();
    void syncListedUniverse();

    const [companyRows, profileRows, snapshots] = await Promise.all([
      db
        .select({
          symbol: companies.symbol,
          name: companies.name,
          exchange: companies.exchange,
          type: companies.type,
          sector: companies.sector,
          industry: companies.industry,
        })
        .from(companies)
        .orderBy(asc(companies.symbol)),
      db
        .select({ symbol: companyProfiles.symbol, marketCap: companyProfiles.marketCap })
        .from(companyProfiles),
      // price_snapshots has one row per symbol; read the complete latest universe.
      // This avoids silently dropping older-but-valid symbols behind a global LIMIT.
      db
        .select({
          symbol: priceSnapshots.symbol,
          time: priceSnapshots.time,
          close: priceSnapshots.close,
          volume: priceSnapshots.volume,
          changePct: priceSnapshots.changePct,
          source: priceSnapshots.source,
          confidence: priceSnapshots.confidence,
          updatedAt: priceSnapshots.updatedAt,
        })
        .from(priceSnapshots)
        .orderBy(desc(priceSnapshots.updatedAt)),
    ]);

    const marketCapBySymbol = new Map(profileRows.map((row) => [row.symbol, row.marketCap != null ? Number(row.marketCap) : null]));
    const universe = new Map<
      string,
      { symbol: string; name: string; exchange: string; sector: string; industry: string; marketCap: number | null }
    >();
    for (const symbol of FEATURED_SYMBOLS) {
      const benchmark = getBenchmarkForSymbol(symbol);
      universe.set(symbol, {
        symbol,
        name: symbol,
        exchange: "HOSE",
        sector: benchmark.sector,
        industry: benchmark.industry,
        marketCap: null,
      });
    }
    for (const company of companyRows) {
      if (isStockCompany(company)) {
        const benchmark = getBenchmarkForSymbol(company.symbol);
        universe.set(company.symbol, {
          symbol: company.symbol,
          name: company.name,
          exchange: company.exchange.toUpperCase(),
          sector: normalizedSector(company.symbol, company.sector),
          industry: company.industry?.trim() || benchmark.industry || "Khác",
          marketCap: null,
        });
      }
    }

    const latest = new Map<string, (typeof snapshots)[number]>();
    for (const snapshot of snapshots) {
      if (!latest.has(snapshot.symbol)) latest.set(snapshot.symbol, snapshot);
    }

    for (const company of universe.values()) company.marketCap = marketCapBySymbol.get(company.symbol) ?? null;

    const missingSymbols = [...universe.keys()].filter((symbol) => !latest.has(symbol));
    void warmMissingQuoteBatch(missingSymbols);

    const marketStatus = vietnamMarketStatus();
    const forceNeutral = marketStatus === "PRE_MARKET";
    const items: HeatmapItem[] = [...universe.values()]
      .map((company) => {
        const snap = latest.get(company.symbol);
        const state = classify(snap?.changePct ?? null, forceNeutral);
        const tradingValue = snap ? Math.max(0, snap.close * snap.volume) : 0;
        const updatedAt = snap?.updatedAt?.toISOString() ?? null;
        const ageSeconds = snap ? Math.max(0, Math.round((Date.now() - snap.updatedAt.getTime()) / 1000)) : null;
        return {
          ...company,
          price: snap?.close ?? null,
          changePercent: snap?.changePct ?? null,
          volume: snap?.volume ?? null,
          tradingValue,
          ...state,
          source: snap?.source ?? null,
          confidence: snap?.confidence != null ? Number(snap.confidence) : null,
          updatedAt,
          ageSeconds,
          isStale: ageSeconds == null || ageSeconds > STALE_AFTER_SECONDS,
        };
      })
      .sort((a, b) => b.tradingValue - a.tradingValue || a.symbol.localeCompare(b.symbol));

    const sectorMap = new Map<string, { name: string; count: number; tradingValue: number }>();
    for (const item of items) {
      const current = sectorMap.get(item.sector) ?? {
        name: item.sector,
        count: 0,
        tradingValue: 0,
      };
      current.count += 1;
      current.tradingValue += item.tradingValue;
      sectorMap.set(item.sector, current);
    }

    const marketCapGroups = [
      { key: "mega", name: "Siêu lớn", min: 100_000, max: Infinity },
      { key: "large", name: "Lớn", min: 30_000, max: 100_000 },
      { key: "mid", name: "Trung bình", min: 5_000, max: 30_000 },
      { key: "small", name: "Nhỏ", min: 0, max: 5_000 },
    ].map(({ key, name, min, max }) => {
      const grouped = items.filter((item) => item.marketCap != null && item.marketCap >= min && item.marketCap < max);
      return { key, name, count: grouped.length, tradingValue: grouped.reduce((sum, item) => sum + item.tradingValue, 0) };
    });

    const stats = {
      ceiling: 0,
      up: 0,
      unchanged: 0,
      down: 0,
      floor: 0,
      "no-data": 0,
      total: items.length,
    };
    for (const item of items) {
      if (item.status in stats) stats[item.status as keyof typeof stats] += 1;
    }

    const dataQuality = {
      universeCount: items.length,
      validQuoteCount: items.filter((item) => item.price != null).length,
      staleCount: items.filter((item) => item.isStale).length,
      noDataCount: items.filter((item) => item.status === "no-data").length,
      exchanges: [...new Set(items.map((item) => item.exchange).filter(Boolean))].sort(),
      staleAfterSeconds: STALE_AFTER_SECONDS,
    };

    return {
      items,
      marketStatus,
      timestamp: new Date().toISOString(),
      stats,
      dataQuality,
      realtime: getRealtimeStatus(),
      sectors: [...sectorMap.values()].sort(
        (a, b) => b.tradingValue - a.tradingValue || b.count - a.count,
      ),
      marketCapGroups,
    };
  });
}
