import { describe, expect, it } from "vitest";
import { analyzeCrypto } from "./analysis";
import type { Ohlcv } from "../connectors/core";

function trendBars(direction: "up" | "down", count = 120): Ohlcv[] {
  return Array.from({ length: count }, (_, index) => {
    const step = direction === "up" ? 0.004 : -0.004;
    const close = 100 * Math.exp(step * index);
    return {
      time: index * 60,
      open: close * (direction === "up" ? 0.998 : 1.002),
      high: close * 1.003,
      low: close * 0.997,
      close,
      volume: 1_000 + index,
    };
  });
}

function bearishBounceBars(): Ohlcv[] {
  const bars = trendBars("down");
  const start = bars[bars.length - 9].close;
  for (let offset = 0; offset < 8; offset += 1) {
    const close = start * Math.exp(0.01 * offset);
    bars[bars.length - 8 + offset] = {
      ...bars[bars.length - 8 + offset],
      open: close * 0.998,
      high: close * 1.003,
      low: close * 0.997,
      close,
    };
  }
  return bars;
}

describe("local crypto signal direction", () => {
  it("emits SHORT for a persistent bearish close/EMA/momentum regime", () => {
    const result = analyzeCrypto(trendBars("down"));
    expect(result.recommendation).toBe("SHORT");
    expect(result.indicators.scoreDiff).toBeLessThanOrEqual(-2);
    expect(result.reasons.some((reason) => reason.includes("EMA20") || reason.includes("Động lượng"))).toBe(true);
  });

  it("emits LONG for a persistent bullish close/EMA/momentum regime", () => {
    const result = analyzeCrypto(trendBars("up"));
    expect(result.recommendation).toBe("LONG");
    expect(result.indicators.scoreDiff).toBeGreaterThanOrEqual(2);
  });

  it("does not flip LONG on a countertrend bounce before EMA50 confirmation", () => {
    const result = analyzeCrypto(bearishBounceBars());
    expect(result.recommendation).not.toBe("LONG");
    expect(result.reasons.some((reason) => reason.includes("EMA50"))).toBe(true);
  });
});
