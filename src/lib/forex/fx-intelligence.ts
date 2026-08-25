/**
 * Phase 6 — Forex-Specific Intelligence
 *
 * 6.1 DXY correlation bias
 * 6.2 Currency strength matrix
 * 6.3 Session analysis (Asian / London / NY / overlap)
 * 6.4 Volatility regime (re-exported from analysis context)
 */

import { FOREX_BY_SYMBOL } from "./data";

export type FxSessionId = "asian" | "london" | "newyork" | "overlap" | "off";

export interface SessionInfo {
  id: FxSessionId;
  label: string;
  volatility: "LOW" | "NORMAL" | "HIGH";
  liquidity: "LOW" | "NORMAL" | "HIGH";
  /** UTC hour 0-23 at evaluation time */
  utcHour: number;
  note: string;
}

export interface CurrencyStrengthRow {
  currency: string;
  score: number;
  bar: number;
}

export interface DxyCorrelation {
  dxyChangePct: number | null;
  dxyBias: "up" | "down" | "flat" | "unknown";
  pairExpected: "bullish" | "bearish" | "neutral" | "n/a";
  note: string;
}

export interface FxIntelligence {
  session: SessionInfo;
  currencyStrength: CurrencyStrengthRow[];
  dxy: DxyCorrelation;
  pairBiasFromStrength: {
    bias: "bullish" | "bearish" | "neutral";
    baseScore: number | null;
    quoteScore: number | null;
    note: string;
  };
}

/** Sessions in UTC (approximate FX cash hours). */
export function getSessionInfo(now = new Date()): SessionInfo {
  const utcHour = now.getUTCHours() + now.getUTCMinutes() / 60;

  // Asian: 00:00–09:00 UTC (Tokyo-centric)
  // London: 07:00–16:00 UTC
  // New York: 12:00–21:00 UTC
  // Overlap London/NY: 12:00–16:00 UTC

  if (utcHour >= 12 && utcHour < 16) {
    return {
      id: "overlap",
      label: "London / New York overlap",
      volatility: "HIGH",
      liquidity: "HIGH",
      utcHour: Math.floor(utcHour),
      note: "Peak liquidity — spreads typically tightest",
    };
  }
  if (utcHour >= 7 && utcHour < 12) {
    return {
      id: "london",
      label: "London",
      volatility: "HIGH",
      liquidity: "HIGH",
      utcHour: Math.floor(utcHour),
      note: "European open — strong directional moves common",
    };
  }
  if (utcHour >= 16 && utcHour < 21) {
    return {
      id: "newyork",
      label: "New York",
      volatility: "HIGH",
      liquidity: "HIGH",
      utcHour: Math.floor(utcHour),
      note: "US session — USD pairs active",
    };
  }
  if (utcHour >= 0 && utcHour < 7) {
    return {
      id: "asian",
      label: "Asian",
      volatility: "NORMAL",
      liquidity: "NORMAL",
      utcHour: Math.floor(utcHour),
      note: "Asia range often sets London breakout levels",
    };
  }
  return {
    id: "off",
    label: "Off-hours",
    volatility: "LOW",
    liquidity: "LOW",
    utcHour: Math.floor(utcHour),
    note: "Thin liquidity — wider spreads, noise risk",
  };
}

/**
 * Build currency strength from latest % changes of major USD crosses.
 * Positive score = currency stronger vs peers.
 */
export function buildCurrencyStrength(
  quotes: Array<{ symbol: string; changePercent: number | null }>,
): CurrencyStrengthRow[] {
  const maj = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD"];
  const scores: Record<string, { sum: number; n: number }> = {};
  for (const c of maj) scores[c] = { sum: 0, n: 0 };

  const bySym = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q.changePercent]));

  // XXXUSD: base gains when change% > 0 → base +, USD -
  const usdQuoted = ["EURUSD", "GBPUSD", "AUDUSD"];
  for (const s of usdQuoted) {
    const ch = bySym.get(s);
    if (ch == null || !Number.isFinite(ch)) continue;
    const base = s.slice(0, 3);
    scores[base].sum += ch;
    scores[base].n += 1;
    scores.USD.sum -= ch;
    scores.USD.n += 1;
  }

  // USDXXX: USD gains when change% > 0 → USD +, quote -
  const usdBase = ["USDJPY", "USDCAD", "USDCHF"];
  for (const s of usdBase) {
    const ch = bySym.get(s);
    if (ch == null || !Number.isFinite(ch)) continue;
    const quote = s.slice(3, 6);
    scores.USD.sum += ch;
    scores.USD.n += 1;
    if (scores[quote]) {
      scores[quote].sum -= ch;
      scores[quote].n += 1;
    }
  }

  const rows: CurrencyStrengthRow[] = maj
    .map((currency) => {
      const { sum, n } = scores[currency];
      const score = n ? sum / n : 0;
      return { currency, score: Number(score.toFixed(3)), bar: 0 };
    })
    .sort((a, b) => b.score - a.score);

  // Normalize bar 0..1 for UI
  const maxAbs = Math.max(0.01, ...rows.map((r) => Math.abs(r.score)));
  for (const r of rows) {
    r.bar = Number((0.5 + r.score / (2 * maxAbs)).toFixed(3));
  }
  return rows;
}

export function dxyCorrelationForPair(
  symbol: string,
  dxyChangePct: number | null,
): DxyCorrelation {
  const sym = symbol.toUpperCase();
  const def = FOREX_BY_SYMBOL.get(sym);

  if (dxyChangePct == null || !Number.isFinite(dxyChangePct)) {
    return {
      dxyChangePct: null,
      dxyBias: "unknown",
      pairExpected: "n/a",
      note: "DXY data unavailable",
    };
  }

  const dxyBias: DxyCorrelation["dxyBias"] =
    dxyChangePct > 0.05 ? "up" : dxyChangePct < -0.05 ? "down" : "flat";

  // Inverse to DXY: EURUSD, GBPUSD, AUDUSD, XAUUSD, ...
  // Positive with DXY: USDJPY, USDCAD, USDCHF, ...
  let pairExpected: DxyCorrelation["pairExpected"] = "neutral";
  let note = "Limited DXY linkage for this symbol";

  if (sym === "DXY") {
    pairExpected = dxyBias === "up" ? "bullish" : dxyBias === "down" ? "bearish" : "neutral";
    note = "Symbol is DXY itself";
  } else if (def?.quoteCurrency === "USD" && def.baseCurrency !== "USD") {
    // XXXUSD → inverse DXY
    pairExpected =
      dxyBias === "up" ? "bearish" : dxyBias === "down" ? "bullish" : "neutral";
    note = `DXY ${dxyBias} → typically pressure on ${sym} (inverse)`;
  } else if (def?.baseCurrency === "USD" && def.quoteCurrency !== "USD") {
    // USDXXX → with DXY
    pairExpected =
      dxyBias === "up" ? "bullish" : dxyBias === "down" ? "bearish" : "neutral";
    note = `DXY ${dxyBias} → typically supports ${sym}`;
  } else if (sym.startsWith("XAU") || def?.category === "gold") {
    pairExpected =
      dxyBias === "up" ? "bearish" : dxyBias === "down" ? "bullish" : "neutral";
    note = `Gold often inverse to DXY (${dxyBias})`;
  }

  return {
    dxyChangePct: Number(dxyChangePct.toFixed(3)),
    dxyBias,
    pairExpected,
    note,
  };
}

export function pairBiasFromStrength(
  symbol: string,
  strength: CurrencyStrengthRow[],
): FxIntelligence["pairBiasFromStrength"] {
  const def = FOREX_BY_SYMBOL.get(symbol.toUpperCase());
  if (!def || def.category === "index" || def.category === "oil") {
    return {
      bias: "neutral",
      baseScore: null,
      quoteScore: null,
      note: "Strength matrix N/A for this asset",
    };
  }
  const by = new Map(strength.map((r) => [r.currency, r.score]));
  const base = by.get(def.baseCurrency) ?? null;
  const quote = by.get(def.quoteCurrency) ?? null;
  if (base == null || quote == null) {
    return {
      bias: "neutral",
      baseScore: base,
      quoteScore: quote,
      note: "Incomplete strength data for base/quote",
    };
  }
  const diff = base - quote;
  const bias =
    diff > 0.12 ? "bullish" : diff < -0.12 ? "bearish" : "neutral";
  return {
    bias,
    baseScore: base,
    quoteScore: quote,
    note: `${def.baseCurrency}(${base >= 0 ? "+" : ""}${base.toFixed(2)}) vs ${def.quoteCurrency}(${quote >= 0 ? "+" : ""}${quote.toFixed(2)})`,
  };
}

export function buildFxIntelligence(
  symbol: string,
  quotes: Array<{ symbol: string; changePercent: number | null }>,
  now = new Date(),
): FxIntelligence {
  const session = getSessionInfo(now);
  const currencyStrength = buildCurrencyStrength(quotes);
  const dxyQ = quotes.find((q) => q.symbol.toUpperCase() === "DXY");
  const dxy = dxyCorrelationForPair(symbol, dxyQ?.changePercent ?? null);
  const pairBiasFromStrengthResult = pairBiasFromStrength(symbol, currencyStrength);

  return {
    session,
    currencyStrength,
    dxy,
    pairBiasFromStrength: pairBiasFromStrengthResult,
  };
}
