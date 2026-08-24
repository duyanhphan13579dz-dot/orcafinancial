import {
  fetchWithRetry,
  getBreaker,
  ProviderError,
  readJsonSafe,
} from "@/lib/connectors/core";
import { forProvider } from "@/lib/logger";
import type {
  FundingBias,
  FundingSnapshot,
  FuturesIntelligence,
  LongShortBias,
  LongShortSnapshot,
  OiPriceSetup,
  OpenInterestSnapshot,
} from "./types";

const FAPI = "binance-futures";
const BASE = "https://fapi.binance.com";
const log = forProvider("crypto-futures");
const TIMEOUT_MS = 5_000;
const RETRIES = 1;

function futuresSymbol(base: string): string {
  const s = base.trim().toUpperCase().replace(/USDT$/i, "");
  return `${s}USDT`;
}

function classifyFunding(rate: number | null): { bias: FundingBias; insight: string } {
  if (rate == null || !Number.isFinite(rate)) {
    return { bias: "NEUTRAL", insight: "Không có dữ liệu funding rate." };
  }
  const pct = rate * 100;
  if (rate >= 0.0003) {
    return {
      bias: "LONG_CROWDED",
      insight: `Funding +${pct.toFixed(4)}% — phe Long đang trả phí cao, thị trường có dấu hiệu Long crowded.`,
    };
  }
  if (rate <= -0.0003) {
    return {
      bias: "SHORT_CROWDED",
      insight: `Funding ${pct.toFixed(4)}% — phe Short đang trả phí, thị trường nghiêng Short crowded.`,
    };
  }
  return {
    bias: "NEUTRAL",
    insight: `Funding ${pct >= 0 ? "+" : ""}${pct.toFixed(4)}% — cân bằng, chưa có tín hiệu crowded rõ.`,
  };
}

function classifyLongShort(ratio: number | null): {
  bias: LongShortBias;
  insight: string;
} {
  if (ratio == null || !Number.isFinite(ratio)) {
    return { bias: "BALANCED", insight: "Không có dữ liệu Long/Short ratio." };
  }
  if (ratio > 1.2) {
    return {
      bias: "LONG_DOMINANT",
      insight: `Long/Short ratio ${ratio.toFixed(2)} (>1.2) — tài khoản Long chiếm ưu thế. Không dùng độc lập làm tín hiệu mua.`,
    };
  }
  if (ratio < 0.8) {
    return {
      bias: "SHORT_DOMINANT",
      insight: `Long/Short ratio ${ratio.toFixed(2)} (<0.8) — tài khoản Short chiếm ưu thế. Không dùng độc lập làm tín hiệu bán.`,
    };
  }
  return {
    bias: "BALANCED",
    insight: `Long/Short ratio ${ratio.toFixed(2)} — cân bằng (0.8–1.2).`,
  };
}

function classifyOiPrice(
  oiChangePct: number | null,
  priceChangePct: number | null,
): { setup: OiPriceSetup; insight: string } {
  if (
    oiChangePct == null ||
    priceChangePct == null ||
    !Number.isFinite(oiChangePct) ||
    !Number.isFinite(priceChangePct)
  ) {
    return { setup: "UNKNOWN", insight: "Thiếu dữ liệu OI hoặc biến động giá để diễn giải." };
  }
  const oiUp = oiChangePct > 0.3;
  const oiDown = oiChangePct < -0.3;
  const priceUp = priceChangePct > 0.15;
  const priceDown = priceChangePct < -0.15;

  if (priceUp && oiUp) {
    return {
      setup: "LONG_BUILDUP",
      insight: `Giá ↑ (+${priceChangePct.toFixed(2)}%) và OI ↑ (+${oiChangePct.toFixed(2)}%) → Long buildup (mở vị thế Long mới).`,
    };
  }
  if (priceDown && oiUp) {
    return {
      setup: "SHORT_BUILDUP",
      insight: `Giá ↓ (${priceChangePct.toFixed(2)}%) và OI ↑ (+${oiChangePct.toFixed(2)}%) → Short buildup.`,
    };
  }
  if (priceUp && oiDown) {
    return {
      setup: "SHORT_COVERING",
      insight: `Giá ↑ (+${priceChangePct.toFixed(2)}%) và OI ↓ (${oiChangePct.toFixed(2)}%) → Short covering (đóng Short).`,
    };
  }
  if (priceDown && oiDown) {
    return {
      setup: "LONG_LIQUIDATION",
      insight: `Giá ↓ (${priceChangePct.toFixed(2)}%) và OI ↓ (${oiChangePct.toFixed(2)}%) → Long liquidation / đóng Long.`,
    };
  }
  return {
    setup: "NEUTRAL",
    insight: `OI ${oiChangePct >= 0 ? "+" : ""}${oiChangePct.toFixed(2)}%, giá ${priceChangePct >= 0 ? "+" : ""}${priceChangePct.toFixed(2)}% — chưa có setup rõ.`,
  };
}

interface PremiumIndex {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
}

interface OpenInterestRow {
  symbol: string;
  openInterest: string;
  time?: number;
}

interface OiHistRow {
  symbol: string;
  sumOpenInterest: string;
  sumOpenInterestValue: string;
  timestamp: number;
}

interface LsRatioRow {
  symbol: string;
  longAccount: string;
  shortAccount: string;
  longShortRatio: string;
  timestamp: number;
}

async function fetchPremiumIndex(symbol: string): Promise<PremiumIndex> {
  return getBreaker(FAPI).exec(async () => {
    const url = `${BASE}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`;
    const res = await fetchWithRetry(url, {
      provider: FAPI,
      timeoutMs: TIMEOUT_MS,
      retries: RETRIES,
    });
    return readJsonSafe<PremiumIndex>(res, FAPI, url);
  });
}

async function fetchOpenInterest(symbol: string): Promise<OpenInterestRow> {
  return getBreaker(FAPI).exec(async () => {
    const url = `${BASE}/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`;
    const res = await fetchWithRetry(url, {
      provider: FAPI,
      timeoutMs: TIMEOUT_MS,
      retries: RETRIES,
    });
    return readJsonSafe<OpenInterestRow>(res, FAPI, url);
  });
}

async function fetchOiHist(symbol: string): Promise<OiHistRow[]> {
  return getBreaker(FAPI).exec(async () => {
    const url = `${BASE}/futures/data/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=5m&limit=3`;
    const res = await fetchWithRetry(url, {
      provider: FAPI,
      timeoutMs: TIMEOUT_MS,
      retries: RETRIES,
    });
    return readJsonSafe<OiHistRow[]>(res, FAPI, url);
  });
}

async function fetchGlobalLongShort(symbol: string): Promise<LsRatioRow[]> {
  return getBreaker(FAPI).exec(async () => {
    const url = `${BASE}/futures/data/globalLongShortAccountRatio?symbol=${encodeURIComponent(symbol)}&period=5m&limit=1`;
    const res = await fetchWithRetry(url, {
      provider: FAPI,
      timeoutMs: TIMEOUT_MS,
      retries: RETRIES,
    });
    return readJsonSafe<LsRatioRow[]>(res, FAPI, url);
  });
}

function emptyFunding(): FundingSnapshot {
  return {
    rate: null,
    ratePct: null,
    nextFundingTime: null,
    markPrice: null,
    indexPrice: null,
    bias: "NEUTRAL",
    insight: "Funding không khả dụng.",
    source: FAPI,
  };
}

function emptyLongShort(): LongShortSnapshot {
  return {
    longAccountPct: null,
    shortAccountPct: null,
    ratio: null,
    bias: "BALANCED",
    insight: "Long/Short ratio không khả dụng.",
    period: "5m",
    source: FAPI,
  };
}

function emptyOi(): OpenInterestSnapshot {
  return {
    openInterest: null,
    openInterestUsd: null,
    changePct: null,
    priceChangePct: null,
    setup: "UNKNOWN",
    insight: "Open Interest không khả dụng.",
    source: FAPI,
  };
}

/**
 * Fetch futures intelligence for a spot base symbol (e.g. BTC).
 * Soft-fails individual legs — never throws if at least one source works.
 */
export async function fetchFuturesIntelligence(
  baseSymbol: string,
  spotPriceChange24h?: number | null,
): Promise<FuturesIntelligence> {
  const symbol = futuresSymbol(baseSymbol);
  const errors: string[] = [];
  let funding = emptyFunding();
  let longShort = emptyLongShort();
  let openInterest = emptyOi();

  const [premiumRes, oiRes, oiHistRes, lsRes] = await Promise.allSettled([
    fetchPremiumIndex(symbol),
    fetchOpenInterest(symbol),
    fetchOiHist(symbol),
    fetchGlobalLongShort(symbol),
  ]);

  if (premiumRes.status === "fulfilled") {
    const p = premiumRes.value;
    const rate = Number(p.lastFundingRate);
    const { bias, insight } = classifyFunding(Number.isFinite(rate) ? rate : null);
    funding = {
      rate: Number.isFinite(rate) ? rate : null,
      ratePct: Number.isFinite(rate) ? rate * 100 : null,
      nextFundingTime: p.nextFundingTime
        ? new Date(p.nextFundingTime).toISOString()
        : null,
      markPrice: Number.isFinite(Number(p.markPrice)) ? Number(p.markPrice) : null,
      indexPrice: Number.isFinite(Number(p.indexPrice)) ? Number(p.indexPrice) : null,
      bias,
      insight,
      source: FAPI,
    };
  } else {
    errors.push(`funding: ${String(premiumRes.reason).slice(0, 120)}`);
  }

  if (lsRes.status === "fulfilled" && lsRes.value?.[0]) {
    const row = lsRes.value[0];
    const longPct = Number(row.longAccount) * 100;
    const shortPct = Number(row.shortAccount) * 100;
    const ratio = Number(row.longShortRatio);
    const { bias, insight } = classifyLongShort(
      Number.isFinite(ratio) ? ratio : null,
    );
    longShort = {
      longAccountPct: Number.isFinite(longPct) ? longPct : null,
      shortAccountPct: Number.isFinite(shortPct) ? shortPct : null,
      ratio: Number.isFinite(ratio) ? ratio : null,
      bias,
      insight,
      period: "5m",
      source: FAPI,
    };
  } else if (lsRes.status === "rejected") {
    errors.push(`longShort: ${String(lsRes.reason).slice(0, 120)}`);
  }

  let oiValue: number | null = null;
  let oiUsd: number | null = null;
  let oiChangePct: number | null = null;

  if (oiRes.status === "fulfilled") {
    oiValue = Number(oiRes.value.openInterest);
    if (!Number.isFinite(oiValue)) oiValue = null;
  } else {
    errors.push(`oi: ${String(oiRes.reason).slice(0, 120)}`);
  }

  if (oiHistRes.status === "fulfilled" && oiHistRes.value?.length >= 1) {
    const hist = oiHistRes.value;
    const latest = hist[hist.length - 1];
    const prev = hist.length >= 2 ? hist[hist.length - 2] : null;
    const latestOi = Number(latest.sumOpenInterest);
    const latestUsd = Number(latest.sumOpenInterestValue);
    if (Number.isFinite(latestOi)) oiValue = latestOi;
    if (Number.isFinite(latestUsd)) oiUsd = latestUsd;
    if (prev) {
      const prevOi = Number(prev.sumOpenInterest);
      if (Number.isFinite(prevOi) && prevOi > 0 && Number.isFinite(latestOi)) {
        oiChangePct = ((latestOi - prevOi) / prevOi) * 100;
      }
    }
  } else if (oiHistRes.status === "rejected") {
    errors.push(`oiHist: ${String(oiHistRes.reason).slice(0, 120)}`);
  }

  // Price change for OI setup: prefer short-window from mark vs index gap is weak;
  // use 24h spot change as proxy when available.
  const priceChangePct =
    typeof spotPriceChange24h === "number" && Number.isFinite(spotPriceChange24h)
      ? spotPriceChange24h
      : null;

  const { setup, insight } = classifyOiPrice(oiChangePct, priceChangePct);
  openInterest = {
    openInterest: oiValue,
    openInterestUsd: oiUsd,
    changePct: oiChangePct,
    priceChangePct,
    setup,
    insight,
    source: FAPI,
  };

  const available =
    funding.rate != null ||
    longShort.ratio != null ||
    openInterest.openInterest != null;

  if (!available && errors.length === 0) {
    errors.push("No futures data returned");
  }

  if (errors.length) {
    log.warn("futures_partial", { symbol, errors: errors.slice(0, 4) });
  }

  return {
    symbol: baseSymbol.trim().toUpperCase(),
    binanceFuturesSymbol: symbol,
    funding,
    longShort,
    openInterest,
    fetchedAt: new Date().toISOString(),
    available,
    errors,
  };
}

/** Compact text block for AI Agent context. */
export function formatFuturesForAgent(f: FuturesIntelligence): string {
  if (!f.available) return `futures=${f.symbol}:unavailable`;
  const parts = [
    `futures=${f.symbol}`,
    f.funding.ratePct != null
      ? `funding=${f.funding.ratePct.toFixed(4)}%(${f.funding.bias})`
      : null,
    f.longShort.ratio != null
      ? `ls=${f.longShort.longAccountPct?.toFixed(0)}/${f.longShort.shortAccountPct?.toFixed(0)} ratio=${f.longShort.ratio.toFixed(2)}(${f.longShort.bias})`
      : null,
    f.openInterest.openInterest != null
      ? `oi=${f.openInterest.openInterest.toFixed(0)} oiΔ=${f.openInterest.changePct?.toFixed(2) ?? "n/a"}% setup=${f.openInterest.setup}`
      : null,
    f.openInterest.insight ? `oi_insight: ${f.openInterest.insight}` : null,
    f.funding.insight ? `funding_insight: ${f.funding.insight}` : null,
  ];
  return parts.filter(Boolean).join(" | ");
}
