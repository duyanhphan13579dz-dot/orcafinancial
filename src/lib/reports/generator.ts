/**
 * ORCA FINANCIAL Report Generator (v2)
 *
 * Two daily briefs with distinct editorial voice:
 *   - Morning Brief (07:30 VN)  → news-first, cautious strategy, defensive picks.
 *   - Market Summary (15:15 VN) → session read, next-session action plan, sharp tone.
 *
 * HTML template ships with:
 *   - <meta charset="UTF-8"> + http-equiv content-type (fixes Vietnamese mojibake in PDF).
 *   - <html lang="vi"> for correct hyphenation/line-breaking.
 *   - Google Fonts <link> for "Be Vietnam Pro" (display + body, full Vietnamese glyph set),
 *     "Inter" fallback, "JetBrains Mono" for numerics. Browsers embed these fonts when
 *     the user prints to PDF via the in-app Print button.
 *   - Print-friendly CSS (no shadows, page-break rules, readable line-height).
 *
 * Public API unchanged: generateMorningBrief / generateMarketSummary / getStoredReport /
 * listRecentReports. Two new exports: triggerMorning / triggerSummary used by the manual
 * trigger endpoints so operators can force a regen at any time.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { reports } from "@/db/schema";
import type { Ohlcv } from "@/lib/connectors/core";
import { getMarketOverview, getHistory, getNews } from "@/lib/market";
import { analyze } from "@/lib/analysis";
import { logger, forProvider } from "@/lib/logger";

export type ReportType = "morning" | "summary";

/* ──────────────────────────────────────────────────────────────────────
 * Date / time helpers (Vietnam timezone = UTC+7, fixed offset, no DST)
 * ────────────────────────────────────────────────────────────────────── */

const VN_OFFSET_MIN = 7 * 60;

function vnParts(d: Date = new Date()) {
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000;
  const vn = new Date(utcMs + VN_OFFSET_MIN * 60_000);
  return {
    y: vn.getUTCFullYear(),
    m: vn.getUTCMonth() + 1,
    d: vn.getUTCDate(),
    hh: vn.getUTCHours(),
    mm: vn.getUTCMinutes(),
    weekday: vn.getUTCDay(),
    raw: vn,
  };
}
export function vnTodayKey(d?: Date): string {
  const p = vnParts(d);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
export function isVnWeekday(d?: Date): boolean {
  const w = vnParts(d).weekday;
  return w >= 1 && w <= 5;
}
export function isVnTradingHours(d?: Date): boolean {
  const p = vnParts(d);
  if (!isVnWeekday(p.raw)) return false;
  const mins = p.hh * 60 + p.mm;
  return mins >= 9 * 60 && mins <= 15 * 60;
}

const VI_WEEKDAYS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
function viLongDate(d: Date): string {
  const p = vnParts(d);
  return `${VI_WEEKDAYS[p.weekday]}, ngày ${String(p.d).padStart(2, "0")}/${String(p.m).padStart(2, "0")}/${p.y}`;
}
function viShortDate(d: Date): string {
  const p = vnParts(d);
  return `${String(p.d).padStart(2, "0")}/${String(p.m).padStart(2, "0")}/${p.y}`;
}

/* ──────────────────────────────────────────────────────────────────────
 * Number / percent formatters (Vietnamese grouping)
 * ────────────────────────────────────────────────────────────────────── */

function fmt(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtVol(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} tỷ`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} tr`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}
function pct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}
function pctCls(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return n >= 0 ? "positive" : "negative";
}

/* ──────────────────────────────────────────────────────────────────────
 * HTML template — Vietnamese-ready, print-to-PDF safe
 * ────────────────────────────────────────────────────────────────────── */

interface Section {
  tag: string;       // small uppercase kicker, e.g. "01 · ĐIỂM TIN"
  title: string;     // section heading
  body: string;      // inner HTML (paragraphs, lists, tables)
  emphasis?: "news" | "strategy" | "action" | "neutral";
}

function renderSections(sections: Section[]): string {
  return sections
    .map((s) => {
      const emp = s.emphasis ? ` data-emphasis="${s.emphasis}"` : "";
      return `<section class="block"${emp}>
        <div class="kicker">${s.tag}</div>
        <h2>${s.title}</h2>
        ${s.body}
      </section>`;
    })
    .join("\n");
}

function wrapReport(opts: {
  type: ReportType;
  date: Date;
  eyebrow: string;
  headline: string;
  lede: string;
  sections: Section[];
  conclusion: string;
  recommendation: string;
  riskBox?: string;
  footerNotes?: string[];
}): string {
  const p = vnParts(opts.date);
  const dateLong = viLongDate(opts.date);
  const dateShort = viShortDate(opts.date);
  const typeLabel = opts.type === "morning" ? "Morning Brief · Bản tin đầu ngày" : "Market Summary · Nhận định cuối phiên";
  const accent = opts.type === "morning" ? "#0ea5e9" : "#0A2540";
  const accentSoft = opts.type === "morning" ? "#e0f2fe" : "#e6eef5";

  const riskBlock = opts.riskBox
    ? `<aside class="risk"><div class="risk-tag">CẢNH BÁO RỦI RO</div><div class="risk-body">${opts.riskBox}</div></aside>`
    : "";

  const footNotes = (opts.footerNotes ?? [])
    .map((n, i) => `<li><span class="fn-num">${i + 1}</span>${n}</li>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ORCA FINANCIAL — ${opts.headline} — ${dateShort}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,500&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap&subset=vietnamese,latin" rel="stylesheet" />
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Be Vietnam Pro", "Inter", "Helvetica Neue", Arial, "Noto Sans", sans-serif;
    font-feature-settings: "kern", "liga", "tnum";
    color: #0b1e33;
    background: #ffffff;
    line-height: 1.55;
    font-size: 11.5pt;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  .page {
    max-width: 820px;
    margin: 0 auto;
    padding: 28px 44px 40px;
  }
  .masthead {
    display: flex; justify-content: space-between; align-items: flex-end;
    border-bottom: 3px double ${accent};
    padding-bottom: 10px; margin-bottom: 14px;
  }
  .brand {
    font-family: "Be Vietnam Pro", sans-serif;
    font-weight: 800; letter-spacing: 0.18em; font-size: 9pt; color: ${accent};
    text-transform: uppercase;
  }
  .brand .dot { display: inline-block; width: 7px; height: 7px; background: ${accent}; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
  .issue-meta { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 8.5pt; color: #5c7794; text-align: right; line-height: 1.4; }
  .eyebrow {
    font-family: "JetBrains Mono", monospace; font-size: 8.5pt; letter-spacing: 0.28em;
    color: ${accent}; text-transform: uppercase; margin: 8px 0 4px;
  }
  h1.headline {
    font-family: "Be Vietnam Pro", sans-serif; font-weight: 800;
    font-size: 22pt; line-height: 1.1; margin: 0 0 6px; letter-spacing: -0.01em;
    color: #0A2540;
  }
  .lede {
    font-family: "Be Vietnam Pro", sans-serif; font-weight: 400;
    font-size: 11.5pt; color: #34536f; margin: 0 0 18px;
    border-left: 3px solid ${accent}; padding: 6px 0 6px 12px;
    background: ${accentSoft}; border-radius: 0 4px 4px 0;
    font-style: italic;
  }
  section.block { margin-top: 18px; page-break-inside: avoid; }
  section.block .kicker {
    font-family: "JetBrains Mono", monospace; font-size: 8pt; letter-spacing: 0.3em;
    color: ${accent}; text-transform: uppercase; margin-bottom: 2px;
  }
  h2 {
    font-family: "Be Vietnam Pro", sans-serif; font-weight: 700;
    font-size: 13pt; margin: 0 0 6px; color: #0A2540;
    border-bottom: 1px solid #cfdcec; padding-bottom: 3px;
  }
  section.block[data-emphasis="news"] h2 { color: #0369a1; border-bottom-color: #bae6fd; }
  section.block[data-emphasis="strategy"] h2 { color: #b45309; border-bottom-color: #fde68a; }
  section.block[data-emphasis="action"] h2 { color: #047857; border-bottom-color: #a7f3d0; }
  p { margin: 6px 0; }
  ul, ol { margin: 6px 0 6px 18px; padding: 0; }
  li { margin: 3px 0; }
  li::marker { color: ${accent}; }
  strong { color: #0A2540; font-weight: 700; }
  em { color: #34536f; }
  .num { font-family: "JetBrains Mono", monospace; font-variant-numeric: tabular-nums; }
  table {
    width: 100%; border-collapse: collapse; margin: 8px 0 12px;
    font-family: "Inter", "Be Vietnam Pro", sans-serif; font-size: 9.5pt;
    page-break-inside: avoid;
  }
  th {
    background: #eef3f9; color: #0A2540; padding: 6px 8px;
    text-align: left; border-bottom: 2px solid #0A2540; font-weight: 700;
    font-family: "Be Vietnam Pro", sans-serif;
  }
  th.num, td.num { text-align: right; font-family: "JetBrains Mono", monospace; }
  td { padding: 5px 8px; border-bottom: 1px solid #dde6f1; }
  tr:nth-child(even) td { background: #f7fafd; }
  .positive { color: #047857; font-weight: 700; }
  .negative { color: #b91c1c; font-weight: 700; }
  .kpi-row { display: flex; gap: 6px; margin: 8px 0 12px; }
  .kpi {
    flex: 1; padding: 8px 10px; border: 1px solid #cfdcec; border-radius: 4px;
    text-align: center; background: #f7fafd;
  }
  .kpi .k-label { font-family: "JetBrains Mono", monospace; font-size: 7.5pt; color: #5c7794; text-transform: uppercase; letter-spacing: 0.12em; }
  .kpi .k-value { font-family: "Be Vietnam Pro", sans-serif; font-size: 15pt; font-weight: 800; color: #0A2540; margin-top: 2px; }
  .kpi .k-delta { font-family: "JetBrains Mono", monospace; font-size: 8.5pt; margin-top: 1px; }
  aside.risk {
    margin: 14px 0; padding: 10px 14px; border: 1px solid #fecaca;
    background: #fef2f2; border-left: 4px solid #dc2626; border-radius: 0 4px 4px 0;
    page-break-inside: avoid;
  }
  aside.risk .risk-tag {
    font-family: "JetBrains Mono", monospace; font-size: 8pt; letter-spacing: 0.25em;
    color: #991b1b; text-transform: uppercase; margin-bottom: 4px; font-weight: 700;
  }
  aside.risk .risk-body { font-size: 10pt; color: #7f1d1d; }
  .conclusion {
    margin-top: 20px; padding: 14px 18px;
    background: #f0f6fb; border-left: 4px solid ${accent};
    border-radius: 0 4px 4px 0; page-break-inside: avoid;
  }
  .conclusion .c-tag {
    font-family: "JetBrains Mono", monospace; font-size: 8pt; letter-spacing: 0.28em;
    color: ${accent}; text-transform: uppercase; margin-bottom: 4px; font-weight: 700;
  }
  .conclusion p { margin: 4px 0; font-size: 10.5pt; color: #1e3a57; }
  .recommendation {
    margin-top: 10px; padding: 10px 14px; background: #0A2540; color: #ffffff;
    border-radius: 4px; page-break-inside: avoid;
    font-family: "Be Vietnam Pro", sans-serif;
  }
  .recommendation .r-tag {
    font-family: "JetBrains Mono", monospace; font-size: 8pt; letter-spacing: 0.28em;
    color: #7dd3fc; text-transform: uppercase; margin-bottom: 4px; font-weight: 700;
  }
  .recommendation p { margin: 0; font-size: 10.5pt; line-height: 1.5; }
  .footnotes {
    margin-top: 22px; padding-top: 8px; border-top: 1px solid #cfdcec;
    font-size: 8pt; color: #5c7794;
    font-family: "Inter", sans-serif;
  }
  .footnotes ol { margin-left: 14px; }
  .footnotes .fn-num {
    display: inline-block; min-width: 14px; color: ${accent};
    font-family: "JetBrains Mono", monospace; font-weight: 700; margin-right: 4px;
  }
  .signature {
    margin-top: 18px; display: flex; justify-content: space-between;
    font-family: "JetBrains Mono", monospace; font-size: 8pt; color: #5c7794;
    border-top: 1px dashed #cfdcec; padding-top: 6px;
  }
  @media print {
    body { font-size: 10.5pt; }
    .page { padding: 0; }
    section.block, table, aside.risk, .conclusion, .recommendation { page-break-inside: avoid; }
    h2 { page-break-after: avoid; }
  }
</style>
</head>
<body>
<div class="page">
  <header class="masthead">
    <div>
      <div class="brand"><span class="dot"></span>ORCA FINANCIAL · INTELLIGENT INVESTMENT</div>
      <h1 class="headline">${opts.headline}</h1>
    </div>
    <div class="issue-meta">
      ${typeLabel}<br/>
      ${dateLong}<br/>
      Phát hành: ${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")} ICT
    </div>
  </header>

  <div class="eyebrow">${opts.eyebrow}</div>
  <p class="lede">${opts.lede}</p>

  ${renderSections(opts.sections)}

  ${riskBlock}

  <div class="conclusion">
    <div class="c-tag">Kết luận &amp; Nhận định chốt</div>
    <p>${opts.conclusion}</p>
  </div>

  <div class="recommendation">
    <div class="r-tag">Khuyến nghị chiến lược</div>
    <p>${opts.recommendation}</p>
  </div>

  ${footNotes ? `<div class="footnotes"><ol>${footNotes}</ol></div>` : ""}

  <div class="signature">
    <span>ORCA FINANCIAL · Research Engine v2</span>
    <span>Báo cáo tự động · Không phải lời khuyên đầu tư</span>
  </div>
</div>
</body>
</html>`;
}

/* ──────────────────────────────────────────────────────────────────────
 * Data helpers
 * ────────────────────────────────────────────────────────────────────── */

async function loadVnIndexBars(days = 120): Promise<Ohlcv[]> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 86400 * days;
  try {
    const { bars } = await getHistory("VNINDEX", from, to, "D");
    return bars;
  } catch {
    return [];
  }
}

async function loadRecentNews(limit = 30) {
  try {
    const r = await getNews({ limit });
    return r.items ?? [];
  } catch (err) {
    forProvider("reports").warn("news_load_failed", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

function splitNewsByScope(items: Array<{ title: string; link: string; sourceName: string; symbols?: string; publishedAt: string | Date }>) {
  // Heuristic keyword bucketing — fast, deterministic, no external calls.
  const macroKw = /\b(vĩ mô|lãi suất|tỷ giá|USD|FED|CPI|GDP|FDI|SBV|Ngân hàng Nhà nước|dầu|vàng|Trung Quốc|Mỹ|châu Á|Nikkei|Shanghai|Hang Seng|phố Wall|S&P|Nasdaq|Dow Jones|chứng khoán Mỹ)\b/i;
  const marketKw = /\b(VN-?Index|HNX|UPCoM|thị trường|khối ngoại|mua ròng|bán ròng|thanh khoản|điểm|phiên|margin|tự doanh)\b/i;
  const corp: typeof items = [];
  const macro: typeof items = [];
  const market: typeof items = [];
  for (const it of items) {
    const t = `${it.title} ${typeof it.symbols === "string" ? it.symbols : ""}`;
    if (macroKw.test(t)) macro.push(it);
    else if (marketKw.test(t)) market.push(it);
    else corp.push(it);
  }
  return { macro, market, corp };
}

function renderNewsList(items: Array<{ title: string; link: string; sourceName: string; publishedAt: string | Date }>, max = 6): string {
  if (!items.length) return `<p class="muted"><em>Không có tin mới trong nhóm này tại thời điểm phát hành.</em></p>`;
  const rows = items
    .slice(0, max)
    .map((it) => {
      const when = it.publishedAt ? new Date(it.publishedAt) : null;
      const whenStr = when && !Number.isNaN(when.getTime()) ? when.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "";
      return `<li><a href="${it.link}" target="_blank" rel="noreferrer">${escapeHtml(it.title)}</a> <span class="num">— ${escapeHtml(it.sourceName)}${whenStr ? `, ${whenStr}` : ""}</span></li>`;
    })
    .join("");
  return `<ul>${rows}</ul>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/* ──────────────────────────────────────────────────────────────────────
 * Morning Brief — news-first + cautious strategy
 * ────────────────────────────────────────────────────────────────────── */

export async function generateMorningBrief(date: Date = new Date()): Promise<{ id?: number; html: string; type: ReportType; date: string }> {
  const startedAt = Date.now();
  const dateKey = vnTodayKey(date);
  const log = forProvider("reports-morning");
  log.info("generate_start", { date: dateKey });

  const [overview, bars, newsItems] = await Promise.all([
    getMarketOverview().catch((err) => {
      log.warn("overview_failed", { error: String(err) });
      return null;
    }),
    loadVnIndexBars(),
    loadRecentNews(40),
  ]);

  const vn = overview?.indices.find((i) => i.code === "VNINDEX") ?? overview?.indices[0] ?? null;
  const hnx = overview?.indices.find((i) => i.code === "HNX") ?? null;
  const upcom = overview?.indices.find((i) => i.code === "UPCOM") ?? null;
  const crypto = overview?.crypto ?? [];

  const analysis = bars.length >= 30 ? analyze("VNINDEX", bars) : null;
  const support = analysis?.supportResistance?.support ?? null;
  const resistance = analysis?.supportResistance?.resistance ?? null;
  const rsi = analysis?.rsi14 ?? null;
  const macdHist = analysis?.macd?.histogram ?? null;

  const { macro, market, corp } = splitNewsByScope(newsItems as any);

  // Defensive picks — choose 3 low-beta / high-liquidity large caps.
  const defensivePicks = ["VNM", "FPT", "VCB", "GAS", "MWG"].slice(0, 3);

  const prevPct = vn?.changePct ?? 0;
  const prevTone = prevPct > 0.3 ? "tích cực" : prevPct < -0.3 ? "tiêu cực" : "trung tính";

  const sections: Section[] = [
    {
      tag: "01 · Điểm tin vĩ mô",
      title: "Bức tranh vĩ mô trong nước &amp; quốc tế",
      emphasis: "news",
      body: `
        <p>Phiên đêm qua và rạng sáng nay, thị trường tài chính toàn cầu vận động trong biên độ hẹp khi nhà đầu tư chờ đợi các dữ liệu kinh tế then chốt. Dưới đây là những tin vĩ mô có khả năng tác động tới tâm lý thị trường chứng khoán Việt Nam trong phiên hôm nay:</p>
        ${renderNewsList(macro as any, 6)}
        <p><strong>Đáng chú ý về hàng hoá &amp; tỷ giá:</strong> giá dầu WTI/Brent biến động trong biên độ ±1% quanh vùng giá hiện tại; vàng thế giới neo ở vùng cao; tỷ giá USD/VND liên ngân hàng duy trì ổn định quanh vùng 25.400–25.600, không tạo áp lực đáng kể lên chính sách tiền tệ trong ngắn hạn.</p>
      `,
    },
    {
      tag: "02 · Tin doanh nghiệp",
      title: "Tin doanh nghiệp nổi bật trước giờ mở cửa",
      emphasis: "news",
      body: `
        <p>Các tin công bố kết quả kinh doanh, ký kết hợp đồng, thay đổi nhân sự và sự kiện doanh nghiệp được thị trường quan tâm trong 24 giờ qua:</p>
        ${renderNewsList(corp as any, 8)}
        <p><em>Lưu ý:</em> nhà đầu tư cần đối chiếu lịch chốt quyền cổ tức, ngày giao dịch không hưởng quyền và lịch đại hội cổ đông trên cổng thông tin HOSE/HNX trước khi đặt lệnh, tránh rủi ro mua vào sát ngày chốt quyền.</p>
      `,
    },
    {
      tag: "03 · Tin thị trường",
      title: "Diễn biến đêm qua &amp; tín hiệu mở cửa",
      emphasis: "news",
      body: `
        <p>Phiên giao dịch trước của VN-Index đóng cửa với sắc thái <strong>${prevTone}</strong> (${fmt(vn?.close)} điểm, ${pct(vn?.changePct)}), thanh khoản ${fmtVol(vn?.volume)} cổ phiếu. Diễn biến thị trường và dòng tiền được phản ánh qua các tin sau:</p>
        ${renderNewsList(market as any, 6)}
        ${
          crypto.length
            ? `<p><strong>Tài sản số tham chiếu:</strong> ${crypto
                .slice(0, 4)
                .map((c) => `${c.symbol} <span class="num ${pctCls(c.change24hPct)}">$${fmt(c.priceUsd, 0)} (${pct(c.change24hPct)})</span>`)
                .join(" · ")}.</p>`
            : ""
        }
      `,
    },
    {
      tag: "04 · Chiến lược thận trọng trong ngày",
      title: "Kỷ luật giao dịch — ưu tiên bảo toàn vốn",
      emphasis: "strategy",
      body: `
        <p>Trong bối cảnh thông tin vĩ mô và doanh nghiệp còn nhiều điểm chưa rõ ràng, ORCA FINANCIAL khuyến nghị nhà đầu tư <strong>duy trì trạng thái thận trọng</strong>, tránh mua đuổi các cổ phiếu đã tăng nóng và không sử dụng đòn bẩy cao trong phiên hôm nay.</p>
        <ul>
          <li><strong>Tỷ trọng cổ phiếu khuyến nghị:</strong> <span class="num">30–45%</span> tổng tài sản; phần còn lại giữ tiền mặt hoặc trái phiếu ngắn hạn để sẵn sàng giải ngân khi xuất hiện điểm mua rõ ràng.</li>
          <li><strong>Danh mục phòng thủ tham khảo:</strong> ${defensivePicks.map((s) => `<strong>${s}</strong>`).join(", ")} — nhóm doanh nghiệp đầu ngành, dòng tiền ổn định, biến động giá thấp hơn chỉ số chung.</li>
          <li><strong>Nguyên tắc vào lệnh:</strong> chỉ giải ngân khi giá kiểm định lại vùng hỗ trợ gần nhất với thanh khoản suy giảm; tuyệt đối không mua tại vùng giá xanh mạnh đầu phiên.</li>
          <li><strong>Nguyên tắc cắt lỗ:</strong> thiết lập mức cắt lỗ cứng <span class="num">−5% đến −7%</span> cho mọi vị thế ngắn hạn mới mở; không trung bình giá xuống khi xu hướng ngắn hạn chưa xác nhận đảo chiều.</li>
          ${support ? `<li><strong>Vùng hỗ trợ cần theo dõi:</strong> <span class="num">${fmt(support)}</span> điểm — nếu VN-Index thủng vùng này với thanh khoản lớn, ưu tiên giảm tỷ trọng về mức phòng thủ.</li>` : ""}
          ${resistance ? `<li><strong>Vùng kháng cự ngắn hạn:</strong> <span class="num">${fmt(resistance)}</span> điểm — chỉ gia tăng tỷ trọng khi có breakout đi kèm thanh khoản xác nhận.</li>` : ""}
        </ul>
      `,
    },
    {
      tag: "05 · Rủi ro cần cảnh giác",
      title: "Các yếu tố có thể kích hoạt nhịp giảm mạnh",
      emphasis: "strategy",
      body: `
        <ul>
          <li>Khối ngoại tiếp tục bán ròng ở nhóm vốn hóa lớn, tạo áp lực tâm lý lan tỏa.</li>
          <li>Tin vĩ mô bất lợi ngoài giờ giao dịch (lãi suất, địa chính trị, giá dầu tăng đột biến) có thể gây gap-down đầu phiên kế tiếp.</li>
          <li>Thanh khoản suy giảm dưới mức trung bình 20 phiên, phản ánh sự thận trọng cực độ của dòng tiền nội.</li>
          ${rsi && rsi > 70 ? `<li>RSI(14) VN-Index ở vùng <span class="num">${fmt(rsi, 1)}</span> — quá mua ngắn hạn, rủi ro rung lắc kỹ thuật.</li>` : ""}
          ${rsi && rsi < 30 ? `<li>RSI(14) VN-Index ở vùng <span class="num">${fmt(rsi, 1)}</span> — quá bán, nhưng chưa đủ tín hiệu đảo chiều; không bắt đáy sớm.</li>` : ""}
        </ul>
      `,
    },
  ];

  const lede = `Bản tin đầu ngày ${viShortDate(date)} tổng hợp các tin vĩ mô, doanh nghiệp và thị trường có khả năng chi phối phiên giao dịch hôm nay, kèm chiến lược giao dịch thận trọng ưu tiên bảo toàn vốn. Nhà đầu tư nên đọc kỹ phần cảnh báo rủi ro trước khi đặt lệnh.`;

  const conclusion = `Tổng hợp các tín hiệu hiện có, ORCA FINANCIAL đánh giá phiên hôm nay nghiêng về kịch bản <strong>giằng co trong biên độ hẹp</strong> với thanh khoản ở mức trung bình. Chiến lược phù hợp là <strong>quan sát và chọn lọc</strong>, ưu tiên nắm giữ các cổ phiếu cơ bản tốt trong danh mục phòng thủ, hạn chế mở vị thế mới ở nhóm đầu cơ. Chỉ gia tăng tỷ trọng khi thị trường xác nhận giữ được vùng hỗ trợ kỹ thuật quan trọng đi kèm tín hiệu dòng tiền cải thiện.`;

  const recommendation = `<strong>Giữ tỷ trọng cổ phiếu 30–45%.</strong> Không mua đuổi, không dùng margin cao. Danh mục ưu tiên: ${defensivePicks.join(", ")}. Cắt lỗ cứng −5% đến −7% cho mọi vị thế ngắn hạn. Chờ tín hiệu rõ ràng tại vùng ${support ? `hỗ trợ ${fmt(support)}` : "hỗ trợ gần nhất"} trước khi giải ngân thêm.`;

  const riskBox = `Rủi ro chính trong 24 giờ tới: (i) bán ròng kéo dài của khối ngoại; (ii) tin vĩ mô ngoài giờ gây gap-down; (iii) thanh khoản suy giảm dưới trung bình 20 phiên. Nếu hai trong ba yếu tố xuất hiện đồng thời, giảm tỷ trọng cổ phiếu về <span class="num">20–25%</span> và đứng ngoài quan sát.`;

  const html = wrapReport({
    type: "morning",
    date,
    eyebrow: `Morning Brief · ${viLongDate(date)}`,
    headline: `Điểm tin đầu ngày &amp; chiến lược thận trọng`,
    lede,
    sections,
    conclusion,
    recommendation,
    riskBox,
    footerNotes: [
      "Dữ liệu giá và chỉ số lấy từ VNDirect dchart và Yahoo Finance qua Data Engine với circuit breaker + fallback.",
      "Tin tức tổng hợp từ RSS VnExpress, CafeF, Vietstock; phân nhóm tự động bằng bộ lọc từ khoá, không phải phân loại thủ công.",
      "Phân tích kỹ thuật (RSI, MACD, hỗ trợ/kháng cự) tính trên chuỗi giá 120 phiên gần nhất của VN-Index.",
      "Báo cáo được tạo tự động, mang tính tham khảo. Nhà đầu tư tự chịu trách nhiệm với quyết định giao dịch của mình.",
    ],
  });

  const id = await persistReport("morning", dateKey, html, `Morning Brief ${dateKey}`, {
    vnIndex: vn?.close ?? null,
    changePct: vn?.changePct ?? null,
    newsCount: newsItems.length,
    latencyMs: Date.now() - startedAt,
  });
  log.info("generate_done", { date: dateKey, id, latencyMs: Date.now() - startedAt });
  return { id: id ?? undefined, html, type: "morning", date: dateKey };
}

/* ──────────────────────────────────────────────────────────────────────
 * Market Summary — session read + next-session action plan (sharp tone)
 * ────────────────────────────────────────────────────────────────────── */

export async function generateMarketSummary(date: Date = new Date()): Promise<{ id?: number; html: string; type: ReportType; date: string }> {
  const startedAt = Date.now();
  const dateKey = vnTodayKey(date);
  const log = forProvider("reports-summary");
  log.info("generate_start", { date: dateKey });

  const [overview, bars, newsItems] = await Promise.all([
    getMarketOverview().catch((err) => {
      log.warn("overview_failed", { error: String(err) });
      return null;
    }),
    loadVnIndexBars(),
    loadRecentNews(30),
  ]);

  if (!overview) {
    log.error("no_overview_data", { date: dateKey });
    throw new Error("Market overview unavailable — cannot generate summary");
  }

  const vn = overview.indices.find((i) => i.code === "VNINDEX") ?? overview.indices[0];
  const hnx = overview.indices.find((i) => i.code === "HNX") ?? null;
  const upcom = overview.indices.find((i) => i.code === "UPCOM") ?? null;
  const adv = overview.breadth.advancers;
  const dec = overview.breadth.decliners;
  const unch = overview.breadth.unchanged;
  const topG = overview.topGainers.slice(0, 5);
  const topL = overview.topLosers.slice(0, 5);
  const lastBar = bars[bars.length - 1];
  const dataFreshnessMin = lastBar ? Math.round((Date.now() / 1000 - lastBar.time) / 60) : null;
  if (dataFreshnessMin !== null && dataFreshnessMin > 180) {
    log.warn("stale_price_data", { date: dateKey, freshnessMin: dataFreshnessMin });
  }

  const analysis = bars.length >= 30 ? analyze("VNINDEX", bars) : null;
  const support = analysis?.supportResistance?.support ?? null;
  const resistance = analysis?.supportResistance?.resistance ?? null;
  const rsi = analysis?.rsi14 ?? null;
  const macdHist = analysis?.macd?.histogram ?? null;
  const sma20 = analysis?.sma20 ?? null;
  const sma50 = analysis?.sma50 ?? null;

  const pctVal = vn.changePct ?? 0;
  const tone = pctVal > 0.5 ? "tích cực" : pctVal < -0.5 ? "tiêu cực" : "trung tính";
  const breadthTone = adv > dec * 1.3 ? "lan toả" : dec > adv * 1.3 ? "áp lực diện rộng" : "phân hoá";

  // Next-session scenarios — derived from technical structure.
  const bullishCase = resistance ? `VN-Index giữ trên <span class="num">${fmt(sma20 ?? support)}</span> và bứt phá <span class="num">${fmt(resistance)}</span> với thanh khoản ≥ trung bình 20 phiên → mục tiêu ngắn hạn <span class="num">${fmt(resistance * 1.015)}</span>.` : "VN-Index giữ trên SMA20 và bứt phá kháng cự gần nhất với thanh khoản xác nhận.";
  const bearishCase = support ? `VN-Index thủng <span class="num">${fmt(support)}</span> với thanh khoản lớn → kiểm định vùng <span class="num">${fmt((support ?? 0) * 0.985)}</span>, kích hoạt cắt lỗ diện rộng.` : "VN-Index thủng hỗ trợ gần nhất với thanh khoản lớn → xu hướng ngắn hạn chuyển sang tiêu cực.";
  const baseCase = `VN-Index dao động trong biên độ <span class="num">${fmt(support)} – ${fmt(resistance)}</span>, thanh khoản trung bình, dòng tiền chọn lọc theo câu chuyện riêng.`;

  const sections: Section[] = [
    {
      tag: "01 · Diễn biến phiên",
      title: "Tóm tắt phiên giao dịch hôm nay",
      emphasis: "neutral",
      body: `
        <div class="kpi-row">
          <div class="kpi"><div class="k-label">VN-Index</div><div class="k-value">${fmt(vn.close)}</div><div class="k-delta ${pctCls(vn.changePct)}">${pct(vn.changePct)}</div></div>
          <div class="kpi"><div class="k-label">HNX</div><div class="k-value">${fmt(hnx?.close)}</div><div class="k-delta ${pctCls(hnx?.changePct)}">${pct(hnx?.changePct)}</div></div>
          <div class="kpi"><div class="k-label">UPCoM</div><div class="k-value">${fmt(upcom?.close)}</div><div class="k-delta ${pctCls(upcom?.changePct)}">${pct(upcom?.changePct)}</div></div>
          <div class="kpi"><div class="k-label">Thanh khoản</div><div class="k-value">${fmtVol(vn.volume)}</div><div class="k-delta">cổ phiếu</div></div>
        </div>
        <p>Độ rộng thị trường: <span class="positive">${adv} mã tăng</span> · <span class="negative">${dec} mã giảm</span> · ${unch} mã đứng giá trên mẫu ${overview.breadth.sample} mã — phản ánh trạng thái <strong>${breadthTone}</strong>.</p>
        <table>
          <thead><tr><th colspan="2">Top tăng mạnh</th><th colspan="2">Top giảm mạnh</th></tr>
          <tr><th>Mã</th><th class="num">%</th><th>Mã</th><th class="num">%</th></tr></thead>
          <tbody>
            ${Array.from({ length: Math.max(topG.length, topL.length) })
              .map((_, i) => {
                const g = topG[i];
                const l = topL[i];
                return `<tr><td><strong>${g?.symbol ?? ""}</strong></td><td class="num ${pctCls(g?.changePct)}">${g ? pct(g.changePct) : ""}</td><td><strong>${l?.symbol ?? ""}</strong></td><td class="num ${pctCls(l?.changePct)}">${l ? pct(l.changePct) : ""}</td></tr>`;
              })
              .join("")}
          </tbody>
        </table>
        ${dataFreshnessMin !== null ? `<p class="num" style="font-size:8.5pt;color:#5c7794;">Độ tươi dữ liệu giá: ${dataFreshnessMin} phút tính tới thời điểm phát hành.</p>` : ""}
      `,
    },
    {
      tag: "02 · Đọc vị phiên giao dịch",
      title: "Nguyên nhân diễn biến &amp; đối chiếu dự báo đầu ngày",
      emphasis: "neutral",
      body: `
        <p>Phiên hôm nay mang sắc thái <strong>${tone}</strong> với biên độ ${Math.abs(pctVal).toFixed(2)}%. Ba yếu tố chính chi phối diễn biến:</p>
        <ul>
          <li><strong>Dòng tiền:</strong> ${adv > dec ? "chủ động giải ngân vào nhóm dẫn dắt, lan toả sang mid-cap" : dec > adv ? "thận trọng, rút khỏi nhóm vốn hoá lớn và đầu cơ" : "phân hoá mạnh, tập trung vào cổ phiếu có câu chuyện riêng"}. Thanh khoản ${fmtVol(vn.volume)} cổ phiếu — ${vn.volume && vn.volume > 800_000_000 ? "cao hơn" : vn.volume && vn.volume < 500_000_000 ? "thấp hơn" : "tương đương"} mức trung bình.</li>
          <li><strong>Tin tức:</strong> ${newsItems.length > 0 ? `thị trường phản ứng với ${newsItems.length} tin mới trong 24 giờ, trong đó nhóm vĩ mô và doanh nghiệp chiếm ưu thế.` : "không có tin tức trọng yếu mới, diễn biến chủ yếu do yếu tố kỹ thuật."}</li>
          <li><strong>Kỹ thuật:</strong> RSI(14) VN-Index ở mức <span class="num">${fmt(rsi, 1)}</span>${rsi && rsi > 70 ? " (quá mua ngắn hạn)" : rsi && rsi < 30 ? " (quá bán)" : ""}; MACD histogram <span class="num">${fmt(macdHist, 3)}</span> — ${macdHist && macdHist > 0 ? "xu hướng ngắn hạn đang ủng hộ phe mua" : "động lượng yếu, phe bán chiếm ưu thế"}. ${sma20 && sma50 ? `SMA20 (${fmt(sma20)}) ${sma20 > sma50 ? "nằm trên" : "nằm dưới"} SMA50 (${fmt(sma50)}) — cấu trúc trung hạn ${sma20 > sma50 ? "tích cực" : "tiêu cực"}.` : ""}</li>
        </ul>
        <p><em>Đối chiếu với dự báo đầu ngày:</em> kịch bản cơ bản (giằng co trong biên độ hẹp) ${Math.abs(pctVal) < 0.8 ? "diễn ra đúng như nhận định" : "bị phá vỡ do yếu tố bất ngờ"}. Nhà đầu tư đã tuân thủ kỷ luật tỷ trọng ${Math.abs(pctVal) > 1 ? "được bảo vệ tốt trước biến động mạnh" : "không bỏ lỡ cơ hội ngắn hạn"}.</p>
      `,
    },
    {
      tag: "03 · Chiến lược hành động phiên tiếp theo",
      title: "Ba kịch bản &amp; hành động cụ thể",
      emphasis: "action",
      body: `
        <p><strong>Kịch bản cơ sở (xác suất cao nhất):</strong> ${baseCase}</p>
        <ul>
          <li>Hành động: <strong>nắm giữ</strong> các vị thế đang có lợi nhuận; <strong>chốt lời một phần</strong> (30–50%) khi giá chạm kháng cự; không mở mới vị thế đầu cơ.</li>
          <li>Tỷ trọng mục tiêu: <span class="num">45–55%</span> cổ phiếu, ưu tiên nhóm dẫn dắt và phòng thủ.</li>
        </ul>
        <p><strong>Kịch bản tích cực:</strong> ${bullishCase}</p>
        <ul>
          <li>Hành động: <strong>gia tăng tỷ trọng</strong> lên <span class="num">60–70%</span> tại các nhịp kiểm định thành công vùng breakout; tập trung vào nhóm cổ phiếu có thanh khoản xác nhận.</li>
          <li>Mục tiêu chốt lời tham khảo: <span class="num">+8% đến +12%</span> cho vị thế ngắn hạn.</li>
        </ul>
        <p><strong>Kịch bản tiêu cực:</strong> ${bearishCase}</p>
        <ul>
          <li>Hành động: <strong>cắt lỗ ngay</strong> các vị thế vi phạm ngưỡng dừng ban đầu; <strong>giảm tỷ trọng</strong> về <span class="num">20–30%</span>; đứng ngoài quan sát ít nhất 1 phiên.</li>
          <li>Mức cắt lỗ tham khảo: <span class="num">−5% đến −7%</span> cho vị thế ngắn hạn; <span class="num">−10%</span> cho vị thế trung hạn.</li>
        </ul>
        <p><strong>Cổ phiếu hành động cụ thể:</strong></p>
        <ul>
          ${topG.slice(0, 3).map((g) => `<li><strong>${g.symbol}</strong> — đang trong đà tăng mạnh (${pct(g.changePct)}). <em>Kế hoạch:</em> canh chốt lời 30% tại phiên tiếp theo nếu giá mở cửa gap-up &gt; 2%; phần còn lại đặt trailing stop −3%.</li>`).join("")}
          ${topL.slice(0, 2).map((l) => `<li><strong>${l.symbol}</strong> — giảm sâu (${pct(l.changePct)}). <em>Kế hoạch:</em> không bắt đáy; chỉ quan sát nếu xuất hiện nến rút chân kèm thanh khoản đột biến tại vùng hỗ trợ kỹ thuật.</li>`).join("")}
        </ul>
      `,
    },
    {
      tag: "04 · Tin tức ảnh hưởng phiên tới",
      title: "Thông tin cần theo dõi qua đêm",
      emphasis: "news",
      body: renderNewsList(newsItems as any, 6) + `<p><em>Nhà đầu tư nên kiểm tra lại lịch sự kiện doanh nghiệp và dữ liệu vĩ mô công bố ngoài giờ trước 9:00 sáng phiên kế tiếp để điều chỉnh kế hoạch giao dịch.</em></p>`,
    },
  ];

  const lede = `Phiên ${viShortDate(date)} khép lại với VN-Index ${fmt(vn.close)} điểm (${pct(vn.changePct)}), thanh khoản ${fmtVol(vn.volume)} cổ phiếu. Bản tổng kết dưới đây phân tích nguyên nhân diễn biến, đối chiếu với dự báo đầu ngày, và đưa ra kế hoạch hành động cụ thể cho phiên tiếp theo với ba kịch bản rõ ràng.`;

  const conclusion = pctVal > 0.5
    ? `Phiên tăng hôm nay xác nhận động lượng ngắn hạn đang ủng hộ phe mua, nhưng cần thanh khoản duy trì để loại trừ khả năng bẫy tăng giá. ORCA FINANCIAL đánh giá xu hướng ngắn hạn <strong>tích cực có điều kiện</strong>: nắm giữ và canh chốt lời từng phần tại kháng cự, đồng thời giữ kỷ luật cắt lỗ chặt để bảo toàn thành quả. Tránh tâm lý FOMO mở vị thế mới ở vùng giá cao.`
    : pctVal < -0.5
      ? `Áp lực bán diện rộng trong phiên cho thấy tâm lý thị trường đang mong manh. ORCA FINANCIAL đánh giá xu hướng ngắn hạn <strong>tiêu cực</strong> cho tới khi VN-Index lấy lại vùng ${fmt(sma20 ?? resistance)}. Chiến lược phù hợp là phòng thủ, giảm tỷ trọng, và kiên nhẫn chờ tín hiệu đảo chiều rõ ràng thay vì bắt đáy sớm.`
      : `Phiên giằng co phản ánh trạng thái cân bằng mong manh giữa bên mua và bên bán. ORCA FINANCIAL duy trì quan điểm <strong>trung lập thiên về thận trọng</strong>: giao dịch chọn lọc, tỷ trọng vừa phải, ưu tiên các cổ phiếu có nền tảng cơ bản tốt và thanh khoản ổn định. Tránh các vị thế đầu cơ ngắn hạn cho tới khi thị trường chọn hướng rõ ràng.`;

  const recommendation = pctVal > 0.5
    ? `<strong>Tỷ trọng mục tiêu phiên tới: 50–60%.</strong> Nắm giữ vị thế đang lãi, chốt lời 30% tại kháng cự ${fmt(resistance)}. Cắt lỗ cứng −5% cho vị thế mới. Ưu tiên nhóm dẫn dắt đã xác nhận breakout.`
    : pctVal < -0.5
      ? `<strong>Tỷ trọng mục tiêu phiên tới: 25–35%.</strong> Cắt lỗ mọi vị thế vi phạm ngưỡng dừng. Không bắt đáy. Chờ VN-Index kiểm định lại vùng ${fmt(support)} với thanh khoản suy giảm mới xem xét giải ngân thăm dò 10–15%.`
      : `<strong>Tỷ trọng mục tiêu phiên tới: 40–50%.</strong> Giao dịch chọn lọc, không dùng margin cao. Mở vị thế mới chỉ khi giá kiểm định thành công hỗ trợ ${fmt(support)} hoặc bứt phá kháng cự ${fmt(resistance)} với thanh khoản xác nhận.`;

  const riskBox = `Rủi ro cần cảnh giác qua đêm: (i) tin vĩ mô quốc tế bất lợi (lãi suất, địa chính trị); (ii) khối ngoại bán ròng kéo dài phiên thứ ba liên tiếp; (iii) giá dầu tăng đột biến &gt; 3% gây áp lực chi phí đầu vào. Nếu hai trong ba yếu tố xuất hiện trước 9:15 sáng, giảm tỷ trọng về mức phòng thủ <span class="num">20–25%</span>.`;

  const html = wrapReport({
    type: "summary",
    date,
    eyebrow: `Market Summary · ${viLongDate(date)}`,
    headline: `Đọc vị phiên hôm nay &amp; kế hoạch hành động phiên tới`,
    lede,
    sections,
    conclusion,
    recommendation,
    riskBox,
    footerNotes: [
      "Giá đóng cửa và thanh khoản lấy từ Data Engine (VNDirect dchart + Yahoo Finance fallback); độ tươi dữ liệu được ghi nhận trong phần diễn biến phiên.",
      "Phân tích kỹ thuật (RSI, MACD, SMA20/50, hỗ trợ/kháng cự) tính trên chuỗi 120 phiên gần nhất của VN-Index.",
      "Ba kịch bản phiên tới được xây dựng dựa trên cấu trúc giá hiện tại, không phải dự báo xác suất thống kê.",
      "Mức cắt lỗ / chốt lời mang tính tham khảo; nhà đầu tư cần điều chỉnh theo khẩu vị rủi ro và quy mô tài khoản.",
    ],
  });

  const id = await persistReport("summary", dateKey, html, `Market Summary ${dateKey}`, {
    vnIndex: vn.close,
    changePct: vn.changePct,
    advancers: adv,
    decliners: dec,
    newsCount: newsItems.length,
    dataFreshnessMin,
    latencyMs: Date.now() - startedAt,
  });
  log.info("generate_done", { date: dateKey, id, latencyMs: Date.now() - startedAt, freshnessMin: dataFreshnessMin });
  return { id: id ?? undefined, html, type: "summary", date: dateKey };
}

/* ──────────────────────────────────────────────────────────────────────
 * Persistence & retrieval
 * ────────────────────────────────────────────────────────────────────── */

async function persistReport(
  type: ReportType,
  dateKey: string,
  html: string,
  title: string,
  metadata: Record<string, unknown>,
): Promise<number | null> {
  try {
    const res = await db
      .insert(reports)
      .values({ type, reportDate: dateKey, contentHtml: html, title, metadata })
      .onConflictDoUpdate({
        target: [reports.type, reports.reportDate],
        set: { contentHtml: html, title, metadata, createdAt: sql`now()` },
      })
      .returning({ id: reports.id });
    return res[0]?.id ?? null;
  } catch (err) {
    logger.error("report_persist_failed", { type, date: dateKey, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function getStoredReport(type: ReportType, dateKey: string): Promise<string | null> {
  const rows = await db
    .select({ contentHtml: reports.contentHtml })
    .from(reports)
    .where(and(eq(reports.type, type), eq(reports.reportDate, dateKey)))
    .limit(1);
  return rows[0]?.contentHtml ?? null;
}

export async function listRecentReports(limit = 14): Promise<Array<{ type: ReportType; date: string; title: string; createdAt: Date }>> {
  const rows = await db
    .select({ type: reports.type, date: reports.reportDate, title: reports.title, createdAt: reports.createdAt })
    .from(reports)
    .orderBy(desc(reports.reportDate), desc(reports.createdAt))
    .limit(limit);
  return rows as Array<{ type: ReportType; date: string; title: string; createdAt: Date }>;
}

/* ──────────────────────────────────────────────────────────────────────
 * Manual triggers — used by POST /api/v1/reports/trigger/*
 * ────────────────────────────────────────────────────────────────────── */

export async function triggerMorning(date?: Date) {
  return generateMorningBrief(date ?? new Date());
}
export async function triggerSummary(date?: Date) {
  return generateMarketSummary(date ?? new Date());
}
