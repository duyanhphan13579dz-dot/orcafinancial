import { desc, eq, sql, and } from "drizzle-orm";
import { db } from "@/db";
import { FOREX_PAIRS } from "./data";
import {
  forexAnalysis,
  forexOhlcv,
  forexPairs,
  forexPrices,
} from "./schema";
import {
  fetchForexBars,
  fetchForexSnapshot,
} from "./connectors";
import { analyzeForex } from "./analysis";
import { forProvider } from "@/lib/logger";
import type { Ohlcv } from "@/lib/connectors/core";

const log = forProvider("forex-service");

const FRESHNESS_CACHE_TTL = 5_000;
const LATEST_PRICES_CACHE_TTL = 5_000;
const PAIRS_CACHE_TTL = 5 * 60_000;
const PAIR_CACHE_TTL = 5_000;

/** Soft TTL — serve DB/memory instantly; refresh network in background. */
const OHLCV_SOFT_TTL: Record<string, number> = {
  "1m": 30_000,
  "5m": 60_000,
  "15m": 120_000,
  "1h": 300_000,
  "4h": 900_000,
  "1d": 2_400_000,
};

const OHLCV_HARD_TTL: Record<string, number> = {
  "1m": 120_000,
  "5m": 300_000,
  "15m": 600_000,
  "1h": 1_800_000,
  "4h": 3_600_000,
  "1d": 12_000_000,
};

/** In-process memory cache — sub-ms on warm serverless instances. */
const MEM_OHLCV_TTL = 20_000;
const memOhlcv = new Map<
  string,
  { bars: Ohlcv[]; source: string; newestMs: number; at: number }
>();

interface ForexSyncResult {
  source: string;
  saved: number;
  timestamp: Date;
  durationMs: number;
}

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

type ForexPairRow = typeof forexPairs.$inferSelect;

type ForexPairDetail =
  | {
      pair: ForexPairRow;
      price: typeof forexPrices.$inferSelect | undefined;
    }
  | null;

let syncPromise: Promise<ForexSyncResult> | null = null;
let initializePromise: Promise<number> | null = null;
let pairsCache: CacheEntry<ForexPairRow[]> | null = null;
let latestPricesCache: CacheEntry<unknown[]> | null = null;
let freshnessCache: CacheEntry<{
  refreshed: boolean;
  latestAt?: string;
  source?: string;
  saved?: number;
  timestamp?: Date;
  durationMs?: number;
}> | null = null;

const pairCache = new Map<string, CacheEntry<ForexPairDetail>>();

function cacheIsFresh<T>(entry: CacheEntry<T> | null | undefined, ttl: number) {
  return Boolean(entry && Date.now() - entry.timestamp < ttl);
}

function invalidatePriceCaches() {
  freshnessCache = null;
  latestPricesCache = null;
  pairCache.clear();
}

function memKey(symbol: string, timeframe: string, limit: number) {
  return `${symbol}:${timeframe}:${limit}`;
}

async function getCachedForexPairs() {
  if (cacheIsFresh(pairsCache, PAIRS_CACHE_TTL)) return pairsCache!.value;
  const rows = await db
    .select()
    .from(forexPairs)
    .orderBy(forexPairs.category, forexPairs.symbol);
  pairsCache = { value: rows, timestamp: Date.now() };
  return rows;
}

export async function initializeForexPairs() {
  if (cacheIsFresh(pairsCache, PAIRS_CACHE_TTL)) return pairsCache!.value.length;
  if (initializePromise) return initializePromise;

  initializePromise = (async () => {
    const chunk = 8;
    for (let i = 0; i < FOREX_PAIRS.length; i += chunk) {
      await Promise.all(
        FOREX_PAIRS.slice(i, i + chunk).map((p) =>
          db
            .insert(forexPairs)
            .values({
              symbol: p.symbol,
              name: p.name,
              category: p.category,
              baseCurrency: p.baseCurrency,
              quoteCurrency: p.quoteCurrency,
              yahooSymbol: p.yahooSymbol,
              source: "multi-source",
            })
            .onConflictDoUpdate({
              target: forexPairs.symbol,
              set: {
                name: p.name,
                category: p.category,
                baseCurrency: p.baseCurrency,
                quoteCurrency: p.quoteCurrency,
                yahooSymbol: p.yahooSymbol,
                updatedAt: new Date(),
              },
            }),
        ),
      );
    }
    pairsCache = null;
    const rows = await getCachedForexPairs();
    return rows.length;
  })().finally(() => {
    initializePromise = null;
  });

  return initializePromise;
}

export async function syncForexPrices() {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    const started = Date.now();
    if (!cacheIsFresh(pairsCache, PAIRS_CACHE_TTL)) {
      await initializeForexPairs();
    }
    const snapshot = await fetchForexSnapshot();
    const pairs = await getCachedForexPairs();
    const by = new Map(pairs.map((p) => [p.symbol, p]));
    const timestamp = new Date(Math.floor(Date.now() / 5000) * 5000);
    let saved = 0;
    const quotes = snapshot.quotes.filter((q) => by.has(q.symbol));

    for (let i = 0; i < quotes.length; i += 12) {
      await Promise.all(
        quotes.slice(i, i + 12).map(async (q) => {
          const pair = by.get(q.symbol);
          if (!pair) return;
          await db
            .insert(forexPrices)
            .values({
              pairId: pair.id,
              price: q.price,
              bid: q.bid,
              ask: q.ask,
              change: q.change,
              changePercent: q.changePercent,
              source: snapshot.source,
              timestamp,
            })
            .onConflictDoUpdate({
              target: [forexPrices.pairId, forexPrices.timestamp],
              set: {
                price: q.price,
                bid: q.bid,
                ask: q.ask,
                change: q.change,
                changePercent: q.changePercent,
                source: snapshot.source,
                createdAt: new Date(),
              },
            });
          saved++;
        }),
      );
    }

    invalidatePriceCaches();
    const durationMs = Date.now() - started;
    log.info("forex_prices_synced", { source: snapshot.source, saved, durationMs });
    return { source: snapshot.source, saved, timestamp, durationMs };
  })().finally(() => {
    syncPromise = null;
  });

  return syncPromise;
}

export async function ensureForexFresh(maxAgeMs = 10_000) {
  if (cacheIsFresh(freshnessCache, FRESHNESS_CACHE_TTL)) {
    return freshnessCache!.value;
  }

  const r = await db.execute(sql`SELECT MAX(created_at) latest FROM forex_prices`);
  const raw = (r.rows[0] as { latest?: Date | string | null } | undefined)?.latest;
  const latest = raw ? new Date(raw).getTime() : 0;

  if (!latest) {
    // Cold DB — one blocking sync
    try {
      const refreshed = await syncForexPrices();
      const value = { refreshed: true, ...refreshed };
      freshnessCache = { value, timestamp: Date.now() };
      return value;
    } catch {
      return { refreshed: false };
    }
  }

  if (Date.now() - latest > maxAgeMs) {
    // Background only — never block chart path
    void syncForexPrices().catch((e) =>
      log.warn("bg_forex_sync_failed", { error: String(e) }),
    );
  }

  const value = { refreshed: false, latestAt: new Date(latest).toISOString() };
  freshnessCache = { value, timestamp: Date.now() };
  return value;
}

export async function listForexPairs(opts: { category?: string; search?: string } = {}) {
  const rows = await getCachedForexPairs();
  let result = rows;
  if (opts.category) result = result.filter((r) => r.category === opts.category);
  if (opts.search) {
    const q = opts.search.toUpperCase();
    result = result.filter(
      (r) => r.symbol.includes(q) || r.name.toUpperCase().includes(q),
    );
  }
  return result;
}

export async function latestForexPrices() {
  if (cacheIsFresh(latestPricesCache, LATEST_PRICES_CACHE_TTL)) {
    return latestPricesCache!.value;
  }
  const r = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (p.pair_id)
        f.symbol, f.name, f.category,
        f.base_currency AS "baseCurrency",
        f.quote_currency AS "quoteCurrency",
        p.price, p.bid, p.ask, p.change,
        p.change_percent AS "changePercent",
        p.source, p.timestamp
      FROM forex_pairs f
      JOIN forex_prices p ON p.pair_id = f.id
      ORDER BY p.pair_id, p.timestamp DESC
    )
    SELECT * FROM latest ORDER BY category, symbol
  `);
  latestPricesCache = { value: r.rows, timestamp: Date.now() };
  return r.rows;
}

export async function getForexPair(symbol: string) {
  const normalized = symbol.toUpperCase();
  const cached = pairCache.get(normalized);
  if (cached && Date.now() - cached.timestamp < PAIR_CACHE_TTL) {
    return cached.value;
  }

  const [pair] = await db
    .select()
    .from(forexPairs)
    .where(eq(forexPairs.symbol, normalized))
    .limit(1);

  if (!pair) {
    pairCache.set(normalized, { value: null, timestamp: Date.now() });
    return null;
  }

  const [price] = await db
    .select()
    .from(forexPrices)
    .where(eq(forexPrices.pairId, pair.id))
    .orderBy(desc(forexPrices.timestamp))
    .limit(1);

  const result = { pair, price };
  pairCache.set(normalized, { value: result, timestamp: Date.now() });
  return result;
}

interface DbOhlcv {
  bars: Ohlcv[];
  source: string;
  newestMs: number;
}

async function readOhlcvFromDb(
  pairId: string,
  timeframe: string,
  limit: number,
): Promise<DbOhlcv | null> {
  try {
    const rows = await db
      .select()
      .from(forexOhlcv)
      .where(and(eq(forexOhlcv.pairId, pairId), eq(forexOhlcv.timeframe, timeframe)))
      .orderBy(desc(forexOhlcv.time))
      .limit(limit);

    if (rows.length < Math.min(10, limit)) return null;
    const newest = rows[0]?.time;
    if (!newest) return null;

    const bars: Ohlcv[] = rows
      .map((r) => ({
        time: Math.floor(new Date(r.time).getTime() / 1000),
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume ?? 0,
      }))
      .reverse();

    return {
      bars,
      source: rows[0]?.source ?? "db-cache",
      newestMs: new Date(newest).getTime(),
    };
  } catch {
    return null;
  }
}

async function persistBars(
  pairId: string,
  timeframe: string,
  bars: Ohlcv[],
  source: string,
) {
  const chunk = 50;
  for (let i = 0; i < bars.length; i += chunk) {
    await Promise.all(
      bars.slice(i, i + chunk).map((b) =>
        db
          .insert(forexOhlcv)
          .values({
            pairId,
            timeframe,
            time: new Date(b.time * 1000),
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume,
            source,
          })
          .onConflictDoUpdate({
            target: [forexOhlcv.pairId, forexOhlcv.timeframe, forexOhlcv.time],
            set: {
              open: b.open,
              high: b.high,
              low: b.low,
              close: b.close,
              volume: b.volume,
              source,
            },
          }),
      ),
    );
  }
}

/**
 * Chart path target: 1–3s cold, <200ms warm.
 * Priority: memory → DB soft → DB hard+SWR → Yahoo race → DB fallback.
 */
export async function syncForexOhlcv(
  symbol: string,
  timeframe: string,
  limit = 120,
) {
  const sym = symbol.toUpperCase();
  const safeLimit = Math.min(200, Math.max(40, limit));
  const key = memKey(sym, timeframe, safeLimit);

  const mem = memOhlcv.get(key);
  if (mem && Date.now() - mem.at < MEM_OHLCV_TTL) {
    return {
      pair: (await getForexPair(sym))?.pair ?? ({ symbol: sym } as ForexPairRow),
      bars: mem.bars,
      source: `${mem.source}+mem`,
      stale: false,
    };
  }

  let found = await getForexPair(sym);
  if (!found) {
    await initializeForexPairs();
    found = await getForexPair(sym);
  }
  if (!found) throw new Error("Forex pair not found");

  const soft = OHLCV_SOFT_TTL[timeframe] ?? 180_000;
  const hard = OHLCV_HARD_TTL[timeframe] ?? 900_000;
  const cached = await readOhlcvFromDb(found.pair.id, timeframe, safeLimit);
  const age = cached ? Date.now() - cached.newestMs : Infinity;

  if (cached && age <= soft) {
    memOhlcv.set(key, {
      bars: cached.bars,
      source: cached.source,
      newestMs: cached.newestMs,
      at: Date.now(),
    });
    return {
      pair: found.pair,
      bars: cached.bars,
      source: cached.source,
      stale: false,
    };
  }

  if (cached && age <= hard) {
    void fetchForexBars(found.pair.symbol, timeframe, safeLimit)
      .then((result) => {
        memOhlcv.set(key, {
          bars: result.bars,
          source: result.source,
          newestMs: Date.now(),
          at: Date.now(),
        });
        return persistBars(found!.pair.id, timeframe, result.bars, result.source);
      })
      .catch((e) => log.warn("ohlcv_bg_refresh_failed", { symbol: sym, error: String(e) }));

    memOhlcv.set(key, {
      bars: cached.bars,
      source: cached.source,
      newestMs: cached.newestMs,
      at: Date.now(),
    });
    return {
      pair: found.pair,
      bars: cached.bars,
      source: `${cached.source}+swr`,
      stale: true,
    };
  }

  try {
    const result = await fetchForexBars(found.pair.symbol, timeframe, safeLimit);
    memOhlcv.set(key, {
      bars: result.bars,
      source: result.source,
      newestMs: Date.now(),
      at: Date.now(),
    });
    void persistBars(found.pair.id, timeframe, result.bars, result.source).catch((e) =>
      log.warn("ohlcv_persist_failed", { symbol: sym, error: String(e) }),
    );
    return {
      pair: found.pair,
      bars: result.bars,
      source: result.source,
      stale: false,
    };
  } catch (netErr) {
    if (cached && cached.bars.length >= 10) {
      log.warn("ohlcv_network_failed_using_db", {
        symbol: sym,
        timeframe,
        error: String(netErr),
      });
      return {
        pair: found.pair,
        bars: cached.bars,
        source: `${cached.source}+fallback`,
        stale: true,
      };
    }
    throw netErr;
  }
}

export async function runForexAnalysis(symbol: string, timeframe = "1h") {
  const { pair, bars, source } = await syncForexOhlcv(symbol, timeframe, 120);
  const a = analyzeForex(bars);
  void db
    .insert(forexAnalysis)
    .values({
      pairId: pair.id,
      timeframe,
      technicalSignals: a.indicators,
      patterns: { candlestick: a.candlestickPatterns, chart: a.chartPatterns },
      recommendation: a.recommendation,
      entryPrice: a.entryPrice,
      stopLoss: a.stopLoss,
      takeProfit: a.takeProfit,
      confidence: a.confidence,
      reason: a.reasons.join("; "),
      timestamp: new Date(),
    })
    .catch((e) => log.warn("analysis_persist_failed", { symbol, error: String(e) }));
  return { symbol: pair.symbol, name: pair.name, timeframe, source, ...a };
}

/** First paint: chart is priority; price sync never blocks. */
export async function getForexDetailBundle(
  symbol: string,
  timeframe = "1h",
  limit = 120,
) {
  const sym = symbol.toUpperCase();
  const safeLimit = Math.min(limit, 150);

  const [detail, ohlcv, analysis] = await Promise.all([
    (async () => {
      void ensureForexFresh(8_000).catch(() => undefined);
      return getForexPair(sym);
    })(),
    syncForexOhlcv(sym, timeframe, safeLimit),
    runForexAnalysis(sym, timeframe).catch(() => null),
  ]);

  if (!detail && !ohlcv) throw new Error("Forex pair not found");

  return {
    pair: detail?.pair ?? ohlcv.pair,
    price: detail?.price ?? null,
    bars: ohlcv.bars,
    timeframe,
    source: ohlcv.source,
    analysis,
  };
}

/** Pre-warm other TFs after first paint so switches stay <1s. */
export function warmForexTimeframes(symbol: string, primary = "1h") {
  const others = ["1m", "5m", "15m", "1h", "4h", "1d"].filter((t) => t !== primary);
  void Promise.allSettled(
    others.map((tf) =>
      syncForexOhlcv(symbol, tf, 100).catch((e) =>
        log.warn("ohlcv_warm_failed", { symbol, tf, error: String(e) }),
      ),
    ),
  );
}
