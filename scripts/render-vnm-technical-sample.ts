import fs from "node:fs";
import path from "node:path";
import { analyze } from "@/lib/analysis";
import { detectCandlestickPatterns, detectChartPatterns } from "@/lib/technical-patterns";
import { buildTechnicalSentiment } from "@/lib/stock-intelligence/technical-sentiment";
import { renderStockAnalysisPdf } from "@/lib/stock-intelligence/stock-analysis-pdf";

function sampleBars() {
  return Array.from({ length: 140 }, (_, index) => {
    const trend = 62 + index * 0.18 + Math.sin(index / 6) * 2.2 + Math.sin(index / 15) * 1.1;
    const open = trend + Math.sin(index * 1.7) * 0.7;
    const close = trend + Math.cos(index * 1.3) * 0.85;
    const high = Math.max(open, close) + 0.9 + Math.abs(Math.sin(index)) * 0.6;
    const low = Math.min(open, close) - 0.9 - Math.abs(Math.cos(index)) * 0.5;
    return { time: 1700000000 + index * 86400, open, high, low, close, volume: 900_000 + index * 2_500 + Math.abs(Math.sin(index / 3)) * 250_000, source: "ui-smoke-fixture" };
  });
}

const bars = sampleBars();
const technical = analyze("VNM", bars);
const candlestickPatterns = detectCandlestickPatterns(bars).filter((item) => item.barIndex >= bars.length - 30);
const chartPatterns = detectChartPatterns(bars);
const technicalSentiment = buildTechnicalSentiment(technical, chartPatterns, candlestickPatterns);
const quarters = Array.from({ length: 8 }, (_, index) => {
  const year = 2026 - Math.floor(index / 4);
  const quarter = 4 - (index % 4);
  const revenue = 15_000 - index * 280;
  const netIncome = 2_200 - index * 45;
  return {
    period: `Q${quarter}/${year}`, quarter, fiscalYear: year,
    income: { revenue, grossProfit: revenue * 0.28, ebitda: revenue * 0.18, netIncome, eps: 1.15 - index * 0.02 },
    balance: { totalAssets: 45_000 - index * 300, totalLiabilities: 15_000 - index * 120, equity: 30_000 - index * 180, cash: 4_500 - index * 40, bookValuePerShare: 24 },
    cashflow: { operatingCashFlow: 2_500 - index * 40, investingCashFlow: -700, financingCashFlow: -300, freeCashFlow: 1_800 - index * 40 },
  };
});
const narrative = {
  executiveSummary: "Mẫu kiểm thử giao diện cho VNM: doanh nghiệp có nền tảng hoạt động ổn định trong fixture, trong khi tín hiệu kỹ thuật được đánh giá độc lập theo giá và thanh khoản.",
  investmentThesis: ["Tăng trưởng và biên lợi nhuận cần được xác nhận bằng các kỳ tiếp theo.", "Tín hiệu kỹ thuật hiện là dữ liệu tham khảo ngắn hạn, không thay thế phân tích cơ bản."],
  businessModel: "Doanh nghiệp hàng tiêu dùng chuyển hóa sản lượng, giá bán và hệ thống phân phối thành doanh thu và dòng tiền.",
  industryCompetitivePositioning: "Vị thế cạnh tranh cần được đối chiếu với dữ liệu thị phần, thương hiệu và biên lợi nhuận ngành thực tế.",
  financialAnalysis: "Fixture cho thấy doanh thu, EBITDA và dòng tiền dương qua các kỳ; số liệu trong file này chỉ phục vụ kiểm thử hiển thị.",
  technicalAssessment: `${technicalSentiment.labelVi}. RSI, MACD, SMA và các mẫu hình được tổng hợp từ chuỗi giá trong fixture; cần chờ tín hiệu xác nhận bằng thanh khoản.`,
  forecastAndAssumptions: "Dự phóng minh họa, không phải dự báo đầu tư thực tế.",
  valuationView: "Định giá minh họa cần được thay bằng dữ liệu nguồn đã kiểm chứng trước khi sử dụng.",
  catalysts: ["Kết quả kinh doanh mới và diễn biến thanh khoản."],
  risksAndInvalidation: [technicalSentiment.invalidation, "Dữ liệu mẫu không phản ánh thị trường thực tế."],
  esgAndGovernance: "Chưa có dữ liệu ESG và quản trị trong fixture.",
  conclusion: "Đây là file kiểm thử trực quan, không phải báo cáo đầu tư.",
  recommendation: "Không sử dụng để ra quyết định đầu tư.",
  provider: "fixture",
  model: "ui-smoke-test",
};

const health = {
  overall: 72, rating: "healthy", asOfPeriod: quarters[0].period,
  dataQuality: { periodsUsed: 8 },
  groups: [
    { key: "liquidity", label: "Thanh khoản", score: 75, narrative: "Khả năng thanh khoản ở mức kiểm thử.", indicators: [{ key: "earningsQuality", value: 1.1 }, { key: "debtEquity", value: 0.5 }] },
    { key: "profitability", label: "Sinh lời", score: 78, narrative: "Biên lợi nhuận dương trong fixture.", indicators: [{ key: "netMargin", value: 14 }, { key: "roa", value: 8 }, { key: "roe", value: 12 }, { key: "ebitdaMargin", value: 18 }, { key: "assetTurnover", value: 0.8 }] },
  ],
  indicators: [],
};
const forecast = {
  expectedValue: 70, targetPrice: 72, valuationConfidence: 0.45, predictionConfidence: 0.5, dataConfidence: 0.45,
  scenarios: [{ name: "base", probability: 0.5, fairValue: 70, rationale: "Kịch bản cơ sở minh họa." }, { name: "bull", probability: 0.25, fairValue: 78, rationale: "Kịch bản tích cực minh họa." }, { name: "bear", probability: 0.25, fairValue: 58, rationale: "Kịch bản tiêu cực minh họa." }],
  forecast: [{ period: "2027E", revenue: 16_000, ebitda: 3_000, netIncome: 2_400, eps: 1.25 }],
  assumptionBridge: ["Giả định minh họa cho smoke test."], status: "ready",
};
const risk = { overall: 38, level: "medium", mainRisk: "Biến động thị trường và dữ liệu mẫu.", dataConfidence: 0.45, predictionConfidence: 0.5, tradePlan: { entryLow: 65, entryHigh: 68, stopLoss: 60, takeProfit1: 72, takeProfit2: 78 } };
const thesis = { stance: "neutral", score: 58, whyBuy: [{ title: "Nền tảng hoạt động", detail: "Fixture dương." }], whyNotBuy: [{ title: "Dữ liệu minh họa", detail: "Chưa dùng cho đầu tư." }], catalysts: [{ title: "Kỳ báo cáo mới", detail: "Cần xác nhận." }], invalidation: [{ title: "Phá hỗ trợ", detail: technicalSentiment.invalidation }], monitoring: ["SMA20/SMA50", "RSI(14)"] };

async function main() {
const pdf = await renderStockAnalysisPdf({
  symbol: "VNM", generatedAt: new Date().toISOString(),
  profile: { symbol: "VNM", name: "Vinamilk — UI Smoke Fixture", exchange: "HOSE", industry: "Thực phẩm", sector: "Hàng tiêu dùng", marketCapBillionVnd: 150_000, description: "Dữ liệu fixture chỉ dùng để kiểm tra trực quan giao diện báo cáo." } as any,
  quarters: quarters as any, technical, health: health as any, forecast: forecast as any, risk: risk as any,
  news: { events: [], dataConfidence: 0.45 } as any, backtest: { status: "ready", dataConfidence: 0.45 } as any,
  crossModule: { signals: [], causalLinks: [], causalChains: [], market: { regimeLabel: "NEUTRAL" } } as any, business: { segments: [] } as any, thesis: thesis as any,
  companyNarrative: narrative as any, technicalSentiment, priceHistory: bars as any,
  source: "ui-smoke-fixture — không phải dữ liệu thị trường thực", dataConfidence: 0.45,
});

const output = path.join(process.cwd(), "artifacts", "ORCA_VNM_technical_ui_smoke.pdf");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, pdf);
console.log(JSON.stringify({ output, bytes: pdf.length, sentiment: technicalSentiment, chartPatterns: chartPatterns.length, candlestickPatterns: candlestickPatterns.length }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
