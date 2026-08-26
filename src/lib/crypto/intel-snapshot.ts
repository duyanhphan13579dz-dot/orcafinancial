/**
 * Batched crypto intelligence for detail page — one round-trip instead of
 * orderflow + whale + futures separate polls.
 * Soft-fail per layer + short in-memory TTL to cut upstream load.
 */
import { forProvider } from "@/lib/logger";
import { getCryptoCoin, getCryptoFutures } from "./service";
import { fetchOrderFlowIntelligence } from "./order-flow";
import { fetchWhaleLiquidationIntelligence } from "./whale-engine";
import type {
  FuturesIntelligence,
  OrderFlowIntelligence,
  WhaleLiquidationIntelligence,
} from "./types";

const log = forProvider("crypto-intel");

export interface CryptoIntelSnapshot {
  symbol: string;
  futures: FuturesIntelligence | null;
  orderFlow: OrderFlowIntelligence | null;
  whale: WhaleLiquidationIntelligence | null;
  layersOk: string[];
  fetchedAt: string;
  cacheHit: boolean;
}

interface CacheEntry {
  value: CryptoIntelSnapshot;
  expiresAt: number;
}

const TTL_MS = 4_000;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CryptoIntelSnapshot>>();

function normalize(symbol: string) {
  return symbol.trim().toUpperCase().replace(/USDT$/i, "");
}

async function build(symbol: string, includeOrderFlow: boolean): Promise<CryptoIntelSnapshot> {
  const layersOk: string[] = [];
  let change24h: number | null = null;
  let volume24h: number | null = null;

  try {
    const detail = await getCryptoCoin(symbol);
    if (detail?.price) {
      change24h =
        detail.price.change24h != null ? Number(detail.price.change24h) : null;
      volume24h =
        detail.price.volume24h != null ? Number(detail.price.volume24h) : null;
    }
  } catch {
    /* ignore */
  }

  const [futR, ofR, whaleR] = await Promise.allSettled([
    getCryptoFutures(symbol, change24h),
    includeOrderFlow
      ? fetchOrderFlowIntelligence(symbol, { volume24hUsd: volume24h })
      : Promise.resolve(null),
    fetchWhaleLiquidationIntelligence(symbol, {
      volume24hUsd: volume24h,
      change24h,
    }),
  ]);

  const futures = futR.status === "fulfilled" ? futR.value : null;
  const orderFlow = ofR.status === "fulfilled" ? ofR.value : null;
  const whale = whaleR.status === "fulfilled" ? whaleR.value : null;

  if (futures?.available) layersOk.push("futures");
  if (orderFlow?.available) layersOk.push("orderflow");
  if (whale?.available) layersOk.push("whale");

  if (futR.status === "rejected")
    log.warn("intel_futures_fail", { symbol, error: String(futR.reason).slice(0, 100) });
  if (ofR.status === "rejected")
    log.warn("intel_of_fail", { symbol, error: String(ofR.reason).slice(0, 100) });
  if (whaleR.status === "rejected")
    log.warn("intel_whale_fail", { symbol, error: String(whaleR.reason).slice(0, 100) });

  return {
    symbol,
    futures,
    orderFlow,
    whale,
    layersOk,
    fetchedAt: new Date().toISOString(),
    cacheHit: false,
  };
}

export async function getCryptoIntelSnapshot(
  symbol: string,
  options: { includeOrderFlow?: boolean } = {},
): Promise<CryptoIntelSnapshot> {
  const key = `${normalize(symbol)}:${options.includeOrderFlow === false ? "no-orderflow" : "orderflow"}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return { ...hit.value, cacheHit: true };
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = build(key.split(":")[0], options.includeOrderFlow !== false)
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
      // bound map size
      if (cache.size > 80) {
        const first = cache.keys().next().value;
        if (first) cache.delete(first);
      }
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}
