import { describe, expect, it } from "vitest";
import {
  assessIndex,
  computeIndexStats,
  rankDrivers,
  type DriverQuote,
} from "@/lib/index-analysis";
import type { Ohlcv } from "@/lib/connectors/core";

function makeBars(closes: number[]): Ohlcv[] {
  return closes.map((c, i) => ({
    time: 1_700_000_000 + i * 86400,
    open: c - 0.5,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 1000 + i,
  }));
}

describe("computeIndexStats", () => {
  it("computes last/prev/change/MA/52w from real-shaped bars", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i * 0.5);
    const stats = computeIndexStats(makeBars(closes));
    expect(stats).not.toBeNull();
    expect(stats!.last).toBe(100 + 79 * 0.5);
    expect(stats!.prevClose).toBe(100 + 78 * 0.5);
    expect(stats!.changePct).toBeGreaterThan(0);
    expect(stats!.ma20).toBeGreaterThan(stats!.ma50!);
    expect(stats!.week52High).toBe(stats!.last);
    expect(stats!.off52wHighPct).toBeCloseTo(0, 5);
    expect(stats!.mom1mPct).toBeGreaterThan(0);
  });

  it("returns null when not enough bars", () => {
    expect(computeIndexStats(makeBars([100]))).toBeNull();
  });
});

describe("assessIndex", () => {
  it("labels an uptrend with low/medium risk and Vietnamese summary", () => {
    const closes = Array.from({ length: 90 }, (_, i) => 100 + i);
    const assessment = assessIndex(computeIndexStats(makeBars(closes)));
    expect(assessment.trend).toBe("up");
    expect(assessment.trendLabel).toBe("XU HƯỚNG TĂNG");
    expect(assessment.summary).toContain("nhịp tăng");
    expect(assessment.signals.length).toBeGreaterThan(2);
  });

  it("labels a downtrend", () => {
    const closes = Array.from({ length: 90 }, (_, i) => 200 - i);
    const assessment = assessIndex(computeIndexStats(makeBars(closes)));
    expect(assessment.trend).toBe("down");
    expect(assessment.trendLabel).toBe("XU HƯỚNG GIẢM");
  });

  it("never fabricates when stats missing", () => {
    const assessment = assessIndex(null);
    expect(assessment.trendLabel).toBe("Chưa đủ dữ liệu");
    expect(assessment.signals).toHaveLength(0);
  });
});

describe("rankDrivers", () => {
  it("splits gainers/losers from real quotes", () => {
    const quotes: DriverQuote[] = [
      { symbol: "A", close: 10, changePct: 2, volume: 1 },
      { symbol: "B", close: 10, changePct: -3, volume: 1 },
      { symbol: "C", close: 10, changePct: 5, volume: 1 },
      { symbol: "D", close: 10, changePct: -1, volume: 1 },
      { symbol: "E", close: 10, changePct: null, volume: 1 },
    ];
    const drivers = rankDrivers(quotes);
    expect(drivers.gainers[0].symbol).toBe("C");
    expect(drivers.losers[0].symbol).toBe("B");
    expect(drivers.note).toContain("Ước lượng");
  });
});
