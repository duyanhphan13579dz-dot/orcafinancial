import {
  fetchWithRetry,
  getBreaker,
  ProviderError,
  readJsonSafe,
} from "@/lib/connectors/core";
import { forProvider } from "@/lib/logger";
import { fetchFuturesIntelligence } from "./futures";
import { fetchOrderFlowIntelligence, whaleNotionalThreshold } from "./order-flow";
import type {
  FuturesIntelligence,
  LiquidationZone,
  OrderFlowIntelligence,
  WhaleActivity,
  WhaleEvent,
  WhaleLiquidationIntelligence,
} from "./types";

const SPOT = "binance-whale";
const FAPI = "binance-futures";
const SPOT_BASE = "https://data-api.binance.vision";
const FAPI_BASE = "https://fapi.binance.com";
const log = forProvider("crypto-whale");
const TIMEOUT_MS = 6_000;
const RETRIES = 1;

/** Rolling window for whale activity summary (ms). */
const WHALE_WINDOW_MS = 12 * 60_000;

function pairSymbol(base: string): string {
  const s = base.trim().toUpperCase().replace(/USDT$/i, "");
  return `${s}USDT`;
}

interface AggTradeRow {
  a: number;
  p: string;
  q: string;
  f: number;
  l: number;
  T: number;
  m: boolean;
}

async function fetchAggTrades(symbol: string, limit = 500): Promise<AggTradeRow[]> {
  return getBreaker(SPOT).exec(async () => {
    const safe = Math.min(1000, Math.max(50, limit));
    const url = `${SPOT_BASE}/api/v3/aggTrades?symbol=${encodeURIComponent(symbol)}&limit=${safe}`;
    const res = await fetchWithRetry(url, {
      provider: SPOT,
      timeoutMs: TIMEOUT_MS,
      retries: RETRIES,
    });
    const rows = await readJsonSafe<AggTradeRow[]>(res, SPOT, url);
    if (!rows?.length) throw new ProviderError(SPOT, `no aggTrades for ${symbol}`);
    return rows;
  });
}

interface TakerLsRow {
  buySellRatio: string;
  buyVol: string;
  sellVol: string;
  timestamp: number;
}

async function fetchTakerLongShort(symbol: string): Promise<TakerLsRow | null> {
  try {
    return await getBreaker(FAPI).exec(async () => {
      const url = `${FAPI_BASE}/futures/data/takerlongshortRatio?symbol=${encodeURIComponent(symbol)}&period=5m&limit=1`;
      const res = await fetchWithRetry(url, {
        provider: FAPI,
        timeoutMs: TIMEOUT_MS,
        retries: RETRIES,
      });
      const rows = await readJsonSafe<TakerLsRow[]>(res, FAPI, url);
      return rows?.[0] ?? null;
    });
  } catch {
    return null;
  }
}

function buildWhaleEvents(
  rows: AggTradeRow[],
  thresholdUsd: number,
  windowMs: number,
): WhaleEvent[] {
  const cutoff = Date.now() - windowMs;
  const events: WhaleEvent[] = [];

  for (const t of rows) {
    if (t.T < cutoff) continue;
    const price = Number(t.p);
    const qty = Number(t.q);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) continue;
    const notional = price * qty;
    if (notional < thresholdUsd) continue;
    // m = true → buyer is maker → aggressive sell
    const side: "BUY" | "SELL" = t.m ? "SELL" : "BUY";
    const kind =
      notional >= thresholdUsd * 3
        ? "WHALE"
        : notional >= thresholdUsd
          ? "LARGE_ORDER"
          : "LARGE_ORDER";
    events.push({
      kind,
      side,
      price,
      qty,
      notional,
      time: t.T,
      tradeId: t.a,
    });
  }

  return events.sort((a, b) => b.time - a.time);
}

function summarizeWhale(events: WhaleEvent[], windowMs: number): WhaleActivity {
  const buys = events.filter((e) => e.side === "BUY");
  const sells = events.filter((e) => e.side === "SELL");
  const buyUsd = buys.reduce((s, e) => s + e.notional, 0);
  const sellUsd = sells.reduce((s, e) => s + e.notional, 0);
  const net = buyUsd - sellUsd;
  const minutes = Math.round(windowMs / 60_000);

  let bias: WhaleActivity["bias"] = "NEUTRAL";
  if (net > 0 && buyUsd > sellUsd * 1.35) bias = "ACCUMULATION";
  else if (net < 0 && sellUsd > buyUsd * 1.35) bias = "DISTRIBUTION";

  let insight: string;
  if (events.length === 0) {
    insight = `Không phát hiện lệnh lớn (whale) trong ${minutes} phút gần nhất.`;
  } else if (bias === "ACCUMULATION") {
    insight = `🐋 ${minutes} phút: Buy ${fmtUsd(buyUsd)} / Sell ${fmtUsd(sellUsd)} — net +${fmtUsd(net)}. Dòng lệnh lớn nghiêng mua (accumulation).`;
  } else if (bias === "DISTRIBUTION") {
    insight = `🐋 ${minutes} phút: Buy ${fmtUsd(buyUsd)} / Sell ${fmtUsd(sellUsd)} — net ${fmtUsd(net)}. Dòng lệnh lớn nghiêng bán (distribution).`;
  } else {
    insight = `🐋 ${minutes} phút: Buy ${fmtUsd(buyUsd)} / Sell ${fmtUsd(sellUsd)} — net ${fmtUsd(net)}. Cân bằng.`;
  }

  return {
    windowMinutes: minutes,
    buyNotional: buyUsd,
    sellNotional: sellUsd,
    netFlow: net,
    buyCount: buys.length,
    sellCount: sells.length,
    events: events.slice(0, 20),
    bias,
    insight,
  };
}

function fmtUsd(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

/**
 * Estimated liquidation pressure zones around mark price.
 * Not exchange liquidation heatmap (requires private WS). Built from:
 * OI notional, L/S ratio, funding bias, order-book walls.
 */
function estimateLiquidationZones(
  markPrice: number | null,
  futures: FuturesIntelligence | null,
  orderFlow: OrderFlowIntelligence | null,
): { zones: LiquidationZone[]; insight: string; method: string } {
  if (markPrice == null || !Number.isFinite(markPrice) || markPrice <= 0) {
    return {
      zones: [],
      insight: "Thiếu mark price — không ước lượng được vùng thanh lý.",
      method: "none",
    };
  }

  const oiUsd = futures?.openInterest.openInterestUsd ?? null;
  const longPct = futures?.longShort.longAccountPct ?? 50;
  const shortPct = futures?.longShort.shortAccountPct ?? 50;
  const fundingBias = futures?.funding.bias ?? "NEUTRAL";
  const oiSetup = futures?.openInterest.setup ?? "UNKNOWN";

  // Base mass to distribute across zones (heuristic fraction of OI)
  const baseMass = oiUsd != null && oiUsd > 0 ? oiUsd * 0.08 : markPrice * 50;

  const offsets = [
    { pct: 0.015, weight: 0.12 },
    { pct: 0.03, weight: 0.22 },
    { pct: 0.05, weight: 0.28 },
    { pct: 0.08, weight: 0.22 },
    { pct: 0.12, weight: 0.16 },
  ];

  // When longs dominate / funding long crowded → more long liquidations below price
  const longStress =
    (longPct / 100) *
    (fundingBias === "LONG_CROWDED" ? 1.35 : fundingBias === "SHORT_CROWDED" ? 0.75 : 1);
  const shortStress =
    (shortPct / 100) *
    (fundingBias === "SHORT_CROWDED" ? 1.35 : fundingBias === "LONG_CROWDED" ? 0.75 : 1);

  const zones: LiquidationZone[] = [];

  for (const o of offsets) {
    const longPrice = markPrice * (1 - o.pct);
    const shortPrice = markPrice * (1 + o.pct);
    const longNotional = baseMass * o.weight * longStress;
    const shortNotional = baseMass * o.weight * shortStress;

    zones.push({
      price: longPrice,
      side: "LONG",
      notionalEstimate: longNotional,
      distancePct: -o.pct * 100,
      source: "estimated",
    });
    zones.push({
      price: shortPrice,
      side: "SHORT",
      notionalEstimate: shortNotional,
      distancePct: o.pct * 100,
      source: "estimated",
    });
  }

  // Boost zones near order-book walls
  if (orderFlow?.orderBook) {
    for (const w of orderFlow.orderBook.buyWalls) {
      zones.push({
        price: w.price,
        side: "LONG",
        notionalEstimate: w.notional * 2,
        distancePct: ((w.price - markPrice) / markPrice) * 100,
        source: "order_wall",
      });
    }
    for (const w of orderFlow.orderBook.sellWalls) {
      zones.push({
        price: w.price,
        side: "SHORT",
        notionalEstimate: w.notional * 2,
        distancePct: ((w.price - markPrice) / markPrice) * 100,
        source: "order_wall",
      });
    }
  }

  zones.sort((a, b) => b.price - a.price);

  // Insight for AI / UI
  const above = zones.filter((z) => z.side === "SHORT" && z.distancePct > 0);
  const below = zones.filter((z) => z.side === "LONG" && z.distancePct < 0);
  const topShort = above.sort((a, b) => b.notionalEstimate - a.notionalEstimate)[0];
  const topLong = below.sort((a, b) => b.notionalEstimate - a.notionalEstimate)[0];

  const parts: string[] = [];
  if (oiSetup === "LONG_BUILDUP" || fundingBias === "LONG_CROWDED") {
    parts.push(
      "Long positioning đang crowded — nếu giá giảm mạnh, rủi ro long liquidation phía dưới tăng.",
    );
  }
  if (oiSetup === "SHORT_BUILDUP" || fundingBias === "SHORT_CROWDED") {
    parts.push(
      "Short positioning đông — khả năng short squeeze tăng nếu giá phá các vùng thanh lý short phía trên.",
    );
  }
  if (topShort) {
    parts.push(
      `Vùng short liquidation ước lượng đáng chú ý quanh $${topShort.price.toFixed(0)} (~${fmtUsd(topShort.notionalEstimate)}).`,
    );
  }
  if (topLong) {
    parts.push(
      `Vùng long liquidation ước lượng quanh $${topLong.price.toFixed(0)} (~${fmtUsd(topLong.notionalEstimate)}).`,
    );
  }
  if (!parts.length) {
    parts.push("Chưa có tín hiệu thanh lý tập trung rõ từ OI / funding / walls.");
  }
  parts.push(
    "Lưu ý: bản đồ thanh lý mang tính ước lượng (không phải heatmap exchange realtime).",
  );

  return {
    zones: zones.slice(0, 14),
    insight: parts.join(" "),
    method: "oi_ls_funding_walls",
  };
}

export async function fetchWhaleLiquidationIntelligence(
  baseSymbol: string,
  opts: { volume24hUsd?: number | null; change24h?: number | null } = {},
): Promise<WhaleLiquidationIntelligence> {
  const symbol = pairSymbol(baseSymbol);
  const base = baseSymbol.trim().toUpperCase().replace(/USDT$/i, "");
  const errors: string[] = [];
  const threshold = whaleNotionalThreshold(symbol, opts.volume24hUsd);

  const [aggRes, futuresRes, orderFlowRes, takerRes] = await Promise.allSettled([
    fetchAggTrades(symbol, 800),
    fetchFuturesIntelligence(base, opts.change24h),
    fetchOrderFlowIntelligence(base, {
      volume24hUsd: opts.volume24hUsd,
      depthLimit: 20,
      tradeLimit: 50,
    }),
    fetchTakerLongShort(symbol),
  ]);

  let whale: WhaleActivity = {
    windowMinutes: Math.round(WHALE_WINDOW_MS / 60_000),
    buyNotional: 0,
    sellNotional: 0,
    netFlow: 0,
    buyCount: 0,
    sellCount: 0,
    events: [],
    bias: "NEUTRAL",
    insight: "Whale data không khả dụng.",
  };

  if (aggRes.status === "fulfilled") {
    const events = buildWhaleEvents(aggRes.value, threshold, WHALE_WINDOW_MS);
    whale = summarizeWhale(events, WHALE_WINDOW_MS);
  } else {
    errors.push(`aggTrades: ${String(aggRes.reason).slice(0, 120)}`);
  }

  // Merge order-flow walls into events as ORDER_WALL markers
  const orderFlow =
    orderFlowRes.status === "fulfilled" ? orderFlowRes.value : null;
  if (orderFlowRes.status === "rejected") {
    errors.push(`orderflow: ${String(orderFlowRes.reason).slice(0, 100)}`);
  }
  if (orderFlow?.orderBook) {
    for (const w of orderFlow.orderBook.buyWalls.slice(0, 2)) {
      whale.events.unshift({
        kind: "ORDER_WALL",
        side: "BUY",
        price: w.price,
        qty: w.qty,
        notional: w.notional,
        time: Date.now(),
        tradeId: null,
      });
    }
    for (const w of orderFlow.orderBook.sellWalls.slice(0, 2)) {
      whale.events.unshift({
        kind: "ORDER_WALL",
        side: "SELL",
        price: w.price,
        qty: w.qty,
        notional: w.notional,
        time: Date.now(),
        tradeId: null,
      });
    }
  }

  const futures =
    futuresRes.status === "fulfilled" ? futuresRes.value : null;
  if (futuresRes.status === "rejected") {
    errors.push(`futures: ${String(futuresRes.reason).slice(0, 100)}`);
  }

  const mark =
    futures?.funding.markPrice ??
    orderFlow?.orderBook?.bestBid ??
    whale.events.find((e) => e.kind !== "ORDER_WALL")?.price ??
    null;

  const liq = estimateLiquidationZones(mark, futures, orderFlow);

  let takerInsight: string | null = null;
  if (takerRes.status === "fulfilled" && takerRes.value) {
    const r = Number(takerRes.value.buySellRatio);
    if (Number.isFinite(r)) {
      takerInsight =
        r > 1.15
          ? `Taker buy/sell ratio ${r.toFixed(2)} — dòng lệnh aggressive nghiêng mua (5m).`
          : r < 0.87
            ? `Taker buy/sell ratio ${r.toFixed(2)} — dòng lệnh aggressive nghiêng bán (5m).`
            : `Taker buy/sell ratio ${r.toFixed(2)} — cân bằng (5m).`;
    }
  }

  // Combined AI-oriented assessment
  const assessmentParts: string[] = [];
  assessmentParts.push(whale.insight);
  if (takerInsight) assessmentParts.push(takerInsight);
  if (futures?.openInterest.insight) assessmentParts.push(futures.openInterest.insight);
  assessmentParts.push(liq.insight);

  const available =
    whale.events.length > 0 ||
    (futures?.available ?? false) ||
    liq.zones.length > 0;

  if (errors.length) {
    log.warn("whale_liq_partial", { symbol, errors: errors.slice(0, 4) });
  }

  return {
    symbol: base,
    binanceSymbol: symbol,
    whale,
    liquidation: {
      markPrice: mark,
      zones: liq.zones,
      insight: liq.insight,
      method: liq.method,
    },
    takerInsight,
    assessment: assessmentParts.join(" "),
    whaleThresholdUsd: threshold,
    available,
    errors,
    fetchedAt: new Date().toISOString(),
  };
}

export function formatWhaleLiqForAgent(w: WhaleLiquidationIntelligence): string {
  if (!w.available) return `whale_liq=${w.symbol}:unavailable`;
  const parts = [
    `whale_liq=${w.symbol}`,
    `whale_net=${(w.whale.netFlow / 1000).toFixed(0)}k bias=${w.whale.bias}`,
    w.liquidation.zones[0]
      ? `top_zone=${w.liquidation.zones[0].side}@${w.liquidation.zones[0].price.toFixed(0)}`
      : null,
    w.assessment.slice(0, 280),
  ];
  return parts.filter(Boolean).join(" | ");
}
