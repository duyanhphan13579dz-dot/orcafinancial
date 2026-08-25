import { desc, eq, sql, and } from "drizzle-orm";
import { db } from "@/db";
import { FOREX_PAIRS, FOREX_BY_SYMBOL } from "./data";
import {
  forexAnalysis,
  forexOhlcv,
  forexPairs,
  forexPrices,
} from "./schema";
import {
  fetchForexBars,
  fetchForexSnapshot,
  type ForexQuote,
} from "./connectors";
import { analyzeForex } from "./analysis";
import { forProvider } from "@/lib/logger";
import type { Ohlcv } from "@/lib/connectors/core";
import { timeframesFor } from "./timeframes";
import { toQuoteContract } from "./normalize";
import type { ForexQuoteContract } from "./types";
import {
  applyTickToBars,
  applyTickToMemMap,
  getOhlcvPolicy,
  PRICE_REFRESH_MS,
} from "./realtime";
import { buildMtfResult, mtfStackFor } from "./mtf";
import { buildFxIntelligence } from "./fx-intelligence";
import { buildTradeSetup } from "./trade-setup";
import { enrichWithMacroAiAlerts } from "./enrich-analysis";

const log = forProvider("forex-service");

const FRESHNESS_CACHE_TTL = 4_000;
const LATEST_PRICES_CACHE_TTL = 4_000;
const PAIRS_CACHE_TTL = 5 * 60_000;
const PAIR_CACHE_TTL = 4_000;
const LIVE_QUOTE_CACHE_TTL = PRICE_REFRESH_MS.memoryTtl;

const MEM_OHLCV_TTL = 25_000;
const memOhlcv = new Map<
  string,
  { bars: Ohlcv[]; source: string; newestMs: number; at: number }
>();

let liveSnapshotCache: {
  bySymbol: Map<string, ForexQuote>;
  source: string;
  at: number;
} | null = null;

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
const quoteContractCache = new Map<string, CacheEntry<ForexQuoteContract>>();

function cacheIsFresh<T>(entry: CacheEntry<T> | null | undefined, ttl: number) {
  return Boolean(entry && Date.now() - entry.timestamp < ttl);
}

function invalidatePriceCaches() {
  freshnessCache = null;
  latestPricesCache = null;
  pairCache.clear();
  quoteContractCache.clear();
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

function rememberSnapshot(quotes: ForexQuote[], source: string) {
  const bySymbol = new Map<string, ForexQuote>();
  for (const q of quotes) bySymbol.set(q.symbol.toUpperCase(), q);
  liveSnapshotCache = { bySymbol, source, at: Date.now() };
}

export function tickMergeFromLiveSnapshot(): number {
  if (!liveSnapshotCache) return 0;
  const now = Date.now();
  if (now - liveSnapshotCache.at > 20_000) return 0;
  let total = 0;
  for (const [sym, q] of liveSnapshotCache.bySymbol) {
    if (!Number.isFinite(q.price) || q.price <= 0) continue;
    total += applyTickToMemMap(memOhlcv, sym, q.price, now);
  }
  if (total > 0) {
    log.info("tick_merge_ok", { series: total, symbols: liveSnapshotCache.bySymbol.size });
  }
  return total;
}

export async function syncForexPrices() {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    const started = Date.now();
    if (!cacheIsFresh(pairsCache, PAIRS_CACHE_TTL)) {
      await initializeForexPairs();
    }
    const snapshot = await fetchForexSnapshot();
    rememberSnapshot(snapshot.quotes, snapshot.source);

    const pairs = await getCachedForexPairs();
    const by = new Map(pairs.map((p) => [p.symbol, p]));
    const timestamp = new Date(Math.floor(Date.now() / 4000) * 4000);
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
    tickMergeFromLiveSnapshot();

    const durationMs = Date.now() - started;
    log.info("forex_prices_synced", { source: snapshot.source, saved, durationMs });
    return { source: snapshot.source, saved, timestamp, durationMs };
  })().finally(() => {
    syncPromise = null;
  });

  return syncPromise;
}

export async function ensureForexFresh(maxAgeMs = 8_000) {
  if (cacheIsFresh(freshnessCache, FRESHNESS_CACHE_TTL)) {
    return freshnessCache!.value;
  }

  const r = await db.execute(sql`SELECT MAX(created_at) latest FROM forex_prices`);
  const raw = (r.rows[0] as { latest?: Date | string | null } | undefined)?.latest;
  const latest = raw ? new Date(raw).getTime() : 0;

  if (!latest) {
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

async function loadLiveQuoteContract(
  symbol: string,
): Promise<ForexQuoteContract | null> {
  const sym = symbol.toUpperCase();
  const cached = quoteContractCache.get(sym);
  if (cached && Date.now() - cached.timestamp < LIVE_QUOTE_CACHE_TTL) {
    return cached.value;
  }

  const def = FOREX_BY_SYMBOL.get(sym);

  if (liveSnapshotCache && Date.now() - liveSnapshotCache.at < 12_000) {
    const q = liveSnapshotCache.bySymbol.get(sym);
    if (q) {
      const contract = toQuoteContract(q, {
        name: def?.name,
        category: def?.category,
        baseCurrency: def?.baseCurrency,
        quoteCurrency: def?.quoteCurrency,
        forceDegraded: q.degraded,
      });
      quoteContractCache.set(sym, { value: contract, timestamp: Date.now() });
      return contract;
    }
  }

  const found = await getForexPair(sym);
  if (found?.price) {
    const p = found.price;
    const contract = toQuoteContract(
      {
        symbol: sym,
        price: p.price,
        bid: p.bid,
        ask: p.ask,
        change: p.change,
        changePercent: p.changePercent,
        source: p.source,
        timestamp: new Date(p.timestamp),
      },
      {
        name: found.pair.name,
        category: found.pair.category,
        baseCurrency: found.pair.baseCurrency,
        quoteCurrency: found.pair.quoteCurrency,
      },
    );
    if (contract.ageMs > 12_000) {
      void syncForexPrices().catch(() => undefined);
    }
    quoteContractCache.set(sym, { value: contract, timestamp: Date.now() });
    return contract;
  }

  try {
    const snap = await fetchForexSnapshot();
    rememberSnapshot(snap.quotes, snap.source);
    tickMergeFromLiveSnapshot();
    const q = snap.quotes.find((x) => x.symbol === sym);
    if (!q) return null;
    const contract = toQuoteContract(q, {
      name: def?.name,
      category: def?.category,
      baseCurrency: def?.baseCurrency,
      quoteCurrency: def?.quoteCurrency,
      forceDegraded: q.degraded,
    });
    quoteContractCache.set(sym, { value: contract, timestamp: Date.now() });
    return contract;
  } catch (e) {
    log.warn("live_quote_network_failed", { symbol: sym, error: String(e) });
    return null;
  }
}

const quoteInflight = new Map<string, Promise<ForexQuoteContract | null>>();

export function getLiveQuoteContract(symbol: string) {
  const normalized = symbol.toUpperCase();
  const cached = quoteContractCache.get(normalized);
  if (cached && Date.now() - cached.timestamp < LIVE_QUOTE_CACHE_TTL) {
    return Promise.resolve(cached.value);
  }
  const existing = quoteInflight.get(normalized);
  if (existing) return existing;
  const pending = loadLiveQuoteContract(normalized).finally(() => {
    quoteInflight.delete(normalized);
  });
  quoteInflight.set(normalized, pending);
  return pending;
}

export function mapRowsToContracts(
  rows: Array<Record<string, unknown>>,
): ForexQuoteContract[] {
  return rows.map((r) => {
    const symbol = String(r.symbol ?? "").toUpperCase();
    const def = FOREX_BY_SYMBOL.get(symbol);
    return toQuoteContract(
      {
        symbol,
        price: Number(r.price),
        bid: r.bid == null ? null : Number(r.bid),
        ask: r.ask == null ? null : Number(r.ask),
        change: r.change == null ? null : Number(r.change),
        changePercent: r.changePercent == null ? null : Number(r.changePercent),
        source: String(r.source ?? "db"),
        timestamp: new Date(String(r.timestamp)),
      },
      {
        name: String(r.name ?? def?.name ?? symbol),
        category: String(r.category ?? def?.category ?? "usd_cross"),
        baseCurrency: String(r.baseCurrency ?? def?.baseCurrency ?? ""),
        quoteCurrency: String(r.quoteCurrency ?? def?.quoteCurrency ?? ""),
      },
    );
  });
}

async function loadForexPair(symbol: string) {
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

const pairInflight = new Map<string, Promise<ForexPairDetail>>();

export function getForexPair(symbol: string) {
  const normalized = symbol.toUpperCase();
  const existing = pairInflight.get(normalized);
  if (existing) return existing;
  const pending = loadForexPair(normalized).finally(() => {
    pairInflight.delete(normalized);
  });
  pairInflight.set(normalized, pending);
  return pending;
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

async function loadForexOhlcv(
  symbol: string,
  timeframe: string,
  limit = 120,
) {
  const sym = symbol.toUpperCase();
  const safeLimit = Math.min(200, Math.max(40, limit));
  const key = memKey(sym, timeframe, safeLimit);
  const policy = getOhlcvPolicy(timeframe);

  const applyLiveTick = async (bars: Ohlcv[], source: string, stale: boolean) => {
    const live = await getLiveQuoteContract(sym).catch(() => null);
    const patched = live ? applyTickToBars(bars, live.price, timeframe) : bars;
    const existing = memOhlcv.get(key);
    if (existing) {
      existing.bars = patched;
      existing.at = Date.now();
    }
    const lastClose = patched.length ? patched[patched.length - 1].close : null;
    return {
      pair: (await getForexPair(sym))?.pair ?? ({ symbol: sym } as ForexPairRow),
      bars: patched,
      source: live ? `${source}+tick` : source,
      stale,
      quote: live,
      lastCandleClose: lastClose,
      priceVsCandleDiff:
        live && lastClose != null ? live.price - lastClose : null,
    };
  };

  const mem = memOhlcv.get(key);
  if (mem && Date.now() - mem.at < MEM_OHLCV_TTL) {
    return applyLiveTick(mem.bars, `${mem.source}+mem`, false);
  }

  let found = await getForexPair(sym);
  if (!found) {
    await initializeForexPairs();
    found = await getForexPair(sym);
  }
  if (!found) throw new Error("Forex pair not found");

  const soft = policy.soft;
  const hard = policy.hard;
  const cached = await readOhlcvFromDb(found.pair.id, timeframe, safeLimit);
  const age = cached ? Date.now() - cached.newestMs : Infinity;

  if (cached && age <= soft) {
    memOhlcv.set(key, {
      bars: cached.bars,
      source: cached.source,
      newestMs: cached.newestMs,
      at: Date.now(),
    });
    return applyLiveTick(cached.bars, cached.source, false);
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
    return applyLiveTick(cached.bars, `${cached.source}+swr`, true);
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
    return applyLiveTick(result.bars, result.source, false);
  } catch (netErr) {
    if (cached && cached.bars.length >= 10) {
      log.warn("ohlcv_network_failed_using_db", {
        symbol: sym,
        timeframe,
        error: String(netErr),
      });
      return applyLiveTick(cached.bars, `${cached.source}+fallback`, true);
    }
    throw netErr;
  }
}

const ohlcvInflight = new Map<
  string,
  Promise<Awaited<ReturnType<typeof loadForexOhlcv>>>
>();

export function syncForexOhlcv(symbol: string, timeframe: string, limit = 120) {
  const normalized = symbol.toUpperCase();
  const safeLimit = Math.min(200, Math.max(40, limit));
  const key = memKey(normalized, timeframe, safeLimit);
  const existing = ohlcvInflight.get(key);
  if (existing) return existing;

  const pending = loadForexOhlcv(normalized, timeframe, safeLimit).finally(() => {
    ohlcvInflight.delete(key);
  });
  ohlcvInflight.set(key, pending);
  return pending;
}

export async function runMtfAnalysis(symbol: string) {
  const sym = symbol.toUpperCase();
  const stack = mtfStackFor(sym);
  const results = await Promise.all(
    stack.map(async (s) => {
      try {
        const o = await syncForexOhlcv(sym, s.tf, 80);
        return { timeframe: s.tf, label: s.label, weight: s.weight, bars: o.bars };
      } catch (e) {
        log.warn("mtf_tf_failed", { symbol: sym, tf: s.tf, error: String(e) });
        return { timeframe: s.tf, label: s.label, weight: s.weight, bars: null };
      }
    }),
  );
  return buildMtfResult(results);
}

export async function runFxIntelligence(symbol: string) {
  const rows = (await latestForexPrices()) as Array<Record<string, unknown>>;
  const quotes = rows.map((r) => ({
    symbol: String(r.symbol ?? ""),
    changePercent: r.changePercent == null ? null : Number(r.changePercent),
  }));
  if (liveSnapshotCache) {
    const dxy = liveSnapshotCache.bySymbol.get("DXY");
    if (dxy && !quotes.some((q) => q.symbol === "DXY")) {
      quotes.push({ symbol: "DXY", changePercent: dxy.changePercent });
    }
  }
  return buildFxIntelligence(symbol.toUpperCase(), quotes);
}

export async function runForexAnalysis(symbol: string, timeframe = "1h") {
  const ohlcv = await syncForexOhlcv(symbol, timeframe, 120);
  const { pair, bars, source, quote } = ohlcv;
  const a = analyzeForex(bars);

  const [mtf, fxIntel] = await Promise.all([
    runMtfAnalysis(symbol).catch((e) => {
      log.warn("mtf_failed", { symbol, error: String(e) });
      return null;
    }),
    runFxIntelligence(symbol).catch((e) => {
      log.warn("fx_intel_failed", { symbol, error: String(e) });
      return null;
    }),
  ]);

  let recommendation = a.recommendation;
  let confidence = a.confidence;
  const extraReasons: string[] = [];

  if (mtf) {
    extraReasons.push(`[MTF] ${mtf.summary} (${Math.round(mtf.alignment * 100)}% align)`);
    if (mtf.context.includes("conflict")) {
      if (recommendation !== "NEUTRAL") {
        recommendation = "NEUTRAL";
        confidence = Math.min(confidence, 0.5);
        extraReasons.push("[MTF] Conflict → force NEUTRAL");
      }
    } else if (mtf.overall === "bullish" && recommendation === "SELL") {
      recommendation = "NEUTRAL";
      confidence = Math.min(confidence, 0.52);
      extraReasons.push("[MTF] Against HTF bullish → NEUTRAL");
    } else if (mtf.overall === "bearish" && recommendation === "BUY") {
      recommendation = "NEUTRAL";
      confidence = Math.min(confidence, 0.52);
      extraReasons.push("[MTF] Against HTF bearish → NEUTRAL");
    } else if (
      mtf.alignment >= 0.7 &&
      ((mtf.overall === "bullish" && recommendation === "BUY") ||
        (mtf.overall === "bearish" && recommendation === "SELL"))
    ) {
      confidence = Math.min(0.93, confidence + 0.06);
      extraReasons.push("[MTF] Strong alignment boost");
    }
  }

  if (fxIntel) {
    extraReasons.push(
      `[Session] ${fxIntel.session.label} · vol ${fxIntel.session.volatility} · liq ${fxIntel.session.liquidity}`,
    );
    if (fxIntel.dxy.pairExpected !== "n/a" && fxIntel.dxy.dxyBias !== "unknown") {
      extraReasons.push(`[DXY] ${fxIntel.dxy.note}`);
      if (
        (recommendation === "BUY" && fxIntel.dxy.pairExpected === "bearish") ||
        (recommendation === "SELL" && fxIntel.dxy.pairExpected === "bullish")
      ) {
        confidence = Math.max(0.35, confidence - 0.05);
        extraReasons.push("[DXY] Against DXY correlation — confidence −5%");
      }
    }
    if (fxIntel.pairBiasFromStrength.bias !== "neutral") {
      extraReasons.push(`[Strength] ${fxIntel.pairBiasFromStrength.note}`);
    }
    if (fxIntel.session.liquidity === "LOW" && recommendation !== "NEUTRAL") {
      confidence = Math.max(0.35, confidence - 0.04);
    }
  }

  const entryPrice = quote?.price ?? a.entryPrice;
  const riskDist =
    a.stopLoss !== null && recommendation === "BUY"
      ? entryPrice - a.stopLoss
      : a.stopLoss !== null && recommendation === "SELL"
        ? a.stopLoss - entryPrice
        : null;

  const stopLoss =
    riskDist !== null && recommendation === "BUY"
      ? entryPrice - riskDist
      : riskDist !== null && recommendation === "SELL"
        ? entryPrice + riskDist
        : a.stopLoss;
  const takeProfit =
    riskDist !== null && recommendation === "BUY"
      ? entryPrice + riskDist * 2
      : riskDist !== null && recommendation === "SELL"
        ? entryPrice - riskDist * 2
        : a.takeProfit;
  const takeProfit2 =
    riskDist !== null && recommendation === "BUY"
      ? entryPrice + riskDist * 3.5
      : riskDist !== null && recommendation === "SELL"
        ? entryPrice - riskDist * 3.5
        : a.takeProfit2;

  const tradeSetup = buildTradeSetup({
    symbol: pair.symbol,
    recommendation,
    confidence,
    entry: entryPrice,
    stopLoss,
    takeProfit,
    takeProfit2,
    layers: a.layers ?? [],
    mtf,
    fx: fxIntel,
    regime: a.volatilityRegime,
  });

  if (recommendation !== "NEUTRAL") {
    confidence = tradeSetup.confidenceBreakdown.total / 100;
  }

  const enriched = await enrichWithMacroAiAlerts({
    symbol: pair.symbol,
    name: pair.name,
    timeframe,
    recommendation,
    confidence,
    entryPrice,
    stopLoss,
    takeProfit,
    takeProfit2,
    reasons: [...extraReasons, ...a.reasons],
    layers: a.layers,
    marketStructure: a.marketStructure,
    volatilityRegime: a.volatilityRegime,
    compositeScore: a.compositeScore,
    indicators: a.indicators as Record<string, unknown>,
    mtf,
    fxIntelligence: fxIntel,
    tradeSetup,
    quote: quote
      ? {
          price: quote.price,
          changePercent: quote.changePercent,
          bid: quote.bid,
          ask: quote.ask,
          spreadPips: quote.spreadPips,
          freshness: quote.freshness,
        }
      : null,
  });

  recommendation = enriched.recommendation;
  confidence = enriched.confidence;

  void db
    .insert(forexAnalysis)
    .values({
      pairId: pair.id,
      timeframe,
      technicalSignals: a.indicators,
      patterns: { candlestick: a.candlestickPatterns, chart: a.chartPatterns },
      recommendation,
      entryPrice,
      stopLoss,
      takeProfit,
      confidence,
      reason: enriched.reasons.join("; "),
      timestamp: new Date(),
    })
    .catch((e) => log.warn("analysis_persist_failed", { symbol, error: String(e) }));

  return {
    symbol: pair.symbol,
    name: pair.name,
    timeframe,
    source,
    ...a,
    recommendation,
    confidence: Number(confidence.toFixed(2)),
    entryPrice,
    stopLoss,
    takeProfit,
    takeProfit2,
    reasons: enriched.reasons.slice(0, 16),
    mtf,
    fxIntelligence: fxIntel,
    tradeSetup,
    macro: enriched.macro,
    analyst: enriched.analyst,
    alerts: enriched.alerts,
    quote: quote ?? null,
  };
}

export async function getForexDetailBundle(
  symbol: string,
  timeframe = "1h",
  limit = 120,
) {
  const sym = symbol.toUpperCase();
  const safeLimit = Math.min(limit, 150);

  const [quote, ohlcv, analysis] = await Promise.all([
    getLiveQuoteContract(sym),
    syncForexOhlcv(sym, timeframe, safeLimit),
    runForexAnalysis(sym, timeframe).catch(() => null),
  ]);

  if (!quote && !ohlcv) throw new Error("Forex pair not found");

  return {
    pair: ohlcv.pair,
    price: quote
      ? {
          price: quote.price,
          bid: quote.bid,
          ask: quote.ask,
          change: quote.change,
          changePercent: quote.changePercent,
          source: quote.source,
          timestamp: quote.timestamp,
          spread: quote.spread,
          spreadPips: quote.spreadPips,
          freshness: quote.freshness,
          ageMs: quote.ageMs,
        }
      : null,
    quote,
    bars: ohlcv.bars,
    timeframe,
    source: ohlcv.source,
    analysis,
  };
}

export function warmForexTimeframes(symbol: string, primary = "1h") {
  const others = timeframesFor(symbol).filter((t) => t !== primary);
  void Promise.allSettled(
    others.map((tf) =>
      syncForexOhlcv(symbol, tf, 100).catch((e) =>
        log.warn("ohlcv_warm_failed", { symbol, tf, error: String(e) }),
      ),
    ),
  );
}
