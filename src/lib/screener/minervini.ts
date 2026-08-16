import type { Ohlcv } from "@/lib/connectors/core";
import { ScreenerResult, getMovingAverages } from "./utils";

export function screenMinervini(
  symbol: string,
  bars: Ohlcv[],
  rsRating: number
): ScreenerResult {
  const reasons: string[] = [];
  let points = 0;
  const n = bars.length;
  const lastPrice = bars[n - 1].close;

  const mas = getMovingAverages(bars, [50, 150, 200]);
  const ma50 = mas.get(50)!;
  const ma150 = mas.get(150)!;
  const ma200 = mas.get(200)!;

  // 1. Price > MA50
  if (lastPrice > ma50) { points++; reasons.push("Giá nằm trên MA50"); }
  
  // 2. MA50 > MA150 > MA200
  if (ma50 > ma150 && ma150 > ma200) { points++; reasons.push("MA50 > MA150 > MA200 (Xếp chồng dương)"); }
  
  // 3. MA200 dốc lên (1 tháng)
  const ma200_prev = bars.slice(-20, -19).length > 0 ? getMovingAverages(bars.slice(0, -20), [200]).get(200) : null;
  if (ma200_prev && ma200 > ma200_prev) { points++; reasons.push("MA200 đang hướng lên"); }

  // 4. Price > MA200
  if (lastPrice > ma200) { points++; reasons.push("Giá nằm trên MA200"); }

  // 5. Price >= 75% 52w High
  const high52w = Math.max(...bars.slice(-252).map(b => b.high));
  if (lastPrice >= high52w * 0.75) { points++; reasons.push("Giá nằm trong 25% tính từ đỉnh 52 tuần"); }

  // 6. Price >= 130% 52w Low
  const low52w = Math.min(...bars.slice(-252).map(b => b.low));
  if (lastPrice >= low52w * 1.3) { points++; reasons.push("Giá tăng ít nhất 30% tính từ đáy 52 tuần"); }

  // 7. RS Rating >= 70
  if (rsRating >= 70) { points++; reasons.push(`Sức mạnh giá RS Rating ${rsRating} >= 70`); }

  // 8. VCP (Volatility Contraction Pattern) - Simplified: Biên độ hẹp dần 3 tuần gần nhất
  const range1 = Math.max(...bars.slice(-60, -40).map(b => b.high)) - Math.min(...bars.slice(-60, -40).map(b => b.low));
  const range2 = Math.max(...bars.slice(-40, -20).map(b => b.high)) - Math.min(...bars.slice(-40, -20).map(b => b.low));
  const range3 = Math.max(...bars.slice(-20).map(b => b.high)) - Math.min(...bars.slice(-20).map(b => b.low));
  if (range3 < range2 && range2 < range1) { points++; reasons.push("Phát hiện mẫu hình thu hẹp biến động (VCP)"); }

  const score = Math.round((points / 8) * 100);
  let classification = "Failed";
  if (points === 8) classification = "Perfect";
  else if (score >= 80) classification = "Near";
  else if (score >= 60) classification = "Watchlist";

  return {
    symbol,
    score,
    classification,
    reasons,
    data: { mas: { ma50, ma150, ma200 }, points, rsRating }
  };
}
