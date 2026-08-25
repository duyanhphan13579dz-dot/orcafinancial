import { desc, eq, ilike, or, sql, and, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { companies, jobLogs, news, priceSnapshots, priceSnapshotHistory } from "@/db/schema";
import {
  cached,
  mapPool,
  CONNECTOR_CONFIG,
  type Ohlcv,
  type Quote,
  type SymbolInfo,
  type Timeframe,
} from "@/lib/connectors/core";
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

export const FEATURED_SYMBOLS = [
  "VNM", "VIC", "VHM", "HPG", "FPT", "MWG", "VCB", "TCB", "BID", "CTG",
  "SSI", "VND", "MSN", "GAS", "VRE", "MBB", "STB", "HDB", "POW", "GVR",
];

export const INDICES = [
  { code: "VNINDEX", name: "VN-Index", exchange: "HOSE" },
  { code: "HNX", name: "HNX-Index", exchange: "HNX" },
  { code: "UPCOM", name: "UPCOM-Index", exchange: "UPCOM" },
];

/** Prefer DB snapshot if newer than this (ms). */
const SNAPSHOT_FRESH_MS = 45_000;

/** Market overview cache — longer TTL = sub-second warm dashboard hits via Redis. */
const OVERVIEW_TTL_MS = Number(process.env.MARKET_OVERVIEW_TTL_MS) || 60_000;
const QUOTE_TTL_MS = Number(process.env.MARKET_QUOTE_TTL_MS) || 20_000;
const HIST_D_TTL_MS = Number(process.env.MARKET_HIST_D_TTL_MS) || 120_000;
const HIST_INTRA_TTL_MS = Number(process.env.MARKET_HIST_INTRA_TTL_MS) || 30_000;

async function logJob(job: string, status: "ok" | "error", detail: string, durationMs: number) {
  try {
    await db.insert(jobLogs).values({ job, status, detail, durationMs });
  } catch (err) {
    logger.error("job_log_failed", { job, error: err instanceof Error ? err.message : String(err) });
  }
}

function snapshotToQuote(row: typeof priceSnapshots.$inferSelect): Quote {
  return {
    symbol: row.symbol,
    time: Math.floor(row.time.getTime() / 1000),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
    prevClose: null,
    changePct: row.changePct != null ? Number(row.changePct) : null,
    source: `${row.source}-snapshot`,
    confidence: Number(row.confidence ?? 0.9),
  };
}

async function loadFreshSnapshots(symbols: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  if (symbols.length === 0) return out;
  try {
    const cutoff = new Date(Date.now() - SNAPSHOT_FRESH_MS);
    const rows = await db
      .select()
      .from(priceSnapshots)
      .where(and(inArray(priceSnapshots.symbol, symbols), gte(priceSnapshots.updatedAt, cutoff)));
    for (const row of rows) out.set(row.symbol, snapshotToQuote(row));
  } catch (err) {
    logger.warn("snapshot_batch_read_failed", { error: String(err) });
  }
  return out;
}

export async function getHistory(
  symbol: string,
  from: number,
  to: number,
  timeframe: Timeframe,
): Promise<{ bars: Ohlcv[]; source: string; confidence: number }> {
  const key = `hist:${symbol}:${timeframe}:${Math.floor(from / 300)}:${Math.floor(to / 300)}`;
  return cached(key, timeframe === "D" ? HIST_D_TTL_MS : HIST_INTRA_TTL_MS, async () => {
    try {
      const bars = await vndirectHistory(symbol, from, to, timeframe);
      return { bars, source: "vndirect-dchart", confidence: 0.95 };
    } catch (primaryErr) {
      logger.warn("history_primary_failed", {
        symbol,
        error: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
      });
      const bars = await yahooHistory(symbol, from, to, timeframe);
      return { bars, source: "yahoo-finance", confidence: 0.85 };
    }
  });
}

export async function getQuote(symbol: string): Promise<Quote> {
  const key = `quote:${symbol}`;
  const quote = await cached(key, QUOTE_TTL_MS, async () => {
    const snaps = await loadFreshSnapshots([symbol]);
    const snap = snaps.get(symbol);
    if (snap) return snap;

    try {
      return await vndirectQuote(symbol);
    } catch (primaryErr) {
      logger.warn("quote_primary_failed", {
        symbol,
        error: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
      });
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
    .insert(priceSnapshotHistory)
    .values({
      symbol: quote.symbol,
      time: new Date(quote.time * 1000),
      open: quote.open,
      high: quote.high,
      low: quote.low,
      close: quote.close,
      volume: quote.volume,
      changePct: quote.changePct ?? 0,
      source: quote.source.replace(/-snapshot$/, ""),
      confidence: quote.confidence,
    })
    .onConflictDoNothing({ target: [priceSnapshotHistory.symbol, priceSnapshotHistory.time] })
    .catch((err) => logger.warn("snapshot_history_insert_failed", { symbol: quote.symbol, error: String(err) }));

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
      source: quote.source.replace(/-snapshot$/, ""),
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
        source: quote.source.replace(/-snapshot$/, ""),
        confidence: quote.confidence,
        updatedAt: new Date(),
      },
    })
    .catch((err) => logger.error("snapshot_upsert_failed", { symbol, error: String(err) }));

  return quote;
}

export async function getQuotes(symbols: string[]): Promise<Quote[]> {
  if (symbols.length === 0) return [];

  const snaps = await loadFreshSnapshots(symbols);
  const missing = symbols.filter((s) => !snaps.has(s));

  if (missing.length > 0) {
    const settled = await mapPool(
      missing,
      CONNECTOR_CONFIG.quoteConcurrency,
      (s) => getQuote(s),
    );
    for (const r of settled) {
      if (r.status === "fulfilled") snaps.set(r.value.symbol, r.value);
    }
  }

  return symbols.map((s) => snaps.get(s)).filter((q): q is Quote => Boolean(q));
}

export async function getMarketOverview() {
  return cached("market:overview", OVERVIEW_TTL_MS, async () => {
    const started = Date.now();
    const indexCodes = INDICES.map((i) => i.code);

    const [indexQuotes, quotes, cryptoResult] = await Promise.all([
      getQuotes(indexCodes),
      getQuotes(FEATURED_SYMBOLS),
      cryptoPricesWithFallback().catch((err) => {
        logger.warn("crypto_failed", { error: String(err) });
        return [] as CryptoQuote[];
      }),
    ]);

    const indexByCode = new Map(indexQuotes.map((q) => [q.symbol, q]));
    const indices = INDICES.map((idx) => {
      const q = indexByCode.get(idx.code);
      return q ? { ...idx, ...q } : null;
    }).filter((x): x is NonNullable<typeof x> => x !== null);

    const advancers = quotes.filter((q) => (q.changePct ?? 0) > 0.01).length;
    const decliners = quotes.filter((q) => (q.changePct ?? 0) < -0.01).length;
    const unchanged = quotes.length - advancers - decliners;
    const sorted = [...quotes].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));

    await logJob(
      "market_overview",
      "ok",
      `indices=${indices.length} quotes=${quotes.length}`,
      Date.now() - started,
    );

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

export async function searchSymbols(query: string): Promise<SymbolInfo[]> {
  const q = query.trim();
  if (!q) return [];

  return cached(`search:v2:${q.toUpperCase()}`, 300_000, async () => {
    let local: (typeof companies.$inferSelect)[] = [];
    try {
      local = await db
        .select()
        .from(companies)
        .where(or(ilike(companies.symbol, `${q}%`), ilike(companies.name, `%${q}%`)))
        .limit(15);
    } catch (err) {
      logger.warn("search_local_db_failed", { q, error: String(err) });
    }

    const exact = local.find((c) => c.symbol.toUpperCase() === q.toUpperCase());
    if (exact && q.length <= 4) {
      return [
        {
          symbol: exact.symbol,
          name: exact.name,
          exchange: exact.exchange,
          type: exact.type,
          source: exact.source,
        },
        ...local
          .filter((c) => c.symbol !== exact.symbol)
          .map((c) => ({
            symbol: c.symbol,
            name: c.name,
            exchange: c.exchange,
            type: c.type,
            source: c.source,
          })),
      ].slice(0, 20);
    }

    let remote: SymbolInfo[] = [];
    try {
      remote = await vndirectSearch(q);
      for (const r of remote.slice(0, 20)) {
        void db
          .insert(companies)
          .values({
            symbol: r.symbol,
            name: r.name,
            exchange: r.exchange,
            type: r.type,
            source: r.source,
          })
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
      ...local.map((c) => ({
        symbol: c.symbol,
        name: c.name,
        exchange: c.exchange,
        type: c.type,
        source: c.source,
      })),
      ...remote,
    ]) {
      if (seen.has(item.symbol)) continue;
      seen.add(item.symbol);
      merged.push(item);
    }
    return merged.slice(0, 20);
  });
}

export async function getCompany(symbol: string): Promise<SymbolInfo | null> {
  try {
    const rows = await db.select().from(companies).where(eq(companies.symbol, symbol)).limit(1);
    if (rows.length > 0) {
      const c = rows[0];
      return { symbol: c.symbol, name: c.name, exchange: c.exchange, type: c.type, source: c.source };
    }
  } catch (err) {
    logger.warn("get_company_db_failed", { symbol, error: String(err) });
  }
  try {
    const results = await searchSymbols(symbol);
    return results.find((r) => r.symbol === symbol) ?? null;
  } catch {
    return null;
  }
}

const TICKER_RE = /\b([A-Z]{3})\b/g;
const NEWS_SYNC_INTERVAL_MS = 120_000;
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
    // DB down — still insert with featured symbols only
  }

  const chunkSize = CONNECTOR_CONFIG.newsInsertConcurrency;
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

  newsListCache.clear();

  await logJob(
    "sync_news",
    errors.length === items.length && items.length === 0 ? "error" : "ok",
    `fetched=${items.length} inserted=${inserted} errors=${errors.join("; ")}`,
    Date.now() - started,
  );
  return { inserted, errors };
}

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

/** Never throw on DB failure — Agent and news page keep working with empty/cached. */
export async function getNews(opts: { page?: number; limit?: number; symbol?: string } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
  const symbolKey = opts.symbol?.toUpperCase() ?? "";
  const cacheKey = `news:${page}:${limit}:${symbolKey}`;

  const hit = newsListCache.get(cacheKey);
  if (hit && Date.now() - hit.at < NEWS_LIST_CACHE_MS) {
    scheduleNewsSync();
    return hit.value;
  }

  scheduleNewsSync();

  const where = opts.symbol
    ? or(ilike(news.symbols, `%${opts.symbol}%`), ilike(news.title, `%${opts.symbol}%`))
    : undefined;

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
      db.select({ count: sql<number>`count(*)::int` }).from(news).where(where),
    ]);
    rows = rowResult;
    count = countResult[0]?.count ?? 0;
  } catch (err) {
    logger.warn("get_news_db_failed", { error: String(err) });
    if (hit) return hit.value;
    // Soft-fail: empty payload so Agent continues without news context
    return { items: [], total: 0, page, limit, degraded: true } as NewsListPayload & {
      degraded?: boolean;
    };
  }

  if (rows.length === 0 && count === 0 && !opts.symbol) {
    try {
      if (newsSyncInFlight) {
        await newsSyncInFlight;
      } else {
        lastNewsSync = Date.now();
        await syncNews();
      }
      const [rowResult, countResult] = await Promise.all([
        db.select().from(news).orderBy(desc(news.publishedAt)).limit(limit).offset((page - 1) * limit),
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
  if (newsListCache.size > 40) {
    const oldest = newsListCache.keys().next().value;
    if (oldest) newsListCache.delete(oldest);
  }
  return payload;
}

export async function getNewsSentiment(symbol: string) {
  return cached(`sentiment:${symbol}`, 90_000, async () => {
    scheduleNewsSync();

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let rows: { sentiment: number; title: string; publishedAt: Date }[] = [];
    let allRows: { sentiment: number }[] = [];
    try {
      const [r1, r2] = await Promise.all([
        db
          .select({ sentiment: news.sentiment, title: news.title, publishedAt: news.publishedAt })
          .from(news)
          .where(
            and(
              gte(news.publishedAt, cutoff),
              or(ilike(news.symbols, `%${symbol}%`), ilike(news.title, `%${symbol}%`)),
            ),
          )
          .orderBy(desc(news.publishedAt))
          .limit(20),
        db.select({ sentiment: news.sentiment }).from(news).where(gte(news.publishedAt, cutoff)).limit(100),
      ]);
      rows = r1;
      allRows = r2;
    } catch (err) {
      logger.warn("get_news_sentiment_db_failed", { symbol, error: String(err) });
    }

    const headlines = rows.map((r) => r.title);
    const hybrid = await scoreSentimentHybrid(symbol, headlines);
    const marketAvg =
      allRows.length > 0 ? allRows.reduce((s, r) => s + r.sentiment, 0) / allRows.length : 0;

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
