import { describe, expect, it } from "vitest";
import { buildTechnicalSentiment } from "@/lib/stock-intelligence/technical-sentiment";
import type { AnalysisResult } from "@/lib/analysis";

function analysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    symbol: "VNM",
    lastClose: 100,
    changePct1d: 1,
    changePct1m: 4,
    volumeVsAvg20: 1.3,
    rsi14: 58,
    macd: { macd: 2, signal: 1, histogram: 1 },
    sma20: 98,
    sma50: 95,
    bollinger: { upper: 105, middle: 98, lower: 91 },
    supportResistance: { support: 90, resistance: 106 },
    volatilityPct: 20,
    maxDrawdownPct: 8,
    recommendation: "Buy",
    score: 70,
    confidence: 0.7,
    reasons: [],
    multiTimeframe: { short: "BULLISH", medium: "BULLISH", long: "BULLISH" },
    accumulationDistribution: { score: 20, label: "ACCUMULATION", volumeTrend: 0.1 },
    ...overrides,
  };
}

describe("technical sentiment", () => {
  it("classifies aligned trend and MACD as bullish continuation", () => {
    const result = buildTechnicalSentiment(analysis(), [], []);
    expect(result.sentiment).toBe("CONTINUATION_BULLISH");
    expect(result.labelVi).toContain("Tiếp diễn");
  });

  it("classifies bullish candle reversal inside a bearish trend", () => {
    const bearish = analysis({
      rsi14: 38,
      macd: { macd: -2, signal: -1, histogram: -1 },
      sma20: 102,
      sma50: 105,
      multiTimeframe: { short: "NEUTRAL", medium: "BEARISH", long: "BEARISH" },
    });
    const result = buildTechnicalSentiment(bearish, [], [
      { name: "Hammer", nameVi: "Nến Búa", type: "bullish", barIndex: 10, time: 10, reliability: 0.8, description: "Đảo chiều tăng." },
    ]);
    expect(result.sentiment).toBe("REVERSAL_BULLISH");
    expect(result.confirmation).toContain("kháng cự");
  });
});
