import type { CrossModuleContext } from "@/lib/stock-intelligence/cross-module-engine";
import type { BusinessIntelligence } from "@/lib/stock-intelligence/moat-engine";

export interface ThesisPoint { title: string; detail: string; confidence: number; source: string; }
export interface InvestmentThesis { symbol: string; stance: "constructive" | "neutral" | "cautious" | "insufficient_data"; score: number | null; whyBuy: ThesisPoint[]; whyNotBuy: ThesisPoint[]; invalidation: ThesisPoint[]; catalysts: ThesisPoint[]; monitoring: string[]; dataConfidence: number; predictionConfidence: number; disclosure: string; }
function clamp(n: number, min = 0, max = 100) { return Math.max(min, Math.min(max, Math.round(n))); }
function point(title: string, detail: string, confidence: number, source: string): ThesisPoint { return { title, detail, confidence, source }; }

export function buildInvestmentThesis(input: { symbol: string; recommendation?: string | null; technicalScore?: number | null; fundamentalScore?: number | null; valuationScore?: number | null; riskScore?: number | null; sentimentScore?: number | null; forecastExpectedValue?: number | null; currentPrice?: number | null; crossModule: CrossModuleContext; business: BusinessIntelligence; predictionConfidence?: number | null }): InvestmentThesis {
  const whyBuy: ThesisPoint[] = [];
  const whyNotBuy: ThesisPoint[] = [];
  const invalidation: ThesisPoint[] = [];
  const catalysts: ThesisPoint[] = [];
  const monitoring: string[] = [];
  const technical = input.technicalScore ?? null;
  const fundamental = input.fundamentalScore ?? null;
  const valuation = input.valuationScore ?? null;
  const risk = input.riskScore ?? null;
  const compositeValues = [technical, fundamental, valuation].filter((value): value is number => value != null);
  const score = compositeValues.length ? clamp(compositeValues.reduce((sum, value) => sum + value, 0) / compositeValues.length) : null;
  if (fundamental != null && fundamental >= 65) whyBuy.push(point("Nền tảng tài chính hỗ trợ", `Financial score ${fundamental}/100 cho thấy current-state health đang là trụ cột tích cực của thesis.`, 0.65, "financial-health"));
  if (technical != null && technical >= 60) whyBuy.push(point("Động lượng kỹ thuật thuận lợi", `Technical score ${technical}/100 và tín hiệu hiện hữu đang ủng hộ xu hướng nghiên cứu.`, 0.65, "technical-analysis"));
  if (valuation != null && valuation >= 60) whyBuy.push(point("Định giá không quá bất lợi", `Valuation score ${valuation}/100 cho thấy fair-value context không ở trạng thái cực đoan bất lợi.`, 0.55, "valuation-engine"));
  for (const signal of input.crossModule.signals.filter((item) => item.direction === "positive")) whyBuy.push(point(`${signal.module.toUpperCase()} là catalyst`, signal.evidence, signal.confidence, `cross-module:${signal.module}`));
  if (input.business.moat.rating === "strong" || input.business.moat.rating === "moderate") whyBuy.push(point("Moat proxy có tín hiệu hỗ trợ", `Moat scorecard ${input.business.moat.score}/100, cần được xác minh bằng dữ liệu doanh nghiệp thực tế.`, input.business.dataConfidence, "business-intelligence"));
  if (risk != null && risk < 50) whyNotBuy.push(point("Rủi ro tổng hợp cần chiết khấu", `Risk score ${risk}/100 chưa tạo vùng an toàn rõ ràng.`, 0.6, "risk-engine"));
  for (const signal of input.crossModule.signals.filter((item) => item.direction === "negative")) whyNotBuy.push(point(`${signal.module.toUpperCase()} là headwind`, signal.evidence, signal.confidence, `cross-module:${signal.module}`));
  if (input.business.moat.rating === "insufficient_data") whyNotBuy.push(point("Chưa đủ dữ liệu để xác nhận moat", input.business.moat.caveat, input.business.dataConfidence, "business-intelligence"));
  if (input.forecastExpectedValue != null && input.currentPrice != null && input.forecastExpectedValue < input.currentPrice) whyNotBuy.push(point("Expected value thấp hơn giá hiện tại", `Expected value ${input.forecastExpectedValue.toFixed(2)} thấp hơn current price ${input.currentPrice.toFixed(2)} theo scenario engine.`, 0.55, "forecast-engine"));
  invalidation.push(point("Sức khỏe tài chính suy giảm", "Thesis cần xem lại nếu current financial health giảm mạnh qua các kỳ liên tiếp hoặc xuất hiện mismatch trong báo cáo actual.", 0.75, "financial-validation"));
  invalidation.push(point("Causal headwind kéo dài", "Thesis bị vô hiệu hóa một phần nếu commodity, FX, macro hoặc market regime tạo tác động âm kéo dài và không được bù bởi tăng trưởng nội tại.", input.crossModule.dataConfidence, "cross-module-causal"));
  invalidation.push(point("Breakdown kỹ thuật có xác nhận", "Cần hạ thesis khi support bị phá vỡ kèm volume bất thường và backtest không còn ủng hộ signal.", 0.55, "technical/backtest"));
  catalysts.push(...input.crossModule.signals.filter((item) => item.direction === "positive").map((signal) => point(signal.headline, signal.evidence, signal.confidence, `cross-module:${signal.module}`)));
  monitoring.push("Theo dõi latest reported financial period và phân biệt actual với estimate/target.");
  monitoring.push("Theo dõi thay đổi ORCA score, risk score và market regime theo thời gian.");
  monitoring.push("Theo dõi các causal chain có confidence thấp trước khi dùng cho quyết định.");
  const dataConfidence = Math.min(input.business.dataConfidence, input.crossModule.dataConfidence);
  const predictionConfidence = input.predictionConfidence ?? 0.35;
  const stance = score == null || dataConfidence < 0.25 ? "insufficient_data" : score >= 68 && (risk == null || risk >= 50) ? "constructive" : score <= 42 || (risk != null && risk < 35) ? "cautious" : "neutral";
  return { symbol: input.symbol, stance, score, whyBuy: whyBuy.slice(0, 5), whyNotBuy: whyNotBuy.slice(0, 5), invalidation, catalysts: catalysts.slice(0, 5), monitoring, dataConfidence, predictionConfidence, disclosure: "Investment thesis là lớp tổng hợp có giải thích từ data-engine và các engine hiện hữu. Các điểm moat/cross-module có thể là proxy hoặc causal inference khi chưa có actual filing, segment disclosure hoặc causal backtest; không phải khuyến nghị đầu tư cá nhân." };
}
