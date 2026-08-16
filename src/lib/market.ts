import { desc, eq, ilike, or, sql, and, gte } from "drizzle-orm";
import { db } from "@/db";
import { companies, jobLogs, news, priceSnapshots } from "@/db/schema";
import { cached, type Ohlcv, type Quote, type SymbolInfo, type Timeframe } from "@/lib/connectors/core";
import {
  cryptoPricesWithFallback,
  fetchAllRssNews,
  vndirectHistory,
  vndirectQuote,
  vndirectSearch,
  yahooHistory,
  type CryptoQuote,
} from "@/lib/connectors/providers";
import { logger } from "@/lib/logger";
import { analyzeSentiment } from "@/lib/sentiment";

/** Featured liquid VN tickers used for dashboard/breadth (symbols are identifiers; all data is fetched live). */
export const FEATURED_SYMBOLS = [
  "VNM", "VIC", "VHM", "HPG", "FPT", "MWG", "VCB", "TCB", "BID", "CTG",
  "SSI", "VND", "MSN", "GAS", "VRE", "MBB", "STB", "HDB", "POW", "GVR",
];

export const INDICES = [
  { code: "VNINDEX", name: "VN-Index", exchange: "HOSE" },
  { code: "HNX", name: "HNX-Index", exchange: "HNX" },
  { code: "UPCOM", name: "UPCOM-Index", exchange: "UPCOM" },
];

async function logJob(job: string, status: "ok" | "error", detail: string, durationMs: number) {
  try {
    await db.insert(jobLogs).values({ job, status, detail, durationMs });
  } catch (err) {
    logger.error("job_log_failed", { job, error: err instanceof Error ? err.message : String(err) });
  }
}

/* ----------------------- History with fallback chain ----------------------- */
export async function getHistory(symbol: string, from: number, to: number, timeframe: Timeframe): Promise<{ bars: Ohlcv[]; source: string; confidence: number }> {
  const key = `hist:${symbol}:${timeframe}:${Math.floor(from / 300)}:${Math.floor(to / 300)}`;
  return cached(key, timeframe === "D" ? 60_000 : 20_000, async () => {
    try {
      const bars = await vndirectHistory(symbol, from, to, timeframe);
      return { bars, source: "vndirect-dchart", confidence: 0.95 };
    } catch (primaryErr) {
      logger.warn("history_primary_failed", { symbol, error: primaryErr instanceof Error ? primaryErr.message : String(primaryErr) });
      const bars = await yahooHistory(symbol, from, to, timeframe);
      return { bars, source: "yahoo-finance", confidence: 0.85 };
    }
  });
}

/* ----------------------------- Validated quote ----------------------------- */
export async function getQuote(symbol: string): Promise<Quote> {
  const key = `quote:${symbol}`;
  const quote = await cached(key, 10_000, async () => {
    try {
      return await vndirectQuote(symbol);
    } catch (primaryErr) {
      logger.warn("quote_primary_failed", { symbol, error: primaryErr instanceof Error ? primaryErr.message : String(primaryErr) });
      const to = Math.floor(Date.now() / 1000);
      const bars = await yahooHistory(symbol, to - 86400 * 14, to, "D");
      const last = bars[bars.length - 1];
      const prev = bars.length > 1 ? bars[bars.length - 2] : null;
      return {
        symbol,
        time: last.time,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
        volume: last.volume,
        prevClose: prev?.close ?? null,
        changePct: prev ? ((last.close - prev.close) / prev.close) * 100 : null,
        source: "yahoo-finance",
        confidence: 0.85,
      } satisfies Quote;
    }
  });

  // Persist normalized snapshot (fire-and-forget, keeps latency low).
  void db
    .insert(priceSnapshots)
    .values({
      symbol: quote.symbol,
      time: new Date(quote.time * 1000),
      open: quote.open,
      high: quote.high,
      low: quote.low,
      close: quote.close,
      volume: quote.volume,
      changePct: quote.changePct ?? 0,
      source: quote.source,
      confidence: quote.confidence,
    })
    .onConflictDoUpdate({
      target: priceSnapshots.symbol,
      set: {
        time: new Date(quote.time * 1000),
        open: quote.open,
        high: quote.high,
        low: quote.low,
        close: quote.close,
        volume: quote.volume,
        changePct: quote.changePct ?? 0,
        source: quote.source,
        confidence: quote.confidence,
        updatedAt: new Date(),
      },
    })
    .catch((err) => logger.error("snapshot_upsert_failed", { symbol, error: String(err) }));

  return quote;
}

export async function getQuotes(symbols: string[]): Promise<Quote[]> {
  const results = await Promise.allSettled(symbols.map((s) => getQuote(s)));
  return results.filter((r): r is PromiseFulfilledResult<Quote> => r.status === "fulfilled").map((r) => r.value);
}

/* ------------------------------ Market overview ---------------------------- */
export async function getMarketOverview() {
  return cached("market:overview", 15_000, async () => {
    const started = Date.now();
    const [indexResults, quotes, cryptoResult] = await Promise.all([
      Promise.allSettled(INDICES.map((idx) => getQuote(idx.code))),
      getQuotes(FEATURED_SYMBOLS),
      cryptoPricesWithFallback().catch((err) => {
        logger.warn("crypto_failed", { error: String(err) });
        return [] as CryptoQuote[];
      }),
    ]);

    const indices = indexResults
      .map((r, i) => (r.status === "fulfilled" ? { ...INDICES[i], ...r.value } : null))
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const advancers = quotes.filter((q) => (q.changePct ?? 0) > 0.01).length;
    const decliners = quotes.filter((q) => (q.changePct ?? 0) < -0.01).length;
    const unchanged = quotes.length - advancers - decliners;
    const sorted = [...quotes].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));

    await logJob("market_overview", "ok", `indices=${indices.length} quotes=${quotes.length}`, Date.now() - started);

    return {
      indices,
      breadth: { advancers, decliners, unchanged, sample: quotes.length },
      topGainers: sorted.slice(0, 5),
      topLosers: sorted.slice(-5).reverse(),
      quotes,
      crypto: cryptoResult,
      generatedAt: new Date().toISOString(),
    };
  });
}

/* ---------------------------------- Search --------------------------------- */
export async function searchSymbols(query: string): Promise<SymbolInfo[]> {
  const q = query.trim();
  if (!q) return [];

  // Fast path: local DB (kept in sync from provider results).
  const local = await db
    .select()
    .from(companies)
    .where(or(ilike(companies.symbol, `${q}%`), ilike(companies.name, `%${q}%`)))
    .limit(15);

  let remote: SymbolInfo[] = [];
  try {
    remote = await cached(`search:${q.toUpperCase()}`, 300_000, () => vndirectSearch(q));
    // Sync provider results into normalized companies table.
    for (const r of remote.slice(0, 20)) {
      void db
        .insert(companies)
        .values({ symbol: r.symbol, name: r.name, exchange: r.exchange, type: r.type, source: r.source })
        .onConflictDoUpdate({
          target: companies.symbol,
          set: { name: r.name, exchange: r.exchange, type: r.type, updatedAt: new Date() },
        })
        .catch(() => undefined);
    }
  } catch (err) {
    logger.warn("search_remote_failed", { q, error: String(err) });
  }

  const seen = new Set<string>();
  const merged: SymbolInfo[] = [];
  for (const item of [
    ...local.map((c) => ({ symbol: c.symbol, name: c.name, exchange: c.exchange, type: c.type, source: c.source })),
    ...remote,
  ]) {
    if (seen.has(item.symbol)) continue;
    seen.add(item.symbol);
    merged.push(item);
  }
  return merged.slice(0, 20);
}

export async function getCompany(symbol: string): Promise<SymbolInfo | null> {
  const rows = await db.select().from(companies).where(eq(companies.symbol, symbol)).limit(1);
  if (rows.length > 0) {
    const c = rows[0];
    return { symbol: c.symbol, name: c.name, exchange: c.exchange, type: c.type, source: c.source };
  }
  try {
    const results = await searchSymbols(symbol);
    return results.find((r) => r.symbol === symbol) ?? null;
  } catch {
    return null;
  }
}

/* ----------------------------------- News ---------------------------------- */
const TICKER_RE = /\b([A-Z]{3})\b/g;

export async function syncNews(): Promise<{ inserted: number; errors: string[] }> {
  const started = Date.now();
  const { items, errors } = await fetchAllRssNews();
  let inserted = 0;

  const knownSymbols = new Set<string>(
    (await db.select({ symbol: companies.symbol }).from(companies)).map((r) => r.symbol),
  );
  for (const s of FEATURED_SYMBOLS) knownSymbols.add(s);

  for (const item of items) {
    const matched = new Set<string>();
    for (const m of `${item.title} ${item.description}`.matchAll(TICKER_RE)) {
      if (knownSymbols.has(m[1])) matched.add(m[1]);
    }
    // Run Vietnamese sentiment NLP on title + description
    const sentimentScore = analyzeSentiment(`${item.title} ${item.description}`);
    try {
      const res = await db
        .insert(news)
        .values({
          guid: item.guid.slice(0, 900),
          title: item.title,
          link: item.link,
          description: item.description,
          imageUrl: item.imageUrl,
          sourceName: item.sourceName,
          symbols: [...matched].join(" "),
          sentiment: sentimentScore,
          publishedAt: item.publishedAt,
        })
        .onConflictDoNothing({ target: news.guid })
        .returning({ id: news.id });
      if (res.length > 0) inserted += 1;
    } catch (err) {
      logger.error("news_insert_failed", { guid: item.guid, error: String(err) });
    }
  }

  await logJob("sync_news", errors.length === items.length && items.length === 0 ? "error" : "ok", `fetched=${items.length} inserted=${inserted} errors=${errors.join("; ")}`, Date.now() - started);
  return { inserted, errors };
}

let lastNewsSync = 0;
export async function getNews(opts: { page?: number; limit?: number; symbol?: string } = {}) {
  // Refresh from real feeds at most once per 90s (lazy scheduler).
  if (Date.now() - lastNewsSync > 90_000) {
    lastNewsSync = Date.now();
    await syncNews().catch((err) => logger.error("sync_news_failed", { error: String(err) }));
  }
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
  const where = opts.symbol
    ? or(ilike(news.symbols, `%${opts.symbol}%`), ilike(news.title, `%${opts.symbol}%`))
    : undefined;

  const rows = await db
    .select()
    .from(news)
    .where(where)
    .orderBy(desc(news.publishedAt))
    .limit(limit)
    .offset((page - 1) * limit);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(news)
    .where(where);

  return { items: rows, total: count, page, limit };
}

/* ----------------------------- Sentiment API ------------------------------ */
export async function getNewsSentiment(symbol: string) {
  return cached(`sentiment:${symbol}`, 30_000, async () => {
    // Ensure news are fresh
    if (Date.now() - lastNewsSync > 90_000) {
      lastNewsSync = Date.now();
      await syncNews().catch(() => undefined);
    }
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ sentiment: news.sentiment, title: news.title, publishedAt: news.publishedAt })
      .from(news)
      .where(
        and(
          gte(news.publishedAt, cutoff),
          or(ilike(news.symbols, `%${symbol}%`), ilike(news.title, `%${symbol}%`)),
        ),
      )
      .orderBy(desc(news.publishedAt))
      .limit(20);

    // Also get overall market sentiment (all news last 24h)
    const allRows = await db
      .select({ sentiment: news.sentiment })
      .from(news)
      .where(gte(news.publishedAt, cutoff))
      .limit(100);

    const symbolAvg = rows.length > 0 ? rows.reduce((s, r) => s + r.sentiment, 0) / rows.length : 0;
    const marketAvg = allRows.length > 0 ? allRows.reduce((s, r) => s + r.sentiment, 0) / allRows.length : 0;

    return {
      symbol,
      sentimentScore: Number(symbolAvg.toFixed(3)),
      marketSentiment: Number(marketAvg.toFixed(3)),
      newsCount24h: rows.length,
      articles: rows.map((r) => ({
        title: r.title,
        sentiment: r.sentiment,
        publishedAt: r.publishedAt,
      })),
    };
  });
}
