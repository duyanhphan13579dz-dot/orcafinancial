import PDFDocument from "pdfkit";
import type { CompanyProfile } from "@/lib/company-profile";
import type { FinancialQuarter } from "@/lib/financial-statements";
import type { AnalysisResult } from "@/lib/analysis";
import type { HealthDetail } from "@/lib/financial-health-detail";
import type { ForecastScenarioResult } from "@/lib/stock-intelligence/forecast-engine";
import type { RiskAssessment } from "@/lib/stock-intelligence/risk-engine";
import type { NewsIntelligenceResult } from "@/lib/stock-intelligence/news-intelligence";
import type { BacktestResult } from "@/lib/stock-intelligence/backtest-engine";

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
  source: string;
  dataConfidence: number;
}

const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const BLUE = "#0A2540";
const MUTED = "#55718d";
const LINE = "#d5e0ea";
const GREEN = "#087f5b";
const RED = "#b42318";

function money(value: number | null | undefined): string { return value == null || !Number.isFinite(value) ? "N/A" : value.toLocaleString("vi-VN", { maximumFractionDigits: 2 }); }
function pct(value: number | null | undefined): string { return value == null || !Number.isFinite(value) ? "N/A" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`; }
function safeText(value: unknown): string { return String(value ?? "N/A").replace(/\s+/g, " ").trim(); }

export function renderStockAnalysisPdf(payload: StockAnalysisPdfPayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 54, bottom: 58, left: 48, right: 48 }, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try { doc.registerFont("orca", FONT).registerFont("orca-bold", FONT_BOLD); } catch { /* system fallback */ }
    const regular = "orca";
    const bold = "orca-bold";
    const title = (text: string) => { if (doc.y > 700) doc.addPage(); doc.moveDown(0.5).font(bold).fontSize(15).fillColor(BLUE).text(text); doc.moveDown(0.18).strokeColor(LINE).moveTo(48, doc.y).lineTo(547, doc.y).stroke(); doc.moveDown(0.35); };
    const paragraph = (text: string, color = "#172b3f") => doc.font(regular).fontSize(9.4).fillColor(color).text(safeText(text), { lineGap: 2.2, paragraphGap: 4 });
    const row = (label: string, value: string, color = "#172b3f") => { doc.font(regular).fontSize(9).fillColor(MUTED).text(label, 54, doc.y, { width: 185, continued: true }); doc.font(bold).fillColor(color).text(`  ${value}`); };
    const bullet = (text: string, color = "#172b3f") => doc.font(regular).fontSize(9.2).fillColor(color).text(`• ${safeText(text)}`, { indent: 10, lineGap: 2 });
    const table = (headers: string[], rows: string[][]) => { const widths = headers.map((_, index) => index === 0 ? 110 : (499 - 110) / Math.max(1, headers.length - 1)); const startX = 48; let y = doc.y; const draw = (values: string[], header = false) => { let x = startX; const height = 20; doc.rect(startX, y, 499, height).fill(header ? "#eaf1f7" : "#ffffff").stroke(LINE); values.forEach((value, index) => { doc.font(header ? bold : regular).fontSize(header ? 8 : 7.7).fillColor(header ? BLUE : "#172b3f").text(safeText(value), x + 5, y + 6, { width: widths[index] - 10, lineBreak: false }); x += widths[index]; }); y += height; }; draw(headers, true); for (const values of rows) { if (y > 735) { doc.addPage(); y = doc.y; } draw(values); } doc.y = y + 5; };

    doc.font(bold).fontSize(9).fillColor(BLUE).text("ORCA FINANCIAL · STOCK INTELLIGENCE", { characterSpacing: 0.6 });
    doc.moveDown(1.6);
    doc.font(bold).fontSize(28).fillColor(BLUE).text("BÁO CÁO PHÂN TÍCH");
    doc.moveDown(0.4);
    doc.font(bold).fontSize(22).fillColor(payload.technical.recommendation.includes("Buy") ? GREEN : payload.technical.recommendation.includes("Sell") ? RED : BLUE).text(`${payload.symbol} · ${payload.technical.recommendation}`);
    doc.moveDown(0.7);
    row("Giá hiện tại", `${money(payload.technical.lastClose)} nghìn VNĐ`);
    row("Mục tiêu theo scenario", payload.forecast.targetPrice == null ? "N/A" : `${money(payload.forecast.targetPrice)} nghìn VNĐ`);
    row("Technical score", `${payload.technical.score}/100`);
    row("Financial health", `${payload.health.overall}/100 · Rating ${payload.health.rating}`);
    row("Data confidence", `${Math.round(payload.dataConfidence * 100)}%`);
    row("Thời điểm tạo", new Date(payload.generatedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }));
    doc.moveDown(1.5);
    doc.roundedRect(48, doc.y, 499, 78, 5).fillAndStroke("#f2f7fb", LINE);
    doc.font(bold).fontSize(11).fillColor(BLUE).text("KẾT LUẬN ĐIỀU HÀNH", 62, doc.y + 12);
    doc.font(regular).fontSize(9).fillColor("#172b3f").text(`Khuyến nghị theo technical engine: ${payload.technical.recommendation}. ${payload.forecast.expectedValue != null ? `Expected value theo xác suất scenario là ${money(payload.forecast.expectedValue)} nghìn VNĐ.` : "Chưa đủ dữ liệu để xác định expected value."}`, 62, doc.y + 30, { width: 470, lineGap: 2 });
    doc.addPage();

    title("1. THÔNG TIN DOANH NGHIỆP");
    row("Tên doanh nghiệp", payload.profile.name); row("Mã / sàn", `${payload.profile.symbol} · ${payload.profile.exchange}`); row("Ngành / lĩnh vực", `${payload.profile.industry} · ${payload.profile.sector}`); row("Vốn hóa ước tính", `${money(payload.profile.marketCapBillionVnd)} tỷ VNĐ`); row("Cổ phiếu lưu hành", `${money(payload.profile.sharesOutstandingMillions)} triệu cp`); row("Beta ngành", money(payload.profile.beta));
    doc.moveDown(0.4); paragraph(payload.profile.description);
    title("2. ĐÁNH GIÁ KẾT QUẢ KINH DOANH VÀ SỨC KHỎE TÀI CHÍNH");
    paragraph(payload.health.summary);
    table(["Kỳ", "Doanh thu", "EBITDA", "LN ròng", "EPS"], payload.quarters.slice(0, 6).map((quarter) => [quarter.period, money(quarter.income.revenue), money(quarter.income.ebitda), money(quarter.income.netIncome), money(quarter.income.eps)]));
    table(["Nhóm", "Điểm", "Trọng số", "Nhận xét"], payload.health.groups.map((group) => [group.label, `${group.score}/100`, `${(group.weight * 100).toFixed(0)}%`, group.narrative]));
    title("3. PHÂN TÍCH KỸ THUẬT");
    row("Xu hướng / khuyến nghị", `${payload.technical.recommendation} · ${payload.technical.score}/100`); row("RSI(14)", money(payload.technical.rsi14)); row("SMA20 / SMA50", `${money(payload.technical.sma20)} / ${money(payload.technical.sma50)}`); row("Biến động năm hóa", pct(payload.technical.volatilityPct)); row("Drawdown tối đa", pct(payload.technical.maxDrawdownPct)); row("Hỗ trợ / kháng cự", payload.technical.supportResistance ? `${money(payload.technical.supportResistance.support)} / ${money(payload.technical.supportResistance.resistance)}` : "N/A");
    doc.moveDown(0.3); payload.technical.reasons.slice(0, 5).forEach((reason) => bullet(reason));
    title("4. DỰ PHÓNG KẾT QUẢ KINH DOANH VÀ ĐỊNH GIÁ");
    paragraph(`Mô hình ${payload.forecast.modelVersion}. Forecast là estimate; prediction confidence ${Math.round(payload.forecast.predictionConfidence * 100)}%.`);
    table(["Kịch bản", "Xác suất", "Fair value", "Luận điểm"], payload.forecast.scenarios.map((scenario) => [scenario.name.toUpperCase(), `${(scenario.probability * 100).toFixed(0)}%`, scenario.fairValue == null ? "N/A" : money(scenario.fairValue), scenario.rationale]));
    table(["Kỳ dự phóng", "Doanh thu", "EBITDA", "LN ròng", "EPS"], payload.forecast.forecast.map((point) => [point.period, money(point.revenue), money(point.ebitda), money(point.netIncome), money(point.eps)]));
    title("5. RỦI RO, CATALYST VÀ KẾ HOẠCH THEO DÕI");
    row("Mức rủi ro", `${payload.risk.level} · ${payload.risk.overall}/100`); row("Rủi ro chính", payload.risk.mainRisk); row("Backtest accuracy", `${(payload.backtest.metrics.recommendationAccuracy * 100).toFixed(1)}%`); row("News trend 7 ngày", payload.news.trend.d7.toFixed(3));
    payload.news.events.slice(0, 5).forEach((event) => bullet(`[${event.impact.toUpperCase()} · ${event.category}] ${event.title}`));
    if (payload.risk.tradePlan) { doc.moveDown(0.25); paragraph(`Trade plan nghiên cứu: vùng vào ${money(payload.risk.tradePlan.entryLow)}–${money(payload.risk.tradePlan.entryHigh)}, stop loss ${money(payload.risk.tradePlan.stopLoss)}, TP1 ${money(payload.risk.tradePlan.takeProfit1)}, TP2 ${money(payload.risk.tradePlan.takeProfit2)}; R/R ${payload.risk.tradePlan.riskReward1}x / ${payload.risk.tradePlan.riskReward2}x.`, MUTED); }
    title("6. NHẬN XÉT CHUNG VỀ DOANH NGHIỆP");
    paragraph(`Doanh nghiệp ${payload.profile.name} hoạt động trong ${payload.profile.industry}. Sức khỏe tài chính hiện ở mức ${payload.health.rating} với điểm ${payload.health.overall}/100; technical engine cho tín hiệu ${payload.technical.recommendation}. Kịch bản cơ sở được xây dựng từ xu hướng lịch sử và phải được xem xét lại khi có báo cáo tài chính, tin tức hoặc thay đổi thị trường mới.`);
    bullet(`Nguồn dữ liệu thô: ${payload.source}.`); bullet(`Dữ liệu được lấy qua data-engine tại thời điểm ${new Date(payload.generatedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}.`); bullet("Các trường estimate/degraded không phải số liệu audited actual; forecast, fair value và trade plan không phải cam kết giá.");
    doc.moveDown(0.8); doc.font(regular).fontSize(8).fillColor(MUTED).text("Báo cáo chỉ nhằm mục đích nghiên cứu, không phải lời khuyên đầu tư cá nhân. Nhà đầu tư cần tự đánh giá khẩu vị rủi ro, tính thanh khoản, thuế, phí và thông tin công bố chính thức.");
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) { doc.switchToPage(i); doc.font(regular).fontSize(7.5).fillColor(MUTED).text(`ORCA FINANCIAL · ${payload.symbol} · BÁO CÁO PHÂN TÍCH`, 48, 785, { width: 350, lineBreak: false }); doc.text(`Trang ${i + 1}/${range.count}`, 430, 785, { width: 117, align: "right", lineBreak: false }); }
    doc.end();
  });
}
