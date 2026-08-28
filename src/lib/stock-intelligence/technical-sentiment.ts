import type { AnalysisResult } from "@/lib/analysis";
import type { CandlePattern, ChartPattern } from "@/lib/technical-patterns";

export type TechnicalSentiment = "REVERSAL_BULLISH" | "REVERSAL_BEARISH" | "CONTINUATION_BULLISH" | "CONTINUATION_BEARISH" | "NEUTRAL";

export interface TechnicalSentimentResult {
  sentiment: TechnicalSentiment;
  labelVi: string;
  confidence: number;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  indicatorSummary: string[];
  chartPatterns: Array<{ nameVi: string; type: ChartPattern["type"]; reliability: number; target: number | null; description: string }>;
  candlestickPatterns: Array<{ nameVi: string; type: CandlePattern["type"]; reliability: number; description: string }>;
  confirmation: string;
  invalidation: string;
}

function round(value: number): number { return Number(value.toFixed(2)); }

export function buildTechnicalSentiment(analysis: AnalysisResult, chartPatterns: ChartPattern[], candlestickPatterns: CandlePattern[]): TechnicalSentimentResult {
  const recentCandles = candlestickPatterns.slice(-8);
  const recentCharts = chartPatterns.slice(-5);
  const bullishCandles = recentCandles.filter((item) => item.type === "bullish").reduce((sum, item) => sum + item.reliability, 0);
  const bearishCandles = recentCandles.filter((item) => item.type === "bearish").reduce((sum, item) => sum + item.reliability, 0);
  const bullishCharts = recentCharts.filter((item) => item.type === "bullish").reduce((sum, item) => sum + item.reliability, 0);
  const bearishCharts = recentCharts.filter((item) => item.type === "bearish").reduce((sum, item) => sum + item.reliability, 0);
  const trend: TechnicalSentimentResult["trend"] = analysis.multiTimeframe.medium === "BULLISH" || analysis.multiTimeframe.long === "BULLISH"
    ? "BULLISH"
    : analysis.multiTimeframe.medium === "BEARISH" || analysis.multiTimeframe.long === "BEARISH" ? "BEARISH" : "NEUTRAL";
  const reversalBullish = bullishCandles + bullishCharts;
  const reversalBearish = bearishCandles + bearishCharts;
  const bullishContinuation = trend === "BULLISH" && analysis.macd?.histogram != null && analysis.macd.histogram >= 0 && (analysis.sma20 == null || analysis.lastClose >= analysis.sma20);
  const bearishContinuation = trend === "BEARISH" && analysis.macd?.histogram != null && analysis.macd.histogram <= 0 && (analysis.sma20 == null || analysis.lastClose <= analysis.sma20);

  let sentiment: TechnicalSentiment = "NEUTRAL";
  if (trend === "BEARISH" && reversalBullish > reversalBearish + 0.35 && analysis.rsi14 != null && analysis.rsi14 < 45) sentiment = "REVERSAL_BULLISH";
  else if (trend === "BULLISH" && reversalBearish > reversalBullish + 0.35 && analysis.rsi14 != null && analysis.rsi14 > 55) sentiment = "REVERSAL_BEARISH";
  else if (bullishContinuation) sentiment = "CONTINUATION_BULLISH";
  else if (bearishContinuation) sentiment = "CONTINUATION_BEARISH";
  else if (reversalBullish > reversalBearish + 0.6) sentiment = "REVERSAL_BULLISH";
  else if (reversalBearish > reversalBullish + 0.6) sentiment = "REVERSAL_BEARISH";

  const indicatorSummary: string[] = [];
  if (analysis.rsi14 != null) indicatorSummary.push(`RSI(14) ${analysis.rsi14.toFixed(1)}: ${analysis.rsi14 < 30 ? "quá bán" : analysis.rsi14 > 70 ? "quá mua" : analysis.rsi14 >= 50 ? "động lượng nghiêng tăng" : "động lượng nghiêng giảm"}.`);
  if (analysis.macd) indicatorSummary.push(`MACD ${analysis.macd.macd.toFixed(2)}, tín hiệu ${analysis.macd.signal.toFixed(2)}, histogram ${analysis.macd.histogram.toFixed(2)}: ${analysis.macd.histogram >= 0 ? "động lượng tăng" : "động lượng giảm"}.`);
  if (analysis.sma20 != null && analysis.sma50 != null) indicatorSummary.push(`Giá ${analysis.lastClose >= analysis.sma20 ? "trên" : "dưới"} SMA20 và SMA20 ${analysis.sma20 >= analysis.sma50 ? "trên" : "dưới"} SMA50.`);
  if (analysis.bollinger) indicatorSummary.push(`Bollinger: dải dưới ${analysis.bollinger.lower.toFixed(2)}, giữa ${analysis.bollinger.middle.toFixed(2)}, trên ${analysis.bollinger.upper.toFixed(2)}.`);
  if (analysis.volumeVsAvg20 != null) indicatorSummary.push(`Khối lượng phiên gần nhất bằng ${analysis.volumeVsAvg20.toFixed(2)} lần trung bình 20 phiên.`);

  const labelVi = ({
    REVERSAL_BULLISH: "Đảo chiều tăng tiềm năng",
    REVERSAL_BEARISH: "Đảo chiều giảm tiềm năng",
    CONTINUATION_BULLISH: "Tiếp diễn tăng",
    CONTINUATION_BEARISH: "Tiếp diễn giảm",
    NEUTRAL: "Trung tính/chưa xác nhận",
  } as Record<TechnicalSentiment, string>)[sentiment];
  const confirmation = sentiment.includes("BULLISH")
    ? "Cần xác nhận bằng giá vượt vùng kháng cự hoặc đóng cửa tăng kèm thanh khoản cải thiện."
    : sentiment.includes("BEARISH") ? "Cần xác nhận bằng giá phá vùng hỗ trợ hoặc đóng cửa giảm kèm thanh khoản gia tăng." : "Chưa có tín hiệu đủ mạnh; chờ phá vỡ vùng hỗ trợ/kháng cự với thanh khoản xác nhận.";
  const invalidation = sentiment.includes("BULLISH")
    ? `Luận điểm tăng suy yếu nếu giá đóng cửa dưới vùng hỗ trợ ${analysis.supportResistance?.support?.toFixed(2) ?? "gần nhất"}.`
    : sentiment.includes("BEARISH") ? `Luận điểm giảm suy yếu nếu giá vượt vùng kháng cự ${analysis.supportResistance?.resistance?.toFixed(2) ?? "gần nhất"}.` : "Không nên kết luận hướng đi khi chưa có tín hiệu xác nhận.";
  const baseConfidence = sentiment === "NEUTRAL" ? 0.5 : 0.55 + Math.min(0.35, Math.abs(analysis.score - 50) / 140 + Math.max(reversalBullish, reversalBearish) / 20);

  return {
    sentiment,
    labelVi,
    confidence: round(Math.min(0.9, baseConfidence)),
    trend,
    indicatorSummary,
    chartPatterns: recentCharts.map((item) => ({ nameVi: item.nameVi, type: item.type, reliability: item.reliability, target: item.target, description: item.description })),
    candlestickPatterns: recentCandles.map((item) => ({ nameVi: item.nameVi, type: item.type, reliability: item.reliability, description: item.description })),
    confirmation,
    invalidation,
  };
}
