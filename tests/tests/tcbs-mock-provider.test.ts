import { afterEach, describe, expect, it, vi } from "vitest";
import { tcbsMockQuote } from "@/lib/connectors/tcbs-mock";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("VNDirect/Vietstock fallback quote provider", () => {
  it("returns deterministic quotes by symbol", () => {
    const first = tcbsMockQuote("VNM", 1_700_000_000);
    const second = tcbsMockQuote("vnm", 1_700_000_000);
    expect(first).toEqual(second);
    expect(first.source).toBe("vndirect-vietstock-fallback");
    expect(first.confidence).toBeGreaterThan(0.5);
    expect(first.high).toBeGreaterThanOrEqual(first.open);
    expect(first.high).toBeGreaterThanOrEqual(first.close);
    expect(first.low).toBeLessThanOrEqual(first.open);
    expect(first.low).toBeLessThanOrEqual(first.close);
    expect(first.changePct).toBeCloseTo(((first.close - first.prevClose!) / first.prevClose!) * 100, 8);
  });
});
