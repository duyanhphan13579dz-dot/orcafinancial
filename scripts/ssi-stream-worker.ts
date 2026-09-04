/**
 * SSI FastConnect market DATA stream worker.
 *
 * A long-lived process that subscribes to the WebSocket DATA channel and
 * writes snapshots into `price_snapshots`. Because `getQuote()` already prefers
 * fresh DB snapshots before falling back to VNDirect, anything written here is
 * picked up by the dashboard automatically.
 *
 * Run this OUTSIDE the Next.js serverless runtime — never open a WebSocket
 * inside a request handler:
 *
 *     npm run ssi:stream
 *
 * Host-agnostic: Fly.io, Railway, Render, Cloud Run, a VPS or plain Docker.
 * It needs `SSI_API_KEY`, `SSI_API_SECRET`, `SSI_WS_ENABLED=true` and
 * `DATABASE_URL` (Redis optional, used as a hot cache).
 *
 * Topics: trade | quote | room | put | oddlot | market
 * Order/position/FCO events are NOT used — they require an OTP-backed token
 * and this project does not trade.
 */

import "dotenv/config";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { priceSnapshots } from "@/db/schema";
import { forProvider } from "@/lib/logger";
import { sharedCacheSet } from "@/lib/connectors/redis-cache";
import { SSI_PROVIDER, isSsiConfigured, isSsiWsEnabled, ssiConfig } from "@/lib/connectors/ssi/config";
import {
  SsiMarketStream,
  buildTopics,
  type SsiMarketEventData,
  type SsiTopicKind,
  type SsiTradeEvent,
} from "@/lib/connectors/ssi/stream";
import { ssiMasterData } from "@/lib/connectors/ssi/client";

const log = forProvider(SSI_PROVIDER);

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const FLUSH_MS = envInt("SSI_STREAM_FLUSH_MS", 5_000);
const CACHE_TTL_MS = envInt("SSI_STREAM_CACHE_TTL_MS", 20_000);
const BAR_SECONDS = envInt("SSI_STREAM_BAR_SECONDS", 60);

const DEFAULT_SYMBOLS = [
  "VNM", "VIC", "VHM", "HPG", "FPT", "MWG", "VCB", "TCB", "BID", "CTG",
  "SSI", "VND", "MSN", "GAS", "VRE", "MBB", "STB", "HDB", "POW", "GVR",
];

function configuredSymbols(): string[] {
  const raw = process.env.SSI_STREAM_SYMBOLS?.trim();
  if (!raw) return DEFAULT_SYMBOLS;
  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9]{1,15}$/.test(s));
  return symbols.length ? symbols : DEFAULT_SYMBOLS;
}

function configuredTopics(): SsiTopicKind[] {
  const raw = process.env.SSI_STREAM_TOPICS?.trim();
  if (!raw) return ["trade", "quote", "room", "market"];
  const allowed: SsiTopicKind[] = ["trade", "quote", "room", "put", "oddlot", "market"];
  const kinds = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is SsiTopicKind => (allowed as string[]).includes(s));
  return kinds.length ? kinds : ["trade"];
}

interface BarState {
  symbol: string;
  bucket: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  refPrice: number | null;
  updatedAt: number;
}

const bars = new Map<string, BarState>();

function bucketFor(timeSeconds: number): number {
  return Math.floor(timeSeconds / BAR_SECONDS) * BAR_SECONDS;
}

function applyTrade(event: SsiTradeEvent): void {
  if (event.symbol.length === 0 || event.price == null) return;
  const nowSeconds = event.time ?? Math.floor(Date.now() / 1000);
  const bucket = bucketFor(nowSeconds);
  const qty = event.quantity ?? 0;
  const existing = bars.get(event.symbol);

  if (!existing || existing.bucket !== bucket) {
    bars.set(event.symbol, {
      symbol: event.symbol,
      bucket,
      open: event.price,
      high: event.high ?? event.price,
      low: event.low ?? event.price,
      close: event.price,
      volume: qty,
      // Carry the reference price forward so changePct survives bar rolls.
      refPrice: existing?.refPrice ?? null,
      updatedAt: Date.now(),
    });
    return;
  }

  existing.high = Math.max(existing.high, event.high ?? event.price, event.price);
  existing.low = Math.min(existing.low, event.low ?? event.price, event.price);
  existing.close = event.price;
  existing.volume += qty;
  if (event.totalVolume != null) existing.volume = Math.max(existing.volume, event.totalVolume);
  existing.updatedAt = Date.now();
}

function applyMarketBands(event: Extract<SsiMarketEventData, { kind: "market" }>): void {
  if (!event.symbol || event.refPrice == null) return;
  const existing = bars.get(event.symbol);
  if (existing) {
    existing.refPrice = event.refPrice;
    return;
  }
  bars.set(event.symbol, {
    symbol: event.symbol,
    bucket: bucketFor(Math.floor(Date.now() / 1000)),
    open: event.refPrice,
    high: event.refPrice,
    low: event.refPrice,
    close: event.refPrice,
    volume: 0,
    refPrice: event.refPrice,
    updatedAt: Date.now(),
  });
}

function changePctFor(bar: BarState): number {
  if (bar.refPrice == null || bar.refPrice === 0) return 0;
  return ((bar.close - bar.refPrice) / bar.refPrice) * 100;
}

/** Seed reference prices so the first tick already has a meaningful changePct. */
async function seedReferencePrices(symbols: string[]): Promise<void> {
  try {
    const rows = await ssiMasterData();
    for (const row of rows) {
      if (!symbols.includes(row.symbol) || row.refPrice == null) continue;
      const existing = bars.get(row.symbol);
      if (existing) {
        existing.refPrice = row.refPrice;
      } else {
        bars.set(row.symbol, {
          symbol: row.symbol,
          bucket: bucketFor(Math.floor(Date.now() / 1000)),
          open: row.refPrice,
          high: row.refPrice,
          low: row.refPrice,
          close: row.refPrice,
          volume: 0,
          refPrice: row.refPrice,
          updatedAt: Date.now(),
        });
      }
    }
    log.info("ssi_worker_reference_seeded", { rows: rows.length });
  } catch (error) {
    // Not fatal: ticks will still arrive, changePct just stays 0 until the
    // `market` topic delivers the reference price.
    log.warn("ssi_worker_reference_seed_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function flush(): Promise<void> {
  if (bars.size === 0) return;
  const pending = [...bars.values()];
  const now = new Date();

  const values = pending.map((bar) => ({
    symbol: bar.symbol,
    time: new Date(bar.bucket * 1000),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    changePct: changePctFor(bar),
    source: SSI_PROVIDER,
    confidence: 0.97,
    updatedAt: now,
  }));

  try {
    await db
      .insert(priceSnapshots)
      .values(values)
      .onConflictDoUpdate({
        target: priceSnapshots.symbol,
        set: {
          time: sql`excluded.time`,
          open: sql`excluded.open`,
          high: sql`excluded.high`,
          low: sql`excluded.low`,
          close: sql`excluded.close`,
          volume: sql`excluded.volume`,
          changePct: sql`excluded.change_pct`,
          source: sql`excluded.source`,
          confidence: sql`excluded.confidence`,
          updatedAt: sql`excluded.updated_at`,
        },
      });

    // Mirror into the shared cache so warm instances skip the DB round-trip.
    for (const value of values) {
      await sharedCacheSet(`quote:${value.symbol}`, {
        symbol: value.symbol,
        time: Math.floor(value.time.getTime() / 1000),
        open: value.open,
        high: value.high,
        low: value.low,
        close: value.close,
        volume: value.volume,
        prevClose: null,
        changePct: value.changePct,
        source: SSI_PROVIDER,
        confidence: value.confidence,
      }, CACHE_TTL_MS);
    }

    log.debug("ssi_worker_flush", { symbols: values.length });
  } catch (error) {
    log.error("ssi_worker_flush_failed", {
      symbols: values.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function main(): Promise<void> {
  if (!isSsiConfigured()) {
    console.error("[ssi-worker] SSI_API_KEY / SSI_API_SECRET not set — exiting.");
    process.exit(1);
  }
  if (!isSsiWsEnabled()) {
    console.error("[ssi-worker] SSI_WS_ENABLED is not true — refusing to start.");
    process.exit(1);
  }
  const config = ssiConfig();
  if (!config) {
    console.error("[ssi-worker] SSI configuration unavailable — exiting.");
    process.exit(1);
  }
  if (typeof WebSocket === "undefined") {
    console.error("[ssi-worker] No global WebSocket — requires Node 22+.");
    process.exit(1);
  }

  const symbols = configuredSymbols();
  const kinds = configuredTopics();
  const topics = buildTopics(kinds, symbols, "tick");

  console.log(
    `[ssi-worker] starting · ${symbols.length} symbols · topics: ${topics.join(", ")}`,
  );

  await seedReferencePrices(symbols);

  let tradeCount = 0;
  let quoteCount = 0;
  let roomCount = 0;

  const stream = new SsiMarketStream(
    {
      onEvent: (event: SsiMarketEventData) => {
        switch (event.kind) {
          case "trade":
            applyTrade(event);
            tradeCount += 1;
            break;
          case "market":
            applyMarketBands(event);
            break;
          case "quote":
            quoteCount += 1;
            // Order-book snapshots are published to the shared cache for the
            // microstructure endpoint; they are not persisted to Postgres.
            void sharedCacheSet(`ssi:orderbook:${event.symbol}`, event, CACHE_TTL_MS);
            break;
          case "room":
            roomCount += 1;
            void sharedCacheSet(`ssi:room:${event.symbol}`, event, CACHE_TTL_MS);
            break;
          default:
            break;
        }
      },
      onConnected: () => log.info("ssi_worker_connected", { topics }),
      onReconnect: (attempt) => log.warn("ssi_worker_reconnecting", { attempt }),
      onError: (error) => log.error("ssi_worker_stream_error", { error: error.message }),
    },
    topics,
  );

  await stream.start();

  const flushTimer = setInterval(() => {
    void flush();
  }, FLUSH_MS);

  const statsTimer = setInterval(() => {
    log.info("ssi_worker_stats", { tradeCount, quoteCount, roomCount, symbols: bars.size });
  }, 60_000);

  const shutdown = (signal: string) => {
    log.info("ssi_worker_shutdown", { signal });
    clearInterval(flushTimer);
    clearInterval(statsTimer);
    stream.stop();
    void flush().finally(() => process.exit(0));
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  console.error("[ssi-worker] fatal:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
