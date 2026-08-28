import type { Quote } from "@/lib/connectors/core";

const MOCK_SOURCE = "tcbs-market-data-mock";

/**
 * Deterministic TCBS-shaped quote fixtures for development and UI integration.
 * This provider is deliberately disabled in production by the caller.
 */
const FIXTURES: Record<string, { close: number; prevClose: number; volume: number; beta: number }> = {
  VNM: { close: 62.6, prevClose: 62.8, volume: 835_500, beta: 1.02 },
  SSI: { close: 28.4, prevClose: 27.9, volume: 5_210_000, beta: 1.18 },
  HPG: { close: 25.15, prevClose: 25.45, volume: 8_420_000, beta: 1.24 },
  FPT: { close: 142.3, prevClose: 140.8, volume: 1_860_000, beta: 0.92 },
  VCB: { close: 92.1, prevClose: 91.7, volume: 1_140_000, beta: 0.78 },
  VIC: { close: 42.8, prevClose: 43.2, volume: 4_350_000, beta: 1.31 },
};

function fixtureFor(symbol: string) {
  const key = symbol.trim().toUpperCase();
  const known = FIXTURES[key];
  if (known) return { symbol: key, ...known };

  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const close = 18 + (hash % 8_000) / 100;
  const prevClose = close * (1 + (((hash % 81) - 40) / 10_000));
  return { symbol: key, close, prevClose, volume: 250_000 + (hash % 2_500_000), beta: 0.85 + (hash % 60) / 100 };
}

export function tcbsMockQuote(symbol: string, now = Math.floor(Date.now() / 1000)): Quote {
  const fixture = fixtureFor(symbol);
  const range = Math.max(fixture.close * 0.012 * fixture.beta, 0.01);
  const open = fixture.prevClose;
  const high = Math.max(open, fixture.close) + range;
  const low = Math.min(open, fixture.close) - range;
  const changePct = ((fixture.close - fixture.prevClose) / fixture.prevClose) * 100;

  return {
    symbol: fixture.symbol,
    time: now,
    open,
    high,
    low,
    close: fixture.close,
    volume: fixture.volume,
    prevClose: fixture.prevClose,
    changePct,
    source: MOCK_SOURCE,
    confidence: 0.35,
  };
}

export const TCBS_MOCK_SOURCE = MOCK_SOURCE;

export function isTcbsMockEnabled(): boolean {
  return process.env.TCBS_MARKET_DATA_MOCK === "true" && process.env.NODE_ENV !== "production";
}
