import type { Ohlcv } from "@/lib/connectors/core";
import { FinancialQuarter } from "@/lib/financial-statements";
import { ScreenerResult } from "./utils";

export function screenCANSLIM(
  symbol: string,
  bars: Ohlcv[],
  financials: FinancialQuarter[],
  rsRating: number
): ScreenerResult {
  const reasons: string[] = [];
  let score = 0;
  const n = bars.length;
  const lastPrice = bars[n - 1].close;

  // C: Current Quarterly Earnings (EPS tăng >= 25% YoY)
  if (financials.length >= 5) {
    const currentEPS = financials[0].income.eps;
    const yearAgoEPS = financials[4].income.eps;
    const epsGrowth = ((currentEPS - yearAgoEPS) / Math.abs(yearAgoEPS)) * 100;
    if (epsGrowth >= 25) {
      score += 15;
      reasons.push(`EPS quý gần nhất tăng ${epsGrowth.toFixed(1)}% YoY (đạt tiêu chí C)`);
    } else {
      reasons.push(`EPS quý tăng ${epsGrowth.toFixed(1)}% (thấp hơn mục tiêu 25%)`);
    }
  }

  // A: Annual Earnings Increase (EPS năm tăng >= 25% trong 3 năm - Giả lập qua 4 quý gần nhất)
  const annualEPS = financials.slice(0, 4).reduce((sum, q) => sum + q.income.eps, 0);
  if (annualEPS > 5) { // Proxy cho EPS cao
    score += 10;
    reasons.push(`EPS hàng năm ổn định (A)`);
  }

  // N: New Product/Service/Management/Highs (Gần đỉnh 52 tuần <= 15%)
  const high52w = Math.max(...bars.slice(-252).map(b => b.high));
  const distFromHigh = ((high52w - lastPrice) / high52w) * 100;
  if (distFromHigh <= 15) {
    score += 15;
    reasons.push(`Giá cách đỉnh 52 tuần ${distFromHigh.toFixed(1)}% (N - Vùng tích lũy gần đỉnh)`);
  }

  // S: Supply and Demand (Volume đột biến >= 150% avg 50d)
  const avgVol50 = bars.slice(-50).reduce((s, b) => s + b.volume, 0) / 50;
  const lastVol = bars[n-1].volume;
  if (lastVol >= avgVol50 * 1.5) {
    score += 15;
    reasons.push(`Khối lượng đột biến ${((lastVol/avgVol50)*100).toFixed(0)}% so với trung bình (S)`);
  }

  // L: Leader or Laggard (RS Rating nằm trong top 20% - >= 80)
  if (rsRating >= 80) {
    score += 20;
    reasons.push(`Sức mạnh giá RS Rating = ${rsRating} (L - Dẫn dắt thị trường)`);
  }

  // I: Institutional Sponsorship (Giả lập qua ROE >= 17%)
  const roe = financials[0].balance.equity > 0 ? (financials[0].income.netIncome / financials[0].balance.equity) * 400 : 0;
  if (roe >= 17) {
    score += 15;
    reasons.push(`ROE đạt ${roe.toFixed(1)}% (I - Hiệu quả sử dụng vốn tốt)`);
  }

  // M: Market Direction (Thị trường chung - Giả lập 10 điểm nếu RS > 50)
  if (rsRating > 50) score += 10;

  let classification = "Weak";
  if (score >= 80) classification = "Strong";
  else if (score >= 50) classification = "Moderate";

  return {
    symbol,
    score,
    classification,
    reasons,
    data: { epsGrowth: 25, rsRating, roe, distFromHigh }
  };
}
