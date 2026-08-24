import type {
  ForexFreshness,
  ForexNormalizeMeta,
  ForexQuoteContract,
  ForexRawQuote,
} from "./types";
import { FOREX_FRESHNESS_MS } from "./types";
import { FOREX_BY_SYMBOL } from "./data";

/**
 * Pip size by pair convention.
 * JPY pairs → 0.01; most FX → 0.0001; gold/oil/index → price * 0.0001 or 0.01.
 */
export function pipSize(symbol: string): number {
  const s = symbol.toUpperCase();
  if (s.includes("JPY")) return 0.01;
  if (s === "XAUUSD" || s === "XAUVND" || s.startsWith("XAU")) return 0.1;
  if (s === "BRENTUSD" || s === "WTIUSD" || s.includes("BRENT") || s.includes("WTI"))
    return 0.01;
  if (s === "DXY") return 0.01;
  // VND crosses trade in whole numbers / large units
  if (s.endsWith("VND")) return 1;
  return 0.0001;
}

export function computeSpread(
  bid: number | null,
  ask: number | null,
): number | null {
  if (
    bid === null ||
    ask === null ||
    !Number.isFinite(bid) ||
    !Number.isFinite(ask) ||
    ask < bid
  ) {
    return null;
  }
  return ask - bid;
}

export function computeSpreadPips(
  symbol: string,
  spread: number | null,
): number | null {
  if (spread === null || !Number.isFinite(spread)) return null;
  const pip = pipSize(symbol);
  if (pip <= 0) return null;
  return Number((spread / pip).toFixed(2));
}

/** Prefer mid when bid+ask valid; else last price. */
export function midPrice(
  price: number,
  bid: number | null,
  ask: number | null,
): number {
  if (
    bid !== null &&
    ask !== null &&
    Number.isFinite(bid) &&
    Number.isFinite(ask) &&
    ask >= bid &&
    bid > 0
  ) {
    return (bid + ask) / 2;
  }
  return price;
}

export function classifyFreshness(
  ageMs: number,
  opts?: { forceDegraded?: boolean; offline?: boolean },
): ForexFreshness {
  if (opts?.offline || !Number.isFinite(ageMs) || ageMs < 0) return "OFFLINE";
  if (opts?.forceDegraded && ageMs > FOREX_FRESHNESS_MS.FRESH) return "DEGRADED";
  if (ageMs <= FOREX_FRESHNESS_MS.LIVE) return "LIVE";
  if (ageMs <= FOREX_FRESHNESS_MS.FRESH) return "FRESH";
  if (ageMs <= FOREX_FRESHNESS_MS.STALE) return "STALE";
  if (ageMs <= FOREX_FRESHNESS_MS.DEGRADED) return "DEGRADED";
  return "OFFLINE";
}

export function formatAge(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "—";
  if (ageMs < 1000) return `${ageMs}ms ago`;
  if (ageMs < 60_000) return `${(ageMs / 1000).toFixed(1)}s ago`;
  if (ageMs < 3600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  return `${Math.floor(ageMs / 3600_000)}h ago`;
}

/**
 * Build the unified ForexQuoteContract from a raw connector/DB quote.
 */
export function toQuoteContract(
  raw: ForexRawQuote,
  meta: ForexNormalizeMeta = {},
  now = Date.now(),
): ForexQuoteContract {
  const def = FOREX_BY_SYMBOL.get(raw.symbol.toUpperCase());
  const bid =
    typeof raw.bid === "number" && Number.isFinite(raw.bid) && raw.bid > 0
      ? raw.bid
      : null;
  const ask =
    typeof raw.ask === "number" && Number.isFinite(raw.ask) && raw.ask > 0
      ? raw.ask
      : null;
  const price = midPrice(raw.price, bid, ask);
  const spread = computeSpread(bid, ask);
  const ts =
    raw.timestamp instanceof Date
      ? raw.timestamp.getTime()
      : new Date(raw.timestamp).getTime();
  const ageMs = Math.max(0, now - (Number.isFinite(ts) ? ts : now));

  return {
    symbol: raw.symbol.toUpperCase(),
    name: meta.name ?? def?.name ?? raw.symbol,
    category: meta.category ?? def?.category ?? "usd_cross",
    baseCurrency: meta.baseCurrency ?? def?.baseCurrency ?? "",
    quoteCurrency: meta.quoteCurrency ?? def?.quoteCurrency ?? "",
    price,
    bid,
    ask,
    spread,
    spreadPips: computeSpreadPips(raw.symbol, spread),
    change:
      typeof raw.change === "number" && Number.isFinite(raw.change)
        ? raw.change
        : null,
    changePercent:
      typeof raw.changePercent === "number" && Number.isFinite(raw.changePercent)
        ? raw.changePercent
        : null,
    timestamp: new Date(Number.isFinite(ts) ? ts : now).toISOString(),
    source: raw.source,
    freshness: classifyFreshness(ageMs, { forceDegraded: meta.forceDegraded }),
    ageMs,
  };
}

/**
 * Align two OHLCV series by timestamp with nearest-neighbor tolerance.
 * Used for derived pairs (EURVND = EURUSD * USDVND, etc.).
 */
export function alignBarsByTime<
  T extends { time: number },
>(
  left: T[],
  right: T[],
  toleranceSec = 120,
): Array<{ left: T; right: T }> {
  if (!left.length || !right.length) return [];
  const rightSorted = [...right].sort((a, b) => a.time - b.time);
  const out: Array<{ left: T; right: T }> = [];

  for (const l of left) {
    // binary search nearest
    let lo = 0;
    let hi = rightSorted.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rightSorted[mid].time < l.time) lo = mid + 1;
      else hi = mid;
    }
    let best = rightSorted[lo];
    let bestDiff = Math.abs(best.time - l.time);
    if (lo > 0) {
      const prev = rightSorted[lo - 1];
      const d = Math.abs(prev.time - l.time);
      if (d < bestDiff) {
        best = prev;
        bestDiff = d;
      }
    }
    if (bestDiff <= toleranceSec) {
      out.push({ left: l, right: best });
    }
  }
  return out;
}

/**
 * Safe OHLC combine for multiply / divide derived pairs.
 * For divide: high/low take extremes across the four corners.
 */
export function combineOhlc(
  op: "multiply" | "divide",
  l: { open: number; high: number; low: number; close: number },
  r: { open: number; high: number; low: number; close: number },
): { open: number; high: number; low: number; close: number } | null {
  const f =
    op === "multiply"
      ? (a: number, b: number) => a * b
      : (a: number, b: number) => (b === 0 ? NaN : a / b);

  const open = f(l.open, r.open);
  const close = f(l.close, r.close);
  // Four-corner extremes for high/low (correct for both multiply and divide)
  const corners = [
    f(l.high, r.high),
    f(l.high, r.low),
    f(l.low, r.high),
    f(l.low, r.low),
  ].filter((x) => Number.isFinite(x) && x > 0);

  if (
    !Number.isFinite(open) ||
    !Number.isFinite(close) ||
    open <= 0 ||
    close <= 0 ||
    corners.length === 0
  ) {
    return null;
  }

  return {
    open,
    high: Math.max(...corners, open, close),
    low: Math.min(...corners, open, close),
    close,
  };
}

/**
 * Patch the last candle so close tracks live mid (and high/low envelope).
 * Keeps chart header consistent with live price.
 */
export function patchLastCandle<
  T extends { time: number; open: number; high: number; low: number; close: number; volume: number },
>(bars: T[], liveMid: number): T[] {
  if (!bars.length || !Number.isFinite(liveMid) || liveMid <= 0) return bars;
  const out = bars.slice();
  const last = { ...out[out.length - 1] };
  last.close = liveMid;
  last.high = Math.max(last.high, liveMid, last.open);
  last.low = Math.min(last.low, liveMid, last.open);
  out[out.length - 1] = last;
  return out;
}
