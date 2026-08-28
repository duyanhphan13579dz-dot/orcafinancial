import PDFDocument from "pdfkit";
import type { CompanyProfile } from "@/lib/company-profile";
import type { FinancialQuarter } from "@/lib/financial-statements";
import type { AnalysisResult } from "@/lib/analysis";
import type { HealthDetail } from "@/lib/financial-health-detail";
import type { ForecastScenarioResult } from "@/lib/stock-intelligence/forecast-engine";
import type { RiskAssessment } from "@/lib/stock-intelligence/risk-engine";
import type { NewsIntelligenceResult } from "@/lib/stock-intelligence/news-intelligence";
import type { BacktestResult } from "@/lib/stock-intelligence/backtest-engine";
import type { CrossModuleContext } from "@/lib/stock-intelligence/cross-module-engine";
import type { BusinessIntelligence } from "@/lib/stock-intelligence/moat-engine";
import type { InvestmentThesis } from "@/lib/stock-intelligence/investment-thesis";
import type { CompanyReportLlmNarrative } from "@/lib/stock-intelligence/company-report-llm";
import type { TechnicalSentimentResult } from "@/lib/stock-intelligence/technical-sentiment";
import { generateValueChain } from "@/lib/value-chain";
import type { Ohlcv } from "@/lib/connectors/core";
import fs from "node:fs";
import path from "node:path";

export interface StockAnalysisPdfPayload {
  symbol: string;
  generatedAt: string;
  profile: CompanyProfile;
  quarters: FinancialQuarter[];
  technical: AnalysisResult;
  health: HealthDetail;
  forecast: ForecastScenarioResult;
  risk: RiskAssessment;
  news: NewsIntelligenceResult;
  backtest: BacktestResult;
  crossModule?: CrossModuleContext;
  business?: BusinessIntelligence;
  thesis?: InvestmentThesis;
  companyNarrative?: CompanyReportLlmNarrative;
  technicalSentiment?: TechnicalSentimentResult;
  priceHistory?: Ohlcv[];
  source: string;
  dataConfidence: number;
}

const FONT = path.join(process.cwd(), "public/fonts/NotoSans-Regular.ttf");
const FONT_BOLD = path.join(process.cwd(), "public/fonts/NotoSans-SemiBold.ttf");
const BLUE = "#0A2540";
const MUTED = "#55718d";
const LINE = "#d5e0ea";
const GREEN = "#087f5b";
const RED = "#b42318";
const GRID = "#dce7ef";

function indicatorValue(health: HealthDetail, key: string): number | null {
  for (const group of health.groups) {
    const item = group.indicators.find((indicator) => indicator.key === key);
    if (item) return item.value;
  }
  return null;
}

function money(value: number | null | undefined): string { return value == null || !Number.isFinite(value) ? "Chưa có dữ liệu" : value.toLocaleString("vi-VN", { maximumFractionDigits: 2 }); }
function pct(value: number | null | undefined): string { return value == null || !Number.isFinite(value) ? "Chưa có dữ liệu" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`; }
function translateReportText(value: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/Financial score/gi, "Điểm tài chính"], [/current-state health/gi, "sức khỏe hiện tại"], [/Expected value/gi, "Giá trị kỳ vọng"], [/Moat score/gi, "Điểm hào kinh tế"], [/scorecard/gi, "bảng điểm"], [/proxy/gi, "số liệu tham chiếu"], [/segment disclosure/gi, "công bố theo phân khúc"], [/classification/gi, "phân loại"], [/competitive advantage/gi, "lợi thế cạnh tranh"], [/actual audited/gi, "đã kiểm toán"], [/proxy ngành/gi, "số liệu tham chiếu ngành"], [/benchmark/gi, "mốc so sánh"], [/retention/gi, "khả năng giữ khách hàng"], [/current price/gi, "giá hiện tại"], [/breadth score/gi, "điểm độ rộng thị trường"], [/sector change/gi, "thay đổi của ngành"], [/data-engine/gi, "hệ thống dữ liệu"], [/commodity mapping/gi, "liên hệ hàng hóa"], [/pricing power/gi, "khả năng định giá"], [/brand awareness/gi, "mức độ nhận diện thương hiệu"], [/customer survey/gi, "khảo sát khách hàng"], [/Net margin/gi, "biên lợi nhuận ròng"], [/valuation/gi, "định giá"], [/Market regime/gi, "Trạng thái thị trường"], [/risk premium/gi, "phần bù rủi ro"], [/recommendation/gi, "khuyến nghị"], [/VN market regime/gi, "trạng thái thị trường Việt Nam"], [/Risk appetite/gi, "khẩu vị rủi ro"], [/Valuation multiple/gi, "hệ số định giá"], [/Fair value/gi, "Giá trị hợp lý"], [/current financial health/gi, "sức khỏe tài chính hiện tại"], [/commodity exposure/gi, "ảnh hưởng của hàng hóa đầu vào"], [/bull/gi, "tích cực"], [/base/gi, "cơ sở"], [/bear/gi, "tiêu cực"], [/unknown/gi, "chưa xác định"], [/uncertain/gi, "chưa chắc chắn"], [/NEUTRAL/gi, "trung tính"], [/risk medium/gi, "rủi ro trung bình"], [/DATA SYNCING/gi, "đang đồng bộ dữ liệu"], [/disclosure/gi, "công bố thông tin"], [/thesis/gi, "luận điểm đầu tư"], [/invalidation/gi, "điều kiện làm suy yếu luận điểm"], [/snapshot/gi, "tại thời điểm lập báo cáo"], [/trailing/gi, "theo số liệu gần nhất"], [/point-in-time/gi, "tại thời điểm lập báo cáo"], [/as-reported/gi, "theo báo cáo công bố"], [/filing/gi, "hồ sơ công bố"], [/assumptions?/gi, "giả định"], [/trade plan/gi, "kế hoạch giao dịch"], [/hold/gi, "nắm giữ"], [/buy/gi, "mua"], [/sell/gi, "bán"],
  ];
  return replacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}
function safeText(value: unknown): string { return translateReportText(String(value ?? "Chưa có dữ liệu").replace(/\s+/g, " ").trim()).replace(/\bconnector\b/gi, "nguồn kết nối").replace(/\bstock context\b/gi, "bối cảnh cổ phiếu").replace(/\bcausal headwind\b/gi, "yếu tố bất lợi kéo dài").replace(/\bISH_TREND\b/g, "xu hướng ngành").replace(/\bRISK LOW\b/gi, "rủi ro thấp").replace(/\bRISK MEDIUM\b/gi, "rủi ro trung bình").replace(/\bRISK HIGH\b/gi, "rủi ro cao").replace(/\bactual\b/gi, "số liệu công bố").replace(/\bestimate\b/gi, "ước tính").replace(/\btarget\b/gi, "mục tiêu").replace(/\bcoverage\b/gi, "độ phủ bằng chứng"); }
function recommendationVi(value: string): string { return ({ "Strong Buy": "Mua mạnh", Buy: "Mua", Hold: "Nắm giữ", Sell: "Bán", "Strong Sell": "Bán mạnh" } as Record<string, string>)[value] ?? value; }
function riskVi(value: string): string { return ({ low: "Thấp", medium: "Trung bình", high: "Cao", critical: "Rất cao" } as Record<string, string>)[value.toLowerCase()] ?? value; }
function impactVi(value: string): string { return ({ low: "Tác động thấp", medium: "Tác động trung bình", high: "Tác động cao", critical: "Tác động rất cao" } as Record<string, string>)[value.toLowerCase()] ?? value; }
function categoryVi(value: string): string { return ({ general: "Tin chung", earnings: "Kết quả kinh doanh", corporate: "Doanh nghiệp", macro: "Vĩ mô", policy: "Chính sách", industry: "Ngành", technical: "Kỹ thuật", valuation: "Định giá" } as Record<string, string>)[value.toLowerCase()] ?? value; }
function directionVi(value: string): string { return ({ positive: "tích cực", negative: "tiêu cực", neutral: "trung tính", mixed: "hỗn hợp", unknown: "chưa xác định", uncertain: "chưa chắc chắn", up: "tăng", down: "giảm" } as Record<string, string>)[value.toLowerCase()] ?? value; }
function moduleVi(value: string): string { return ({ market: "Thị trường", industry: "Ngành", commodity: "Hàng hóa", fx: "Tỷ giá", macro: "Vĩ mô" } as Record<string, string>)[value.toLowerCase()] ?? value; }
function ratingVi(value: string): string { return ({ excellent: "Rất tốt", strong: "Tốt", healthy: "Lành mạnh", moderate: "Trung bình", weak: "Yếu", poor: "Kém", insufficient_data: "Chưa đủ dữ liệu" } as Record<string, string>)[value.toLowerCase()] ?? value; }
function regimeVi(value: string): string { return value.replace(/BROAD MARKET ADVANCE/gi, "Thị trường tăng").replace(/BROAD MARKET DECLINE/gi, "Thị trường giảm").replace(/BROAD MARKET ADVANCE/gi, "Thị trường tăng").replace(/BULLISH/gi, "Tăng").replace(/BEARISH/gi, "Giảm").replace(/NEUTRAL/gi, "Trung tính").replace(/RISK LOW/gi, "Rủi ro thấp").replace(/RISK MEDIUM/gi, "Rủi ro trung bình").replace(/RISK HIGH/gi, "Rủi ro cao"); }
function forecastVersionVi(value: string): string { return value.replace(/^ORCA Forecast v/i, "phiên bản ").replace(/^ORCA AI Forecast v/i, "phiên bản "); }
function dataTierVi(confidence: number): string { return confidence >= 0.75 ? "Số liệu nguồn tương đối đầy đủ" : confidence >= 0.6 ? "Số liệu cần đối chiếu thêm" : "Ước tính/suy giảm chất lượng dữ liệu"; }
function moatScoreVi(score: number | null, coverage: string): string { return score == null || coverage === "unknown" ? "Chưa xác định" : `${score}/100 · ${coverage === "proxy" ? "proxy ngành" : "bằng chứng trực tiếp"}`; }
function cleanCausalText(value: string): string { return safeText(value).replace(/commodity/gi, "hàng hóa đầu vào").replace(/EBITDA margin/gi, "biên EBITDA").replace(/fair value/gi, "giá trị hợp lý").replace(/market regime/gi, "trạng thái thị trường").replace(/risk appetite/gi, "khẩu vị rủi ro").replace(/valuation multiple/gi, "hệ số định giá"); }

function drawPriceSnapshot(doc: PDFKit.PDFDocument, bars: Ohlcv[] = [], technical?: AnalysisResult) {
  const points = bars.slice(-90);
  if (points.length < 2) { paragraphFallback(doc, "Không đủ dữ liệu giá để vẽ biểu đồ kỹ thuật."); return; }
  const x = 54; const y = doc.y + 10; const w = 487; const h = 85;
  const closes = points.map((bar) => bar.close).filter(Number.isFinite);
  const overlaySeries = (period: number): Array<number | null> => points.map((_, index) => { const sourceIndex = bars.length - points.length + index; if (sourceIndex + 1 < period) return null; const values = bars.slice(sourceIndex - period + 1, sourceIndex + 1).map((bar) => bar.close); return values.length === period ? values.reduce((sum, value) => sum + value, 0) / period : null; });
  const sma20 = overlaySeries(20);
  const sma50 = overlaySeries(50);
  const overlayValues = [...closes, ...sma20, ...sma50].filter((value): value is number => value != null && Number.isFinite(value));
  const min = Math.min(...overlayValues); const max = Math.max(...overlayValues); const span = Math.max(max - min, 1e-9);
  doc.save().rect(x, y, w, h).fillAndStroke("#f8fbfd", LINE);
  for (let i = 0; i <= 4; i += 1) {
    const gy = y + (h * i) / 4;
    doc.strokeColor(GRID).lineWidth(0.5).moveTo(x, gy).lineTo(x + w, gy).stroke();
  }
  const drawLine = (values: Array<number | null>, color: string, width: number) => {
    const path = values.map((value, index) => value == null ? null : [x + (w * index) / Math.max(points.length - 1, 1), y + h - ((value - min) / span) * (h - 16) - 8] as const).filter((value): value is readonly [number, number] => value != null);
    if (path.length < 2) return [] as readonly [number, number][];
    doc.strokeColor(color).lineWidth(width).moveTo(path[0][0], path[0][1]);
    path.slice(1).forEach(([px, py]) => doc.lineTo(px, py));
    doc.stroke();
    return path;
  };
  const path = drawLine(closes, BLUE, 1.8);
  drawLine(sma20, GREEN, 1.1);
  drawLine(sma50, RED, 1.1);
  const last = path[path.length - 1];
  if (last) doc.fillColor(BLUE).circle(last[0], last[1], 3).fill();
  const legend = technical ? ` · SMA20 ${money(technical.sma20)} · SMA50 ${money(technical.sma50)}` : "";
  doc.font(regularFont(doc)).fontSize(7.5).fillColor(MUTED).text(`90 phiên gần nhất · thấp ${money(min)} · cao ${money(max)} · cuối ${money(points.at(-1)?.close)}${legend}`, x + 8, y + h - 16, { width: w - 16, lineBreak: false });
  doc.restore();
  doc.y = y + h + 16;
}

function regularFont(doc: PDFKit.PDFDocument): string { return (doc as PDFKit.PDFDocument & { _orcaRegular?: string })._orcaRegular ?? "Helvetica"; }
function paragraphFallback(doc: PDFKit.PDFDocument, text: string) { doc.font(regularFont(doc)).fontSize(8.2).fillColor(MUTED).text(text, { lineGap: 1.2 }); }

function valueChainRows(profile: CompanyProfile): string[][] {
  const chain = generateValueChain(profile.symbol);
  return chain.primary.map((item) => [
    item.nameVi,
    `${item.description} Biến số cần theo dõi là quy mô hoạt động, khả năng kiếm tiền và mức độ chuyển hóa thành lợi nhuận.`
  ]);
}

function businessMechanics(profile: CompanyProfile): string {
  const text = `${profile.sector} ${profile.industry}`.toLowerCase();
  if (text.includes("chứng khoán") || text.includes("securities")) {
    return "Doanh thu của doanh nghiệp chứng khoán thường được hình thành từ môi giới, cho vay ký quỹ, tự doanh, ngân hàng đầu tư và quản lý tài sản. Thanh khoản thị trường và dư nợ margin tác động đến quy mô phí; kết quả tự doanh có thể làm lợi nhuận biến động mạnh hơn doanh thu dịch vụ. Vì vậy, cần đọc đồng thời tăng trưởng hoạt động, chất lượng tài sản và mức độ phụ thuộc vào thu nhập tự doanh thay vì chỉ nhìn một chỉ tiêu lợi nhuận.";
  }
  if (text.includes("ngân hàng") || text.includes("bank")) {
    return "Ngân hàng tạo lợi nhuận chủ yếu từ chênh lệch lãi suất, phí dịch vụ và hiệu quả sử dụng vốn. Tăng trưởng tín dụng, biên lãi ròng, chi phí dự phòng và chất lượng tài sản là các biến số quyết định khả năng duy trì lợi nhuận.";
  }
  return "Doanh nghiệp chuyển hóa nguồn lực đầu vào thành sản phẩm hoặc dịch vụ, sau đó biến doanh thu thành lợi nhuận và dòng tiền. Luận điểm đầu tư cần tập trung vào biến số làm thay đổi sản lượng, giá bán, biên lợi nhuận, vốn lưu động và nhu cầu tái đầu tư.";
}

function thesisStanceVi(value: InvestmentThesis["stance"]): string {
  return value === "constructive" ? "tích cực có điều kiện" : value === "cautious" ? "thận trọng" : value === "neutral" ? "trung lập" : "chưa đủ dữ liệu";
}

function implication(direction: string, moduleLabel: string): string {
  if (direction === "positive") return `Yếu tố này đang hỗ trợ ${moduleLabel.toLowerCase()}, nhưng chỉ trở thành động lực định giá nếu được xác nhận bằng kết quả kinh doanh.`;
  if (direction === "negative") return `Yếu tố này tạo sức ép lên ${moduleLabel.toLowerCase()} và cần được phản ánh vào biên an toàn khi đánh giá cổ phiếu.`;
  return "Tác động hiện chưa đủ rõ để trở thành luận điểm định giá chính.";
}

function reportSignalText(signal: { module: string; direction: string; headline: string; evidence: string }): string {
  const moduleLabel = moduleVi(signal.module);
  return `${moduleLabel}: ${safeText(signal.headline)}. Bằng chứng hiện có: ${safeText(signal.evidence)} ${implication(signal.direction, moduleLabel)}`;
}

function reportCausalText(titleText: string, impact: string, links: Array<{ from: string; to: string }>): string {
  const path = links.map((link) => `${cleanCausalText(link.from)} dẫn tới ${cleanCausalText(link.to)}`).join("; ");
  return `Mối liên hệ đáng theo dõi: ${cleanCausalText(titleText)}. Hướng tác động hiện được đánh giá là ${directionVi(impact)}. Chuỗi quan sát: ${path || "chưa đủ dữ liệu để mô tả chi tiết"}.`;
}

function changeText(current: number | null | undefined, previous: number | null | undefined): string {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return "Chưa có dữ liệu";
  return pct((current / previous - 1) * 100);
}

export function renderStockAnalysisPdf(payload: StockAnalysisPdfPayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 46, bottom: 28, left: 48, right: 48 }, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    let regular = "Helvetica";
    let bold = "Helvetica-Bold";
    (doc as PDFKit.PDFDocument & { _orcaRegular?: string })._orcaRegular = regular;
    try {
      if (fs.existsSync(FONT) && fs.existsSync(FONT_BOLD)) {
        doc.registerFont("orca", FONT).registerFont("orca-bold", FONT_BOLD);
        regular = "orca";
        bold = "orca-bold";
        (doc as PDFKit.PDFDocument & { _orcaRegular?: string })._orcaRegular = regular;
      }
    } catch {
      // PDFKit's built-in fonts keep report generation alive on restricted runtimes.
    }
    const title = (text: string) => { if (doc.y > 650) doc.addPage(); doc.x = 48; doc.moveDown(0.2).font(bold).fontSize(13.2).fillColor(BLUE).text(text, 48, doc.y, { width: 499 }); doc.moveDown(0.08).strokeColor(LINE).moveTo(48, doc.y).lineTo(547, doc.y).stroke(); doc.moveDown(0.18); };
    const paragraph = (text: string, color = "#172b3f") => { doc.x = 48; return doc.font(regular).fontSize(8.7).fillColor(color).text(safeText(text), 48, doc.y, { width: 499, lineGap: 1.15, paragraphGap: 2 }); };
    const row = (label: string, value: string, color = "#172b3f") => { if (doc.y > 735) doc.addPage(); doc.x = 48; const y = doc.y; const left = safeText(label); const right = safeText(value); doc.font(regular).fontSize(9); const leftHeight = doc.heightOfString(left, { width: 185, lineGap: 1.1 }); doc.font(bold).fontSize(8.2); const rightHeight = doc.heightOfString(`  ${right}`, { width: 308, lineGap: 1.1 }); doc.font(regular).fontSize(8.2).fillColor(MUTED).text(left, 54, y, { width: 185, lineGap: 1.1 }); doc.font(bold).fontSize(8.2).fillColor(color).text(`  ${right}`, 239, y, { width: 308, lineGap: 1.1 }); doc.y = y + Math.max(leftHeight, rightHeight) + 2.5; };
    const bullet = (text: string, color = "#172b3f") => { if (doc.y > 735) doc.addPage(); doc.x = 48; return doc.font(regular).fontSize(8.5).fillColor(color).text(`• ${safeText(text)}`, 54, doc.y, { width: 493, lineGap: 1.2 }); };
    const table = (headers: string[], rows: string[][]) => {
      const firstWidth = headers.length >= 6 ? 72 : headers.length >= 4 ? 105 : 110;
      const widths = headers.map((_, index) => index === 0 ? firstWidth : (499 - firstWidth) / Math.max(1, headers.length - 1));
      const startX = 48; let y = doc.y;
      const draw = (values: string[], header = false) => {
        const fontSize = header ? 7.3 : headers.length >= 6 ? 6.5 : 7.1;
        const heights = values.map((value, index) => { doc.font(header ? bold : regular).fontSize(fontSize); return doc.heightOfString(safeText(value), { width: Math.max(20, widths[index] - 10), lineGap: 1.8 }); });
        const height = Math.max(header ? 17 : 16, Math.min(50, Math.max(...heights) + 7));
        if (y + height > 780) { doc.addPage(); y = doc.y; }
        let x = startX;
        doc.rect(startX, y, 499, height).fill(header ? "#eaf1f7" : "#ffffff").stroke(LINE);
        values.forEach((value, index) => { doc.font(header ? bold : regular).fontSize(fontSize).fillColor(header ? BLUE : "#172b3f").text(safeText(value), x + 4, y + 4, { width: Math.max(20, widths[index] - 8), height: height - 6, lineGap: 1.1 }); x += widths[index]; });
        y += height;
      };
      draw(headers, true); for (const values of rows) draw(values);
      doc.x = 48; doc.y = y + 5;
    };

    doc.font(bold).fontSize(9).fillColor(BLUE).text("ORCA FINANCIAL · INTELLIGENT INVESTMENT", { characterSpacing: 0.6 });
    doc.moveDown(1.6);
    doc.font(bold).fontSize(28).fillColor(BLUE).text("BÁO CÁO PHÂN TÍCH");
    doc.moveDown(0.4);
    doc.font(bold).fontSize(22).fillColor(payload.technical.recommendation.includes("Buy") ? GREEN : payload.technical.recommendation.includes("Sell") ? RED : BLUE).text(`${payload.symbol} · ${recommendationVi(payload.technical.recommendation)}`);
    doc.moveDown(0.7);
    row("Giá hiện tại", `${money(payload.technical.lastClose)} nghìn VNĐ`);
    row("Mục tiêu theo kịch bản", payload.forecast.expectedValue == null || payload.forecast.valuationConfidence < 0.6 ? "Chưa đủ dữ liệu để kết luận" : `${money(payload.forecast.targetPrice)} nghìn VNĐ`);
    row("Điểm kỹ thuật", `${payload.technical.score}/100`);
    row("Sức khỏe tài chính", `${payload.health.overall}/100 · Xếp loại ${ratingVi(payload.health.rating)}`);
    row("Độ tin cậy dữ liệu", `${Math.round(payload.dataConfidence * 100)}% · ${dataTierVi(payload.dataConfidence)}`);
    row("Thời điểm tạo", new Date(payload.generatedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }));
    doc.moveDown(1.5);
    doc.roundedRect(48, doc.y, 499, 88, 5).fillAndStroke("#f2f7fb", LINE);
    doc.font(bold).fontSize(11).fillColor(BLUE).text("KẾT LUẬN ĐIỀU HÀNH", 62, doc.y + 12);
    const valuationHeadline = payload.forecast.expectedValue != null && payload.forecast.valuationConfidence >= 0.6 ? `Giá trị kỳ vọng theo các kịch bản là ${money(payload.forecast.expectedValue)} nghìn VNĐ.` : "Định giá chưa đủ độ tin cậy để đưa ra giá trị kỳ vọng kết luận.";
    doc.font(regular).fontSize(9).fillColor("#172b3f").text(`Đánh giá tổng quan: cổ phiếu đang ở trạng thái ${recommendationVi(payload.technical.recommendation)}. ${valuationHeadline}`, 62, doc.y + 30, { width: 470, lineGap: 2.5 });
    doc.y += 104;
    if (payload.companyNarrative) {
      doc.addPage();
      title("TÓM TẮT NGHIÊN CỨU THEO CHUẨN EQUITY RESEARCH");
      paragraph(payload.companyNarrative.executiveSummary);
      if (payload.companyNarrative.investmentThesis.length) {
        title("Luận điểm đầu tư");
        payload.companyNarrative.investmentThesis.forEach((item) => bullet(item));
      }
      title("Mô hình kinh doanh"); paragraph(payload.companyNarrative.businessModel);
      title("Ngành và vị thế cạnh tranh"); paragraph(payload.companyNarrative.industryCompetitivePositioning);
      title("Phân tích tài chính"); paragraph(payload.companyNarrative.financialAnalysis);
      title("Dự phóng và giả định"); paragraph(payload.companyNarrative.forecastAndAssumptions);
      title("Quan điểm định giá"); paragraph(payload.companyNarrative.valuationView);
      if (payload.companyNarrative.catalysts.length) { title("Catalyst"); payload.companyNarrative.catalysts.forEach((item) => bullet(item)); }
      if (payload.companyNarrative.risksAndInvalidation.length) { title("Rủi ro và điều kiện vô hiệu hóa"); payload.companyNarrative.risksAndInvalidation.forEach((item) => bullet(item, RED)); }
      title("ESG và quản trị"); paragraph(payload.companyNarrative.esgAndGovernance);
      title("Kết luận và khuyến nghị"); paragraph(`${payload.companyNarrative.conclusion} ${payload.companyNarrative.recommendation}`);
      if (payload.companyNarrative.model) paragraph(`Narrative được tạo bởi ${payload.companyNarrative.provider ?? "LLM"}/${payload.companyNarrative.model}; các bảng số liệu định lượng bên dưới vẫn là nguồn hiển thị chính.`, MUTED);
    }
    if (payload.thesis) {
      row("Điểm tích cực", payload.thesis.whyBuy.slice(0, 3).map((item) => item.title).join("; ") || "Chưa xác định");
      row("Rủi ro cần lưu ý", payload.thesis.whyNotBuy.slice(0, 3).map((item) => item.title).join("; ") || payload.risk.mainRisk);
      row("Biến số cần theo dõi", payload.thesis.monitoring.slice(0, 3).join("; ") || "Kết quả kinh doanh và dòng tiền");
    }
    doc.addPage();
    title("1. DOANH NGHIỆP VÀ MÔ HÌNH KINH DOANH");
    row("Tên doanh nghiệp", payload.profile.name);
    row("Mã cổ phiếu / sàn", `${payload.profile.symbol} · ${payload.profile.exchange}`);
    row("Ngành / lĩnh vực", `${payload.profile.industry} · ${payload.profile.sector}`);
    row("Vốn hóa tham chiếu", `${money(payload.profile.marketCapBillionVnd)} tỷ VNĐ`);
    paragraph(payload.profile.description);
    paragraph(businessMechanics(payload.profile));
    table(["Mảng hoạt động", "Cơ chế tạo doanh thu và biến số cần theo dõi"], valueChainRows(payload.profile));
    if (payload.business?.segments.length) {
      paragraph("Các mảng dưới đây chỉ được sử dụng khi có bằng chứng hoặc dữ liệu tham chiếu phù hợp; phần chưa đủ độ phủ không được mặc định là lợi thế cạnh tranh.", MUTED);
      table(["Năng lực / mảng", "Nhận định", "Độ tin cậy"], payload.business.segments.slice(0, 5).map((segment) => [segment.name, segment.description, `${Math.round(segment.confidence * 100)}%`]));
    }

    title("2. KẾT QUẢ KINH DOANH VÀ XU HƯỚNG");
    paragraph(`Báo cáo sử dụng ${payload.health.dataQuality.periodsUsed} kỳ gần nhất đến ${payload.health.asOfPeriod}. ${dataTierVi(payload.dataConfidence)}; số liệu estimate được trình bày rõ ràng và không được gọi là số liệu đã kiểm toán.`, MUTED);
    table(["Kỳ", "Doanh thu", "Tăng trưởng quý", "EBITDA", "LN ròng", "EPS"], payload.quarters.slice(0, 8).map((quarter, index, rows) => [`${quarter.period} · ước tính`, money(quarter.income.revenue), changeText(quarter.income.revenue, rows[index + 1]?.income.revenue), money(quarter.income.ebitda), money(quarter.income.netIncome), money(quarter.income.eps)]));
    const latest = payload.quarters[0];
    const yearAgo = payload.quarters.find((quarter) => latest && quarter.quarter === latest.quarter && quarter.fiscalYear === latest.fiscalYear - 1);
    const revenueChange = changeText(latest?.income.revenue, payload.quarters[1]?.income.revenue);
    const netIncomeChange = changeText(latest?.income.netIncome, payload.quarters[1]?.income.netIncome);
    paragraph(`Kỳ gần nhất ghi nhận doanh thu ${money(latest?.income.revenue)} tỷ VNĐ và lợi nhuận ròng ${money(latest?.income.netIncome)} tỷ VNĐ. So với kỳ trước, doanh thu thay đổi ${revenueChange} và lợi nhuận ròng thay đổi ${netIncomeChange}. ${yearAgo ? `So với cùng kỳ, doanh thu thay đổi ${changeText(latest?.income.revenue, yearAgo.income.revenue)} và lợi nhuận ròng thay đổi ${changeText(latest?.income.netIncome, yearAgo.income.netIncome)}.` : "Chưa có đủ kỳ tương ứng để so sánh cùng kỳ."}`);
    paragraph("Ý nghĩa đầu tư: cần xác định biến động lợi nhuận đến từ tăng trưởng hoạt động, thay đổi biên, chi phí tài chính hay khoản thu nhập bất thường. Một quý tăng trưởng đơn lẻ chưa đủ để kết luận xu hướng bền vững.", MUTED);
    table(["Chỉ tiêu", "Hiện tại", "So với kỳ trước", "Diễn giải"], [
      ["Doanh thu", money(latest?.income.revenue), revenueChange, "Quy mô hoạt động trong kỳ báo cáo."],
      ["Biên EBITDA", pct(indicatorValue(payload.health, "ebitdaMargin")), "—", "Khả năng chuyển doanh thu thành lợi nhuận trước khấu hao và lãi vay."],
      ["Lợi nhuận ròng", money(latest?.income.netIncome), netIncomeChange, "Kết quả sau chi phí tài chính và thuế."],
      ["ROA / ROE / ROS", `${pct(indicatorValue(payload.health, "roa"))} / ${pct(indicatorValue(payload.health, "roe"))} / ${pct(indicatorValue(payload.health, "netMargin"))}`, "—", "Đọc cùng biên lợi nhuận, vòng quay tài sản và đòn bẩy."],
    ]);

    title("3. SỨC KHỎE TÀI CHÍNH VÀ DÒNG TIỀN");
    const healthNarrative = payload.health.groups.map((group) => `${group.label}: ${group.narrative}`).join(" ");
    paragraph(`Điểm sức khỏe tài chính ${payload.health.overall}/100, xếp loại ${ratingVi(payload.health.rating)}. ${healthNarrative}`);
    table(["Chỉ tiêu", "Giá trị", "Ý nghĩa đối với luận điểm"], [
      ["CFO", money(latest?.cashflow.operatingCashFlow), "Dòng tiền dương hỗ trợ chất lượng lợi nhuận; cần kiểm tra tính lặp lại qua nhiều kỳ."],
      ["FCF", money(latest?.cashflow.freeCashFlow), "Phần tiền còn lại sau chi đầu tư; âm kéo dài có thể làm giảm khả năng tự tài trợ."],
      ["CFO / lợi nhuận ròng", `${money(indicatorValue(payload.health, "earningsQuality"))}x`, "Đo mức độ chuyển đổi lợi nhuận kế toán thành dòng tiền."],
      ["Nợ / vốn chủ", `${money(indicatorValue(payload.health, "debtEquity"))}x`, "Đòn bẩy cao làm tăng độ nhạy của lợi nhuận và định giá với lãi suất."],
      ["Thanh khoản", `${payload.health.groups.find((group) => group.key === "liquidity")?.score ?? "—"}/100`, "Khả năng đáp ứng nghĩa vụ ngắn hạn."],
    ]);
    const dupontMargin = indicatorValue(payload.health, "netMargin");
    const dupontTurnover = indicatorValue(payload.health, "assetTurnover");
    const dupontLeverage = indicatorValue(payload.health, "debtEquity");
    table(["Phân rã DuPont", "Giá trị", "Cách đọc"], [
      ["Biên lợi nhuận ròng", pct(dupontMargin), "Lợi nhuận ròng trên doanh thu."],
      ["Vòng quay tài sản", dupontTurnover == null ? "Chưa có dữ liệu" : `${money(dupontTurnover)} vòng`, "Hiệu quả sử dụng tài sản để tạo doanh thu."],
      ["Hệ số nhân vốn chủ", dupontLeverage == null ? "Chưa có dữ liệu" : `${money(1 + dupontLeverage)} lần`, "Mức độ khuếch đại ROE từ đòn bẩy."],
      ["ROE", pct(indicatorValue(payload.health, "roe")), "Kết quả cần được giải thích bởi ba thành phần trên."],
    ]);
    paragraph("Sức khỏe tài chính chỉ có ý nghĩa đầu tư khi kết nối được với khả năng duy trì lợi nhuận và dòng tiền. Điểm số là tín hiệu tóm tắt, không thay thế việc đọc xu hướng từng kỳ.", MUTED);

          title("4. PHÂN TÍCH KỸ THUẬT, MẪU HÌNH VÀ SENTIMENT");
      paragraph("Biểu đồ dưới đây là snapshot giá của 90 phiên gần nhất. Phần này phục vụ góc nhìn giao dịch ngắn và trung hạn, không phải bằng chứng thay thế cho luận điểm đầu tư dài hạn.", MUTED);
      drawPriceSnapshot(doc, payload.priceHistory, payload.technical);
      if (payload.companyNarrative?.technicalAssessment) {
        title("Nhận định kỹ thuật theo LLM");
        paragraph(payload.companyNarrative.technicalAssessment);
      }
      if (payload.technicalSentiment) {
        row("Sentiment kỹ thuật", `${payload.technicalSentiment.labelVi} · độ tin cậy ${Math.round(payload.technicalSentiment.confidence * 100)}%`);
        row("Xu hướng đa khung thời gian", payload.technicalSentiment.trend === "BULLISH" ? "Tăng" : payload.technicalSentiment.trend === "BEARISH" ? "Giảm" : "Trung tính");
        payload.technicalSentiment.indicatorSummary.slice(0, 6).forEach((item) => bullet(item));
        if (payload.technicalSentiment.chartPatterns.length) {
          title("Mẫu hình giá");
          payload.technicalSentiment.chartPatterns.forEach((item) => bullet(`${item.nameVi}: ${item.description}${item.target != null ? ` Mục tiêu tham chiếu ${money(item.target)}.` : ""}`));
        } else paragraph("Chưa phát hiện mẫu hình giá đủ điều kiện trong cửa sổ dữ liệu hiện tại.", MUTED);
        if (payload.technicalSentiment.candlestickPatterns.length) {
          title("Mẫu hình nến gần đây");
          payload.technicalSentiment.candlestickPatterns.slice(-6).forEach((item) => bullet(`${item.nameVi}: ${item.description}`));
        } else paragraph("Chưa phát hiện mẫu hình nến nổi bật trong 30 phiên gần nhất.", MUTED);
        paragraph(`Xác nhận cần theo dõi: ${payload.technicalSentiment.confirmation}`, MUTED);
        paragraph(`Điều kiện làm suy yếu: ${payload.technicalSentiment.invalidation}`, MUTED);
      }

    table(["Chỉ báo", "Giá trị tại thời điểm lập báo cáo", "Diễn giải"], [
      ["Xu hướng kỹ thuật", `${recommendationVi(payload.technical.recommendation)} · ${payload.technical.score}/100`, "Tín hiệu tổng hợp từ động lượng và xu hướng giá."],
      ["RSI(14)", money(payload.technical.rsi14), "Đo động lượng; cần tránh diễn giải đơn lẻ."],
      ["SMA20 / SMA50", `${money(payload.technical.sma20)} / ${money(payload.technical.sma50)}`, "So sánh giá với xu hướng ngắn và trung hạn."],
      ["Hỗ trợ / kháng cự", payload.technical.supportResistance ? `${money(payload.technical.supportResistance.support)} / ${money(payload.technical.supportResistance.resistance)}` : "Chưa có dữ liệu", "Các vùng cần quan sát khi giá biến động."],
      ["Biến động / drawdown", `${pct(payload.technical.volatilityPct)} / ${pct(payload.technical.maxDrawdownPct)}`, "Đo biên độ rủi ro của giá trong lịch sử."],
    ]);
    payload.technical.reasons.slice(0, 4).forEach((reason) => bullet(`Tín hiệu kỹ thuật: ${reason}`));
    if (payload.risk.tradePlan) {
      title("Thiết lập giao dịch ngắn hạn");
      paragraph(`Vùng quan sát ${money(payload.risk.tradePlan.entryLow)}–${money(payload.risk.tradePlan.entryHigh)}, dừng lỗ ${money(payload.risk.tradePlan.stopLoss)}, mục tiêu ${money(payload.risk.tradePlan.takeProfit1)} và ${money(payload.risk.tradePlan.takeProfit2)}. Đây là thiết lập kỹ thuật độc lập, không phải xác nhận rằng định giá cơ bản đang hấp dẫn.`, MUTED);
    }

    title("5. ĐỊNH GIÁ VÀ DỰ PHÓNG");
    const currentPrice = payload.technical.lastClose;
    const latestEps = latest?.income.eps ?? null;
    const latestBookValue = latest?.balance.bookValuePerShare ?? null;
    const securities = /chứng khoán|securities/i.test(`${payload.profile.sector} ${payload.profile.industry}`);
    paragraph(securities ? "Với doanh nghiệp chứng khoán, P/B, ROE, chất lượng tài sản và khả năng tạo thu nhập trên vốn thường phù hợp hơn một khung doanh thu–EBITDA–FCF áp dụng máy móc như doanh nghiệp sản xuất. Các bội số dưới đây chỉ là tham chiếu và cần được hiệu chỉnh bằng dữ liệu ngành." : "Các bội số được tính từ giá hiện tại và số liệu kỳ gần nhất. Giá trị hợp lý chỉ được nêu khi độ tin cậy mô hình đạt ngưỡng; estimate không được trình bày như mục tiêu chắc chắn.", MUTED);
    table(["Chỉ tiêu", "Giá trị", "Cơ sở và cách diễn giải"], [
      ["Giá hiện tại", `${money(currentPrice)} nghìn VNĐ`, "Giá đóng cửa gần nhất."],
      ["P/E", latestEps && latestEps > 0 ? `${money(currentPrice / latestEps)} lần` : "Không xác định", `EPS ${money(latestEps)}; nhạy với chất lượng số liệu lợi nhuận.`],
      ["P/B", latestBookValue && latestBookValue > 0 ? `${money(currentPrice / latestBookValue)} lần` : "Không xác định", `BVPS ${money(latestBookValue)}; đặc biệt cần theo dõi với doanh nghiệp tài chính.`],
      ["Giá trị kỳ vọng", payload.forecast.expectedValue == null || payload.forecast.valuationConfidence < 0.6 ? "Chưa đủ độ tin cậy" : `${money(payload.forecast.expectedValue)} nghìn VNĐ`, `Độ tin cậy định giá ${Math.round(payload.forecast.valuationConfidence * 100)}%.`],
    ]);
    table(["Kịch bản", "Xác suất", "Giá trị hợp lý", "Luận điểm chính"], payload.forecast.scenarios.map((scenario) => [scenario.name === "bull" ? "Tích cực" : scenario.name === "bear" ? "Tiêu cực" : "Cơ sở", `${(scenario.probability * 100).toFixed(0)}%`, scenario.fairValue == null ? "Chưa có dữ liệu" : money(scenario.fairValue), scenario.rationale]));
    table(["Kỳ dự phóng", "Doanh thu", "EBITDA", "LN ròng", "EPS"], payload.forecast.forecast.map((point) => [point.period, money(point.revenue), money(point.ebitda), money(point.netIncome), money(point.eps)]));
    payload.forecast.assumptionBridge.slice(0, 3).forEach((assumption) => bullet(`Giả định cần kiểm chứng: ${assumption}`, MUTED));

    title("6. LUẬN ĐIỂM ĐẦU TƯ");
    if (payload.thesis) {
      row("Quan điểm hiện tại", `${thesisStanceVi(payload.thesis.stance)}${payload.thesis.score == null ? "" : ` · điểm tổng hợp ${payload.thesis.score}/100`}`);
      paragraph("Luận điểm được xây dựng từ bằng chứng hiện có và vẫn có thể thay đổi khi báo cáo tài chính, xu hướng giá hoặc bối cảnh ngành được cập nhật.");
      title("Điều gì đang hỗ trợ cổ phiếu?");
      payload.thesis.whyBuy.slice(0, 4).forEach((item) => bullet(`${item.title}: ${item.detail}`));
      title("Điều gì khiến cần thận trọng?");
      payload.thesis.whyNotBuy.slice(0, 4).forEach((item) => bullet(`${item.title}: ${item.detail}`, RED));
      title("Catalyst và điều kiện thay đổi quan điểm");
      payload.thesis.catalysts.slice(0, 4).forEach((item) => bullet(`Catalyst: ${item.title}. ${item.detail}`));
      payload.thesis.invalidation.slice(0, 3).forEach((item) => bullet(`Nếu xảy ra, cần hạ đánh giá: ${item.title}. ${item.detail}`, MUTED));
    }

    const macroSignals = payload.crossModule?.signals.filter((signal) => ["macro", "market", "industry", "fx", "commodity"].includes(signal.module)) ?? [];
    paragraph("Bối cảnh và rủi ro cần đưa vào luận điểm:", MUTED);
    if (macroSignals.length) macroSignals.slice(0, 3).forEach((signal) => bullet(reportSignalText(signal)));
    else paragraph("Chưa có đủ dữ liệu vĩ mô liên quan để đưa vào luận điểm định giá; yếu tố này không được sử dụng như giả định bổ sung.", MUTED);
    if (payload.crossModule?.causalChains.length) payload.crossModule.causalChains.slice(0, 2).forEach((chain) => bullet(reportCausalText(chain.title, chain.impact, chain.links)));
    row("Rủi ro tổng hợp", `${riskVi(payload.risk.level)} · ${payload.risk.overall}/100`);
    row("Rủi ro chính", payload.risk.mainRisk);
    if (payload.thesis?.monitoring.length) payload.thesis.monitoring.slice(0, 3).forEach((item) => bullet(`Cần theo dõi: ${item}`));
    paragraph(`Chu kỳ hiện tại: ${payload.crossModule ? regimeVi(payload.crossModule.market.regimeLabel) : "chưa đủ dữ liệu"}. Đây là bối cảnh tham khảo, không thay thế phân tích mô hình lợi nhuận.`, MUTED);

    title("8. NHẬN ĐỊNH TỔNG QUAN");
    const recommendation = recommendationVi(payload.technical.recommendation);
    const valuationSentence = payload.forecast.expectedValue != null && payload.forecast.valuationConfidence >= 0.6 ? `Giá trị kỳ vọng theo các kịch bản là ${money(payload.forecast.expectedValue)} nghìn VNĐ.` : "Định giá chưa đủ độ tin cậy để đưa ra mức giá mục tiêu kết luận.";
    paragraph(`${payload.profile.name} đang được đánh giá theo hướng ${thesisStanceVi(payload.thesis?.stance ?? "insufficient_data")}. Giá hiện tại là ${money(currentPrice)} nghìn VNĐ và trạng thái kỹ thuật là ${recommendation}. ${valuationSentence}`);
    paragraph(`Luận điểm tích cực phụ thuộc vào khả năng duy trì tăng trưởng hoạt động, cải thiện chất lượng lợi nhuận và chuyển hóa thành dòng tiền. Ngược lại, quan điểm cần được hạ xuống nếu lợi nhuận suy yếu qua nhiều kỳ, đòn bẩy hoặc rủi ro tăng lên, hoặc vùng hỗ trợ kỹ thuật bị phá vỡ với thanh khoản bất thường.`);
    if (payload.thesis?.monitoring.length) {
      title("Ba đến năm biến số cần theo dõi");
      payload.thesis.monitoring.slice(0, 5).forEach((item) => bullet(item));
    }
    doc.roundedRect(48, doc.y + 8, 499, 66, 4).fillAndStroke("#f2f7fb", LINE);
    doc.font(bold).fontSize(10).fillColor(BLUE).text(`NHẬN ĐỊNH MỘT DÒNG: ${payload.symbol} — ${thesisStanceVi(payload.thesis?.stance ?? "insufficient_data")}; chỉ nên nâng đánh giá khi kết quả kinh doanh, dòng tiền và các catalyst được xác nhận bằng dữ liệu mới.`, 60, doc.y + 20, { width: 475, lineGap: 2 });
    doc.y += 72;
    doc.moveDown(0.8);
    doc.font(regular).fontSize(8).fillColor(MUTED).text("Báo cáo phục vụ mục đích nghiên cứu; không phải khuyến nghị đầu tư cá nhân.");
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) { doc.switchToPage(i); doc.font(regular).fontSize(7).fillColor(MUTED).text(`ORCA FINANCIAL · ${payload.symbol} · BÁO CÁO PHÂN TÍCH`, 48, 790, { width: 350, height: 10, lineBreak: false }); doc.font(regular).fontSize(7).text(`Trang ${i + 1}/${range.count}`, 430, 790, { width: 117, height: 10, align: "right", lineBreak: false }); }
    doc.end();
  });
}
