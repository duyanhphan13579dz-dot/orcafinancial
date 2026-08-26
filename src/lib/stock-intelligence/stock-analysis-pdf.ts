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
  priceHistory?: Ohlcv[];
  source: string;
  dataConfidence: number;
}

const FONT = path.join(process.cwd(), "public/fonts/DejaVuSans.ttf");
const FONT_BOLD = path.join(process.cwd(), "public/fonts/DejaVuSans-Bold.ttf");
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
    [/Financial score/gi, "Điểm tài chính"], [/current-state health/gi, "sức khỏe hiện tại"], [/Expected value/gi, "Giá trị kỳ vọng"], [/Moat score/gi, "Điểm hào kinh tế"], [/scorecard/gi, "bảng điểm"], [/proxy/gi, "số liệu tham chiếu"], [/segment disclosure/gi, "công bố theo phân khúc"], [/classification/gi, "phân loại"], [/competitive advantage/gi, "lợi thế cạnh tranh"], [/current price/gi, "giá hiện tại"], [/breadth score/gi, "điểm độ rộng thị trường"], [/sector change/gi, "thay đổi của ngành"], [/data-engine/gi, "hệ thống dữ liệu"], [/commodity mapping/gi, "liên hệ hàng hóa"], [/pricing power/gi, "khả năng định giá"], [/brand awareness/gi, "mức độ nhận diện thương hiệu"], [/customer survey/gi, "khảo sát khách hàng"], [/Net margin/gi, "biên lợi nhuận ròng"], [/valuation/gi, "định giá"], [/Market regime/gi, "Trạng thái thị trường"], [/risk premium/gi, "phần bù rủi ro"], [/recommendation/gi, "khuyến nghị"], [/VN market regime/gi, "trạng thái thị trường Việt Nam"], [/Risk appetite/gi, "khẩu vị rủi ro"], [/Valuation multiple/gi, "hệ số định giá"], [/Fair value/gi, "Giá trị hợp lý"], [/current financial health/gi, "sức khỏe tài chính hiện tại"], [/unknown/gi, "chưa xác định"], [/uncertain/gi, "chưa chắc chắn"], [/NEUTRAL/gi, "trung tính"], [/risk medium/gi, "rủi ro trung bình"], [/DATA SYNCING/gi, "đang đồng bộ dữ liệu"], [/disclosure/gi, "công bố thông tin"], [/thesis/gi, "luận điểm đầu tư"], [/invalidation/gi, "điều kiện làm suy yếu luận điểm"], [/snapshot/gi, "tại thời điểm lập báo cáo"], [/trailing/gi, "theo số liệu gần nhất"], [/point-in-time/gi, "tại thời điểm lập báo cáo"], [/as-reported/gi, "theo báo cáo công bố"], [/filing/gi, "hồ sơ công bố"], [/assumptions?/gi, "giả định"], [/trade plan/gi, "kế hoạch giao dịch"], [/hold/gi, "nắm giữ"], [/buy/gi, "mua"], [/sell/gi, "bán"],
  ];
  return replacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}
function safeText(value: unknown): string { return translateReportText(String(value ?? "Chưa có dữ liệu").replace(/\s+/g, " ").trim()); }
function recommendationVi(value: string): string { return ({ "Strong Buy": "Mua mạnh", Buy: "Mua", Hold: "Nắm giữ", Sell: "Bán", "Strong Sell": "Bán mạnh" } as Record<string, string>)[value] ?? value; }
function riskVi(value: string): string { return ({ low: "Thấp", medium: "Trung bình", high: "Cao", critical: "Rất cao" } as Record<string, string>)[value.toLowerCase()] ?? value; }
function impactVi(value: string): string { return ({ low: "Tác động thấp", medium: "Tác động trung bình", high: "Tác động cao", critical: "Tác động rất cao" } as Record<string, string>)[value.toLowerCase()] ?? value; }
function categoryVi(value: string): string { return ({ general: "Tin chung", earnings: "Kết quả kinh doanh", corporate: "Doanh nghiệp", macro: "Vĩ mô", policy: "Chính sách", industry: "Ngành", technical: "Kỹ thuật", valuation: "Định giá" } as Record<string, string>)[value.toLowerCase()] ?? value; }
function directionVi(value: string): string { return ({ positive: "tích cực", negative: "tiêu cực", neutral: "trung tính", mixed: "hỗn hợp", unknown: "chưa xác định", uncertain: "chưa chắc chắn", up: "tăng", down: "giảm" } as Record<string, string>)[value.toLowerCase()] ?? value; }
function moduleVi(value: string): string { return ({ market: "Thị trường", industry: "Ngành", commodity: "Hàng hóa", fx: "Tỷ giá", macro: "Vĩ mô" } as Record<string, string>)[value.toLowerCase()] ?? value; }
function ratingVi(value: string): string { return ({ excellent: "Rất tốt", strong: "Tốt", healthy: "Lành mạnh", moderate: "Trung bình", weak: "Yếu", poor: "Kém", insufficient_data: "Chưa đủ dữ liệu" } as Record<string, string>)[value.toLowerCase()] ?? value; }
function regimeVi(value: string): string { return value.replace(/BROAD MARKET ADVANCE/gi, "Thị trường tăng").replace(/BROAD MARKET DECLINE/gi, "Thị trường giảm").replace(/BROAD MARKET ADVANCE/gi, "Thị trường tăng").replace(/BULLISH/gi, "Tăng").replace(/BEARISH/gi, "Giảm").replace(/NEUTRAL/gi, "Trung tính").replace(/RISK LOW/gi, "Rủi ro thấp").replace(/RISK MEDIUM/gi, "Rủi ro trung bình").replace(/RISK HIGH/gi, "Rủi ro cao"); }
function forecastVersionVi(value: string): string { return value.replace(/^ORCA Forecast v/i, "phiên bản ").replace(/^ORCA AI Forecast v/i, "phiên bản "); }

function drawPriceSnapshot(doc: PDFKit.PDFDocument, bars: Ohlcv[] = []) {
  const points = bars.slice(-90);
  if (points.length < 2) { paragraphFallback(doc, "Không đủ dữ liệu giá để vẽ biểu đồ kỹ thuật."); return; }
  const x = 54; const y = doc.y + 10; const w = 487; const h = 85;
  const closes = points.map((bar) => bar.close).filter(Number.isFinite);
  const min = Math.min(...closes); const max = Math.max(...closes); const span = Math.max(max - min, 1e-9);
  doc.save().rect(x, y, w, h).fillAndStroke("#f8fbfd", LINE);
  for (let i = 0; i <= 4; i += 1) {
    const gy = y + (h * i) / 4;
    doc.strokeColor(GRID).lineWidth(0.5).moveTo(x, gy).lineTo(x + w, gy).stroke();
  }
  const path = points.map((bar, index) => {
    const px = x + (w * index) / Math.max(points.length - 1, 1);
    const py = y + h - ((bar.close - min) / span) * (h - 16) - 8;
    return [px, py] as const;
  });
  doc.strokeColor(BLUE).lineWidth(1.8).moveTo(path[0][0], path[0][1]);
  path.slice(1).forEach(([px, py]) => doc.lineTo(px, py));
  doc.stroke();
  const last = path[path.length - 1];
  doc.fillColor(BLUE).circle(last[0], last[1], 3).fill();
  doc.font(regularFont(doc)).fontSize(7.5).fillColor(MUTED).text(`90 phiên gần nhất · thấp ${money(min)} · cao ${money(max)} · cuối ${money(points.at(-1)?.close)}`, x + 8, y + h - 16, { width: w - 16, lineBreak: false });
  doc.restore();
  doc.y = y + h + 16;
}

function regularFont(doc: PDFKit.PDFDocument): string { return (doc as PDFKit.PDFDocument & { _orcaRegular?: string })._orcaRegular ?? "Helvetica"; }
function paragraphFallback(doc: PDFKit.PDFDocument, text: string) { doc.font(regularFont(doc)).fontSize(8.8).fillColor(MUTED).text(text, { lineGap: 2 }); }

function valueChainRows(profile: CompanyProfile): string[][] {
  const banking = /ngân hàng|bank/i.test(`${profile.sector} ${profile.industry}`);
  return banking
    ? [
      ["Input", "Tiền gửi khách hàng, vốn chủ sở hữu, thanh khoản liên ngân hàng, dữ liệu tín dụng và mạng lưới giao dịch."],
      ["Process", "Huy động vốn; phân bổ tín dụng; quản trị rủi ro; thanh toán; ngân hàng số; dịch vụ ngoại hối và phí."],
      ["Output", "Thu nhập lãi thuần, phí dịch vụ, thu nhập đầu tư/kinh doanh vốn, lợi nhuận và chất lượng tài sản."],
    ]
    : [
      ["Input", "Nguyên vật liệu/nguồn cung, vốn lưu động, nhân sự, công nghệ và kênh phân phối."],
      ["Process", "Sản xuất hoặc cung ứng dịch vụ, kiểm soát chi phí, quản trị chất lượng và bán hàng."],
      ["Output", "Sản phẩm/dịch vụ, doanh thu, lợi nhuận, dòng tiền và năng lực tái đầu tư."],
    ];
}

function changeText(current: number | null | undefined, previous: number | null | undefined): string {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return "Chưa có dữ liệu";
  return pct((current / previous - 1) * 100);
}

export function renderStockAnalysisPdf(payload: StockAnalysisPdfPayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 54, bottom: 24, left: 48, right: 48 }, bufferPages: true });
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
    const title = (text: string) => { if (doc.y > 650) doc.addPage(); doc.x = 48; doc.moveDown(0.5).font(bold).fontSize(15).fillColor(BLUE).text(text, 48, doc.y, { width: 499 }); doc.moveDown(0.18).strokeColor(LINE).moveTo(48, doc.y).lineTo(547, doc.y).stroke(); doc.moveDown(0.35); };
    const paragraph = (text: string, color = "#172b3f") => { doc.x = 48; return doc.font(regular).fontSize(9.4).fillColor(color).text(safeText(text), 48, doc.y, { width: 499, lineGap: 2.2, paragraphGap: 4 }); };
    const row = (label: string, value: string, color = "#172b3f") => { if (doc.y > 735) doc.addPage(); doc.x = 48; const y = doc.y; doc.font(regular).fontSize(9).fillColor(MUTED).text(safeText(label), 54, y, { width: 185 }); doc.font(bold).fillColor(color).text(`  ${safeText(value)}`, 239, y, { width: 308, lineGap: 1.5 }); };
    const bullet = (text: string, color = "#172b3f") => { if (doc.y > 735) doc.addPage(); doc.x = 48; return doc.font(regular).fontSize(9.2).fillColor(color).text(`• ${safeText(text)}`, 54, doc.y, { width: 493, lineGap: 2.5 }); };
    const table = (headers: string[], rows: string[][]) => {
      const firstWidth = headers.length >= 6 ? 72 : headers.length >= 4 ? 105 : 110;
      const widths = headers.map((_, index) => index === 0 ? firstWidth : (499 - firstWidth) / Math.max(1, headers.length - 1));
      const startX = 48; let y = doc.y;
      const draw = (values: string[], header = false) => {
        const fontSize = header ? 8 : headers.length >= 6 ? 6.9 : 7.5;
        const heights = values.map((value, index) => { doc.font(header ? bold : regular).fontSize(fontSize); return doc.heightOfString(safeText(value), { width: Math.max(20, widths[index] - 10), lineGap: 1.8 }); });
        const height = Math.max(header ? 20 : 19, Math.min(58, Math.max(...heights) + 9));
        if (y + height > 780) { doc.addPage(); y = doc.y; }
        let x = startX;
        doc.rect(startX, y, 499, height).fill(header ? "#eaf1f7" : "#ffffff").stroke(LINE);
        values.forEach((value, index) => { doc.font(header ? bold : regular).fontSize(fontSize).fillColor(header ? BLUE : "#172b3f").text(safeText(value), x + 5, y + 5, { width: Math.max(20, widths[index] - 10), height: height - 7, lineGap: 1.8 }); x += widths[index]; });
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
    row("Mục tiêu theo kịch bản", payload.forecast.targetPrice == null ? "Chưa có dữ liệu" : `${money(payload.forecast.targetPrice)} nghìn VNĐ`);
    row("Điểm kỹ thuật", `${payload.technical.score}/100`);
    row("Sức khỏe tài chính", `${payload.health.overall}/100 · Xếp loại ${ratingVi(payload.health.rating)}`);
    row("Độ tin cậy dữ liệu", `${Math.round(payload.dataConfidence * 100)}%`);
    row("Thời điểm tạo", new Date(payload.generatedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }));
    doc.moveDown(1.5);
    doc.roundedRect(48, doc.y, 499, 78, 5).fillAndStroke("#f2f7fb", LINE);
    doc.font(bold).fontSize(11).fillColor(BLUE).text("KẾT LUẬN ĐIỀU HÀNH", 62, doc.y + 12);
    doc.font(regular).fontSize(9).fillColor("#172b3f").text(`Đánh giá tổng quan: cổ phiếu đang ở trạng thái ${recommendationVi(payload.technical.recommendation)}. ${payload.forecast.expectedValue != null ? `Giá trị kỳ vọng theo các kịch bản là ${money(payload.forecast.expectedValue)} nghìn VNĐ.` : "Chưa đủ dữ liệu để xác định giá trị kỳ vọng."}`, 62, doc.y + 30, { width: 470, lineGap: 2.5 });
    doc.addPage();

    title("1. THÔNG TIN DOANH NGHIỆP");
    row("Tên doanh nghiệp", payload.profile.name); row("Mã / sàn", `${payload.profile.symbol} · ${payload.profile.exchange}`); row("Ngành / lĩnh vực", `${payload.profile.industry} · ${payload.profile.sector}`); row("Vốn hóa ước tính", `${money(payload.profile.marketCapBillionVnd)} tỷ VNĐ`); row("Cổ phiếu lưu hành", `${money(payload.profile.sharesOutstandingMillions)} triệu cp`); row("Beta ngành", money(payload.profile.beta));
    doc.moveDown(0.4); paragraph(payload.profile.description);
    title("2. CHUỖI GIÁ TRỊ DOANH NGHIỆP");
    paragraph("Mô hình dưới đây mô tả cách doanh nghiệp chuyển hóa nguồn lực đầu vào thành sản phẩm, dịch vụ, doanh thu và dòng tiền. Những điểm chưa có công bố trực tiếp chỉ mang tính tham chiếu theo đặc điểm ngành.", MUTED);
    table(["Khâu", "Mô tả"], valueChainRows(payload.profile));
    if (payload.business?.segments.length) {
      table(["Phân khúc / năng lực", "Mô tả", "Mức độ tin cậy"], payload.business.segments.slice(0, 5).map((segment) => [segment.name, segment.description, `${Math.round(segment.confidence * 100)}% · ${segment.source === "business-intelligence" ? "Phân tích doanh nghiệp" : "Nguồn dữ liệu"}`]));
    }
    title("3. KẾT QUẢ KINH DOANH VÀ SỨC KHỎE TÀI CHÍNH");
    paragraph(`Trạng thái hiện tại tại ${payload.health.asOfPeriod}; sử dụng ${payload.health.dataQuality.periodsUsed} kỳ. Các chỉ số được ưu tiên từ kỳ thực tế gần nhất; phần ước tính hoặc suy giảm chất lượng dữ liệu được ghi chú riêng khi cần.`);
    table(["Kỳ", "Doanh thu", "Tăng trưởng quý", "EBITDA", "Biên EBITDA", "LN ròng", "EPS"], payload.quarters.slice(0, 8).map((quarter, index, rows) => [quarter.period, money(quarter.income.revenue), changeText(quarter.income.revenue, rows[index + 1]?.income.revenue), money(quarter.income.ebitda), pct(quarter.income.revenue > 0 ? quarter.income.ebitda / quarter.income.revenue * 100 : null), money(quarter.income.netIncome), money(quarter.income.eps)]));
    const latest = payload.quarters[0];
    const yearAgo = payload.quarters.find((quarter) => latest && quarter.quarter === latest.quarter && quarter.fiscalYear === latest.fiscalYear - 1);
    table(["Chỉ số", "Giá trị hiện tại", "So với kỳ trước", "So với cùng kỳ"], [
      ["Doanh thu", money(indicatorValue(payload.health, "revenue" ) ?? latest?.income.revenue), changeText(latest?.income.revenue, payload.quarters[1]?.income.revenue), changeText(latest?.income.revenue, yearAgo?.income.revenue)],
      ["LN ròng", money(latest?.income.netIncome), changeText(latest?.income.netIncome, payload.quarters[1]?.income.netIncome), changeText(latest?.income.netIncome, yearAgo?.income.netIncome)],
      ["Biên EBITDA", pct(indicatorValue(payload.health, "ebitdaMargin")), "Chưa có dữ liệu", "Chưa có dữ liệu"],
      ["CFO / Lợi nhuận ròng", `${money(indicatorValue(payload.health, "earningsQuality"))}x`, "Chưa có dữ liệu", "Chưa có dữ liệu"],
      ["CFO", money(latest?.cashflow.operatingCashFlow), changeText(latest?.cashflow.operatingCashFlow, payload.quarters[1]?.cashflow.operatingCashFlow), "Dòng tiền từ hoạt động kinh doanh; số dương là tín hiệu hỗ trợ chất lượng lợi nhuận."],
      ["FCF", money(latest?.cashflow.freeCashFlow), changeText(latest?.cashflow.freeCashFlow, payload.quarters[1]?.cashflow.freeCashFlow), "Dòng tiền tự do sau chi đầu tư; cần đọc cùng cấu trúc ngành."],
      ["Tỷ lệ chuyển đổi FCF", `${money(indicatorValue(payload.health, "fcfConversion"))}x`, "Chưa có dữ liệu", "Chưa có dữ liệu"],
      ["ROA / ROE / ROS", `${pct(indicatorValue(payload.health, "roa"))} / ${pct(indicatorValue(payload.health, "roe"))} / ${pct(indicatorValue(payload.health, "netMargin"))}`, "Chưa có dữ liệu", "Chưa có dữ liệu"],
      ["Nợ / VCSH", `${money(indicatorValue(payload.health, "debtEquity"))}x`, "Chưa có dữ liệu", "Chưa có dữ liệu"],
    ]);
    table(["Nhóm", "Điểm", "Trọng số", "Nhận xét"], payload.health.groups.map((group) => [group.label, `${group.score}/100`, `${(group.weight * 100).toFixed(0)}%`, group.narrative]));
    title("4. PHÂN TÍCH KỸ THUẬT TẠI THỜI ĐIỂM LẬP BÁO CÁO");
    paragraph("Biểu đồ dưới đây sử dụng 90 phiên OHLCV gần nhất tại thời điểm lập báo cáo. Đường giá không thay thế phân tích nến hoặc dữ liệu trong phiên.", MUTED);
    drawPriceSnapshot(doc, payload.priceHistory);
    table(["Chỉ báo kỹ thuật", "Giá trị tại thời điểm lập báo cáo"], [
      ["Xu hướng / khuyến nghị", `${recommendationVi(payload.technical.recommendation)} · ${payload.technical.score}/100`],
      ["RSI(14)", money(payload.technical.rsi14)],
      ["SMA20 / SMA50", `${money(payload.technical.sma20)} / ${money(payload.technical.sma50)}`],
      ["Biến động năm hóa", pct(payload.technical.volatilityPct)],
      ["Drawdown tối đa", pct(payload.technical.maxDrawdownPct)],
      ["Hỗ trợ / kháng cự", payload.technical.supportResistance ? `${money(payload.technical.supportResistance.support)} / ${money(payload.technical.supportResistance.resistance)}` : "Chưa có dữ liệu"],
    ]);
    doc.moveDown(0.3); payload.technical.reasons.slice(0, 5).forEach((reason) => bullet(reason));
    const currentPrice = payload.technical.lastClose;
    const latestEps = payload.quarters[0]?.income.eps ?? null;
    const latestBookValue = payload.quarters[0]?.balance.bookValuePerShare ?? null;
    title("5. ĐỊNH GIÁ HIỆN TẠI");
    paragraph("P/E và P/B được tính từ giá đóng cửa gần nhất chia cho EPS và giá trị sổ sách trên mỗi cổ phiếu của kỳ gần nhất. Đây là chỉ báo tham chiếu tại thời điểm lập báo cáo và cần được cập nhật khi có báo cáo tài chính chính thức.", MUTED);
    table(["Chỉ tiêu", "Giá trị", "Cơ sở", "Diễn giải"], [
      ["Giá hiện tại", `${money(currentPrice)} nghìn VNĐ`, "Dữ liệu giá", "Giá đóng cửa gần nhất từ hệ thống dữ liệu thị trường."],
      ["P/E", latestEps && latestEps > 0 ? `${money(currentPrice / latestEps)} lần` : "Không xác định", `EPS ${money(latestEps)}`, latestEps && latestEps > 0 ? "Hệ số giá trên lợi nhuận của kỳ gần nhất." : "Không có EPS dương để tính."],
      ["P/B", latestBookValue && latestBookValue > 0 ? `${money(currentPrice / latestBookValue)} lần` : "Không xác định", `BVPS ${money(latestBookValue)}`, latestBookValue && latestBookValue > 0 ? "Hệ số giá trên giá trị sổ sách của kỳ gần nhất." : "Không có BVPS hợp lệ để tính."],
      ["Giá trị hợp lý tổng hợp", payload.forecast.expectedValue == null ? "Chưa có dữ liệu" : `${money(payload.forecast.expectedValue)} nghìn VNĐ`, "Các kịch bản dự phóng", "Không phải mức giá cam kết; phụ thuộc giả định mô hình."],
    ]);
    title("6. DỰ PHÓNG KẾT QUẢ KINH DOANH VÀ ĐỊNH GIÁ");
    paragraph(`Mô hình dự phóng ${forecastVersionVi(payload.forecast.modelVersion)}; đây là ước tính với mức độ tin cậy ${Math.round(payload.forecast.predictionConfidence * 100)}%.`);
    table(["Kịch bản", "Xác suất", "Giá trị hợp lý", "Luận điểm"], payload.forecast.scenarios.map((scenario) => [scenario.name === "bull" ? "Tích cực" : scenario.name === "bear" ? "Tiêu cực" : "Cơ sở", `${(scenario.probability * 100).toFixed(0)}%`, scenario.fairValue == null ? "Chưa có dữ liệu" : money(scenario.fairValue), scenario.rationale]));
    table(["Kỳ dự phóng", "Doanh thu", "EBITDA", "Lợi nhuận ròng", "EPS"], payload.forecast.forecast.map((point) => [point.period, money(point.revenue), money(point.ebitda), money(point.netIncome), money(point.eps)]));
    title("7. RỦI RO, ĐỘNG LỰC VÀ KẾ HOẠCH THEO DÕI");
    row("Mức rủi ro", `${riskVi(payload.risk.level)} · ${payload.risk.overall}/100`); row("Rủi ro chính", payload.risk.mainRisk); row("Độ chính xác kiểm định", `${(payload.backtest.metrics.recommendationAccuracy * 100).toFixed(1)}%`); row("Xu hướng tin tức 7 ngày", payload.news.trend.d7.toFixed(3));
    payload.news.events.slice(0, 5).forEach((event) => bullet(`${impactVi(event.impact)} · ${categoryVi(event.category)}: ${event.title}`));
    if (payload.risk.tradePlan) { doc.moveDown(0.25); paragraph(`Kế hoạch giao dịch nghiên cứu: vùng vào ${money(payload.risk.tradePlan.entryLow)}–${money(payload.risk.tradePlan.entryHigh)}, mức dừng lỗ ${money(payload.risk.tradePlan.stopLoss)}, mục tiêu 1 ${money(payload.risk.tradePlan.takeProfit1)}, mục tiêu 2 ${money(payload.risk.tradePlan.takeProfit2)}; tỷ lệ lợi nhuận/rủi ro ${payload.risk.tradePlan.riskReward1} lần / ${payload.risk.tradePlan.riskReward2} lần.`, MUTED); }
    if (payload.crossModule || payload.business || payload.thesis) {
      title("8. BỐI CẢNH LIÊN KẾT, HÀO KINH TẾ VÀ LUẬN ĐIỂM ĐẦU TƯ");
      if (payload.crossModule) {
        row("Trạng thái thị trường", `${regimeVi(payload.crossModule.market.regimeLabel)} · rủi ro ${riskVi(payload.crossModule.market.risk)}`);
        row("Điểm bối cảnh liên kết", payload.crossModule.aggregateScore == null ? "Chưa có dữ liệu" : `${payload.crossModule.aggregateScore}/100`);
        payload.crossModule.signals.filter((signal) => signal.direction !== "unknown").slice(0, 5).forEach((signal) => bullet(`${moduleVi(signal.module)} · ${directionVi(signal.direction)}: ${signal.headline} — ${signal.evidence}`));
        payload.crossModule.causalChains.slice(0, 3).forEach((chain) => bullet(`Chuỗi tác động ${directionVi(chain.impact)}: ${chain.title}: ${chain.links.map((link) => `${link.from} → ${link.to}`).join(" → ")}`));
      }
      if (payload.business) {
        row("Điểm hào kinh tế", `${payload.business.moat.score}/100 · ${payload.business.moat.rating === "strong" ? "mạnh" : payload.business.moat.rating === "moderate" ? "vừa phải" : payload.business.moat.rating === "weak" ? "yếu" : "chưa đủ dữ liệu"}`);
        payload.business.moat.factors.slice(0, 5).forEach((factor) => bullet(`Hào kinh tế · ${factor.label}: ${factor.score}/100 — ${factor.evidence}`));
        payload.business.growthDrivers.slice(0, 3).forEach((driver) => bullet(`Động lực tăng trưởng · ${directionVi(driver.direction)}: ${driver.driver} — ${driver.evidence}`));
      }
      if (payload.thesis) {
        row("Luận điểm đầu tư", `${payload.thesis.stance === "constructive" ? "tích cực" : payload.thesis.stance === "cautious" ? "thận trọng" : payload.thesis.stance === "neutral" ? "trung lập" : "chưa đủ dữ liệu"}${payload.thesis.score == null ? "" : ` · ${payload.thesis.score}/100`}`);
        payload.thesis.whyBuy.slice(0, 3).forEach((item) => bullet(`Cơ sở tích cực: ${item.title} — ${item.detail}`));
        payload.thesis.whyNotBuy.slice(0, 3).forEach((item) => bullet(`Điểm cần thận trọng: ${item.title} — ${item.detail}`, RED));
        payload.thesis.invalidation.slice(0, 3).forEach((item) => bullet(`Điều kiện làm suy yếu luận điểm: ${item.title} — ${item.detail}`, MUTED));
      }
    }
    doc.addPage();
    title("9. VĨ MÔ, CHU KỲ NGÀNH VÀ CHU KỲ KINH TẾ");
    const macroSignals = payload.crossModule?.signals.filter((signal) => ["macro", "market", "industry", "fx", "commodity"].includes(signal.module)) ?? [];
    table(["Yếu tố", "Trạng thái", "Tác động dự kiến", "Độ tin cậy"], macroSignals.map((signal) => [moduleVi(signal.module), signal.headline, `${directionVi(signal.direction)}: ${signal.evidence}`, `${Math.round(signal.confidence * 100)}%`]));
    if (payload.crossModule) {
      row("Chu kỳ thị trường", `${regimeVi(payload.crossModule.market.regimeLabel)} · rủi ro ${riskVi(payload.crossModule.market.risk)}`);
      row("Chu kỳ ngành", `${payload.crossModule.industry.sector} · thay đổi ${pct(payload.crossModule.industry.sectorChangePct)} · mức độ mạnh ${money(payload.crossModule.industry.sectorStrength)}`);
      paragraph("Đánh giá chu kỳ ngành và kinh tế phản ánh bối cảnh thị trường hiện có. Cổ phiếu có thể được hưởng lợi hoặc chịu áp lực tùy theo lãi suất, tỷ giá, tín dụng, sức mua và xu hướng chung của ngành.", MUTED);
    }
    doc.addPage();
    title("10. NHẬN XÉT CHUNG VỀ DOANH NGHIỆP VÀ CỔ PHIẾU");
    const recommendation = recommendationVi(payload.technical.recommendation);
    const valuationSentence = payload.forecast.expectedValue != null ? `Giá trị kỳ vọng theo các kịch bản là ${money(payload.forecast.expectedValue)} nghìn VNĐ.` : "Chưa có đủ dữ liệu để xác định giá trị kỳ vọng.";
    paragraph(`Doanh nghiệp ${payload.profile.name} hoạt động trong lĩnh vực ${payload.profile.industry}. Sức khỏe tài chính hiện đạt ${payload.health.overall}/100; trạng thái kỹ thuật được đánh giá là ${recommendation}. ${valuationSentence}`);
    paragraph(`Nhận định tổng quan: cổ phiếu phù hợp để tiếp tục theo dõi theo hướng ${recommendation.toLowerCase()}, với trọng tâm là khả năng duy trì tăng trưởng doanh thu, cải thiện lợi nhuận, tạo dòng tiền và giữ vị thế trong chu kỳ ngành. Mức độ tích cực chỉ được nâng lên khi các yếu tố hỗ trợ được xác nhận bằng kết quả kinh doanh và diễn biến giá; ngược lại, cần thận trọng nếu lợi nhuận, dòng tiền hoặc xu hướng kỹ thuật suy yếu liên tiếp.`);
    doc.roundedRect(48, doc.y + 6, 499, 54, 4).fillAndStroke("#f2f7fb", LINE);
    doc.font(bold).fontSize(10).fillColor(BLUE).text(`NHẬN ĐỊNH MỘT DÒNG: ${payload.symbol} — ${recommendation}; ${payload.forecast.expectedValue != null ? `giá trị kỳ vọng tham chiếu ${money(payload.forecast.expectedValue)} nghìn VNĐ, cần xác nhận bằng kết quả kinh doanh và diễn biến thị trường.` : "cần tiếp tục theo dõi kết quả kinh doanh, định giá và xu hướng giá trước khi hành động."}`, 60, doc.y + 17, { width: 475, lineGap: 2 });
    doc.y += 58;
    doc.moveDown(0.8);     doc.font(regular).fontSize(8).fillColor(MUTED).text("Báo cáo chỉ nhằm mục đích nghiên cứu và không phải là khuyến nghị đầu tư cá nhân.");
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) { doc.switchToPage(i); doc.font(regular).fontSize(7.5).fillColor(MUTED).text(`ORCA FINANCIAL · ${payload.symbol} · BÁO CÁO PHÂN TÍCH`, 48, 805, { width: 350, lineBreak: false }); doc.text(`Trang ${i + 1}/${range.count}`, 430, 805, { width: 117, align: "right", lineBreak: false }); }
    doc.end();
  });
}
