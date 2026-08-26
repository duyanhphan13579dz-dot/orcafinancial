import type { CrossModuleContext } from "@/lib/stock-intelligence/cross-module-engine";
import type { BusinessIntelligence } from "@/lib/stock-intelligence/moat-engine";

export interface ThesisPoint { title: string; detail: string; confidence: number; source: string; }
export interface InvestmentThesis { symbol: string; stance: "constructive" | "neutral" | "cautious" | "insufficient_data"; score: number | null; whyBuy: ThesisPoint[]; whyNotBuy: ThesisPoint[]; invalidation: ThesisPoint[]; catalysts: ThesisPoint[]; monitoring: string[]; dataConfidence: number; predictionConfidence: number; disclosure: string; version: string; approval: "SYSTEM_DRAFT" | "USER_APPROVED"; evidenceLinks: Array<{ label: string; source: string; confidence: number }>; }
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
  if (fundamental != null && fundamental >= 65) whyBuy.push(point("Nền tảng tài chính hỗ trợ", `Điểm sức khỏe tài chính ${fundamental}/100 cho thấy trạng thái tài chính hiện tại đang là trụ cột tích cực của luận điểm.`, 0.65, "financial-health"));
  if (technical != null && technical >= 60) whyBuy.push(point("Động lượng kỹ thuật thuận lợi", `Điểm kỹ thuật ${technical}/100 và tín hiệu hiện hữu đang ủng hộ xu hướng nghiên cứu.`, 0.65, "technical-analysis"));
  if (valuation != null && valuation >= 60) whyBuy.push(point("Định giá không quá bất lợi", `Điểm định giá ${valuation}/100 cho thấy bối cảnh giá trị hợp lý chưa ở trạng thái cực đoan bất lợi.`, 0.55, "valuation-engine"));
  for (const signal of input.crossModule.signals.filter((item) => item.direction === "positive")) whyBuy.push(point(`${signal.module.toUpperCase()} là yếu tố hỗ trợ`, signal.evidence, signal.confidence, `cross-module:${signal.module}`));
  if (input.business.moat.rating === "strong" || input.business.moat.rating === "moderate") whyBuy.push(point("Moat proxy có tín hiệu hỗ trợ", `Điểm hào kinh tế ${input.business.moat.score}/100 chỉ là proxy và cần được xác minh bằng dữ liệu doanh nghiệp thực tế.`, input.business.dataConfidence, "business-intelligence"));
  if (risk != null && risk < 50) whyNotBuy.push(point("Rủi ro tổng hợp cần chiết khấu", `Điểm rủi ro ${risk}/100 chưa tạo vùng an toàn rõ ràng.`, 0.6, "risk-engine"));
  for (const signal of input.crossModule.signals.filter((item) => item.direction === "negative")) whyNotBuy.push(point(`${signal.module.toUpperCase()} là yếu tố bất lợi`, signal.evidence, signal.confidence, `cross-module:${signal.module}`));
  if (input.business.moat.rating === "insufficient_data") whyNotBuy.push(point("Chưa đủ dữ liệu để xác nhận moat", input.business.moat.caveat, input.business.dataConfidence, "business-intelligence"));
  if (input.forecastExpectedValue != null && input.currentPrice != null && input.forecastExpectedValue < input.currentPrice) whyNotBuy.push(point("Giá trị kỳ vọng thấp hơn giá hiện tại", `Giá trị kỳ vọng ${input.forecastExpectedValue.toFixed(2)} thấp hơn giá hiện tại ${input.currentPrice.toFixed(2)} theo mô hình kịch bản; không hỗ trợ mua mới khi chưa có dữ liệu xác minh.`, 0.55, "forecast-engine"));
  invalidation.push(point("Sức khỏe tài chính suy giảm", "Luận điểm cần xem lại nếu sức khỏe tài chính hiện tại giảm mạnh qua các kỳ liên tiếp hoặc xuất hiện sai lệch trong báo cáo đã công bố.", 0.75, "financial-validation"));
  invalidation.push(point("Causal headwind kéo dài", "Luận điểm bị suy yếu một phần nếu hàng hóa đầu vào, tỷ giá, vĩ mô hoặc trạng thái thị trường tạo tác động âm kéo dài và không được bù bởi tăng trưởng nội tại.", input.crossModule.dataConfidence, "cross-module-causal"));
  invalidation.push(point("Breakdown kỹ thuật có xác nhận", "Cần hạ luận điểm khi vùng hỗ trợ bị phá vỡ kèm thanh khoản bất thường và kiểm định quá khứ không còn ủng hộ tín hiệu.", 0.55, "technical/backtest"));
  catalysts.push(...input.crossModule.signals.filter((item) => item.direction === "positive").map((signal) => point(signal.headline, signal.evidence, signal.confidence, `cross-module:${signal.module}`)));
  monitoring.push("Theo dõi latest reported financial period và phân biệt actual với estimate/target.");
  monitoring.push("Theo dõi thay đổi ORCA score, risk score và market regime theo thời gian.");
  monitoring.push("Theo dõi các causal chain có confidence thấp trước khi dùng cho quyết định.");
  const dataConfidence = Math.min(input.business.dataConfidence, input.crossModule.dataConfidence);
  const predictionConfidence = input.predictionConfidence ?? 0.35;
  const stance = score == null || dataConfidence < 0.25 ? "insufficient_data" : score >= 68 && (risk == null || risk >= 50) ? "constructive" : score <= 42 || (risk != null && risk < 35) ? "cautious" : "neutral";
  const evidenceLinks = [...whyBuy, ...whyNotBuy, ...invalidation, ...catalysts].slice(0, 12).map((item) => ({ label: item.title, source: item.source, confidence: item.confidence }));
  return { symbol: input.symbol, stance, score, whyBuy: whyBuy.slice(0, 5), whyNotBuy: whyNotBuy.slice(0, 5), invalidation, catalysts: catalysts.slice(0, 5), monitoring, dataConfidence, predictionConfidence, disclosure: "Investment thesis là lớp tổng hợp có giải thích từ data-engine và các engine hiện hữu. Các điểm moat/cross-module có thể là proxy hoặc causal inference khi chưa có actual filing, segment disclosure hoặc causal backtest; không phải khuyến nghị đầu tư cá nhân.", version: `thesis-${new Date().toISOString().slice(0, 10)}`, approval: "SYSTEM_DRAFT", evidenceLinks };
}
