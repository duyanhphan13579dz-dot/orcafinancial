import { desc, eq, sql, and } from "drizzle-orm";
import { db } from "@/db";
import { FOREX_PAIRS } from "./data";
import { forexAnalysis, forexOhlcv, forexPairs, forexPrices } from "./schema";
import { fetchForexBars, fetchForexSnapshot } from "./connectors";
import { analyzeForex } from "./analysis";
import { forProvider } from "@/lib/logger";
import type { Ohlcv } from "@/lib/connectors/core";

const log = forProvider("forex-service");

let syncPromise: Promise<{
  source: string;
  saved: number;
  timestamp: Date;
  durationMs: number;
}> | null = null;

/** Soft TTL — serve from DB immediately; hard TTL forces network refresh. */
const OHLCV_SOFT_TTL: Record<string, number> = {
  "1m": 20_000,
  "5m": 45_000,
  "15m": 90_000,
  "1h": 180_000,
  "4h": 600_000,
  "1d": 1_800_000,
};
const OHLCV_HARD_TTL: Record<string, number> = {
  "1m": 90_000,
  "5m": 180_000,
  "15m": 360_000,
  "1h": 900_000,
  "4h": 2_700_000,
  "1d": 7_200_000,
};

export async function initializeForexPairs() {
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
  return FOREX_PAIRS.length;
}

export async function syncForexPrices() {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const started = Date.now();
    await initializeForexPairs();
    const snapshot = await fetchForexSnapshot();
    const pairs = await db.select().from(forexPairs);
    const by = new Map(pairs.map((p) => [p.symbol, p]));
    const timestamp = new Date(Math.floor(Date.now() / 5000) * 5000);
    let saved = 0;
    const quotes = snapshot.quotes.filter((q) => by.has(q.symbol));
    for (let i = 0; i < quotes.length; i += 12) {
      await Promise.all(
        quotes.slice(i, i + 12).map(async (q) => {
          const pair = by.get(q.symbol)!;
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
    log.info("forex_prices_synced", {
      source: snapshot.source,
      saved,
      durationMs: Date.now() - started,
    });
    return {
      source: snapshot.source,
      saved,
      timestamp,
      durationMs: Date.now() - started,
    };
  })().finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}

export async function ensureForexFresh(maxAgeMs = 10_000) {
  const r = await db.execute(sql`SELECT MAX(created_at) latest FROM forex_prices`);
  const raw = (r.rows[0] as { latest?: Date | string | null } | undefined)?.latest;
  const latest = raw ? new Date(raw).getTime() : 0;
  if (!latest || Date.now() - latest > maxAgeMs)
    return { refreshed: true, ...(await syncForexPrices()) };
  return { refreshed: false, latestAt: new Date(latest).toISOString() };
}

export async function listForexPairs(opts: { category?: string; search?: string } = {}) {
  let rows = await db.select().from(forexPairs).orderBy(forexPairs.category, forexPairs.symbol);
  if (opts.category) rows = rows.filter((r) => r.category === opts.category);
  if (opts.search) {
    const q = opts.search.toUpperCase();
    rows = rows.filter((r) => r.symbol.includes(q) || r.name.toUpperCase().includes(q));
  }
  return rows;
}

export async function latestForexPrices() {
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
  return r.rows;
}

export async function getForexPair(symbol: string) {
  const [pair] = await db
    .select()
    .from(forexPairs)
    .where(eq(forexPairs.symbol, symbol.toUpperCase()))
    .limit(1);
  if (!pair) return null;
  const [price] = await db
    .select()
    .from(forexPrices)
    .where(eq(forexPrices.pairId, pair.id))
    .orderBy(desc(forexPrices.timestamp))
    .limit(1);
  return { pair, price };
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
  const rows = await db
    .select()
    .from(forexOhlcv)
    .where(and(eq(forexOhlcv.pairId, pairId), eq(forexOhlcv.timeframe, timeframe)))
    .orderBy(desc(forexOhlcv.time))
    .limit(limit);

  if (rows.length < Math.min(15, limit)) return null;
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
}

async function persistBars(pairId: string, timeframe: string, bars: Ohlcv[], source: string) {
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

export async function syncForexOhlcv(symbol: string, timeframe: string, limit = 300) {
  let found = await getForexPair(symbol);
  if (!found) {
    await initializeForexPairs();
    found = await getForexPair(symbol);
  }
  if (!found) throw new Error("Forex pair not found");

  const soft = OHLCV_SOFT_TTL[timeframe] ?? 180_000;
  const hard = OHLCV_HARD_TTL[timeframe] ?? 900_000;
  const cached = await readOhlcvFromDb(found.pair.id, timeframe, limit);
  const age = cached ? Date.now() - cached.newestMs : Infinity;

  if (cached && age <= soft) {
    log.info("ohlcv_db_fresh", { symbol, timeframe, bars: cached.bars.length, ageMs: age });
    return { pair: found.pair, bars: cached.bars, source: cached.source, stale: false };
  }

  if (cached && age <= hard) {
    log.info("ohlcv_swr", { symbol, timeframe, bars: cached.bars.length, ageMs: age });
    void fetchForexBars(found.pair.symbol, timeframe, limit)
      .then((result) => persistBars(found!.pair.id, timeframe, result.bars, result.source))
      .catch((e) => log.warn("ohlcv_bg_refresh_failed", { symbol, error: String(e) }));
    return { pair: found.pair, bars: cached.bars, source: `${cached.source}+swr`, stale: true };
  }

  const result = await fetchForexBars(found.pair.symbol, timeframe, limit);
  void persistBars(found.pair.id, timeframe, result.bars, result.source).catch((e) =>
    log.warn("ohlcv_persist_failed", { symbol, error: String(e) }),
  );
  return { pair: found.pair, bars: result.bars, source: result.source, stale: false };
}

export async function runForexAnalysis(symbol: string, timeframe = "1h") {
  const { pair, bars, source } = await syncForexOhlcv(symbol, timeframe, 300);
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

/** One-shot payload for first paint: pair + live price + chart + analysis. */
export async function getForexDetailBundle(symbol: string, timeframe = "1h", limit = 300) {
  const sym = symbol.toUpperCase();
  const [detail, ohlcv, analysis] = await Promise.all([
    (async () => {
      await ensureForexFresh(8000);
      return getForexPair(sym);
    })(),
    syncForexOhlcv(sym, timeframe, limit),
    runForexAnalysis(sym, timeframe).catch(() => null),
  ]);
  if (!detail) throw new Error("Forex pair not found");
  return {
    pair: detail.pair,
    price: detail.price,
    bars: ohlcv.bars,
    timeframe,
    source: ohlcv.source,
    analysis,
  };
}
