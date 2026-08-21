/**
 * ORCA Report Generator — v5 Morning pipeline
 * Data Engine → classify news → impact news → impact indices VN→world → strategy
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
  type ClassifiedNewsItem,
  type IndexImpactItem,
  type NewsCategory,
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

/** Overnight / global reference quotes via Yahoo chart meta. */
const GLOBAL_SYMBOLS: Array<{ yahoo: string; name: string }> = [
  { yahoo: "^GSPC", name: "S&P 500" },
  { yahoo: "^DJI", name: "Dow Jones" },
  { yahoo: "^IXIC", name: "Nasdaq" },
  { yahoo: "^N225", name: "Nikkei 225" },
  { yahoo: "^HSI", name: "Hang Seng" },
  { yahoo: "DX-Y.NYB", name: "US Dollar Index" },
  { yahoo: "GC=F", name: "Gold" },
  { yahoo: "CL=F", name: "WTI Oil" },
];

async function fetchYahooMeta(symbol: string): Promise<{
  name: string;
  price: number | null;
  changePct: number | null;
} | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 ORCA-Reports/1.0" },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            previousClose?: number;
            shortName?: string;
          };
        }>;
      };
    };
    const meta = json.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice ?? null;
    const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const changePct =
      price != null && prev != null && prev !== 0 ? ((price - prev) / prev) * 100 : null;
    return {
      name: meta.shortName ?? symbol,
      price,
      changePct,
    };
  } catch {
    return null;
  }
}

async function loadGlobalSnapshots(): Promise<
  Array<{ symbol: string; name: string; price: number | null; changePct: number | null }>
> {
  const rows = await Promise.all(
    GLOBAL_SYMBOLS.map(async (g) => {
      const m = await fetchYahooMeta(g.yahoo);
      return {
        symbol: g.yahoo,
        name: g.name,
        price: m?.price ?? null,
        changePct: m?.changePct ?? null,
      };
    }),
  );
  return rows.filter((r) => r.price != null || r.changePct != null);
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
<title>ORCA FINANCIAL — ${escapeHtml(opts.headline)}</title>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700;800&display=swap&subset=vietnamese,latin" rel="stylesheet" />
<style>
  body{font-family:"Be Vietnam Pro",system-ui,sans-serif;color:#0b1e33;line-height:1.55;max-width:820px;margin:0 auto;padding:28px 32px;font-size:11.5pt}
  h1{font-size:22pt;margin:0 0 8px;color:#0A2540}
  h3{font-size:11.5pt;color:#334e68;margin:14px 0 6px}
  .meta{color:#5c7794;font-size:9pt;margin-bottom:16px}
  .lede{border-left:3px solid ${accent};padding:8px 12px;background:#f0f7fc;font-style:italic;margin-bottom:18px}
  h2{font-size:13pt;border-bottom:1px solid #cfdcec;padding-bottom:4px;color:#0A2540;margin-top:22px}
  p{margin:8px 0}
  ul{margin:6px 0 12px 18px} li{margin:5px 0}
  .badge{display:inline-block;font-size:8.5pt;padding:1px 6px;border-radius:3px;margin-right:6px;background:#e8f1fa;color:#0A2540}
  .badge-cao,.badge-rat_cao{background:#fee2e2;color:#991b1b}
  .badge-trung_binh{background:#fef3c7;color:#92400e}
  .badge-thap{background:#e5e7eb;color:#374151}
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
  <div class="conclusion"><strong>Kết luận chiến lược đầu ngày:</strong> ${escapeHtml(opts.conclusion)}</div>
  <div class="rec"><strong>Khuyến nghị hành động</strong><br/>${escapeHtml(opts.recommendation)}</div>
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
  return paras.map((p) => '<p class="para">' + escapeHtml(p) + "</p>").join("");
}

const CAT_LABEL: Record<NewsCategory, string> = {
  vi_mo: "Vi mô",
  vi_mo_macro: "Vĩ mô",
  trong_nuoc: "Trong nước",
  quoc_te: "Quốc tế",
  doanh_nghiep: "Doanh nghiệp",
};

const IMPACT_LABEL: Record<string, string> = {
  thap: "Thấp",
  trung_binh: "TB",
  cao: "Cao",
  rat_cao: "Rất cao",
};

function classifiedNewsHtml(items: ClassifiedNewsItem[]): string {
  if (!items.length) return "";
  const order: NewsCategory[] = [
    "vi_mo_macro",
    "quoc_te",
    "trong_nuoc",
    "doanh_nghiep",
    "vi_mo",
  ];
  const byCat = new Map<NewsCategory, ClassifiedNewsItem[]>();
  for (const it of items) {
    const list = byCat.get(it.category) ?? [];
    list.push(it);
    byCat.set(it.category, list);
  }
  let html = "";
  for (const cat of order) {
    const list = byCat.get(cat);
    if (!list?.length) continue;
    html += `<h3>${CAT_LABEL[cat]}</h3><ul>`;
    for (const n of list) {
      const badge = IMPACT_LABEL[n.impact] ?? n.impact;
      html +=
        `<li><span class="badge badge-${n.impact}">${escapeHtml(badge)}</span>` +
        `<strong>${escapeHtml(n.title)}</strong>` +
        (n.source ? ` <em>(${escapeHtml(n.source)})</em>` : "") +
        `<br/><span style="color:#5c7794">${escapeHtml(n.rationale)}</span></li>`;
    }
    html += "</ul>";
  }
  return html;
}

function indexImpactsHtml(items: IndexImpactItem[]): string {
  if (!items.length) return "";
  let html = "<ul>";
  for (const it of items) {
    const badge = IMPACT_LABEL[it.impact] ?? it.impact;
    html +=
      `<li><span class="badge badge-${it.impact}">${escapeHtml(badge)}</span>` +
      `<strong>${escapeHtml(it.name)}</strong> ${pct(it.changePct)}` +
      `<br/><span style="color:#5c7794">${escapeHtml(it.note)}</span></li>`;
  }
  html += "</ul>";
  return html;
}

function buildContextPayload(opts: {
  kind: ReportType;
  dateKey: string;
  overview: Awaited<ReturnType<typeof getMarketOverview>> | null;
  bars: Ohlcv[];
  newsItems: Array<{ title: string; link: string; sourceName: string; publishedAt?: string }>;
  analysis: ReturnType<typeof analyze> | null;
  globalIndices: Array<{ symbol: string; name: string; price: number | null; changePct: number | null }>;
}) {
  const emptyIdx = {
    close: null as number | null,
    changePct: null as number | null,
    volume: null as number | null,
  };
  const vn =
    opts.overview?.indices?.find((i) => i.code === "VNINDEX") ??
    opts.overview?.indices?.[0] ??
    emptyIdx;
  const hnx = opts.overview?.indices?.find((i) => i.code === "HNX") ?? null;
  const upcom = opts.overview?.indices?.find((i) => i.code === "UPCOM") ?? null;

  return {
    kind: opts.kind,
    date: opts.dateKey,
    pipeline:
      opts.kind === "morning"
        ? [
            "classify_news",
            "score_news_impact",
            "score_index_impact_vn_to_world",
            "opening_strategy",
          ]
        : ["session_review", "scenarios", "recommendation"],
    indicesVn: {
      vnIndex: { close: vn.close, changePct: vn.changePct, volume: vn.volume },
      hnx: hnx ? { close: hnx.close, changePct: hnx.changePct, volume: hnx.volume } : null,
      upcom: upcom ? { close: upcom.close, changePct: upcom.changePct } : null,
    },
    indicesGlobal: opts.globalIndices,
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
    news: opts.newsItems.slice(0, 28).map((n) => ({
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

  const [overview, bars, newsItems, globalIndices] = await Promise.all([
    withTimeout(getMarketOverview().catch(() => null), 14_000, null),
    withTimeout(loadVnIndexBars(), 14_000, [] as Ohlcv[]),
    withTimeout(loadRecentNews(50), 12_000, [] as Awaited<ReturnType<typeof loadRecentNews>>),
    withTimeout(loadGlobalSnapshots(), 10_000, [] as Awaited<ReturnType<typeof loadGlobalSnapshots>>),
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
    globalIndices,
  });

  const narrative = await withTimeout(
    generateReportNarrative("morning", context),
    42_000,
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

    const newsBlock = narrative.classifiedNews.length
      ? classifiedNewsHtml(narrative.classifiedNews)
      : narrative.newsInsights.length
        ? bulletsHtml(narrative.newsInsights)
        : newsListHtml(newsItems as any, 12);

    const indexBlock = narrative.indexImpacts.length
      ? indexImpactsHtml(narrative.indexImpacts)
      : globalIndices.length
        ? "<ul>" +
          globalIndices
            .map(
              (g) =>
                `<li><strong>${escapeHtml(g.name)}</strong> ${pct(g.changePct)} · ${fmt(g.price)}</li>`,
            )
            .join("") +
          "</ul>"
        : "<p><em>Chưa có dữ liệu chỉ số toàn cầu.</em></p>";

    body =
      "<h2>01 · Phân loại tin (vi mô · vĩ mô · trong nước · quốc tế · doanh nghiệp)</h2>" +
      newsBlock +
      "<h2>02 · Ảnh hưởng biến động chỉ số (VN → thế giới)</h2>" +
      "<p>Tham chiếu phiên trước / overnight: VN-Index <strong>" +
      fmt(vn?.close) +
      "</strong> (" +
      pct(vn?.changePct) +
      "), KL " +
      fmtVol(vn?.volume) +
      ".</p>" +
      indexBlock +
      "<h2>03 · Nhận định trước phiên</h2>" +
      commentaryHtml(narrative.marketCommentary) +
      "<h2>04 · Chiến lược đầu ngày</h2>" +
      (narrative.actionPoints.length
        ? bulletsHtml(narrative.actionPoints)
        : "<ul><li>Tỷ trọng 30–45%. Ưu tiên " +
          defensivePicks.join(", ") +
          ".</li></ul>") +
      (narrative.watchlist.length
        ? "<h2>05 · Watchlist</h2>" + bulletsHtml(narrative.watchlist)
        : "") +
      "<h2>06 · Nguồn tin (tham chiếu Data Engine)</h2>" +
      newsListHtml(newsItems as any, 10);
  } else {
    headline = "Điểm tin đầu ngày & chiến lược thận trọng";
    lede =
      "Bản tin đầu ngày " +
      viShortDate(date) +
      " — Data Engine đã gom tin; LLM chưa khả dụng nên dùng khung template.";
    conclusion =
      "Phiên hôm nay nghiêng về kịch bản giằng co. Ưu tiên quan sát 30–60 phút đầu, hạn chế mở vị thế đầu cơ.";
    recommendation =
      "Giữ tỷ trọng 30–45%. Ưu tiên " +
      defensivePicks.join(", ") +
      ". Cắt lỗ −5% đến −7%.";
    body =
      "<h2>01 · Điểm tin (chưa phân loại LLM)</h2>" +
      newsListHtml(newsItems as any, 14) +
      "<h2>02 · Chỉ số tham chiếu</h2>" +
      "<p>VN-Index: <strong>" +
      fmt(vn?.close) +
      "</strong> (" +
      pct(vn?.changePct) +
      "), KL " +
      fmtVol(vn?.volume) +
      ".</p>" +
      (globalIndices.length
        ? "<ul>" +
          globalIndices
            .map(
              (g) =>
                `<li>${escapeHtml(g.name)}: ${pct(g.changePct)} · ${fmt(g.price)}</li>`,
            )
            .join("") +
          "</ul>"
        : "") +
      (support
        ? "<p>Hỗ trợ gần: " + fmt(support) + ". Kháng cự: " + fmt(resistance) + ".</p>"
        : "") +
      "<h2>03 · Chiến lược đầu ngày (template)</h2>" +
      "<ul>" +
      "<li>Tỷ trọng khuyến nghị: <strong>30–45%</strong>.</li>" +
      "<li>Danh mục phòng thủ: " +
      defensivePicks.join(", ") +
      ".</li>" +
      "<li>Cắt lỗ −5% đến −7%. Không mua đuổi / margin cao.</li>" +
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
    globalCount: globalIndices.length,
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

  const [overview, bars, newsItems, globalIndices] = await Promise.all([
    withTimeout(getMarketOverview().catch(() => null), 14_000, null),
    withTimeout(loadVnIndexBars(), 14_000, [] as Ohlcv[]),
    withTimeout(loadRecentNews(40), 12_000, [] as Awaited<ReturnType<typeof loadRecentNews>>),
    withTimeout(loadGlobalSnapshots(), 10_000, [] as Awaited<ReturnType<typeof loadGlobalSnapshots>>),
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
    globalIndices,
  });

  const narrative = await withTimeout(
    generateReportNarrative("summary", context),
    42_000,
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
      ") · KL " +
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
      "<h2>03 · Tin đáng chú ý</h2>" +
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
      "<h2>06 · Nguồn tin</h2>" +
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
      ").";
    conclusion =
      pctVal > 0.5
        ? "Xu hướng ngắn hạn tích cực có điều kiện — nắm giữ, chốt lời từng phần tại kháng cự."
        : pctVal < -0.5
          ? "Xu hướng ngắn hạn tiêu cực — phòng thủ, giảm tỷ trọng."
          : "Trung lập thiên thận trọng — giao dịch chọn lọc.";
    recommendation =
      pctVal > 0.5
        ? "Tỷ trọng 50–60%. Chốt lời 30% tại " + fmt(resistance) + ". Cắt lỗ −5%."
        : pctVal < -0.5
          ? "Tỷ trọng 25–35%. Hỗ trợ " + fmt(support) + "."
          : "Tỷ trọng 40–50%. Kiểm định " + fmt(support) + " / breakout " + fmt(resistance) + ".";
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
      ")</p>" +
      "<h2>02 · Ba kịch bản phiên tới</h2>" +
      "<ul><li><strong>Cơ sở:</strong> " +
      fmt(support) +
      " – " +
      fmt(resistance) +
      ".</li>" +
      "<li><strong>Tích cực:</strong> breakout + thanh khoản.</li>" +
      "<li><strong>Tiêu cực:</strong> thủng hỗ trợ → giảm tỷ trọng.</li></ul>" +
      "<h2>03 · Tin</h2>" +
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
