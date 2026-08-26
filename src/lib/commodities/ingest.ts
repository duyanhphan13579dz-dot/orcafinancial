/**
 * Commodity ingestion — persists exactly ONE source snapshot per cycle.
 *
 * Flow:
 *   runScanCycle()  → scans BOTH sources (health) and picks ONE winner
 *   ingestCycle()   → converts the winner's quotes to VND and upserts them
 *
 * Guarantees:
 *   • No blending: every row written in a cycle carries the same `source`.
 *   • No fabrication: if both sources fail, nothing is written.
 *   • VN time: snapshot bucket = VN wall-clock minute.
 *   • Change %: taken from the source when it supplies them; otherwise
 *     derived from our own stored history (never invented).
 */

import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { commodities, commodityPrices } from "@/db/schema";
import { safeDbQuery } from "@/lib/connectors/core";
import { forProvider } from "@/lib/logger";
import { runScanCycle, type CommodityQuote, type ScanCycleResult, type SourceId } from "./sources";
import { getLatestExchangeRate, saveExchangeRates } from "./service";
import { fetchExchangeRates } from "./fx";
import { truncateToMinute, vnLabel } from "./time";

const log = forProvider("commodity-ingest");

export interface IngestResult {
  ok: boolean;
  source: SourceId | null;
  reason: string;
  quotesReceived: number;
  rowsWritten: number;
  rowsChanged: number;
  bucketAt: Date;
  vnTime: string;
  durationMs: number;
  probes: Array<{ source: SourceId; ok: boolean; rows: number; latencyMs: number; error?: string }>;
}

/** In-memory record of the most recent cycle, surfaced by the status API. */
const globalForIngest = globalThis as typeof globalThis & {
  __orcaLastIngest?: IngestResult;
  __orcaIngestHistory?: IngestResult[];
  __orcaIngestPromise?: Promise<IngestResult>;
};
if (!globalForIngest.__orcaIngestHistory) globalForIngest.__orcaIngestHistory = [];

export function getLastIngest(): IngestResult | null {
  return globalForIngest.__orcaLastIngest ?? null;
}
export function getIngestHistory(limit = 20): IngestResult[] {
  return (globalForIngest.__orcaIngestHistory ?? []).slice(0, limit);
}

/** Resolve VND value for a quote using the latest stored FX rate. */
async function toVnd(q: CommodityQuote): Promise<{ priceVnd: number; rate: number | null } | null> {
  if (q.currency === "VND") return { priceVnd: q.price, rate: null };
  const rate = await getLatestExchangeRate(q.currency);
  if (!rate || rate <= 0) return null;
  return { priceVnd: q.price * rate, rate };
}

/** Most recent stored VND price strictly before `before` — for delta maths. */
async function previousVnd(commodityId: string, before: Date): Promise<number | null> {
  const rows = await safeDbQuery("prev_price", () =>
    db
      .select({ priceVnd: commodityPrices.priceVnd })
      .from(commodityPrices)
      .where(and(eq(commodityPrices.commodityId, commodityId), lt(commodityPrices.date, before)))
      .orderBy(desc(commodityPrices.date))
      .limit(1),
  ).catch(() => []);
  return rows.length ? rows[0].priceVnd : null;
}

/**
 * Coalesce callers so a slow provider can never create overlapping ingestion
 * cycles. The returned promise is shared by the scheduler and manual refresh.
 */
export function startIngestCycle(opts: { force?: boolean } = {}): Promise<IngestResult> {
  if (globalForIngest.__orcaIngestPromise) return globalForIngest.__orcaIngestPromise;
  const promise = ingestCycle(opts).finally(() => {
    globalForIngest.__orcaIngestPromise = undefined;
  });
  globalForIngest.__orcaIngestPromise = promise;
  return promise;
}

/**
 * Run one full ingestion cycle.
 * `force` bypasses the "skip if unchanged" optimisation.
 */
export async function ingestCycle(opts: { force?: boolean } = {}): Promise<IngestResult> {
  const started = Date.now();
  const bucketAt = truncateToMinute(new Date());

  // ── 0. Keep FX fresh; conversions depend on it. ──
  try {
    const rates = await fetchExchangeRates();
    if (rates.length) await saveExchangeRates(rates);
  } catch (err) {
    log.warn("fx_refresh_failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // ── 1. Scan both sources, select one. ──
  const cycle: ScanCycleResult = await runScanCycle();
  const probes = cycle.probes.map((p) => ({
    source: p.source,
    ok: p.ok,
    rows: p.quotes.length,
    latencyMs: p.latencyMs,
    error: p.error,
  }));

  if (!cycle.selected) {
    const result: IngestResult = {
      ok: false,
      source: null,
      reason: cycle.reason,
      quotesReceived: 0,
      rowsWritten: 0,
      rowsChanged: 0,
      bucketAt,
      vnTime: vnLabel(bucketAt),
      durationMs: Date.now() - started,
      probes,
    };
    remember(result);
    log.error("ingest_no_source", { reason: cycle.reason });
    return result;
  }

  const snapshot = cycle.selected;

  // ── 2. Resolve catalogue, FX and previous prices in three batched reads. ──
  const catalogue = await safeDbQuery("commodity_catalogue", () =>
    db.select({ id: commodities.id, symbol: commodities.symbol }).from(commodities),
  ).catch(() => [] as Array<{ id: string; symbol: string }>);
  const idBySymbol = new Map(catalogue.map((c) => [c.symbol, c.id]));
  const previousRows = await safeDbQuery("commodity_previous_prices", () => db.execute(sql`
    SELECT DISTINCT ON (commodity_id) commodity_id, price_vnd
    FROM commodity_prices
    WHERE date < ${bucketAt}
    ORDER BY commodity_id, date DESC
  `)).catch(() => ({ rows: [] } as { rows: Array<{ commodity_id: string; price_vnd: number }> }));
  const previousById = new Map((previousRows.rows as Array<{ commodity_id: string; price_vnd: number }>).map((r) => [r.commodity_id, Number(r.price_vnd)]));
  const fxRows = await safeDbQuery("commodity_fx_rates", () => db.execute(sql`
    SELECT DISTINCT ON (currency) currency, rate
    FROM exchange_rates
    ORDER BY currency, date DESC
  `)).catch(() => ({ rows: [] } as { rows: Array<{ currency: string; rate: number }> }));
  const fxByCurrency = new Map((fxRows.rows as Array<{ currency: string; rate: number }>).map((r) => [r.currency, Number(r.rate)]));

  // ── 3. Build rows synchronously, then persist concurrently. ──
  let changed = 0;
  const rows: Array<Record<string, unknown>> = [];
  for (const q of snapshot.quotes) {
    const commodityId = idBySymbol.get(q.symbol);
    if (!commodityId) continue;
    const rate = q.currency === "VND" ? null : fxByCurrency.get(q.currency) ?? null;
    const priceVnd = q.currency === "VND" ? q.price : rate && rate > 0 ? q.price * rate : null;
    if (priceVnd === null) {
      log.warn("fx_missing_for_quote", { symbol: q.symbol, currency: q.currency });
      continue;
    }
    const prev = previousById.get(commodityId) ?? null;
    const movedPct = prev && prev > 0 ? ((priceVnd - prev) / prev) * 100 : null;
    if (movedPct !== null && Math.abs(movedPct) > 0.0001) changed++;

    // Prefer the source's own deltas; fall back to our history.
    const changePct1d = q.changePct1d ?? movedPct;

    const scale = rate ?? 1;
    const row = {
      commodityId,
      price: q.price,
      priceVnd,
      currencyRate: rate,
      prevClose:
        typeof q.prevClose === "number" && Number.isFinite(q.prevClose) ? q.prevClose * scale : prev,
      changePct1d,
      changePct7d: q.changePct7d ?? null,
      changePct30d: q.changePct30d ?? null,
      changePctYtd: q.changePctYtd ?? null,
      changePct1y: q.changePct1y ?? null,
      high52w: typeof q.high52w === "number" && Number.isFinite(q.high52w) ? q.high52w * scale : null,
      low52w: typeof q.low52w === "number" && Number.isFinite(q.low52w) ? q.low52w * scale : null,
      date: bucketAt,
      source: snapshot.source, // ← single source for the whole cycle
    };

    rows.push(row);
  }

  const writes = await Promise.allSettled(rows.map((row) => db
    .insert(commodityPrices)
    .values(row as typeof commodityPrices.$inferInsert)
    .onConflictDoUpdate({
      target: [commodityPrices.commodityId, commodityPrices.date],
      set: {
        price: sql`excluded.price`, priceVnd: sql`excluded.price_vnd`,
        currencyRate: sql`excluded.currency_rate`, prevClose: sql`excluded.prev_close`,
        changePct1d: sql`excluded.change_pct_1d`, changePct7d: sql`excluded.change_pct_7d`,
        changePct30d: sql`excluded.change_pct_30d`, changePctYtd: sql`excluded.change_pct_ytd`,
        changePct1y: sql`excluded.change_pct_1y`, high52w: sql`excluded.high_52w`,
        low52w: sql`excluded.low_52w`, source: sql`excluded.source`,
      },
    })));
  let written = 0;
  writes.forEach((result, index) => {
    if (result.status === "fulfilled") written++;
    else log.error("price_upsert_failed", { symbol: snapshot.quotes[index]?.symbol, error: String(result.reason) });
  });

  const result: IngestResult = {
    ok: written > 0,
    source: snapshot.source,
    reason: cycle.reason,
    quotesReceived: snapshot.quotes.length,
    rowsWritten: written,
    rowsChanged: changed,
    bucketAt,
    vnTime: vnLabel(bucketAt),
    durationMs: Date.now() - started,
    probes,
  };
  remember(result);

  log.info("ingest_cycle_done", {
    source: snapshot.source,
    received: snapshot.quotes.length,
    written,
    changed,
    vnTime: result.vnTime,
    durationMs: result.durationMs,
  });
  return result;
}

function remember(r: IngestResult) {
  globalForIngest.__orcaLastIngest = r;
  const hist = globalForIngest.__orcaIngestHistory!;
  hist.unshift(r);
  if (hist.length > 50) hist.length = 50;
}

/** Retention: drop intraday rows older than N days to keep the table lean. */
export async function pruneOldIntraday(days = 30): Promise<number> {
  try {
    const res = await db.execute(sql`
      DELETE FROM commodity_prices
      WHERE date < NOW() - (${days} || ' days')::interval
        AND date <> date_trunc('day', date)
    `);
    return (res as unknown as { rowCount?: number }).rowCount ?? 0;
  } catch (err) {
    log.warn("prune_failed", { error: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}
