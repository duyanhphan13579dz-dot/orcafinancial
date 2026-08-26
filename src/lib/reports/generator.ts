/**
 * ORCA Report Generator — morning brief + re-export summary
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
  attachNewsLinks,
  generateReportNarrative,
  type NewsBullet,
  type ReportLlmNarrative,
} from "./llm-narrative";

export type ReportType = "morning" | "summary";
export { generateMarketSummary } from "./summary-generate";
export { vnTodayKey, isVnWeekday } from "./report-utils";

import { vnTodayKey, viShortDate, fmt, fmtVol, pct } from "./report-utils";
import { availabilityFor, buildReportQuality, enrichReportHtml, normalizeAndDeduplicateNews, reportId, type ReportMetadata } from "./report-contract";

function vnParts(d: Date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
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
    raw: d,
  };
}

const VI_WEEKDAYS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
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

async function fetchYahooMeta(symbol: string): Promise<{ price: number | null; changePct: number | null } | null> {
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
          meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number };
        }>;
      };
    };
    const meta = json.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice ?? null;
    const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const changePct =
      price != null && prev != null && prev !== 0 ? ((price - prev) / prev) * 100 : null;
    return { price, changePct };
  } catch {
    return null;
  }
}

async function loadGlobalSnapshots() {
  const rows = await Promise.all(
    GLOBAL_SYMBOLS.map(async (g) => {
      const m = await fetchYahooMeta(g.yahoo);
      return { symbol: g.yahoo, name: g.name, price: m?.price ?? null, changePct: m?.changePct ?? null };
    }),
  );
  return rows.filter((r) => r.price != null || r.changePct != null);
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

function renderMorningHtml(opts: {
  date: Date;
  headline: string;
  lede: string;
  macroIntro: string;
  macroNews: NewsBullet[];
  macroCommoditiesNote: string;
  corporateIntro: string;
  corporateNews: NewsBullet[];
  corporateNote: string;
  marketIntro: string;
  marketNews: NewsBullet[];
  cryptoLine: string;
  strategyIntro: string;
  strategyPoints: string[];
  risks: string[];
  riskWarning: string;
  conclusion: string;
  recommendation: string;
  llmMeta?: string;
}): string {
  const p = vnParts(opts.date);
  const band =
    "MORNING BRIEF · " +
    VI_WEEKDAYS[p.weekday].toUpperCase() +
    ", NGÀY " +
    String(p.d).padStart(2, "0") +
    "/" +
    String(p.m).padStart(2, "0") +
    "/" +
    p.y;
  const time = String(p.hh).padStart(2, "0") + ":" + String(p.mm).padStart(2, "0") + " ICT";

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<title>ORCA FINANCIAL — ${escapeHtml(opts.headline)}</title>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap&subset=vietnamese,latin" rel="stylesheet" />
<style>
  :root { --navy: #0A2540; --sky: #0ea5e9; --muted: #5c7794; --line: #cfdcec; --lede-bg: #eef6fc; --warn-border: #f59e0b; --warn-bg: #fffbeb; --ok-bg: #f0f6fb; }
  * { box-sizing: border-box; }
  body { font-family: "Be Vietnam Pro", system-ui, sans-serif; color: #0b1e33; line-height: 1.55; max-width: 820px; margin: 0 auto; padding: 28px 36px 40px; font-size: 11pt; }
  .brand-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 6px; }
  .brand { font-size: 9pt; letter-spacing: 0.04em; color: var(--sky); font-weight: 600; }
  .brand::before { content: "●"; margin-right: 6px; color: var(--sky); }
  h1 { font-size: 22pt; line-height: 1.2; margin: 4px 0 0; color: var(--navy); font-weight: 800; }
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
  .box-warn { margin-top: 16px; border-left: 4px solid var(--warn-border); background: var(--warn-bg); padding: 12px 14px; }
  .box-warn .label { font-size: 9pt; letter-spacing: 0.1em; font-weight: 700; color: #b45309; margin-bottom: 4px; }
  .box-conclusion { margin-top: 16px; border-left: 4px solid var(--sky); background: var(--ok-bg); padding: 12px 14px; }
  .box-conclusion .label { font-size: 9pt; letter-spacing: 0.1em; font-weight: 700; color: var(--sky); margin-bottom: 4px; }
  .box-rec { margin-top: 14px; background: var(--navy); color: #fff; padding: 14px 16px; border-radius: 2px; }
  .box-rec .label { font-size: 9pt; letter-spacing: 0.12em; font-weight: 700; margin-bottom: 6px; opacity: 0.9; }
  .notes { margin-top: 22px; font-size: 8.5pt; color: var(--muted); }
  .notes ol { padding-left: 18px; margin: 6px 0; }
  .foot { margin-top: 16px; padding-top: 10px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; font-size: 8.5pt; color: var(--muted); }
  .llm-tag { font-size: 8pt; color: var(--muted); margin-top: 4px; }
</style>
</head>
<body>
  <div class="brand-row">
    <div>
      <div class="brand">ORCA FINANCIAL · INTELLIGENT INVESTMENT</div>
      <h1>${escapeHtml(opts.headline)}</h1>
    </div>
    <div class="side-meta">Morning Brief · Bản tin<br/>đầu ngày<br/>${escapeHtml(viLongDate(opts.date))}<br/>Phát hành: ${time}</div>
  </div>
  <div class="band">${escapeHtml(band)}</div>
  <div class="lede">${escapeHtml(opts.lede)}</div>
  ${opts.llmMeta ? `<div class="llm-tag">Phân tích hỗ trợ bởi LLM · ${escapeHtml(opts.llmMeta)}</div>` : ""}
  <div class="sec"><div class="sec-num">01 · Điểm tin vĩ mô</div><div class="sec-title">Bức tranh vĩ mô trong nước &amp; quốc tế</div>${opts.macroIntro ? `<p>${escapeHtml(opts.macroIntro)}</p>` : ""}${newsBulletHtml(opts.macroNews)}${opts.macroCommoditiesNote ? `<p>${escapeHtml(opts.macroCommoditiesNote)}</p>` : ""}</div>
  <div class="sec"><div class="sec-num">02 · Tin doanh nghiệp</div><div class="sec-title">Tin doanh nghiệp nổi bật trước giờ mở cửa</div>${opts.corporateIntro ? `<p>${escapeHtml(opts.corporateIntro)}</p>` : ""}${newsBulletHtml(opts.corporateNews)}${opts.corporateNote ? `<p><em>${escapeHtml(opts.corporateNote)}</em></p>` : ""}</div>
  <div class="sec"><div class="sec-num">03 · Tin thị trường</div><div class="sec-title">Diễn biến đêm qua &amp; tín hiệu mở cửa</div>${opts.marketIntro ? `<p>${escapeHtml(opts.marketIntro)}</p>` : ""}${newsBulletHtml(opts.marketNews)}${opts.cryptoLine ? `<p>${escapeHtml(opts.cryptoLine)}</p>` : ""}</div>
  <div class="sec"><div class="sec-num">04 · Chiến lược thận trọng trong ngày</div><div class="sec-title">Kỷ luật giao dịch — ưu tiên bảo toàn vốn</div>${opts.strategyIntro ? `<p>${escapeHtml(opts.strategyIntro)}</p>` : ""}${bulletsHtml(opts.strategyPoints)}</div>
  <div class="sec"><div class="sec-num">05 · Rủi ro cần cảnh giác</div><div class="sec-title">Các yếu tố có thể kích hoạt nhịp giảm mạnh</div>${bulletsHtml(opts.risks)}</div>
  ${opts.riskWarning ? `<div class="box-warn"><div class="label">CẢNH BÁO RỦI RO</div><div>${escapeHtml(opts.riskWarning)}</div></div>` : ""}
  <div class="box-conclusion"><div class="label">KẾT LUẬN &amp; NHẬN ĐỊNH CHỐT</div><div>${escapeHtml(opts.conclusion)}</div></div>
  <div class="box-rec"><div class="label">KHUYẾN NGHỊ CHIẾN LƯỢC</div><div>${escapeHtml(opts.recommendation)}</div></div>
  <div class="notes"><ol><li>Dữ liệu giá và chỉ số lấy từ VNDirect dchart và Yahoo Finance qua Data Engine.</li><li>Tin tức tổng hợp từ RSS; phân nhóm và nhận định bởi LLM.</li><li>Báo cáo mang tính tham khảo, không phải lời khuyên đầu tư.</li></ol></div>
  <div class="foot"><span>ORCA FINANCIAL · Research Engine v2</span><span>Báo cáo tự động · Không phải lời khuyên đầu tư</span></div>
</body>
</html>`;
}

function buildContextPayload(opts: {
  kind: ReportType;
  dateKey: string;
  overview: Awaited<ReturnType<typeof getMarketOverview>> | null;
  bars: Ohlcv[];
  newsItems: Array<{ title: string; link: string; sourceName: string; publishedAt?: string | Date | null }>;
  analysis: ReturnType<typeof analyze> | null;
  globalIndices: Array<{ symbol: string; name: string; price: number | null; changePct: number | null }>;
  crypto?: Array<{ symbol?: string; price?: number; changePct?: number }>;
}) {
  const emptyIdx = { close: null as number | null, changePct: null as number | null, volume: null as number | null };
  const vn =
    opts.overview?.indices?.find((i) => i.code === "VNINDEX") ?? opts.overview?.indices?.[0] ?? emptyIdx;
  const hnx = opts.overview?.indices?.find((i) => i.code === "HNX") ?? null;
  return {
    kind: opts.kind,
    date: opts.dateKey,
    layoutHint: "01 macro · 02 corporate · 03 market · 04 strategy · 05 risks",
    indicesVn: {
      vnIndex: { close: vn.close, changePct: vn.changePct, volume: vn.volume },
      hnx: hnx ? { close: hnx.close, changePct: hnx.changePct, volume: hnx.volume } : null,
    },
    indicesGlobal: opts.globalIndices,
    breadth: opts.overview?.breadth ?? null,
    topGainers: (opts.overview?.topGainers ?? []).slice(0, 6),
    topLosers: (opts.overview?.topLosers ?? []).slice(0, 6),
    technical: opts.analysis
      ? {
          support: opts.analysis.supportResistance?.support ?? null,
          resistance: opts.analysis.supportResistance?.resistance ?? null,
        }
      : null,
    crypto: (opts.crypto ?? []).slice(0, 4),
    news: opts.newsItems.slice(0, 30).map((n) => ({
      title: n.title,
      source: n.sourceName,
      link: n.link || null,
      publishedAt: n.publishedAt ? String(n.publishedAt) : null,
    })),
  };
}

export async function generateMorningBrief(date: Date = new Date()) {
  const startedAt = Date.now();
  const dateKey = vnTodayKey(date);
  const log = forProvider("reports-morning");
  log.info("generate_start", { date: dateKey });

  const [overview, bars, rawNewsItems, globalIndices] = await Promise.all([
    withTimeout(getMarketOverview().catch(() => null), 14_000, null),
    withTimeout(loadVnIndexBars(), 14_000, [] as Ohlcv[]),
    withTimeout(loadRecentNews(50), 12_000, [] as Awaited<ReturnType<typeof loadRecentNews>>),
    withTimeout(loadGlobalSnapshots(), 10_000, [] as Awaited<ReturnType<typeof loadGlobalSnapshots>>),
  ]);

  const newsItems = normalizeAndDeduplicateNews(rawNewsItems as { title: string; link: string; sourceName: string; publishedAt?: string | Date | null }[], 50);
  const vn = overview?.indices?.find((i) => i.code === "VNINDEX") ?? overview?.indices?.[0] ?? null;
  const analysis = bars.length >= 30 ? analyze("VNINDEX", bars) : null;
  const support = analysis?.supportResistance?.support ?? null;
  const resistance = analysis?.supportResistance?.resistance ?? null;
  const crypto = (overview as { crypto?: Array<{ symbol?: string; price?: number; changePct?: number }> })?.crypto;

  const context = buildContextPayload({
    kind: "morning",
    dateKey,
    overview,
    bars,
    newsItems: newsItems as { title: string; link: string; sourceName: string; publishedAt?: string | Date | null }[],
    analysis,
    globalIndices,
    crypto,
  });

  const narrative = await withTimeout(
    generateReportNarrative("morning", context),
    45_000,
    null as ReportLlmNarrative | null,
  );

  const llmMeta = narrative ? [narrative.provider, narrative.model].filter(Boolean).join("/") : undefined;

  const newsCatalog = (newsItems as { title: string; link?: string; sourceName: string }[]).map((n) => ({
    title: n.title,
    link: n.link || null,
    source: n.sourceName || null,
  }));

  const fallbackMacro: NewsBullet[] = newsCatalog.slice(0, 8).map((n) => ({
    title: n.title,
    source: n.source || undefined,
    link: n.link || undefined,
  }));
  const fallbackStrategy = [
    "Tỷ trọng cổ phiếu khuyến nghị: 30–45% tổng tài sản; phần còn lại giữ tiền mặt hoặc trái phiếu ngắn hạn.",
    "Nguyên tắc vào lệnh: chỉ giải ngân khi giá kiểm định lại vùng hỗ trợ với thanh khoản suy giảm; không mua đuổi đầu phiên.",
    "Nguyên tắc cắt lỗ: −5% đến −7% cho vị thế ngắn hạn mới; không trung bình giá xuống khi xu hướng chưa đảo chiều.",
    support != null
      ? `Vùng hỗ trợ cần theo dõi: ${fmt(support)} điểm.`
      : "Theo dõi vùng hỗ trợ kỹ thuật gần nhất trên biểu đồ VN-Index.",
    resistance != null
      ? `Vùng kháng cự ngắn hạn: ${fmt(resistance)} điểm — chỉ gia tăng tỷ trọng khi breakout kèm thanh khoản.`
      : "Chỉ gia tăng tỷ trọng khi có breakout xác nhận.",
  ];

  const cryptoLine =
    narrative?.cryptoLine ||
    (crypto && crypto.length
      ? "Tài sản số tham chiếu: " +
        crypto
          .slice(0, 4)
          .map((c) => `${c.symbol ?? "?"} $${fmt(c.price, 0)} (${pct(c.changePct)})`)
          .join(" · ")
      : "");

  const marketIntroFallback =
    vn?.close != null
      ? `Phiên giao dịch trước của VN-Index đóng cửa tại ${fmt(vn.close)} điểm (${pct(vn.changePct)}), thanh khoản ${fmtVol(vn.volume)}.`
      : "Diễn biến phiên trước và dòng tiền được phản ánh qua các tin thị trường dưới đây.";

  const macroNews = attachNewsLinks(
    narrative?.macroNews?.length ? narrative.macroNews : fallbackMacro.slice(0, 5),
    newsCatalog,
  );
  const corporateNews = attachNewsLinks(
    narrative?.corporateNews?.length ? narrative.corporateNews : fallbackMacro.slice(0, 4),
    newsCatalog,
  );
  const marketNews = attachNewsLinks(
    narrative?.marketNews?.length ? narrative.marketNews : fallbackMacro.slice(0, 5),
    newsCatalog,
  );

  const baseHtml = renderMorningHtml({
    date,
    headline: narrative?.headline || "Điểm tin đầu ngày & chiến lược thận trọng",
    lede:
      narrative?.lede ||
      `Bản tin đầu ngày ${viShortDate(date)} tổng hợp các tin vĩ mô, doanh nghiệp và thị trường, kèm chiến lược thận trọng ưu tiên bảo toàn vốn.`,
    macroIntro:
      narrative?.macroIntro ||
      "Phiên đêm qua và rạng sáng nay, thị trường tài chính toàn cầu vận động khi nhà đầu tư chờ đợi các dữ liệu then chốt.",
    macroNews,
    macroCommoditiesNote:
      narrative?.macroCommoditiesNote ||
      (globalIndices.length
        ? "Tham chiếu overnight: " +
          globalIndices
            .slice(0, 5)
            .map((g) => `${g.name} ${pct(g.changePct)}`)
            .join("; ") +
          "."
        : ""),
    corporateIntro:
      narrative?.corporateIntro ||
      "Các tin công bố kết quả kinh doanh, ký kết hợp đồng, thay đổi nhân sự và sự kiện doanh nghiệp trong 24 giờ qua:",
    corporateNews,
    corporateNote:
      narrative?.corporateNote ||
      "Lưu ý: đối chiếu lịch chốt quyền cổ tức và lịch ĐHCĐ trên cổng HOSE/HNX trước khi đặt lệnh.",
    marketIntro: narrative?.marketIntro || marketIntroFallback,
    marketNews,
    cryptoLine,
    strategyIntro:
      narrative?.strategyIntro ||
      "ORCA FINANCIAL khuyến nghị duy trì trạng thái thận trọng, tránh mua đuổi và không sử dụng đòn bẩy cao.",
    strategyPoints: narrative?.strategyPoints?.length ? narrative.strategyPoints : fallbackStrategy,
    risks: narrative?.risks?.length
      ? narrative.risks
      : [
          "Khối ngoại tiếp tục bán ròng ở nhóm vốn hóa lớn.",
          "Tin vĩ mô bất lợi ngoài giờ có thể gây gap-down.",
          "Thanh khoản suy giảm phản ánh sự thận trọng của dòng tiền nội.",
        ],
    riskWarning:
      narrative?.riskWarning ||
      "Rủi ro chính: bán ròng khối ngoại, tin vĩ mô ngoài giờ, thanh khoản suy giảm. Nếu hai trong ba xuất hiện, giảm tỷ trọng về 20–25%.",
    conclusion:
      narrative?.conclusion ||
      "Phiên hôm nay nghiêng về kịch bản giằng co; ưu tiên quan sát và chọn lọc theo tín hiệu dòng tiền.",
    recommendation:
      narrative?.recommendation ||
      `Giữ tỷ trọng 30–45%. Không mua đuổi, không dùng margin cao. Cắt lỗ −5% đến −7%.` +
        (support != null ? ` Chờ tín hiệu rõ tại vùng hỗ trợ ${fmt(support)}.` : ""),
    llmMeta,
  });

  const generatedAt = new Date().toISOString();
  const overviewQuality = (overview as { quality?: { ageSeconds?: number | null; sources?: string[]; missingSymbols?: string[] } } | null)?.quality;
  const metadata: ReportMetadata = {
    reportId: reportId("morning", dateKey),
    engineVersion: "2.4.0",
    type: "morning",
    date: dateKey,
    publicationTime: generatedAt,
    timestamps: { marketData: (overview as { generatedAt?: string } | null)?.generatedAt ?? null, news: newsItems[0]?.publishedAt ? String(newsItems[0].publishedAt) : null, macro: globalIndices.length ? generatedAt : null, generated: generatedAt },
    availability: { market: availabilityFor(vn?.close, overviewQuality?.ageSeconds), news: availabilityFor(newsItems.length), macro: availabilityFor(globalIndices.length), technical: availabilityFor(bars.length >= 30) },
    sources: [...(overviewQuality?.sources ?? []), "RSS News", "Yahoo Finance"].map((name) => ({ name, status: "LIVE" as const })),
    quality: buildReportQuality({ marketAvailable: vn?.close != null, newsCount: newsItems.length, macroAvailable: globalIndices.length > 0, sourceCount: (overviewQuality?.sources?.length ?? 0) + 2, aiValidated: Boolean(narrative), missing: overviewQuality?.missingSymbols ?? [] }),
    generatedAt,
    version: 1,
  };
  const html = enrichReportHtml(baseHtml, metadata);
  const saved = await storePersist("morning", dateKey, html, `Morning Brief ${dateKey}`, metadata);
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

export async function getStoredReport(type: ReportType, dateKey: string) {
  return (await storeGet(type, dateKey))?.html ?? null;
}
export async function getStoredReportWithMetadata(type: ReportType, dateKey: string) {
  return storeGet(type, dateKey);
}
export async function listRecentReports(limit = 14) {
  return storeList(limit);
}
export async function triggerMorning(date?: Date) {
  return generateMorningBrief(date ?? new Date());
}
export async function triggerSummary(date?: Date) {
  const { generateMarketSummary } = await import("./summary-generate");
  return generateMarketSummary(date ?? new Date());
}
