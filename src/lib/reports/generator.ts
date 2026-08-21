/**
 * ORCA Report Generator — resilient v4 (LLM-enhanced)
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
import {
  generateReportNarrative,
  type ReportLlmNarrative,
} from "./llm-narrative";

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
async function loadRecentNews(limit = 50) {
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
  llmMeta?: string;
}): string {
  const p = vnParts(opts.date);
  const typeLabel =
    opts.type === "morning"
      ? "Morning Brief · Bản tin đầu ngày"
      : "Market Summary · Nhận định cuối phiên";
  const accent = opts.type === "morning" ? "#0ea5e9" : "#0A2540";
  const llmNote = opts.llmMeta
    ? `<div class="meta" style="margin-top:4px">Phân tích hỗ trợ bởi LLM · ${escapeHtml(opts.llmMeta)}</div>`
    : "";
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
  h2{font-size:13pt;border-bottom:1px solid #cfdcec;padding-bottom:4px;color:#0A2540;margin-top:22px}
  p{margin:8px 0}
  ul{margin:6px 0 12px 18px} li{margin:5px 0}
  .conclusion{background:#f0f6fb;border-left:4px solid ${accent};padding:12px 16px;margin-top:18px}
  .rec{background:#0A2540;color:#fff;padding:12px 16px;border-radius:4px;margin-top:10px}
  .foot{margin-top:20px;font-size:8pt;color:#5c7794;border-top:1px solid #cfdcec;padding-top:8px}
  .para{white-space:pre-wrap}
  @media print{body{padding:0}}
</style>
</head>
<body>
  <div class="meta">ORCA FINANCIAL · ${typeLabel}<br/>${viLongDate(opts.date)} · Phát hành ${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")} ICT</div>
  ${llmNote}
  <h1>${escapeHtml(opts.headline)}</h1>
  <div class="lede">${escapeHtml(opts.lede)}</div>
  ${opts.body}
  <div class="conclusion"><strong>Kết luận:</strong> ${escapeHtml(opts.conclusion)}</div>
  <div class="rec"><strong>Khuyến nghị chiến lược</strong><br/>${escapeHtml(opts.recommendation)}</div>
  <div class="foot">ORCA FINANCIAL · Research Engine · Báo cáo tự động · Không phải lời khuyên đầu tư</div>
</body>
</html>`;
}

function newsListHtml(
  items: Array<{ title: string; link: string; sourceName: string }>,
  max = 12,
): string {
  if (!items.length) return "<p><em>Không có tin mới tại thời điểm phát hành.</em></p>";
  return (
    "<ul>" +
    items
      .slice(0, max)
      .map(
        (it) =>
          '<li><a href="' +
          it.link +
          '" target="_blank" rel="noreferrer">' +
          escapeHtml(it.title) +
          "</a> — " +
          escapeHtml(it.sourceName) +
          "</li>",
      )
      .join("") +
    "</ul>"
  );
}

function bulletsHtml(items: string[]): string {
  if (!items.length) return "";
  return "<ul>" + items.map((t) => "<li>" + escapeHtml(t) + "</li>").join("") + "</ul>";
}

function commentaryHtml(text: string): string {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paras.length) return "<p>" + escapeHtml(text) + "</p>";
  return paras.map((p) => "<p class=\"para\">" + escapeHtml(p) + "</p>").join("");
}

function buildContextPayload(opts: {
  kind: ReportType;
  dateKey: string;
  overview: Awaited<ReturnType<typeof getMarketOverview>> | null;
  bars: Ohlcv[];
  newsItems: Array<{ title: string; link: string; sourceName: string; publishedAt?: string }>;
  analysis: ReturnType<typeof analyze> | null;
}) {
  const emptyIdx = { close: null as number | null, changePct: null as number | null, volume: null as number | null };
  const vn =
    opts.overview?.indices?.find((i) => i.code === "VNINDEX") ??
    opts.overview?.indices?.[0] ??
    emptyIdx;
  const hnx = opts.overview?.indices?.find((i) => i.code === "HNX") ?? null;
  const upcom = opts.overview?.indices?.find((i) => i.code === "UPCOM") ?? null;

  return {
    kind: opts.kind,
    date: opts.dateKey,
    indices: {
      vnIndex: { close: vn.close, changePct: vn.changePct, volume: vn.volume },
      hnx: hnx ? { close: hnx.close, changePct: hnx.changePct, volume: hnx.volume } : null,
      upcom: upcom ? { close: upcom.close, changePct: upcom.changePct } : null,
    },
    breadth: opts.overview?.breadth ?? null,
    topGainers: (opts.overview?.topGainers ?? []).slice(0, 8).map((g) => ({
      symbol: g.symbol,
      changePct: g.changePct,
      close: (g as { close?: number }).close,
    })),
    topLosers: (opts.overview?.topLosers ?? []).slice(0, 8).map((l) => ({
      symbol: l.symbol,
      changePct: l.changePct,
      close: (l as { close?: number }).close,
    })),
    technical: opts.analysis
      ? {
          support: opts.analysis.supportResistance?.support ?? null,
          resistance: opts.analysis.supportResistance?.resistance ?? null,
          trend: (opts.analysis as { trend?: string }).trend ?? null,
          signal: (opts.analysis as { signal?: string }).signal ?? null,
        }
      : null,
    recentBars: opts.bars.slice(-8).map((b) => ({
      t: b.time,
      c: b.close,
      v: b.volume,
    })),
    news: opts.newsItems.slice(0, 25).map((n) => ({
      title: n.title,
      source: n.sourceName,
      publishedAt: n.publishedAt ?? null,
      link: n.link,
    })),
  };
}

export async function generateMorningBrief(date: Date = new Date()) {
  const startedAt = Date.now();
  const dateKey = vnTodayKey(date);
  const log = forProvider("reports-morning");
  log.info("generate_start", { date: dateKey });

  const [overview, bars, newsItems] = await Promise.all([
    withTimeout(getMarketOverview().catch(() => null), 14_000, null),
    withTimeout(loadVnIndexBars(), 14_000, [] as Ohlcv[]),
    withTimeout(loadRecentNews(50), 12_000, [] as Awaited<ReturnType<typeof loadRecentNews>>),
  ]);

  const vn =
    overview?.indices?.find((i) => i.code === "VNINDEX") ?? overview?.indices?.[0] ?? null;
  const analysis = bars.length >= 30 ? analyze("VNINDEX", bars) : null;
  const support = analysis?.supportResistance?.support ?? null;
  const resistance = analysis?.supportResistance?.resistance ?? null;
  const defensivePicks = ["VNM", "FPT", "VCB"];

  const context = buildContextPayload({
    kind: "morning",
    dateKey,
    overview,
    bars,
    newsItems: newsItems as any,
    analysis,
  });

  const narrative = await withTimeout(
    generateReportNarrative("morning", context),
    38_000,
    null as ReportLlmNarrative | null,
  );

  let body: string;
  let headline: string;
  let lede: string;
  let conclusion: string;
  let recommendation: string;
  let llmMeta: string | undefined;

  if (narrative) {
    llmMeta = [narrative.provider, narrative.model].filter(Boolean).join("/");
    headline = narrative.headline;
    lede = narrative.lede;
    conclusion = narrative.conclusion;
    recommendation = narrative.recommendation;
    body =
      "<h2>01 · Tin & sự kiện cần chú ý</h2>" +
      (narrative.newsInsights.length
        ? bulletsHtml(narrative.newsInsights)
        : newsListHtml(newsItems as any, 12)) +
      "<h2>02 · Nhận định trước phiên</h2>" +
      commentaryHtml(narrative.marketCommentary) +
      "<h2>03 · Chiến lược / điểm hành động</h2>" +
      (narrative.actionPoints.length
        ? bulletsHtml(narrative.actionPoints)
        : "<ul><li>Tỷ trọng 30–45%. Ưu tiên " +
          defensivePicks.join(", ") +
          ".</li></ul>") +
      (narrative.watchlist.length
        ? "<h2>04 · Watchlist</h2>" + bulletsHtml(narrative.watchlist)
        : "") +
      "<h2>05 · Nguồn tin (tham chiếu)</h2>" +
      newsListHtml(newsItems as any, 10);
  } else {
    headline = "Điểm tin đầu ngày & chiến lược thận trọng";
    lede =
      "Bản tin đầu ngày " +
      viShortDate(date) +
      " tổng hợp tin và chiến lược giao dịch thận trọng, ưu tiên bảo toàn vốn.";
    conclusion =
      "Phiên hôm nay nghiêng về kịch bản giằng co trong biên độ hẹp. Ưu tiên quan sát và chọn lọc, hạn chế mở vị thế đầu cơ.";
    recommendation =
      "Giữ tỷ trọng 30–45%. Ưu tiên " +
      defensivePicks.join(", ") +
      ". Cắt lỗ −5% đến −7%.";
    body =
      "<h2>01 · Điểm tin</h2>" +
      newsListHtml(newsItems as any, 14) +
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
  }

  const html = wrapHtml({
    type: "morning",
    date,
    headline,
    lede,
    body,
    conclusion,
    recommendation,
    llmMeta,
  });

  const saved = await storePersist("morning", dateKey, html, `Morning Brief ${dateKey}`, {
    vnIndex: vn?.close ?? null,
    changePct: vn?.changePct ?? null,
    newsCount: newsItems.length,
    latencyMs: Date.now() - startedAt,
    llm: Boolean(narrative),
    llmModel: llmMeta ?? null,
  });
  log.info("generate_done", {
    date: dateKey,
    id: saved.id,
    persisted: saved.persisted,
    llm: Boolean(narrative),
    latencyMs: Date.now() - startedAt,
  });
  return {
    id: saved.id ?? undefined,
    html,
    type: "morning" as const,
    date: dateKey,
    persisted: saved.persisted,
    llm: Boolean(narrative),
  };
}

export async function generateMarketSummary(date: Date = new Date()) {
  const startedAt = Date.now();
  const dateKey = vnTodayKey(date);
  const log = forProvider("reports-summary");
  log.info("generate_start", { date: dateKey });

  const [overview, bars, newsItems] = await Promise.all([
    withTimeout(getMarketOverview().catch(() => null), 14_000, null),
    withTimeout(loadVnIndexBars(), 14_000, [] as Ohlcv[]),
    withTimeout(loadRecentNews(40), 12_000, [] as Awaited<ReturnType<typeof loadRecentNews>>),
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
  const topG = (overview?.topGainers ?? []).slice(0, 8);
  const topL = (overview?.topLosers ?? []).slice(0, 8);
  const analysis = bars.length >= 30 ? analyze("VNINDEX", bars) : null;
  const support = analysis?.supportResistance?.support ?? null;
  const resistance = analysis?.supportResistance?.resistance ?? null;
  const pctVal = vn.changePct ?? 0;

  const context = buildContextPayload({
    kind: "summary",
    dateKey,
    overview,
    bars,
    newsItems: newsItems as any,
    analysis,
  });

  const narrative = await withTimeout(
    generateReportNarrative("summary", context),
    38_000,
    null as ReportLlmNarrative | null,
  );

  let body: string;
  let headline: string;
  let lede: string;
  let conclusion: string;
  let recommendation: string;
  let llmMeta: string | undefined;

  if (narrative) {
    llmMeta = [narrative.provider, narrative.model].filter(Boolean).join("/");
    headline = narrative.headline;
    lede = narrative.lede;
    conclusion = narrative.conclusion;
    recommendation = narrative.recommendation;
    body =
      "<h2>01 · Diễn biến phiên (số liệu)</h2>" +
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
      "<h2>02 · Nhận định chuyên sâu</h2>" +
      commentaryHtml(narrative.marketCommentary) +
      "<h2>03 · Tin & sự kiện đáng chú ý</h2>" +
      (narrative.newsInsights.length
        ? bulletsHtml(narrative.newsInsights)
        : newsListHtml(newsItems as any, 8)) +
      "<h2>04 · Ba kịch bản / điểm hành động phiên tới</h2>" +
      (narrative.actionPoints.length
        ? bulletsHtml(narrative.actionPoints)
        : "<ul><li>Cơ sở: biên độ " +
          fmt(support) +
          " – " +
          fmt(resistance) +
          ".</li></ul>") +
      (narrative.watchlist.length
        ? "<h2>05 · Watchlist</h2>" + bulletsHtml(narrative.watchlist)
        : "") +
      "<h2>06 · Nguồn tin (tham chiếu)</h2>" +
      newsListHtml(newsItems as any, 8);
  } else {
    headline = "Đọc vị phiên hôm nay & kế hoạch hành động phiên tới";
    lede =
      "Phiên " +
      viShortDate(date) +
      " khép lại với VN-Index " +
      fmt(vn.close) +
      " (" +
      pct(vn.changePct) +
      "). Bản tổng kết kèm ba kịch bản phiên tới.";
    conclusion =
      pctVal > 0.5
        ? "Xu hướng ngắn hạn tích cực có điều kiện — nắm giữ, chốt lời từng phần tại kháng cự."
        : pctVal < -0.5
          ? "Xu hướng ngắn hạn tiêu cực — phòng thủ, giảm tỷ trọng, chờ tín hiệu đảo chiều."
          : "Trung lập thiên thận trọng — giao dịch chọn lọc, tỷ trọng vừa phải.";
    recommendation =
      pctVal > 0.5
        ? "Tỷ trọng 50–60%. Chốt lời 30% tại " + fmt(resistance) + ". Cắt lỗ −5%."
        : pctVal < -0.5
          ? "Tỷ trọng 25–35%. Cắt lỗ vị thế vi phạm. Không bắt đáy. Hỗ trợ " + fmt(support) + "."
          : "Tỷ trọng 40–50%. Chỉ mở vị thế khi kiểm định " +
            fmt(support) +
            " hoặc breakout " +
            fmt(resistance) +
            ".";
    body =
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
      newsListHtml(newsItems as any, 10);
  }

  const html = wrapHtml({
    type: "summary",
    date,
    headline,
    lede,
    body,
    conclusion,
    recommendation,
    llmMeta,
  });

  const saved = await storePersist("summary", dateKey, html, `Market Summary ${dateKey}`, {
    vnIndex: vn.close,
    changePct: vn.changePct,
    advancers: adv,
    decliners: dec,
    newsCount: newsItems.length,
    latencyMs: Date.now() - startedAt,
    llm: Boolean(narrative),
    llmModel: llmMeta ?? null,
  });
  log.info("generate_done", {
    date: dateKey,
    id: saved.id,
    persisted: saved.persisted,
    llm: Boolean(narrative),
    latencyMs: Date.now() - startedAt,
  });
  return {
    id: saved.id ?? undefined,
    html,
    type: "summary" as const,
    date: dateKey,
    persisted: saved.persisted,
    llm: Boolean(narrative),
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
