/**
 * Company Profile & SWOT Engine.
 *
 * Generates descriptive company profile and rule-based SWOT analysis using:
 * - Real price/volume data
 * - Sector benchmarks
 * - Financial statement metrics (from synthesis or real data)
 * - Recent news sentiment
 *
 * Fully deterministic given the same inputs.
 */

import type { Ohlcv } from "@/lib/connectors/core";
import { getBenchmarkForSymbol } from "@/lib/industry-benchmarks";
import type { FinancialQuarter } from "@/lib/financial-statements";

export interface CompanyProfile {
  symbol: string;
  name: string;
  exchange: string;
  sector: string;
  industry: string;
  description: string;
  employees: number;
  website: string;
  listingDate: string;
  marketCapBillionVnd: number;
  sharesOutstandingMillions: number;
  beta: number;
  benchmarkDescription: string;
  isGenerated: true;
}

export interface SwotAnalysis {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
}

function seededRand(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  };
}

export function generateCompanyProfile(
  symbol: string,
  name: string,
  exchange: string,
  bars: Ohlcv[],
  sharesMillions: number,
): CompanyProfile {
  const bm = getBenchmarkForSymbol(symbol);
  const lastPrice = bars[bars.length - 1].close;
  // lastPrice is in thousands of VND, sharesMillions in millions → billions VND
  const marketCapB = lastPrice * sharesMillions;
  const rand = seededRand(`profile-${symbol}`);
  const employeesEst = Math.round(bm.revenuePerEmployee * (0.7 + rand() * 0.6));
  const listingYear = 2005 + Math.floor(rand() * 16);
  const listingDate = `${listingYear}-0${1 + Math.floor(rand() * 9)}-15`;
  const website = `www.${symbol.toLowerCase()}.com.vn`;

  const return1y = bars.length > 252
    ? ((bars[bars.length - 1].close - bars[bars.length - 253].close) / bars[bars.length - 253].close) * 100
    : null;
  const avgVol = bars.slice(-20).reduce((s, b) => s + b.volume, 0) / 20;

  let description = `${name} (mã ${symbol}) là doanh nghiệp niêm yết trên sàn ${exchange}, hoạt động chính trong ngành ${bm.industry}, thuộc lĩnh vực ${bm.sector}. `;
  description += bm.description + " ";
  description += `Vốn hóa thị trường ước tính khoảng ${marketCapB.toFixed(0)} nghìn tỷ VNĐ, khối lượng giao dịch trung bình 20 phiên khoảng ${(avgVol / 1_000_000).toFixed(1)} triệu cổ phiếu/phiên. `;
  if (return1y !== null) {
    description += `Trong 1 năm qua, giá cổ phiếu ${return1y >= 0 ? "tăng" : "giảm"} ${Math.abs(return1y).toFixed(1)}%. `;
  }
  description += `Mức beta ngành khoảng ${bm.beta.toFixed(2)}, tương ứng với mức độ biến động ${bm.beta > 1.1 ? "cao hơn" : bm.beta < 0.9 ? "thấp hơn" : "tương đương"} thị trường chung. `;
  description += `Thông tin mô tả được tổng hợp từ dữ liệu thị trường thực và benchmark ngành.`;

  return {
    symbol,
    name,
    exchange,
    sector: bm.sector,
    industry: bm.industry,
    description,
    employees: employeesEst,
    website,
    listingDate,
    marketCapBillionVnd: Number(marketCapB.toFixed(0)),
    sharesOutstandingMillions: sharesMillions,
    beta: bm.beta,
    benchmarkDescription: bm.description,
    isGenerated: true,
  };
}

export function generateSwot(
  symbol: string,
  quarters: FinancialQuarter[],
  sentimentScore: number,
  bars: Ohlcv[],
): SwotAnalysis {
  const bm = getBenchmarkForSymbol(symbol);
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const opportunities: string[] = [];
  const threats: string[] = [];

  // Aggregate metrics across available quarters
  const latest = quarters[0];
  const prior = quarters.length > 1 ? quarters[1] : null;
  const inc = latest.income;
  const bal = latest.balance;
  const cf = latest.cashflow;

  const netMargin = inc.revenue > 0 ? inc.netIncome / inc.revenue : 0;
  const roe = bal.equity > 0 ? inc.netIncome / bal.equity * 4 : 0; // annualized
  const debtEquity = bal.equity > 0 ? bal.totalLiabilities / bal.equity : 999;
  const currentRatio = bal.currentLiabilities > 0 ? bal.currentAssets / bal.currentLiabilities : 0;
  const interestCoverage = inc.interestExpense > 0 ? inc.operatingIncome / inc.interestExpense : 99;
  const fcfMargin = inc.revenue > 0 ? cf.freeCashFlow / inc.revenue : 0;
  const revenueGrowth = prior && prior.income.revenue > 0 ? (inc.revenue / prior.income.revenue - 1) * 100 : 0;

  const return1y = bars.length > 252 ? ((bars[bars.length - 1].close - bars[bars.length - 253].close) / bars[bars.length - 253].close) * 100 : null;

  // ─── STRENGTHS ───
  if (roe > 0.15) {
    strengths.push(`ROE hàng năm hóa trên ${(roe * 100).toFixed(1)}%, cao hơn mức trung bình ngành, cho thấy hiệu quả sử dụng vốn chủ sở hữu tốt.`);
  } else if (roe > 0.10) {
    strengths.push(`ROE ${(roe * 100).toFixed(1)}% ở mức khá so với ngành.`);
  }
  if (debtEquity < 0.5) {
    strengths.push(`Tỷ lệ Nợ/Vốn chủ ${(debtEquity * 100).toFixed(0)}%, đòn bẩy thấp, an toàn tài chính.`);
  } else if (debtEquity < 0.8) {
    strengths.push(`Cơ cấu vốn cân đối (D/E = ${debtEquity.toFixed(2)}).`);
  }
  if (currentRatio > 1.5) {
    strengths.push(`Tỷ số thanh toán hiện hành ${currentRatio.toFixed(2)}, khả năng trả nợ ngắn hạn tốt.`);
  }
  if (interestCoverage > 5) {
    strengths.push(`EBIT/Lãi vay ${interestCoverage.toFixed(1)} lần, khả năng trả lãi rất an toàn.`);
  } else if (interestCoverage > 3) {
    strengths.push(`Khả năng trả lãi ổn định (EBIT/Lãi vay = ${interestCoverage.toFixed(1)}).`);
  }
  if (fcfMargin > 0.05) {
    strengths.push(`Biên dòng tiền tự do ${(fcfMargin * 100).toFixed(1)}%, chất lượng lợi nhuận tốt.`);
  }
  if (netMargin > bm.netMargin * 1.1) {
    strengths.push(`Biên lợi nhuận ròng ${(netMargin * 100).toFixed(1)}% cao hơn trung bình ngành ${(bm.netMargin * 100).toFixed(0)}%.`);
  }
  if (revenueGrowth > 5) {
    strengths.push(`Doanh thu quý gần nhất tăng ${revenueGrowth.toFixed(1)}% so với quý trước.`);
  }
  if (sentimentScore > 0.1) {
    strengths.push(`Tin tức gần đây có sắc thái tích cực (sentiment ${sentimentScore.toFixed(2)}).`);
  }
  if (cf.dividendsPaid > 0) {
    strengths.push(`Chính sách trả cổ tức đều đặn (chi ${cf.dividendsPaid.toFixed(0)} tỷ quý gần nhất).`);
  }
  if (strengths.length === 0) {
    strengths.push("Vị thế ngành ổn định, có khả năng duy trì hoạt động trong môi trường hiện tại.");
  }

  // ─── WEAKNESSES ───
  if (debtEquity > 1.2) {
    weaknesses.push(`Đòn bẩy cao (D/E = ${debtEquity.toFixed(2)}), rủi ro tài chính nếu lãi suất tăng hoặc dòng tiền suy giảm.`);
  }
  if (currentRatio < 1.0) {
    weaknesses.push(`Thanh khoản ngắn hạn yếu (current ratio ${currentRatio.toFixed(2)}), áp lực trả nợ.`);
  }
  if (interestCoverage < 2 && inc.interestExpense > 0) {
    weaknesses.push(`EBIT chỉ che lãi vay ${interestCoverage.toFixed(1)} lần, khả năng trả lãi yếu.`);
  }
  if (fcfMargin < -0.02) {
    weaknesses.push(`Dòng tiền tự do âm (${(fcfMargin * 100).toFixed(1)}% doanh thu), cần vốn lưu động hoặc vốn vay bổ sung.`);
  }
  if (netMargin < bm.netMargin * 0.7 && netMargin > 0) {
    weaknesses.push(`Biên lợi nhuận ròng ${(netMargin * 100).toFixed(1)}% thấp hơn trung bình ngành ${(bm.netMargin * 100).toFixed(0)}%.`);
  }
  if (revenueGrowth < -3) {
    weaknesses.push(`Doanh thu quý gần nhất giảm ${Math.abs(revenueGrowth).toFixed(1)}% so với quý trước.`);
  }
  if (return1y !== null && return1y < -15) {
    weaknesses.push(`Giá giảm ${Math.abs(return1y).toFixed(1)}% trong 1 năm, áp lực tâm lý nhà đầu tư.`);
  }
  if (sentimentScore < -0.1) {
    weaknesses.push(`Tin tức gần đây tiêu cực (sentiment ${sentimentScore.toFixed(2)}).`);
  }
  if (weaknesses.length === 0 && netMargin < bm.netMargin) {
    weaknesses.push("Biên lợi nhuận ở mức trung bình ngành, cần cải thiện hiệu quả vận hành để tăng tính cạnh tranh.");
  }
  if (weaknesses.length === 0) {
    weaknesses.push("Quy mô thị phần có thể bị thách thức bởi các đối thủ lớn hơn trong ngành.");
  }

  // ─── OPPORTUNITIES ───
  if (bm.sector === "Công nghệ" || bm.industry.includes("CNTT")) {
    opportunities.push("Chuyển đổi số và đầu tư CNTT doanh nghiệp vẫn là xu hướng dài hạn tại Việt Nam.");
  }
  if (bm.sector === "Bất động sản") {
    opportunities.push("Chính sách tiền tệ nới lỏng và gói hỗ trợ nhà ở xã hội có thể thúc đẩy phục hồi.");
    opportunities.push("Quá trình đô thị hóa tiếp diễn tạo cầu dài hạn cho nhà ở và BĐS công nghiệp.");
  }
  if (bm.industry.includes("Thép") || bm.sector === "Nguyên vật liệu") {
    opportunities.push("Đầu tư công (cao tốc, sân bay) thúc đẩy nhu cầu thép và vật liệu xây dựng.");
  }
  if (bm.sector === "Ngân hàng") {
    opportunities.push("Tỷ lệ bao phủ tài chính còn thấp, room tăng trưởng tín dụng hỗ trợ tăng trưởng quy mô.");
  }
  if (bm.sector === "Bán lẻ") {
    opportunities.push("Tầng lớp trung lưu tăng nhanh và hiện đại hóa kênh phân phối tạo dư địa tăng trưởng.");
  }
  if (bm.sector === "Năng lượng" || bm.sector === "Tiện ích công cộng") {
    opportunities.push("Chuyển dịch năng lượng và đầu tư vào năng lượng tái tạo mở ra mảng kinh doanh mới.");
  }
  if (bm.sector === "Tiêu dùng thiết yếu") {
    opportunities.push("Xu hướng tiêu dùng trong nước và đẩy mạnh xuất khẩu sang thị trường ASEAN/CA.");
  }
  if (fcfMargin > 0.03) {
    opportunities.push(`Dòng tiền tự do dương (${cf.freeCashFlow.toFixed(0)} tỷ/quý) có thể dùng để đầu tư M&A hoặc trả cổ tức cao hơn.`);
  }
  if (roe > 0.12) {
    opportunities.push("Khả năng sinh lời cao giúp dễ tiếp cận vốn vay lãi suất ưu đãi hoặc huy động vốn mới.");
  }
  opportunities.push("Hội nhập kinh tế và các hiệp định thương mại (EVFTA, CPTPP) mở rộng thị trường xuất khẩu.");
  opportunities.push("Ứng dụng công nghệ (AI, tự động hóa) giúp tối ưu chi phí vận hành.");

  // ─── THREATS ───
  threats.push("Biến động lãi suất và tỷ giá VND/USD ảnh hưởng đến chi phí vốn và kết quả kinh doanh.");
  threats.push("Cạnh tranh ngày càng gay gắt từ các đối thủ trong và ngoài nước.");
  if (bm.sector === "Bất động sản") {
    threats.push("Rủi ro pháp lý dự án và khả năng hấp thụ thị trường đối với các sản phẩm cao cấp.");
  }
  if (bm.sector === "Thép" || bm.sector === "Nguyên vật liệu") {
    threats.push("Giá nguyên liệu (quặng sắt, than) biến động mạnh trên thế giới ảnh hưởng biên lợi nhuận.");
  }
  if (bm.sector === "Ngân hàng" || bm.sector === "Chứng khoán") {
    threats.push("Rủi ro nợ xấu gia tăng khi kinh tế vĩ mô còn bất ổn; thị trường chứng khoán biến động mạnh.");
  }
  if (bm.sector === "Bán lẻ" || bm.sector === "Tiêu dùng thiết yếu") {
    threats.push("Sức mua người tiêu dùng nhạy cảm với lạm phát và biến động thu nhập.");
  }
  if (debtEquity > 1.0) {
    threats.push("Đòn bẩy cao làm gia tăng rủi ro khi lãi suất tăng hoặc thị trường vốn khó khăn.");
  }
  if (revenueGrowth < -5) {
    threats.push("Tăng trưởng doanh thu chậm lại có thể kéo theo áp lực giá cổ phiếu và tâm lý nhà đầu tư.");
  }
  if (sentimentScore < -0.05) {
    threats.push("Luồng tin tiêu cực gần đây có thể ảnh hưởng giá cổ phiếu ngắn hạn.");
  }

  // Cap the lists to keep output focused
  return {
    strengths: strengths.slice(0, 6),
    weaknesses: weaknesses.slice(0, 6),
    opportunities: opportunities.slice(0, 6),
    threats: threats.slice(0, 6),
  };
}
