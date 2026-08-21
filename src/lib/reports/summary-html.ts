/**
 * Market Summary HTML template
 */
import type { NewsBullet, ScenarioItem } from "./llm-narrative";

const VN_TZ = "Asia/Ho_Chi_Minh";
const VI_WEEKDAYS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

function vnParts(d: Date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: VN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const map = Object.fromEntries(
    fmt.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const wd: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: Number(map.year),
    m: Number(map.month),
    d: Number(map.day),
    hh: Number(map.hour === "24" ? "0" : map.hour),
    mm: Number(map.minute),
    weekday: wd[map.weekday] ?? 0,
  };
}

function viLongDate(d: Date): string {
  const p = vnParts(d);
  return `${VI_WEEKDAYS[p.weekday]}, ngày ${String(p.d).padStart(2, "0")}/${String(p.m).padStart(2, "0")}/${p.y}`;
}

function escapeHtml(s: string): string {
  const amp = String.fromCharCode(38);
  return s
    .split(amp)
    .join(amp + "amp;")
    .split("<")
    .join(amp + "lt;")
    .split(">")
    .join(amp + "gt;")
    .split('"')
    .join(amp + "quot;")
    .split("'")
    .join(amp + "#39;");
}

function newsBulletHtml(items: NewsBullet[]): string {
  if (!items.length) return "<p><em>Chưa có tin phù hợp trong nhóm này.</em></p>";
  return (
    "<ul>" +
    items
      .map((n) => {
        const meta = [n.source, n.time].filter(Boolean).join(", ");
        const titleHtml = n.link
          ? '<a href="' +
            escapeHtml(n.link) +
            '" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(n.title) +
            "</a>"
          : "<strong>" + escapeHtml(n.title) + "</strong>";
        return "<li>" + titleHtml + (meta ? " — " + escapeHtml(meta) : "") + "</li>";
      })
      .join("") +
    "</ul>"
  );
}

function bulletsHtml(items: string[]): string {
  if (!items.length) return "";
  return "<ul>" + items.map((t) => "<li>" + escapeHtml(t) + "</li>").join("") + "</ul>";
}

function scenariosHtml(items: ScenarioItem[]): string {
  if (!items.length) return "";
  return (
    '<div class="scenarios">' +
    items
      .map((s, i) => {
        const n = String(i + 1).padStart(2, "0");
        return (
          '<div class="sc-card">' +
          '<div class="sc-name">' +
          escapeHtml(n + " · " + s.name) +
          "</div>" +
          "<p><strong>Điều kiện:</strong> " +
          escapeHtml(s.condition) +
          "</p>" +
          "<p><strong>Hành động:</strong> " +
          escapeHtml(s.action) +
          "</p>" +
          "</div>"
        );
      })
      .join("") +
    "</div>"
  );
}

export function renderSummaryHtml(opts: {
  date: Date;
  headline: string;
  lede: string;
  marketIntro: string;
  marketNews: NewsBullet[];
  sessionAnalysis: string;
  scenarios: ScenarioItem[];
  risks: string[];
  riskWarning: string;
  sessionOverview: string;
  recommendation: string;
  llmMeta?: string;
}): string {
  const p = vnParts(opts.date);
  const band =
    "MARKET SUMMARY · " +
    VI_WEEKDAYS[p.weekday].toUpperCase() +
    ", NGÀY " +
    String(p.d).padStart(2, "0") +
    "/" +
    String(p.m).padStart(2, "0") +
    "/" +
    p.y;
  const time =
    String(p.hh).padStart(2, "0") + ":" + String(p.mm).padStart(2, "0") + " ICT";

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<title>ORCA FINANCIAL — ${escapeHtml(opts.headline)}</title>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap&subset=vietnamese,latin" rel="stylesheet" />
<style>
  :root {
    --navy: #0A2540;
    --sky: #0ea5e9;
    --muted: #5c7794;
    --line: #cfdcec;
    --lede-bg: #eef6fc;
    --warn-border: #f59e0b;
    --warn-bg: #fffbeb;
    --sc-bg: #f8fafc;
  }
  * { box-sizing: border-box; }
  body {
    font-family: "Be Vietnam Pro", system-ui, sans-serif;
    color: #0b1e33;
    line-height: 1.55;
    max-width: 820px;
    margin: 0 auto;
    padding: 28px 36px 40px;
    font-size: 11pt;
  }
  .brand-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 6px; }
  .brand { font-size: 9pt; letter-spacing: 0.04em; color: var(--sky); font-weight: 600; }
  .brand::before { content: "●"; margin-right: 6px; color: var(--sky); }
  h1 { font-size: 20pt; line-height: 1.25; margin: 4px 0 0; color: var(--navy); font-weight: 800; }
  .side-meta { text-align: right; font-size: 9pt; color: var(--muted); white-space: nowrap; }
  .band { margin: 14px 0 10px; font-size: 8.5pt; letter-spacing: 0.12em; color: var(--sky); font-weight: 600; text-transform: uppercase; }
  .lede { background: var(--lede-bg); border-left: 3px solid var(--sky); padding: 10px 14px; margin: 0 0 20px; font-size: 10.5pt; color: #1e3a5f; }
  .sec { margin-top: 22px; }
  .sec-num { font-size: 9pt; letter-spacing: 0.14em; color: var(--sky); font-weight: 700; text-transform: uppercase; margin-bottom: 2px; }
  .sec-title { font-size: 13.5pt; color: var(--navy); font-weight: 700; margin: 0 0 8px; }
  p { margin: 6px 0 10px; }
  ul { margin: 6px 0 12px; padding-left: 18px; }
  li { margin: 5px 0; }
  a { color: #0369a1; text-decoration: underline; text-underline-offset: 2px; }
  a:hover { color: #0A2540; }
  .scenarios { display: flex; flex-direction: column; gap: 10px; margin: 10px 0 14px; }
  .sc-card { background: var(--sc-bg); border: 1px solid var(--line); border-left: 4px solid var(--sky); padding: 12px 14px; }
  .sc-name { font-size: 9pt; letter-spacing: 0.1em; font-weight: 700; color: var(--navy); text-transform: uppercase; margin-bottom: 6px; }
  .sc-card p { margin: 4px 0; font-size: 10.5pt; }
  .box-warn { margin-top: 16px; border-left: 4px solid var(--warn-border); background: var(--warn-bg); padding: 12px 14px; }
  .box-warn .label { font-size: 9pt; letter-spacing: 0.1em; font-weight: 700; color: #b45309; margin-bottom: 4px; }
  .box-overview {
    margin-top: 20px;
    border: 2px solid var(--navy);
    background: linear-gradient(180deg, #f0f6fb 0%, #fff 100%);
    padding: 16px 18px;
  }
  .box-overview .label {
    font-size: 10pt;
    letter-spacing: 0.12em;
    font-weight: 800;
    color: var(--navy);
    margin-bottom: 8px;
  }
  .box-rec { margin-top: 14px; background: var(--navy); color: #fff; padding: 14px 16px; border-radius: 2px; }
  .box-rec .label { font-size: 9pt; letter-spacing: 0.12em; font-weight: 700; margin-bottom: 6px; opacity: 0.9; }
  .notes { margin-top: 22px; font-size: 8.5pt; color: var(--muted); }
  .notes ol { padding-left: 18px; margin: 6px 0; }
  .notes li { margin: 4px 0; }
  .foot { margin-top: 16px; padding-top: 10px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; font-size: 8.5pt; color: var(--muted); }
  .llm-tag { font-size: 8pt; color: var(--muted); margin-top: 4px; }
  @media print { body { padding: 12px 20px; } }
</style>
</head>
<body>
  <div class="brand-row">
    <div>
      <div class="brand">ORCA FINANCIAL · INTELLIGENT INVESTMENT</div>
      <h1>${escapeHtml(opts.headline)}</h1>
    </div>
    <div class="side-meta">
      Market Summary<br/>Tổng kết cuối phiên<br/>
      ${escapeHtml(viLongDate(opts.date))}<br/>
      Phát hành: ${time}
    </div>
  </div>
  <div class="band">${escapeHtml(band)}</div>
  <div class="lede">${escapeHtml(opts.lede)}</div>
  ${opts.llmMeta ? `<div class="llm-tag">Phân tích hỗ trợ bởi LLM · ${escapeHtml(opts.llmMeta)}</div>` : ""}

  <div class="sec">
    <div class="sec-num">01 · Diễn biến phiên</div>
    <div class="sec-title">Số liệu & dòng chảy trong ngày</div>
    ${opts.marketIntro ? `<p>${escapeHtml(opts.marketIntro)}</p>` : ""}
  </div>

  <div class="sec">
    <div class="sec-num">02 · Tin đáng chú ý</div>
    <div class="sec-title">Thông tin liên quan phiên giao dịch</div>
    ${newsBulletHtml(opts.marketNews)}
  </div>

  <div class="sec">
    <div class="sec-num">03 · Nhận định chi tiết</div>
    <div class="sec-title">Phân tích dữ liệu phiên</div>
    ${opts.sessionAnalysis ? `<p>${escapeHtml(opts.sessionAnalysis)}</p>` : "<p><em>Chưa đủ dữ liệu để nhận định chi tiết.</em></p>"}
  </div>

  <div class="sec">
    <div class="sec-num">04 · Ba kịch bản phiên tới</div>
    <div class="sec-title">Cơ sở · Tích cực · Tiêu cực</div>
    ${scenariosHtml(opts.scenarios)}
  </div>

  <div class="sec">
    <div class="sec-num">05 · Rủi ro cần lưu ý</div>
    <div class="sec-title">Yếu tố có thể đảo chiều kỳ vọng</div>
    ${bulletsHtml(opts.risks)}
  </div>

  ${
    opts.riskWarning
      ? `<div class="box-warn"><div class="label">CẢNH BÁO RỦI RO</div><div>${escapeHtml(opts.riskWarning)}</div></div>`
      : ""
  }

  <div class="box-overview">
    <div class="label">ĐÁNH GIÁ TỔNG QUAN TOÀN PHIÊN</div>
    <div>${escapeHtml(opts.sessionOverview || "—")}</div>
  </div>

  ${
    opts.recommendation
      ? `<div class="box-rec"><div class="label">KHUYẾN NGHỊ HÀNH ĐỘNG</div><div>${escapeHtml(opts.recommendation)}</div></div>`
      : ""
  }

  <div class="notes">
    <ol>
      <li>Dữ liệu thô từ Data Engine (VNDirect, Yahoo Finance, RSS); LLM lọc, chuẩn hóa và nhận định.</li>
      <li>Ba kịch bản mang tính khung thao tác, không phải lời khuyên đầu tư cá nhân.</li>
      <li>Nhà đầu tư tự chịu trách nhiệm với quyết định giao dịch của mình.</li>
    </ol>
  </div>
  <div class="foot">
    <span>ORCA FINANCIAL · Research Engine v2</span>
    <span>Market Summary · Không phải lời khuyên đầu tư</span>
  </div>
</body>
</html>`;
}
