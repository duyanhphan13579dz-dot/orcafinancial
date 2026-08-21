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
import { scoreSentimentHybrid } from "@/lib/llm";
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

  const local = await db
    .select()
    .from(companies)
    .where(or(ilike(companies.symbol, `${q}%`), ilike(companies.name, `%${q}%`)))
    .limit(15);

  let remote: SymbolInfo[] = [];
  try {
    remote = await cached(`search:${q.toUpperCase()}`, 300_000, () => vndirectSearch(q));
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

/** How often we kick a background RSS refresh (do not block the API). */
const NEWS_SYNC_INTERVAL_MS = 120_000;
/** Soft TTL for in-memory list responses — first paint from RAM. */
const NEWS_LIST_CACHE_MS = 20_000;

let lastNewsSync = 0;
let newsSyncInFlight: Promise<{ inserted: number; errors: string[] }> | null = null;

interface NewsListPayload {
  items: (typeof news.$inferSelect)[];
  total: number;
  page: number;
  limit: number;
}

const newsListCache = new Map<string, { at: number; value: NewsListPayload }>();

export async function syncNews(): Promise<{ inserted: number; errors: string[] }> {
  const started = Date.now();
  const { items, errors } = await fetchAllRssNews();
  let inserted = 0;

  let knownSymbols = new Set<string>(FEATURED_SYMBOLS);
  try {
    const rows = await db.select({ symbol: companies.symbol }).from(companies);
    knownSymbols = new Set([...FEATURED_SYMBOLS, ...rows.map((r) => r.symbol)]);
  } catch {
    // DB down — still score with featured set only
  }

  // Batch inserts in chunks to cut round-trips
  const chunkSize = 25;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (item) => {
        const matched = new Set<string>();
        for (const m of `${item.title} ${item.description}`.matchAll(TICKER_RE)) {
          if (knownSymbols.has(m[1])) matched.add(m[1]);
        }
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
      }),
    );
  }

  // Invalidate list cache after successful ingest
  newsListCache.clear();

  await logJob(
    "sync_news",
    errors.length === items.length && items.length === 0 ? "error" : "ok",
    `fetched=${items.length} inserted=${inserted} errors=${errors.join("; ")}`,
    Date.now() - started,
  );
  return { inserted, errors };
}

/** Kick RSS sync without blocking the caller (deduped). */
function scheduleNewsSync(): void {
  if (newsSyncInFlight) return;
  if (Date.now() - lastNewsSync < NEWS_SYNC_INTERVAL_MS) return;
  lastNewsSync = Date.now();
  newsSyncInFlight = syncNews()
    .catch((err) => {
      logger.error("sync_news_failed", { error: String(err) });
      return { inserted: 0, errors: [String(err)] };
    })
    .finally(() => {
      newsSyncInFlight = null;
    });
}

export async function getNews(opts: { page?: number; limit?: number; symbol?: string } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
  const symbolKey = opts.symbol?.toUpperCase() ?? "";
  const cacheKey = `news:${page}:${limit}:${symbolKey}`;

  // 1) In-memory SWR — return immediately if fresh
  const hit = newsListCache.get(cacheKey);
  if (hit && Date.now() - hit.at < NEWS_LIST_CACHE_MS) {
    scheduleNewsSync(); // refresh RSS in background
    return hit.value;
  }

  // 2) Never await RSS on the request path — serve DB first
  scheduleNewsSync();

  const where = opts.symbol
    ? or(ilike(news.symbols, `%${opts.symbol}%`), ilike(news.title, `%${opts.symbol}%`))
    : undefined;

  // 3) Parallel count + page query
  let rows: (typeof news.$inferSelect)[] = [];
  let count = 0;
  try {
    const [rowResult, countResult] = await Promise.all([
      db
        .select()
        .from(news)
        .where(where)
        .orderBy(desc(news.publishedAt))
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(news)
        .where(where),
    ]);
    rows = rowResult;
    count = countResult[0]?.count ?? 0;
  } catch (err) {
    logger.error("get_news_db_failed", { error: String(err) });
    // If DB is empty/down and we still have a stale cache, serve it
    if (hit) return hit.value;
    throw err;
  }

  // Cold DB (no rows yet): wait once for first sync so UI is not empty
  if (rows.length === 0 && count === 0 && !opts.symbol) {
    try {
      if (newsSyncInFlight) {
        await newsSyncInFlight;
      } else {
        lastNewsSync = Date.now();
        await syncNews();
      }
      const [rowResult, countResult] = await Promise.all([
        db
          .select()
          .from(news)
          .orderBy(desc(news.publishedAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ count: sql<number>`count(*)::int` }).from(news),
      ]);
      rows = rowResult;
      count = countResult[0]?.count ?? 0;
    } catch (err) {
      logger.warn("get_news_cold_sync_failed", { error: String(err) });
    }
  }

  const payload: NewsListPayload = { items: rows, total: count, page, limit };
  newsListCache.set(cacheKey, { at: Date.now(), value: payload });
  // Cap cache size
  if (newsListCache.size > 40) {
    const oldest = newsListCache.keys().next().value;
    if (oldest) newsListCache.delete(oldest);
  }
  return payload;
}

/* ----------------------------- Sentiment API ------------------------------ */
export async function getNewsSentiment(symbol: string) {
  return cached(`sentiment:${symbol}`, 60_000, async () => {
    // Background only — do not block sentiment behind full RSS ingest
    scheduleNewsSync();

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

    const allRows = await db
      .select({ sentiment: news.sentiment })
      .from(news)
      .where(gte(news.publishedAt, cutoff))
      .limit(100);

    const headlines = rows.map((r) => r.title);
    const hybrid = await scoreSentimentHybrid(symbol, headlines);

    const marketAvg = allRows.length > 0 ? allRows.reduce((s, r) => s + r.sentiment, 0) / allRows.length : 0;

    return {
      symbol,
      sentimentScore: hybrid.score,
      marketSentiment: Number(marketAvg.toFixed(3)),
      newsCount24h: rows.length,
      label: hybrid.label,
      confidence: hybrid.confidence,
      rationale: hybrid.rationale,
      source: hybrid.source,
      model: hybrid.model ?? null,
      articles: rows.map((r) => ({
        title: r.title,
        sentiment: r.sentiment,
        publishedAt: r.publishedAt,
      })),
    };
  });
}
