/**
 * ORCA Report Generator — resilient v3
 */
import type { Ohlcv } from "@/lib/connectors/core";
import { getMarketOverview, getHistory, getNews } from "@/lib/market";
import { analyze } from "@/lib/analysis";
import { forProvider } from "@/lib/logger";
import {
  getStoredReport as storeGet,
  listRecentReports as storeList,
  persistReport as storePersist,
} from "./store";

export type ReportType = "morning" | "summary";

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

const VI_WEEKDAYS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
function viLongDate(d: Date): string {
  const p = vnParts(d);
  return `${VI_WEEKDAYS[p.weekday]}, ngày ${String(p.d).padStart(2, "0")}/${String(p.m).padStart(2, "0")}/${p.y}`;
}
function viShortDate(d: Date): string {
  const p = vnParts(d);
  return `${String(p.d).padStart(2, "0")}/${String(p.m).padStart(2, "0")}/${p.y}`;
}
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

const HTML_ESC: Record<string, string> = {
  "\u0026": "\u0026amp;",
  "\u003c": "\u003clt;".replace("lt;", "lt;"),
  "\u003e": "\u003egt;".replace("gt;", "gt;"),
};

function escapeHtml(s: string): string {
  return s
    .replace(/\u0026/g, "\u0026amp;")
    .replace(/\u003c/g, "\u003clt;".replace("lt;", "lt;"))
    .replace(/\u003e/g, "\u003egt;".replace("gt;", "gt;"))
    .replace(/"/g, "\u0026quot;")
    .replace(/'/g, "\u0026#39;");
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

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
  } catch {
    return [];
  }
}

function wrapHtml(opts: {
  type: ReportType;
  date: Date;
  headline: string;
  lede: string;
  body: string;
  conclusion: string;
  recommendation: string;
}): string {
  const p = vnParts(opts.date);
  const typeLabel =
    opts.type === "morning"
      ? "Morning Brief · Bản tin đầu ngày"
      : "Market Summary · Nhận định cuối phiên";
  const accent = opts.type === "morning" ? "#0ea5e9" : "#0A2540";
  return `
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<title>ORCA FINANCIAL — ${opts.headline}</title>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700;800&display=swap&subset=vietnamese,latin" rel="stylesheet" />
<style>
  body{font-family:"Be Vietnam Pro",system-ui,sans-serif;color:#0b1e33;line-height:1.55;max-width:820px;margin:0 auto;padding:28px 32px;font-size:11.5pt}
  h1{font-size:22pt;margin:0 0 8px;color:#0A2540}
  .meta{color:#5c7794;font-size:9pt;margin-bottom:16px}
  .lede{border-left:3px solid ${accent};padding:8px 12px;background:#f0f7fc;font-style:italic;margin-bottom:18px}
  h2{font-size:13pt;border-bottom:1px solid #cfdcec;padding-bottom:4px;color:#0A2540}
  ul{margin:6px 0 12px 18px} li{margin:4px 0}
  .conclusion{background:#f0f6fb;border-left:4px solid ${accent};padding:12px 16px;margin-top:18px}
  .rec{background:#0A2540;color:#fff;padding:12px 16px;border-radius:4px;margin-top:10px}
  .foot{margin-top:20px;font-size:8pt;color:#5c7794;border-top:1px solid #cfdcec;padding-top:8px}
  @media print{body{padding:0}}
</style>
</head>
<body>
  <div class="meta">ORCA FINANCIAL · ${typeLabel}<br/>${viLongDate(opts.date)} · Phát hành ${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")} ICT</div>
  <h1>${opts.headline}</h1>
  <div class="lede">${opts.lede}</div>
  ${opts.body}
  <div class="conclusion"><strong>Kết luận:</strong> ${opts.conclusion}</div>
  <div class="rec"><strong>Khuyến nghị chiến lược</strong><br/>${opts.recommendation}</div>
  <div class="foot">ORCA FINANCIAL · Research Engine · Báo cáo tự động · Không phải lời khuyên đầu tư</div>
</body>
</html>`;
}

function newsList(
  items: Array<{ title: string; link: string; sourceName: string }>,
  max = 6,
): string {
  if (!items.length) return "<p><em>Không có tin mới tại thời điểm phát hành.</em></p>";
  return (
    "<ul>" +
    items
      .slice(0, max)
      .map(
        (it) =>
          "<li><a href=\"" +
          it.link +
          "\" target=\"_blank\" rel=\"noreferrer\">" +
          escapeHtml(it.title) +
          "</a> — " +
          escapeHtml(it.sourceName) +
          "</li>",
      )
      .join("") +
    "</ul>"
  );
}

export async function generateMorningBrief(date: Date = new Date()) {
  const startedAt = Date.now();
  const dateKey = vnTodayKey(date);
  const log = forProvider("reports-morning");
  log.info("generate_start", { date: dateKey });

  const [overview, bars, newsItems] = await Promise.all([
    withTimeout(getMarketOverview().catch(() => null), 12_000, null),
    withTimeout(loadVnIndexBars(), 12_000, [] as Ohlcv[]),
    withTimeout(loadRecentNews(40), 10_000, [] as Awaited<ReturnType<typeof loadRecentNews>>),
  ]);

  const vn =
    overview?.indices?.find((i) => i.code === "VNINDEX") ?? overview?.indices?.[0] ?? null;
  const analysis = bars.length >= 30 ? analyze("VNINDEX", bars) : null;
  const support = analysis?.supportResistance?.support ?? null;
  const resistance = analysis?.supportResistance?.resistance ?? null;
  const defensivePicks = ["VNM", "FPT", "VCB"];

  const body =
    "<h2>01 · Điểm tin</h2>" +
    newsList(newsItems as any, 8) +
    "<h2>02 · Thị trường tham chiếu</h2>" +
    "<p>VN-Index: <strong>" +
    fmt(vn?.close) +
    "</strong> (" +
    pct(vn?.changePct) +
    "), thanh khoản " +
    fmtVol(vn?.volume) +
    ".</p>" +
    (support
      ? "<p>Hỗ trợ gần: " + fmt(support) + ". Kháng cự: " + fmt(resistance) + ".</p>"
      : "") +
    "<h2>03 · Chiến lược thận trọng</h2>" +
    "<ul>" +
    "<li>Tỷ trọng cổ phiếu khuyến nghị: <strong>30–45%</strong>.</li>" +
    "<li>Danh mục phòng thủ: " +
    defensivePicks.join(", ") +
    ".</li>" +
    "<li>Cắt lỗ cứng −5% đến −7% cho vị thế ngắn hạn.</li>" +
    "<li>Không mua đuổi, không dùng margin cao.</li>" +
    "</ul>";

  const html = wrapHtml({
    type: "morning",
    date,
    headline: "Điểm tin đầu ngày & chiến lược thận trọng",
    lede:
      "Bản tin đầu ngày " +
      viShortDate(date) +
      " tổng hợp tin và chiến lược giao dịch thận trọng, ưu tiên bảo toàn vốn.",
    body,
    conclusion:
      "Phiên hôm nay nghiêng về kịch bản giằng co trong biên độ hẹp. Ưu tiên quan sát và chọn lọc, hạn chế mở vị thế đầu cơ.",
    recommendation:
      "Giữ tỷ trọng 30–45%. Ưu tiên " +
      defensivePicks.join(", ") +
      ". Cắt lỗ −5% đến −7%.",
  });

  const saved = await storePersist("morning", dateKey, html, `Morning Brief ${dateKey}`, {
    vnIndex: vn?.close ?? null,
    changePct: vn?.changePct ?? null,
    newsCount: newsItems.length,
    latencyMs: Date.now() - startedAt,
  });
  log.info("generate_done", {
    date: dateKey,
    id: saved.id,
    persisted: saved.persisted,
    latencyMs: Date.now() - startedAt,
  });
  return {
    id: saved.id ?? undefined,
    html,
    type: "morning" as const,
    date: dateKey,
    persisted: saved.persisted,
  };
}

export async function generateMarketSummary(date: Date = new Date()) {
  const startedAt = Date.now();
  const dateKey = vnTodayKey(date);
  const log = forProvider("reports-summary");
  log.info("generate_start", { date: dateKey });

  const [overview, bars, newsItems] = await Promise.all([
    withTimeout(getMarketOverview().catch(() => null), 12_000, null),
    withTimeout(loadVnIndexBars(), 12_000, [] as Ohlcv[]),
    withTimeout(loadRecentNews(30), 10_000, [] as Awaited<ReturnType<typeof loadRecentNews>>),
  ]);

  if (!overview) log.warn("no_overview_data_using_fallback", { date: dateKey });

  const emptyIdx = {
    close: null as number | null,
    changePct: null as number | null,
    volume: null as number | null,
  };
  const vn =
    overview?.indices?.find((i) => i.code === "VNINDEX") ?? overview?.indices?.[0] ?? emptyIdx;
  const hnx = overview?.indices?.find((i) => i.code === "HNX") ?? null;
  const adv = overview?.breadth?.advancers ?? 0;
  const dec = overview?.breadth?.decliners ?? 0;
  const topG = (overview?.topGainers ?? []).slice(0, 5);
  const topL = (overview?.topLosers ?? []).slice(0, 5);
  const analysis = bars.length >= 30 ? analyze("VNINDEX", bars) : null;
  const support = analysis?.supportResistance?.support ?? null;
  const resistance = analysis?.supportResistance?.resistance ?? null;
  const pctVal = vn.changePct ?? 0;

  const body =
    "<h2>01 · Diễn biến phiên</h2>" +
    "<p>VN-Index <strong>" +
    fmt(vn.close) +
    "</strong> (" +
    pct(vn.changePct) +
    ") · HNX " +
    fmt(hnx?.close) +
    " (" +
    pct(hnx?.changePct) +
    ") · Thanh khoản " +
    fmtVol(vn.volume) +
    "</p>" +
    "<p>Độ rộng: " +
    adv +
    " tăng · " +
    dec +
    " giảm.</p>" +
    "<p>Top tăng: " +
    (topG.map((g) => g.symbol + " " + pct(g.changePct)).join(", ") || "—") +
    "</p>" +
    "<p>Top giảm: " +
    (topL.map((l) => l.symbol + " " + pct(l.changePct)).join(", ") || "—") +
    "</p>" +
    "<h2>02 · Ba kịch bản phiên tới</h2>" +
    "<ul>" +
    "<li><strong>Cơ sở:</strong> biên độ " +
    fmt(support) +
    " – " +
    fmt(resistance) +
    ", tỷ trọng 45–55%.</li>" +
    "<li><strong>Tích cực:</strong> breakout kháng cự kèm thanh khoản → tỷ trọng 60–70%.</li>" +
    "<li><strong>Tiêu cực:</strong> thủng hỗ trợ → cắt lỗ, giảm tỷ trọng 20–30%.</li>" +
    "</ul>" +
    "<h2>03 · Tin cần theo dõi</h2>" +
    newsList(newsItems as any, 6);

  const html = wrapHtml({
    type: "summary",
    date,
    headline: "Đọc vị phiên hôm nay & kế hoạch hành động phiên tới",
    lede:
      "Phiên " +
      viShortDate(date) +
      " khép lại với VN-Index " +
      fmt(vn.close) +
      " (" +
      pct(vn.changePct) +
      "). Bản tổng kết kèm ba kịch bản phiên tới.",
    body,
    conclusion:
      pctVal > 0.5
        ? "Xu hướng ngắn hạn tích cực có điều kiện — nắm giữ, chốt lời từng phần tại kháng cự."
        : pctVal < -0.5
          ? "Xu hướng ngắn hạn tiêu cực — phòng thủ, giảm tỷ trọng, chờ tín hiệu đảo chiều."
          : "Trung lập thiên thận trọng — giao dịch chọn lọc, tỷ trọng vừa phải.",
    recommendation:
      pctVal > 0.5
        ? "Tỷ trọng 50–60%. Chốt lời 30% tại " + fmt(resistance) + ". Cắt lỗ −5%."
        : pctVal < -0.5
          ? "Tỷ trọng 25–35%. Cắt lỗ vị thế vi phạm. Không bắt đáy. Hỗ trợ " + fmt(support) + "."
          : "Tỷ trọng 40–50%. Chỉ mở vị thế khi kiểm định " +
            fmt(support) +
            " hoặc breakout " +
            fmt(resistance) +
            ".",
  });

  const saved = await storePersist("summary", dateKey, html, `Market Summary ${dateKey}`, {
    vnIndex: vn.close,
    changePct: vn.changePct,
    advancers: adv,
    decliners: dec,
    newsCount: newsItems.length,
    latencyMs: Date.now() - startedAt,
  });
  log.info("generate_done", {
    date: dateKey,
    id: saved.id,
    persisted: saved.persisted,
    latencyMs: Date.now() - startedAt,
  });
  return {
    id: saved.id ?? undefined,
    html,
    type: "summary" as const,
    date: dateKey,
    persisted: saved.persisted,
  };
}

export async function getStoredReport(type: ReportType, dateKey: string) {
  return storeGet(type, dateKey);
}
export async function listRecentReports(limit = 14) {
  return storeList(limit);
}
export async function triggerMorning(date?: Date) {
  return generateMorningBrief(date ?? new Date());
}
export async function triggerSummary(date?: Date) {
  return generateMarketSummary(date ?? new Date());
}
