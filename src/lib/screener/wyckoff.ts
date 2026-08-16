import type { Ohlcv } from "@/lib/connectors/core";
import { ScreenerResult, findPivots } from "./utils";

export function screenWyckoff(
  symbol: string,
  bars: Ohlcv[]
): ScreenerResult {
  const n = bars.length;
  const recent = bars.slice(-120);
  const { highs, lows } = findPivots(recent, 10);
  const lastPrice = bars[n-1].close;
  
  const reasons: string[] = [];
  let phase = "Unknown";
  let prob = 0.5;

  // Pha A: Selling Climax Detection
  const maxVol = Math.max(...bars.map(b => b.volume));
  const scBarIdx = bars.findIndex(b => b.volume === maxVol);
  if (scBarIdx < n - 60) {
    reasons.push("Đã xác nhận pha dừng giảm (Pha A)");
    
    // Pha C: Spring / Test
    const lowestLow = Math.min(...recent.map(b => b.low));
    const isSpring = lastPrice > lowestLow && recent[recent.length-1].low === lowestLow;
    if (isSpring) {
      phase = "Pha C (Spring)";
      prob = 0.8;
      reasons.push("Phát hiện Spring (phá đáy giả) - Cơ hội tích lũy cao");
    }

    // Pha D: Sign of Strength
    const ma50 = bars.slice(-50).reduce((s, b) => s + b.close, 0) / 50;
    if (lastPrice > ma50 && lastPrice > highs[highs.length-1]?.v) {
      phase = "Pha D/E (Markup)";
      prob = 0.9;
      reasons.push("Giá vượt kháng cự gần nhất với sức mạnh lớn (SOS)");
    }
  }

  let classification = "Neutral";
  if (prob > 0.6) {
    classification = lastPrice > lows[0]?.v ? "Accumulation" : "Distribution";
  }

  return {
    symbol,
    score: Math.round(prob * 100),
    classification,
    reasons,
    data: { phase, prob }
  };
}
