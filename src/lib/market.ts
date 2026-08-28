import { desc, eq, ilike, or, sql, and, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { companies, jobLogs, news, priceSnapshots, priceSnapshotHistory } from "@/db/schema";
import {
  cached,
  cachedWithStaleFallback,
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
  tcbsQuote,
  vndirectHistory,
  vndirectQuote,
  vndirectSearch,
  yahooHistory,
  type CryptoQuote,
} from "@/lib/connectors/providers";
import { scoreSentimentHybrid } from "@/lib/llm";
import { isTcbsMockEnabled, tcbsMockQuote } from "@/lib/connectors/tcbs-mock";
import { logger } from "@/lib/logger";
import { analyzeSentiment } from "@/lib/sentiment";
import { SECTOR_DEFINITIONS, type MarketPulse, type MarketSnapshot, type MarketStatus, type OvernightMarketItem, type OvernightMarketSnapshot, type SectorSnapshot } from "@/types/market";

export const FEATURED_SYMBOLS = [
  "VNM", "VIC", "VHM", "HPG", "FPT", "MWG", "VCB", "TCB", "BID", "CTG",
  "SSI", "VND", "MSN", "GAS", "VRE", "MBB", "STB", "HDB", "POW", "GVR",
];

/**
 * Expanded sector universe. It is fetched separately from the compact dashboard
 * universe so the richer board does not make the first overview render heavier.
 */
export const SECTOR_SYMBOLS = [...new Set(SECTOR_DEFINITIONS.flatMap((sector) => sector.symbols))];

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
const OVERVIEW_AUX_TIMEOUT_MS = Number(process.env.MARKET_OVERVIEW_AUX_TIMEOUT_MS) || 450;
const SECTOR_QUOTE_TIMEOUT_MS = Number(process.env.MARKET_SECTOR_QUOTE_TIMEOUT_MS) || 1_800;
const OVERVIEW_TOTAL_TIMEOUT_MS = Number(process.env.MARKET_OVERVIEW_TOTAL_TIMEOUT_MS) || 2_500;
const OVERNIGHT_TTL_MS = Number(process.env.OVERNIGHT_MARKET_TTL_MS) || 45_000;
const OVERNIGHT_TIMEOUT_MS = Number(process.env.OVERNIGHT_MARKET_TIMEOUT_MS) || 1_200;

const OVERNIGHT_DEFINITIONS: ReadonlyArray<Omit<OvernightMarketItem, "value" | "changePct" | "source" | "status" | "updatedAt">> = [
  { symbol: "^GSPC", label: "S&P 500", kind: "index", unit: "pts" },
  { symbol: "^NDX", label: "Nasdaq 100", kind: "index", unit: "pts" },
  { symbol: "^DJI", label: "Dow Jones", kind: "index", unit: "pts" },
  { symbol: "^N225", label: "Nikkei 225", kind: "index", unit: "pts" },
  { symbol: "^HSI", label: "Hang Seng", kind: "index", unit: "pts" },
  { symbol: "^VIX", label: "VIX", kind: "index", unit: "pts" },
  { symbol: "GC=F", label: "Gold futures", kind: "commodity", unit: "USD" },
  { symbol: "BZ=F", label: "Brent futures", kind: "commodity", unit: "USD" },
  { symbol: "CL=F", label: "WTI futures", kind: "commodity", unit: "USD" },
  { symbol: "HG=F", label: "Copper futures", kind: "commodity", unit: "USD" },
  { symbol: "DX-Y.NYB", label: "USD Index", kind: "fx", unit: "pts" },
  { symbol: "EURUSD=X", label: "EUR/USD", kind: "fx", unit: "rate" },
  { symbol: "JPY=X", label: "USD/JPY", kind: "fx", unit: "rate" },
  { symbol: "^TNX", label: "US 10Y", kind: "rates", unit: "%" },
];

export async function withDeadline<T>(promise: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((resolve) => { timer = setTimeout(() => { logger.warn("overview_deadline_fallback", { label, timeoutMs: ms }); resolve(fallback); }, ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function logJob(job: string, status: "ok" | "error", detail: string, durationMs: number) {
  try {
    await db.insert(jobLogs).values({ job, status, detail, durationMs });
  } catch (err) {
    logger.error("job_log_failed", { job, error: err instanceof Error ? err.message : String(err) });
  }
}

function snapshotToQuote(row: typeof priceSnapshots.$inferSelect, stale = false): Quote {
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
    source: `${row.source}-${stale ? "stale-" : ""}snapshot`,
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

async function loadStaleSnapshots(symbols: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  if (symbols.length === 0) return out;
  try {
    const rows = await db.select().from(priceSnapshots).where(inArray(priceSnapshots.symbol, symbols));
    for (const row of rows) out.set(row.symbol, snapshotToQuote(row, true));
  } catch (err) {
    logger.warn("snapshot_stale_read_failed", { error: String(err) });
  }
  return out;
}

/** Read all fresh current snapshots for breadth without fabricating universe data. */
async function loadMarketSnapshots(): Promise<Quote[]> {
  try {
    const cutoff = new Date(Date.now() - SNAPSHOT_FRESH_MS);
    const rows = await db
      .select()
      .from(priceSnapshots)
      .where(gte(priceSnapshots.updatedAt, cutoff))
      .limit(2000);
    return rows.map((row) => snapshotToQuote(row));
  } catch (err) {
    logger.warn("market_snapshot_breadth_read_failed", { error: String(err) });
    return [];
  }
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

export async function getQuote(symbol: string, options: { persist?: boolean; fast?: boolean; allowStale?: boolean; concurrency?: number } = {}): Promise<Quote> {
  const key = `quote:${symbol}`;
  const quote = await cached(key, QUOTE_TTL_MS, async () => {
    const providerOptions = options.fast ? { timeoutMs: 1_500, retries: 0 } : undefined;
    if (isTcbsMockEnabled()) {
      return tcbsMockQuote(symbol);
    }
    if (process.env.TCBS_MARKET_DATA_URL?.trim()) {
      try {
        return await tcbsQuote(symbol, providerOptions);
      } catch (tcbsErr) {
        logger.warn("quote_tcbs_failed", {
          symbol,
          error: tcbsErr instanceof Error ? tcbsErr.message : String(tcbsErr),
        });
      }
    }

    const snaps = await loadFreshSnapshots([symbol]);
    const snap = snaps.get(symbol);
    if (snap) return snap;

    try {
      return await vndirectQuote(symbol, providerOptions);
    } catch (primaryErr) {
      logger.warn("quote_primary_failed", {
        symbol,
        error: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
      });
      const to = Math.floor(Date.now() / 1000);
      const bars = await yahooHistory(symbol, to - 86400 * 14, to, "D", providerOptions);
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

  if (options.persist !== false) void db
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

  if (options.persist !== false) void db
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

export async function getQuotes(symbols: string[], options: { persist?: boolean; fast?: boolean; allowStale?: boolean; concurrency?: number } = {}): Promise<Quote[]> {
  if (symbols.length === 0) return [];

  const snaps = await loadFreshSnapshots(symbols);
  const missing = symbols.filter((s) => !snaps.has(s));
  if (options.allowStale && missing.length > 0) {
    const stale = await loadStaleSnapshots(missing);
    for (const [symbol, quote] of stale) snaps.set(symbol, quote);
  }
  const upstreamMissing = symbols.filter((s) => !snaps.has(s));

  if (upstreamMissing.length > 0) {
    const settled = await mapPool(
      upstreamMissing,
      options.concurrency ?? CONNECTOR_CONFIG.quoteConcurrency,
      (s) => getQuote(s, options),
    );
    for (const r of settled) {
      if (r.status === "fulfilled") snaps.set(r.value.symbol, r.value);
    }
  }

  return symbols.map((s) => snaps.get(s)).filter((q): q is Quote => Boolean(q));
}

function statusFromChange(change: number): MarketStatus {
  if (change > 0.05) return "up";
  if (change < -0.05) return "down";
  return "flat";
}

function buildBreadth(quotes: Quote[], scope: "featured" | "market"): MarketSnapshot["breadth"] {
  const advancing = quotes.filter((q) => (q.changePct ?? 0) > 0.01).length;
  const declining = quotes.filter((q) => (q.changePct ?? 0) < -0.01).length;
  const unchanged = Math.max(0, quotes.length - advancing - declining);
  return {
    advancing,
    advancers: advancing,
    declining,
    decliners: declining,
    unchanged,
    sample: quotes.length,
    ratio: quotes.length ? (advancing - declining) / quotes.length : 0,
    scope,
  };
}

function buildSectors(quotes: Quote[]): SectorSnapshot[] {
  const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));
  return SECTOR_DEFINITIONS.map((sector) => {
    const stocks = sector.symbols.map((symbol) => bySymbol.get(symbol)).filter((q): q is Quote => Boolean(q));
    const changes = stocks.map((q) => q.changePct).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const averageChangePct = changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : null;
    const advancing = stocks.filter((q) => (q.changePct ?? 0) > 0.01).length;
    const declining = stocks.filter((q) => (q.changePct ?? 0) < -0.01).length;
    const unchanged = Math.max(0, stocks.length - advancing - declining);
    const strength = stocks.length ? Math.round(((advancing + unchanged * 0.5) / stocks.length) * 100) : null;
    return {
      id: sector.id,
      label: sector.label,
      shortLabel: sector.shortLabel,
      averageChangePct,
      strength,
      advancing,
      unchanged,
      declining,
      volume: stocks.reduce((sum, q) => sum + q.volume, 0),
      stocks,
    };
  }).filter((sector) => sector.stocks.length > 0);
}

function buildPulse(indexes: Quote[], breadth: MarketSnapshot["breadth"], sectors: SectorSnapshot[], totalVolume: number): MarketPulse {
  const primary = indexes.find((q) => q.symbol === "VNINDEX") ?? indexes[0];
  const trendScore = primary?.changePct ?? 0;
  const breadthScore = breadth.ratio * 100;
  const sectorAverage = sectors.length ? sectors.reduce((sum, s) => sum + (s.averageChangePct ?? 0), 0) / sectors.length : 0;
  const trend: MarketStatus = statusFromChange(trendScore);
  const breadthStatus: MarketStatus = statusFromChange(breadthScore);
  const liquidity: MarketStatus = totalVolume > 0 ? "up" : "flat";
  const foreignFlow = "unknown" as const;
  const risk: MarketPulse["risk"] = trend === "down" && breadthScore < -20 ? "high" : trend === "flat" || breadthScore < -5 ? "medium" : "low";
  const regime: MarketPulse["regime"] = trend === "up" && breadthScore > 10 ? "BULLISH_TREND" : trend === "down" && breadthScore < -10 ? "BROAD_RISK_OFF" : Math.abs(sectorAverage) > 0.15 ? "SELECTIVE_ROTATION" : "NEUTRAL";
  const regimeLabel = { BULLISH_TREND: "BROAD MARKET ADVANCE", BROAD_RISK_OFF: "BROAD RISK-OFF", SELECTIVE_ROTATION: "SELECTIVE ROTATION", BEARISH_TREND: "BEARISH TREND", NEUTRAL: "BALANCED MARKET" }[regime];
  return {
    trend,
    trendScore,
    breadth: breadthStatus,
    breadthScore,
    liquidity,
    liquidityScore: totalVolume > 0 ? 100 : 0,
    foreignFlow,
    risk,
    regime,
    regimeLabel,
    summary: primary ? `VN-Index ${primary.changePct == null ? "chưa có biến động" : `${primary.changePct >= 0 ? "+" : ""}${primary.changePct.toFixed(2)}%`}; breadth nhóm theo dõi ${breadthScore >= 0 ? "nghiêng tích cực" : "nghiêng tiêu cực"}.` : "Chưa đủ dữ liệu để xác định trạng thái thị trường.",
  };
}

function emptyOvernightSnapshot(): OvernightMarketSnapshot {
  const generatedAt = new Date().toISOString();
  return {
    items: OVERNIGHT_DEFINITIONS.map((definition) => ({
      ...definition,
      value: null,
      changePct: null,
      source: "unavailable",
      status: "unavailable" as const,
      updatedAt: null,
    })),
    stale: true,
    partial: true,
    missingSymbols: OVERNIGHT_DEFINITIONS.map((definition) => definition.symbol),
    generatedAt,
    sources: [],
  };
}

async function loadOvernightMarketSnapshot(): Promise<OvernightMarketSnapshot> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 5 * 86_400;
  const results = await mapPool([...OVERNIGHT_DEFINITIONS], 6, async (definition) => {
    try {
      const bars = await yahooHistory(definition.symbol, from, to, "D", { timeoutMs: 1_000, retries: 0 });
      const last = bars[bars.length - 1];
      const previous = bars.length > 1 ? bars[bars.length - 2] : null;
      const changePct = previous && previous.close > 0 ? ((last.close - previous.close) / previous.close) * 100 : null;
      return {
        ...definition,
        value: last.close,
        changePct,
        unit: definition.unit,
        source: "yahoo-finance",
        status: "delayed" as const,
        updatedAt: new Date(last.time * 1000).toISOString(),
      } satisfies OvernightMarketItem;
    } catch (err) {
      logger.warn("overnight_market_item_failed", { symbol: definition.symbol, error: err instanceof Error ? err.message : String(err) });
      return {
        ...definition,
        value: null,
        changePct: null,
        source: "unavailable",
        status: "unavailable" as const,
        updatedAt: null,
      } satisfies OvernightMarketItem;
    }
  });
  const items: OvernightMarketItem[] = results.map((result, index) => result.status === "fulfilled" ? result.value as OvernightMarketItem : {
    ...OVERNIGHT_DEFINITIONS[index],
    value: null,
    changePct: null,
    source: "unavailable",
    status: "unavailable",
    updatedAt: null,
  });
  const available = items.filter((item) => item.value != null);
  return {
    items,
    stale: false,
    partial: available.length !== items.length,
    missingSymbols: items.filter((item) => item.value == null).map((item) => item.symbol),
    generatedAt: new Date().toISOString(),
    sources: [...new Set(available.map((item) => item.source))],
  };
}

export async function getOvernightMarketSnapshot(): Promise<OvernightMarketSnapshot> {
  const refresh = cachedWithStaleFallback<OvernightMarketSnapshot>(
    "market:overnight:v1",
    OVERNIGHT_TTL_MS,
    loadOvernightMarketSnapshot,
    { shouldCache: (snapshot) => snapshot.items.some((item) => item.value != null), fallback: emptyOvernightSnapshot() },
  );
  const result = await withDeadline(refresh, OVERNIGHT_TIMEOUT_MS, { value: emptyOvernightSnapshot(), stale: true }, "overnight-markets");
  return {
    ...result.value,
    stale: result.value.stale || result.stale,
  };
}

function emptyOverview(): MarketSnapshot {
  const generatedAt = new Date().toISOString();
  const breadth = { advancing: 0, advancers: 0, unchanged: 0, declining: 0, decliners: 0, sample: 0, ratio: 0, scope: "featured" as const };
  return {
    indices: [], breadth, marketBreadth: breadth, largeCapBreadth: breadth, sectors: [],
    pulse: { trend: "flat", trendScore: 0, breadth: "flat", breadthScore: 0, liquidity: "flat", liquidityScore: 0, foreignFlow: "unknown", risk: "medium", regime: "NEUTRAL", regimeLabel: "DATA SYNCING", summary: "Đang đồng bộ dữ liệu thị trường." },
    liquidity: { totalVolume: 0, averageVolume: 0, status: "flat" }, foreignFlow: { status: "unknown", value: null },
    topGainers: [], topLosers: [], topVolume: [], sectorQuotes: [], quotes: [], crypto: [], overnight: emptyOvernightSnapshot(), news: [],
    quality: { generatedAt, ageSeconds: 0, partial: true, missingSymbols: [...INDICES.map((i) => i.code), ...FEATURED_SYMBOLS, ...SECTOR_SYMBOLS], stale: true, sources: [], confidence: 0 }, generatedAt,
  };
}

export async function getMarketOverview(): Promise<MarketSnapshot> {
  const refresh = cachedWithStaleFallback<MarketSnapshot>("market:overview:v4", OVERVIEW_TTL_MS, async () => {
    const started = Date.now();
    const indexCodes = INDICES.map((i) => i.code);
    const coreSymbols = [...new Set([...indexCodes, ...FEATURED_SYMBOLS])];
    const requestedSymbols = [...new Set([...coreSymbols, ...SECTOR_SYMBOLS])];
    const [coreQuotes, sectorOnlyQuotes, cryptoResult] = await Promise.all([
      getQuotes(coreSymbols, { persist: false, allowStale: true, fast: true, concurrency: 8 }),
      withDeadline(
        getQuotes(SECTOR_SYMBOLS, { persist: false, allowStale: true, fast: true, concurrency: 12 }),
        SECTOR_QUOTE_TIMEOUT_MS,
        [],
        "sector-quotes",
      ),
      withDeadline(cryptoPricesWithFallback().catch((err) => {
        logger.warn("crypto_failed", { error: String(err) });
        return [] as CryptoQuote[];
      }), 1_200, [] as CryptoQuote[], "crypto").catch((err) => {
        logger.warn("crypto_failed", { error: String(err) });
        return [] as CryptoQuote[];
      }),
    ]);
    const quoteBySymbol = new Map([...coreQuotes, ...sectorOnlyQuotes].map((quote) => [quote.symbol, quote]));
    const indexQuotes = indexCodes.map((symbol) => quoteBySymbol.get(symbol)).filter((quote): quote is Quote => Boolean(quote));
    const quotes = FEATURED_SYMBOLS.map((symbol) => quoteBySymbol.get(symbol)).filter((quote): quote is Quote => Boolean(quote));
    const sectorQuotes = SECTOR_SYMBOLS.map((symbol) => quoteBySymbol.get(symbol)).filter((quote): quote is Quote => Boolean(quote));
    const indexByCode = new Map(indexQuotes.map((q) => [q.symbol, q]));
    const indices = INDICES.map((idx) => {
      const q = indexByCode.get(idx.code);
      return q ? { ...idx, ...q, primary: idx.code === "VNINDEX" } : null;
    }).filter((x): x is NonNullable<typeof x> => x !== null);
    const breadth = buildBreadth(quotes, "featured");
    const [marketUniverse, newsResult, overnight] = await Promise.all([
      withDeadline(loadMarketSnapshots(), OVERVIEW_AUX_TIMEOUT_MS, [], "market-breadth"),
      withDeadline(getNews({ page: 1, limit: 8, withTotal: false }), OVERVIEW_AUX_TIMEOUT_MS, { items: [], total: 0, page: 1, limit: 8 }, "news"),
      getOvernightMarketSnapshot(),
    ]);
    const marketBreadth = buildBreadth(marketUniverse.length > quotes.length ? marketUniverse : quotes, marketUniverse.length > quotes.length ? "market" : "featured");
    const largeCapBreadth = buildBreadth(quotes, "featured");
    const sectors = buildSectors(sectorQuotes);
    const sorted = [...quotes].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
    const topVolume = [...quotes].sort((a, b) => b.volume - a.volume).slice(0, 5);
    const totalVolume = quotes.reduce((sum, q) => sum + q.volume, 0);
    const newsItems = newsResult.items.map((item) => ({
      id: item.id,
      title: item.title,
      link: item.link,
      sourceName: item.sourceName,
      symbols: item.symbols,
      publishedAt: item.publishedAt.toISOString(),
      imageUrl: item.imageUrl,
    }));
    const generatedAt = new Date().toISOString();
    const sources = [...new Set([...indices, ...quotes, ...sectorQuotes].map((q) => q.source.replace(/-snapshot$/, "")))];
    const availableSymbols = new Set([...indexQuotes, ...quotes, ...sectorQuotes].map((q) => q.symbol));
    const missingSymbols = requestedSymbols.filter((symbol) => !availableSymbols.has(symbol));
    void logJob("market_overview", "ok", `indices=${indices.length} quotes=${quotes.length} sectorQuotes=${sectorQuotes.length} sectors=${sectors.length} overnight=${overnight.items.filter((item) => item.value != null).length}`, Date.now() - started);
    return {
      indices,
      breadth,
      marketBreadth,
      largeCapBreadth,
      sectors,
      pulse: buildPulse(indexQuotes, marketBreadth, sectors, totalVolume),
      liquidity: { totalVolume, averageVolume: quotes.length ? totalVolume / quotes.length : 0, status: totalVolume > 0 ? "up" : "flat" },
      foreignFlow: { status: "unknown", value: null },
      topGainers: sorted.slice(0, 5),
      topLosers: sorted.slice(-5).reverse(),
      topVolume,
      sectorQuotes,
      quotes,
      crypto: cryptoResult,
      overnight,
      news: newsItems,
      quality: { generatedAt, ageSeconds: 0, partial: missingSymbols.length > 0, missingSymbols, stale: [...indexQuotes, ...quotes, ...sectorQuotes].some((q) => q.source.includes("-stale-snapshot")), sources, confidence: [...quotes, ...sectorQuotes].length > 0 ? Math.min(...[...quotes, ...sectorQuotes].map((q) => q.confidence)) : 0 },
      generatedAt,
    };
  }, { shouldCache: (snapshot) => snapshot.quotes.length > 0 || snapshot.sectorQuotes.length > 0 || snapshot.indices.length > 0, fallback: emptyOverview() });
  const result = await withDeadline(refresh, OVERVIEW_TOTAL_TIMEOUT_MS, { value: emptyOverview(), stale: true }, "overview-total");
  const generatedAtMs = Date.parse(result.value.generatedAt);
  const ageSeconds = Number.isFinite(generatedAtMs) ? Math.max(0, Math.floor((Date.now() - generatedAtMs) / 1000)) : 0;
  return { ...result.value, quality: { ...result.value.quality, ageSeconds, stale: result.value.quality.stale || result.stale } };
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
export async function getNews(opts: { page?: number; limit?: number; symbol?: string; withTotal?: boolean } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const withTotal = opts.withTotal !== false;
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
      withTotal ? db.select({ count: sql<number>`count(*)::int` }).from(news).where(where) : Promise.resolve([{ count: 0 }]),
    ]);
    rows = rowResult;
    count = withTotal ? countResult[0]?.count ?? 0 : rows.length;
  } catch (err) {
    logger.warn("get_news_db_failed", { error: String(err) });
    if (hit) return hit.value;
    // Soft-fail: empty payload so Agent continues without news context
    return { items: [], total: 0, page, limit, degraded: true } as NewsListPayload & {
      degraded?: boolean;
    };
  }

  if (rows.length === 0 && count === 0 && !opts.symbol) {
    // Never block a user request on RSS cold sync. The scheduled refresh will populate the DB.
    scheduleNewsSync();
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
