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

function money(value: number | null | undefined): string { return value == null || !Number.isFinite(value) ? "N/A" : value.toLocaleString("vi-VN", { maximumFractionDigits: 2 }); }
function pct(value: number | null | undefined): string { return value == null || !Number.isFinite(value) ? "N/A" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`; }
function safeText(value: unknown): string { return String(value ?? "N/A").replace(/\s+/g, " ").trim(); }

function drawPriceSnapshot(doc: PDFKit.PDFDocument, bars: Ohlcv[] = []) {
  const points = bars.slice(-90);
  if (points.length < 2) { paragraphFallback(doc, "Không đủ OHLCV để vẽ snapshot kỹ thuật."); return; }
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
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return "N/A";
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
    const row = (label: string, value: string, color = "#172b3f") => { if (doc.y > 735) doc.addPage(); doc.x = 48; const y = doc.y; doc.font(regular).fontSize(9).fillColor(MUTED).text(label, 54, y, { width: 185 }); doc.font(bold).fillColor(color).text(`  ${value}`, 239, y, { width: 308, lineGap: 1.5 }); };
    const bullet = (text: string, color = "#172b3f") => { if (doc.y > 735) doc.addPage(); doc.x = 48; return doc.font(regular).fontSize(9.2).fillColor(color).text(`• ${safeText(text)}`, 54, doc.y, { width: 493, lineGap: 2 }); };
    const table = (headers: string[], rows: string[][]) => {
      const firstWidth = headers.length >= 6 ? 72 : headers.length >= 4 ? 105 : 110;
      const widths = headers.map((_, index) => index === 0 ? firstWidth : (499 - firstWidth) / Math.max(1, headers.length - 1));
      const startX = 48; let y = doc.y;
      const draw = (values: string[], header = false) => {
        const fontSize = header ? 8 : headers.length >= 6 ? 6.9 : 7.5;
        const heights = values.map((value, index) => { doc.font(header ? bold : regular).fontSize(fontSize); return doc.heightOfString(safeText(value), { width: Math.max(20, widths[index] - 10), lineGap: 1.2 }); });
        const height = Math.max(header ? 20 : 19, Math.min(58, Math.max(...heights) + 9));
        if (y + height > 780) { doc.addPage(); y = doc.y; }
        let x = startX;
        doc.rect(startX, y, 499, height).fill(header ? "#eaf1f7" : "#ffffff").stroke(LINE);
        values.forEach((value, index) => { doc.font(header ? bold : regular).fontSize(fontSize).fillColor(header ? BLUE : "#172b3f").text(safeText(value), x + 5, y + 5, { width: Math.max(20, widths[index] - 10), height: height - 7, lineGap: 1.2 }); x += widths[index]; });
        y += height;
      };
      draw(headers, true); for (const values of rows) draw(values);
      doc.x = 48; doc.y = y + 5;
    };

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
    title("2. CHUỖI GIÁ TRỊ DOANH NGHIỆP");
    paragraph("Mô hình dưới đây mô tả cách doanh nghiệp chuyển hóa nguồn lực đầu vào thành sản phẩm/dịch vụ, doanh thu và dòng tiền. Các điểm không có disclosure trực tiếp được đánh dấu là suy luận theo ngành.", MUTED);
    table(["Khâu", "Mô tả"], valueChainRows(payload.profile));
    if (payload.business?.segments.length) {
      table(["Phân khúc / năng lực", "Mô tả", "Độ tin cậy"], payload.business.segments.slice(0, 5).map((segment) => [segment.name, segment.description, `${Math.round(segment.confidence * 100)}% · ${segment.source}`]));
    }
    title("3. KẾT QUẢ KINH DOANH VÀ SỨC KHỎE TÀI CHÍNH");
    paragraph(`Current state tại ${payload.health.asOfPeriod}; dùng ${payload.health.dataQuality.periodsUsed} kỳ. Chỉ số hiện tại được ưu tiên từ kỳ Actual gần nhất; estimate/degraded được disclosure riêng ở phần nguồn dữ liệu.`);
    table(["Kỳ", "Doanh thu", "QoQ DT", "EBITDA", "Biên EBITDA", "LN ròng", "EPS"], payload.quarters.slice(0, 8).map((quarter, index, rows) => [quarter.period, money(quarter.income.revenue), changeText(quarter.income.revenue, rows[index + 1]?.income.revenue), money(quarter.income.ebitda), pct(quarter.income.revenue > 0 ? quarter.income.ebitda / quarter.income.revenue * 100 : null), money(quarter.income.netIncome), money(quarter.income.eps)]));
    const latest = payload.quarters[0];
    const yearAgo = payload.quarters.find((quarter) => latest && quarter.quarter === latest.quarter && quarter.fiscalYear === latest.fiscalYear - 1);
    table(["Chỉ số", "Giá trị hiện tại", "So với kỳ trước", "So với cùng kỳ"], [
      ["Doanh thu", money(indicatorValue(payload.health, "revenue" ) ?? latest?.income.revenue), changeText(latest?.income.revenue, payload.quarters[1]?.income.revenue), changeText(latest?.income.revenue, yearAgo?.income.revenue)],
      ["LN ròng", money(latest?.income.netIncome), changeText(latest?.income.netIncome, payload.quarters[1]?.income.netIncome), changeText(latest?.income.netIncome, yearAgo?.income.netIncome)],
      ["EBITDA margin", pct(indicatorValue(payload.health, "ebitdaMargin")), "N/A", "N/A"],
      ["CFO / Net income", `${money(indicatorValue(payload.health, "earningsQuality"))}x`, "N/A", "N/A"],
      ["CFO", money(latest?.cashflow.operatingCashFlow), changeText(latest?.cashflow.operatingCashFlow, payload.quarters[1]?.cashflow.operatingCashFlow), "Dòng tiền từ hoạt động kinh doanh; dương là tín hiệu hỗ trợ chất lượng lợi nhuận."],
      ["FCF", money(latest?.cashflow.freeCashFlow), changeText(latest?.cashflow.freeCashFlow, payload.quarters[1]?.cashflow.freeCashFlow), "Dòng tiền tự do sau đầu tư; cần đọc cùng capex và cấu trúc ngành."],
      ["FCF conversion", `${money(indicatorValue(payload.health, "fcfConversion"))}x`, "N/A", "N/A"],
      ["ROA / ROE / ROS", `${pct(indicatorValue(payload.health, "roa"))} / ${pct(indicatorValue(payload.health, "roe"))} / ${pct(indicatorValue(payload.health, "netMargin"))}`, "N/A", "N/A"],
      ["Nợ / VCSH", `${money(indicatorValue(payload.health, "debtEquity"))}x`, "N/A", "N/A"],
    ]);
    table(["Nhóm", "Điểm", "Trọng số", "Nhận xét"], payload.health.groups.map((group) => [group.label, `${group.score}/100`, `${(group.weight * 100).toFixed(0)}%`, group.narrative]));
    title("4. PHÂN TÍCH KỸ THUẬT TẠI THỜI ĐIỂM LẬP BÁO CÁO");
    paragraph("Snapshot dưới đây dùng 90 phiên OHLCV gần nhất tại thời điểm tạo báo cáo. Đường giá không thay thế phân tích nến hoặc dữ liệu intraday.", MUTED);
    drawPriceSnapshot(doc, payload.priceHistory);
    table(["Chỉ báo kỹ thuật", "Giá trị snapshot"], [
      ["Xu hướng / khuyến nghị", `${payload.technical.recommendation} · ${payload.technical.score}/100`],
      ["RSI(14)", money(payload.technical.rsi14)],
      ["SMA20 / SMA50", `${money(payload.technical.sma20)} / ${money(payload.technical.sma50)}`],
      ["Biến động năm hóa", pct(payload.technical.volatilityPct)],
      ["Drawdown tối đa", pct(payload.technical.maxDrawdownPct)],
      ["Hỗ trợ / kháng cự", payload.technical.supportResistance ? `${money(payload.technical.supportResistance.support)} / ${money(payload.technical.supportResistance.resistance)}` : "N/A"],
    ]);
    doc.moveDown(0.3); payload.technical.reasons.slice(0, 5).forEach((reason) => bullet(reason));
    const currentPrice = payload.technical.lastClose;
    const latestEps = payload.quarters[0]?.income.eps ?? null;
    const latestBookValue = payload.quarters[0]?.balance.bookValuePerShare ?? null;
    title("5. ĐỊNH GIÁ HIỆN TẠI");
    paragraph("P/E và P/B được tính từ giá đóng cửa snapshot chia cho EPS và book value per share của kỳ gần nhất. Đây là trailing/point-in-time proxy; cần thay bằng số liệu as-reported đã chuẩn hóa khi filing chính thức khả dụng.", MUTED);
    table(["Chỉ tiêu", "Giá trị", "Cơ sở", "Diễn giải"], [
      ["Giá hiện tại", `${money(currentPrice)} nghìn VNĐ`, "OHLCV snapshot", "Giá đóng cửa gần nhất trong data-engine."],
      ["P/E", latestEps && latestEps > 0 ? `${money(currentPrice / latestEps)}x` : "N/M", `EPS ${money(latestEps)}`, latestEps && latestEps > 0 ? "Trailing proxy theo EPS kỳ gần nhất." : "Không có EPS dương để tính."],
      ["P/B", latestBookValue && latestBookValue > 0 ? `${money(currentPrice / latestBookValue)}x` : "N/M", `BVPS ${money(latestBookValue)}`, latestBookValue && latestBookValue > 0 ? "Point-in-time proxy theo BVPS kỳ gần nhất." : "Không có BVPS hợp lệ để tính."],
      ["Blended fair value", payload.forecast.expectedValue == null ? "N/A" : `${money(payload.forecast.expectedValue)} nghìn VNĐ`, "Forecast scenarios", "Không phải giá cam kết; phụ thuộc assumptions."],
    ]);
    title("6. DỰ PHÓNG KẾT QUẢ KINH DOANH VÀ ĐỊNH GIÁ");
    paragraph(`Mô hình ${payload.forecast.modelVersion}. Forecast là estimate; prediction confidence ${Math.round(payload.forecast.predictionConfidence * 100)}%.`);
    table(["Kịch bản", "Xác suất", "Fair value", "Luận điểm"], payload.forecast.scenarios.map((scenario) => [scenario.name.toUpperCase(), `${(scenario.probability * 100).toFixed(0)}%`, scenario.fairValue == null ? "N/A" : money(scenario.fairValue), scenario.rationale]));
    table(["Kỳ dự phóng", "Doanh thu", "EBITDA", "LN ròng", "EPS"], payload.forecast.forecast.map((point) => [point.period, money(point.revenue), money(point.ebitda), money(point.netIncome), money(point.eps)]));
    title("7. RỦI RO, CATALYST VÀ KẾ HOẠCH THEO DÕI");
    row("Mức rủi ro", `${payload.risk.level} · ${payload.risk.overall}/100`); row("Rủi ro chính", payload.risk.mainRisk); row("Backtest accuracy", `${(payload.backtest.metrics.recommendationAccuracy * 100).toFixed(1)}%`); row("News trend 7 ngày", payload.news.trend.d7.toFixed(3));
    payload.news.events.slice(0, 5).forEach((event) => bullet(`[${event.impact.toUpperCase()} · ${event.category}] ${event.title}`));
    if (payload.risk.tradePlan) { doc.moveDown(0.25); paragraph(`Trade plan nghiên cứu: vùng vào ${money(payload.risk.tradePlan.entryLow)}–${money(payload.risk.tradePlan.entryHigh)}, stop loss ${money(payload.risk.tradePlan.stopLoss)}, TP1 ${money(payload.risk.tradePlan.takeProfit1)}, TP2 ${money(payload.risk.tradePlan.takeProfit2)}; R/R ${payload.risk.tradePlan.riskReward1}x / ${payload.risk.tradePlan.riskReward2}x.`, MUTED); }
    if (payload.crossModule || payload.business || payload.thesis) {
      doc.addPage();
      title("8. CROSS-MODULE, HÀO KINH TẾ VÀ INVESTMENT THESIS");
      if (payload.crossModule) {
        row("Market regime", `${payload.crossModule.market.regimeLabel} · risk ${payload.crossModule.market.risk}`);
        row("Cross-module score", payload.crossModule.aggregateScore == null ? "N/A" : `${payload.crossModule.aggregateScore}/100`);
        payload.crossModule.signals.filter((signal) => signal.direction !== "unknown").slice(0, 5).forEach((signal) => bullet(`[${signal.module.toUpperCase()} · ${signal.direction}] ${signal.headline}: ${signal.evidence}`));
        payload.crossModule.causalChains.slice(0, 3).forEach((chain) => bullet(`[CAUSAL · ${chain.impact}] ${chain.title}: ${chain.links.map((link) => `${link.from} → ${link.to}`).join(" → ")}`));
      }
      if (payload.business) {
        row("Moat score", `${payload.business.moat.score}/100 · ${payload.business.moat.rating}`);
        payload.business.moat.factors.slice(0, 5).forEach((factor) => bullet(`[MOAT] ${factor.label}: ${factor.score}/100 — ${factor.evidence}`));
        payload.business.growthDrivers.slice(0, 3).forEach((driver) => bullet(`[GROWTH · ${driver.direction}] ${driver.driver}: ${driver.evidence}`));
      }
      if (payload.thesis) {
        row("Investment thesis", `${payload.thesis.stance}${payload.thesis.score == null ? "" : ` · ${payload.thesis.score}/100`}`);
        payload.thesis.whyBuy.slice(0, 3).forEach((item) => bullet(`[WHY BUY] ${item.title}: ${item.detail}`));
        payload.thesis.whyNotBuy.slice(0, 3).forEach((item) => bullet(`[WHY NOT] ${item.title}: ${item.detail}`, RED));
        payload.thesis.invalidation.slice(0, 3).forEach((item) => bullet(`[INVALIDATION] ${item.title}: ${item.detail}`, MUTED));
      }
    }
    doc.addPage();
    title("9. VĨ MÔ, CHU KỲ NGÀNH VÀ CHU KỲ KINH TẾ");
    const macroSignals = payload.crossModule?.signals.filter((signal) => ["macro", "market", "industry", "fx", "commodity"].includes(signal.module)) ?? [];
    table(["Yếu tố", "Trạng thái", "Tác động dự kiến", "Độ tin cậy"], macroSignals.map((signal) => [signal.module.toUpperCase(), signal.headline, `${signal.direction}: ${signal.evidence}`, `${Math.round(signal.confidence * 100)}%`]));
    if (payload.crossModule) {
      row("Chu kỳ thị trường", `${payload.crossModule.market.regimeLabel} · ${payload.crossModule.market.risk}`);
      row("Chu kỳ ngành", `${payload.crossModule.industry.sector} · change ${pct(payload.crossModule.industry.sectorChangePct)} · strength ${money(payload.crossModule.industry.sectorStrength)}`);
      paragraph("Đánh giá chu kỳ ngành và kinh tế là nhận định theo snapshot market/sector/macro hiện có; không phải dự báo vĩ mô độc lập và cần cập nhật khi lãi suất, tỷ giá, tín dụng hoặc tăng trưởng thay đổi.", MUTED);
    }
    doc.addPage();
    title("10. NHẬN XÉT CHUNG VỀ DOANH NGHIỆP VÀ CỔ PHIẾU");
    paragraph(`Doanh nghiệp ${payload.profile.name} hoạt động trong ${payload.profile.industry}. Sức khỏe tài chính hiện ở mức ${payload.health.rating} với điểm ${payload.health.overall}/100; technical engine cho tín hiệu ${payload.technical.recommendation}. Kịch bản cơ sở được xây dựng từ xu hướng lịch sử và phải được xem xét lại khi có báo cáo tài chính, tin tức hoặc thay đổi thị trường mới.`);
    if (payload.crossModule) bullet(`Cross-module disclosure: ${payload.crossModule.disclosure}`);
    if (payload.business) { bullet(`Moat disclosure: ${payload.business.disclosure}`); bullet(`Moat caveat: ${payload.business.moat.caveat}`, MUTED); }
    if (payload.thesis) bullet(`Thesis disclosure: ${payload.thesis.disclosure}`);
    bullet(`Nguồn dữ liệu thô: ${payload.source}.`); bullet(`Dữ liệu được lấy qua data-engine tại thời điểm ${new Date(payload.generatedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}.`); bullet("Các trường estimate/degraded không phải số liệu audited actual; forecast, fair value và trade plan không phải cam kết giá.");
    doc.roundedRect(48, doc.y + 6, 499, 42, 4).fillAndStroke("#f2f7fb", LINE);
    doc.font(bold).fontSize(10).fillColor(BLUE).text(`KẾT LUẬN MỘT DÒNG: ${payload.symbol} — ${payload.technical.recommendation}; theo dõi ${payload.forecast.expectedValue != null ? `fair value kỳ vọng ${money(payload.forecast.expectedValue)} nghìn VNĐ` : "dữ liệu định giá và báo cáo tài chính chính thức"}.`, 60, doc.y + 17, { width: 475, lineGap: 1.5 });
    doc.y += 58;
    doc.moveDown(0.8); doc.font(regular).fontSize(8).fillColor(MUTED).text("Báo cáo chỉ nhằm mục đích nghiên cứu, không phải lời khuyên đầu tư cá nhân. Nhà đầu tư cần tự đánh giá khẩu vị rủi ro, tính thanh khoản, thuế, phí và thông tin công bố chính thức.");
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) { doc.switchToPage(i); doc.font(regular).fontSize(7.5).fillColor(MUTED).text(`ORCA FINANCIAL · ${payload.symbol} · BÁO CÁO PHÂN TÍCH`, 48, 805, { width: 350, lineBreak: false }); doc.text(`Trang ${i + 1}/${range.count}`, 430, 805, { width: 117, align: "right", lineBreak: false }); }
    doc.end();
  });
}
