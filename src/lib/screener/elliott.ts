import type { Ohlcv } from "@/lib/connectors/core";
import { ScreenerResult, findPivots } from "./utils";

export function screenElliott(
  symbol: string,
  bars: Ohlcv[]
): ScreenerResult {
  const { highs, lows } = findPivots(bars.slice(-100), 5);
  const reasons: string[] = [];
  let wave = "Checking...";
  let target = 0;
  let confidence = 40;

  if (lows.length >= 2 && highs.length >= 1) {
    const L1 = lows[0].v;
    const H1 = highs[0].v;
    const L2 = lows[1].v;

    // Rule for Wave 1-2-3
    if (H1 > L1 && L2 > L1 && L2 < H1) {
      wave = "Sóng 3 (Đang diễn ra)";
      confidence = 65;
      const wave1Size = H1 - L1;
      target = L2 + (wave1Size * 1.618);
      reasons.push("Đã xác nhận sóng 1-2. Giá đang nằm trong sóng đẩy 3.");
      reasons.push(`Mục tiêu Fib 161.8% tại ${target.toFixed(1)}`);
    }
  }

  if (highs.length >= 3 && lows.length >= 2) {
    const H1 = highs[0].v;
    const L1 = lows[0].v;
    const H2 = highs[1].v;
    const L2 = lows[1].v;
    const H3 = highs[2].v;

    if (H2 > H1 && H3 > H2 && L2 > L1) {
      wave = "Sóng 5 (Gần kết thúc)";
      confidence = 80;
      reasons.push("Phát hiện cấu trúc đẩy 5 sóng mạnh mẽ.");
    }
  }

  return {
    symbol,
    score: confidence,
    classification: wave,
    reasons,
    data: { target, confidence }
  };
}
