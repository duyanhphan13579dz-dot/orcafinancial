import { asc, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { companies, priceSnapshots } from "@/db/schema";
import { FEATURED_SYMBOLS, getQuotes } from "@/lib/market";
import { vndirectSearch } from "@/lib/connectors/providers";
import { cached } from "@/lib/connectors/core";
import { getBenchmarkForSymbol } from "@/lib/industry-benchmarks";
import { logger } from "@/lib/logger";

export type MarketStatus = "pre-market" | "trading" | "lunch-break" | "post-market" | "closed";
export type HeatColor = "ceiling" | "up" | "unchanged" | "down" | "floor" | "no-data";

export interface HeatmapItem {
  symbol: string;
  name: string;
  exchange: string;
  sector: string;
  industry: string;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  tradingValue: number;
  status: HeatColor;
  color: HeatColor;
  intensity: number;
  source: string | null;
  updatedAt: string | null;
}

/** Soft TTL — enough for UI poll every 12–15s without hammering DB. */
const HEATMAP_CACHE_MS = 12_000;

export function vietnamMarketStatus(now = new Date()): MarketStatus {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  if (["Sat", "Sun"].includes(part("weekday"))) return "closed";
  const mins = Number(part("hour")) * 60 + Number(part("minute"));
  if (mins < 9 * 60) return "pre-market";
  if (mins <= 11 * 60 + 30) return "trading";
  if (mins < 13 * 60) return "lunch-break";
  if (mins <= 15 * 60) return "trading";
  return "post-market";
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
    await getQuotes(FEATURED_SYMBOLS);
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
            (!type.includes("CỔ PHIẾU") && !type.includes("STOCK"))
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
  sectors: Array<{ name: string; count: number; tradingValue: number }>;
}> {
  return cached("market:heatmap:v3", HEATMAP_CACHE_MS, async () => {
    // Background only — never block the response path
    void warmFeaturedSnapshots();
    void syncListedUniverse();

    const [companyRows, snapshots] = await Promise.all([
      db
        .select({
          symbol: companies.symbol,
          name: companies.name,
          exchange: companies.exchange,
          sector: companies.sector,
          industry: companies.industry,
        })
        .from(companies)
        .orderBy(asc(companies.symbol))
        .limit(800),
      // Latest rows only — full table scan was a major latency source
      db
        .select()
        .from(priceSnapshots)
        .orderBy(desc(priceSnapshots.updatedAt))
        .limit(600),
    ]);

    const universe = new Map<
      string,
      { symbol: string; name: string; exchange: string; sector: string; industry: string }
    >();
    for (const symbol of FEATURED_SYMBOLS) {
      const benchmark = getBenchmarkForSymbol(symbol);
      universe.set(symbol, {
        symbol,
        name: symbol,
        exchange: "HOSE",
        sector: benchmark.sector,
        industry: benchmark.industry,
      });
    }
    for (const company of companyRows) {
      if (/^[A-Z]{3}$/.test(company.symbol)) {
        const benchmark = getBenchmarkForSymbol(company.symbol);
        universe.set(company.symbol, {
          symbol: company.symbol,
          name: company.name,
          exchange: company.exchange,
          sector: normalizedSector(company.symbol, company.sector),
          industry: company.industry?.trim() || benchmark.industry || "Khác",
        });
      }
    }

    const latest = new Map<string, (typeof snapshots)[number]>();
    for (const snapshot of snapshots) {
      if (!latest.has(snapshot.symbol)) latest.set(snapshot.symbol, snapshot);
    }

    const missingSymbols = [...universe.keys()].filter((symbol) => !latest.has(symbol));
    void warmMissingQuoteBatch(missingSymbols);

    const marketStatus = vietnamMarketStatus();
    const forceNeutral = marketStatus === "pre-market" || marketStatus === "closed";
    const items: HeatmapItem[] = [...universe.values()]
      .map((company) => {
        const snap = latest.get(company.symbol);
        const state = classify(snap?.changePct ?? null, forceNeutral);
        const tradingValue = snap ? Math.max(0, snap.close * snap.volume) : 0;
        return {
          ...company,
          price: snap?.close ?? null,
          changePercent: snap?.changePct ?? null,
          volume: snap?.volume ?? null,
          tradingValue,
          ...state,
          source: snap?.source ?? null,
          updatedAt: snap?.updatedAt?.toISOString() ?? null,
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

    return {
      items,
      marketStatus,
      timestamp: new Date().toISOString(),
      stats,
      sectors: [...sectorMap.values()].sort(
        (a, b) => b.tradingValue - a.tradingValue || b.count - a.count,
      ),
    };
  });
}
