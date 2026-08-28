import { afterEach, describe, expect, it, vi } from "vitest";
import { isTcbsMockEnabled, tcbsMockQuote } from "@/lib/connectors/tcbs-mock";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TCBS market-data mock", () => {
  it("returns deterministic TCBS-shaped quotes by symbol", () => {
    const first = tcbsMockQuote("VNM", 1_700_000_000);
    const second = tcbsMockQuote("vnm", 1_700_000_000);
    expect(first).toEqual(second);
    expect(first.source).toBe("tcbs-market-data-mock");
    expect(first.confidence).toBeLessThan(0.5);
    expect(first.high).toBeGreaterThanOrEqual(first.open);
    expect(first.high).toBeGreaterThanOrEqual(first.close);
    expect(first.low).toBeLessThanOrEqual(first.open);
    expect(first.low).toBeLessThanOrEqual(first.close);
    expect(first.changePct).toBeCloseTo(((first.close - first.prevClose!) / first.prevClose!) * 100, 8);
  });

  it("is enabled only outside production", () => {
    vi.stubEnv("TCBS_MARKET_DATA_MOCK", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect(isTcbsMockEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(isTcbsMockEnabled()).toBe(false);
  });
});
