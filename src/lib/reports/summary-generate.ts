/**
 * Market Summary generation pipeline
 */
import type { Ohlcv } from "@/lib/connectors/core";
import { getMarketOverview, getHistory, getNews } from "@/lib/market";
import { analyze } from "@/lib/analysis";
import { forProvider } from "@/lib/logger";
import { persistReport as storePersist } from "./store";
import {
  attachNewsLinks,
  generateReportNarrative,
  type ReportLlmNarrative,
  type ScenarioItem,
} from "./llm-narrative";
import { renderSummaryHtml } from "./summary-html";
import { vnTodayKey, viShortDate, fmt, fmtVol, pct } from "./report-utils";

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

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

const GLOBAL_SYMBOLS = [
  { yahoo: "^GSPC", name: "S&P 500" },
  { yahoo: "^DJI", name: "Dow Jones" },
  { yahoo: "^IXIC", name: "Nasdaq" },
  { yahoo: "^HSI", name: "Hang Seng" },
  { yahoo: "DX-Y.NYB", name: "US Dollar Index" },
];

async function loadGlobalSnapshots() {
  const rows = await Promise.all(
    GLOBAL_SYMBOLS.map(async (g) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(g.yahoo)}?interval=1d&range=5d`;
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 ORCA-Reports/1.0" },
          signal: AbortSignal.timeout(6_000),
        });
        if (!res.ok)
          return { symbol: g.yahoo, name: g.name, price: null as number | null, changePct: null as number | null };
        const json = (await res.json()) as {
          chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number } }> };
        };
        const meta = json.chart?.result?.[0]?.meta;
        const price = meta?.regularMarketPrice ?? null;
        const prev = meta?.chartPreviousClose ?? meta?.previousClose ?? null;
        const changePct =
          price != null && prev != null && prev !== 0 ? ((price - prev) / prev) * 100 : null;
        return { symbol: g.yahoo, name: g.name, price, changePct };
      } catch {
        return { symbol: g.yahoo, name: g.name, price: null as number | null, changePct: null as number | null };
      }
    }),
  );
  return rows.filter((r) => r.price != null || r.changePct != null);
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
  const analysis = bars.length >= 30 ? analyze("VNINDEX", bars) : null;
  const support = analysis?.supportResistance?.support ?? null;
  const resistance = analysis?.supportResistance?.resistance ?? null;
  const pctVal = vn.changePct ?? 0;

  const context = {
    kind: "summary" as const,
    date: dateKey,
    layoutHint: "01 session · 02 news · 03 analysis · 04 3 scenarios · 05 risks · sessionOverview",
    indicesVn: {
      vnIndex: { close: vn.close, changePct: vn.changePct, volume: vn.volume },
      hnx: hnx ? { close: hnx.close, changePct: hnx.changePct, volume: hnx.volume } : null,
    },
    indicesGlobal: globalIndices,
    breadth: overview?.breadth ?? null,
    topGainers: (overview?.topGainers ?? []).slice(0, 6),
    topLosers: (overview?.topLosers ?? []).slice(0, 6),
    technical: analysis
      ? {
          support: analysis.supportResistance?.support ?? null,
          resistance: analysis.supportResistance?.resistance ?? null,
        }
      : null,
    news: (newsItems as { title: string; link?: string; sourceName: string; publishedAt?: string | Date | null }[])
      .slice(0, 30)
      .map((n) => ({
        title: n.title,
        source: n.sourceName,
        link: n.link || null,
        publishedAt: n.publishedAt ? String(n.publishedAt) : null,
      })),
  };

  const narrative = await withTimeout(
    generateReportNarrative("summary", context),
    48_000,
    null as ReportLlmNarrative | null,
  );

  const llmMeta = narrative
    ? [narrative.provider, narrative.model].filter(Boolean).join("/")
    : undefined;

  const newsCatalog = (newsItems as { title: string; link?: string; sourceName: string }[]).map((n) => ({
    title: n.title,
    link: n.link || null,
    source: n.sourceName || null,
  }));

  const marketNews = attachNewsLinks(
    narrative?.marketNews?.length
      ? narrative.marketNews
      : newsCatalog.slice(0, 6).map((n) => ({
          title: n.title,
          source: n.source || undefined,
          link: n.link || undefined,
        })),
    newsCatalog,
  );

  const defaultScenarios: ScenarioItem[] = [
    {
      name: "Cơ sở",
      condition: `VN-Index dao động ${fmt(support)} – ${fmt(resistance)}, thanh khoản trung bình.`,
      action: "Tỷ trọng 40–50%. Giao dịch chọn lọc, không mở rộng vị thế lớn.",
    },
    {
      name: "Tích cực",
      condition: "Breakout kháng cự kèm thanh khoản tăng rõ.",
      action: "Có thể nâng tỷ trọng 55–65%; chốt lời từng phần tại vùng kháng cự mới.",
    },
    {
      name: "Tiêu cực",
      condition: "Thủng hỗ trợ hoặc bán ròng mạnh lan tỏa.",
      action: "Giảm tỷ trọng 20–30%; đứng ngoài quan sát, không bắt đáy sớm.",
    },
  ];

  const scenarios: ScenarioItem[] =
    narrative?.scenarios && narrative.scenarios.length >= 2
      ? narrative.scenarios
      : defaultScenarios;

  const marketIntro =
    narrative?.marketIntro ||
    `VN-Index ${fmt(vn.close)} (${pct(vn.changePct)}) · HNX ${fmt(hnx?.close)} (${pct(hnx?.changePct)}) · Độ rộng ${adv} tăng / ${dec} giảm · KL ${fmtVol(vn.volume)}.` +
      (globalIndices.length
        ? " Tham chiếu quốc tế: " +
          globalIndices
            .slice(0, 4)
            .map((g) => `${g.name} ${pct(g.changePct)}`)
            .join("; ") +
          "."
        : "");

  const sessionAnalysis =
    narrative?.sessionAnalysis ||
    narrative?.marketCommentary ||
    (pctVal > 0.5
      ? "Phiên nghiêng tích cực với lực cầu cải thiện ở nhóm dẫn dắt; cần theo dõi khả năng duy trì thanh khoản ở phiên sau."
      : pctVal < -0.5
        ? "Phiên nghiêng tiêu cực, áp lực bán chiếm ưu thế; ưu tiên bảo toàn vốn và chờ tín hiệu ổn định."
        : "Phiên giằng co trong biên độ hẹp; dòng tiền thận trọng, thiếu xung lực bứt phá rõ ràng.");

  const sessionOverview =
    narrative?.sessionOverview ||
    narrative?.conclusion ||
    (pctVal > 0.5
      ? "Tổng thể phiên nghiêng tích cực có điều kiện. Điểm then chốt phiên tới là thanh khoản xác nhận và hành vi khối ngoại."
      : pctVal < -0.5
        ? "Tổng thể phiên nghiêng tiêu cực. Ưu tiên phòng thủ cho đến khi hỗ trợ được giữ vững và độ rộng cải thiện."
        : "Tổng thể phiên trung lập thiên thận trọng. Chờ breakout/breakdown có thanh khoản trước khi mở rộng vị thế.");

  const html = renderSummaryHtml({
    date,
    headline: narrative?.headline || "Đọc vị phiên hôm nay & kế hoạch phiên tới",
    lede:
      narrative?.lede ||
      `Phiên ${viShortDate(date)} khép lại với VN-Index ${fmt(vn.close)} (${pct(vn.changePct)}). Bản tổng kết gồm diễn biến, tin đáng chú ý, nhận định chi tiết, ba kịch bản phiên tới và đánh giá tổng quan.`,
    marketIntro,
    marketNews,
    sessionAnalysis,
    scenarios,
    risks: narrative?.risks?.length
      ? narrative.risks
      : ["Khối ngoại bán ròng", "Thanh khoản suy giảm", "Tin vĩ mô ngoài giờ"],
    riskWarning:
      narrative?.riskWarning ||
      "Nếu thanh khoản suy giảm đồng thời với bán ròng lan tỏa, giảm tỷ trọng và hạn chế bắt đáy sớm.",
    sessionOverview,
    recommendation:
      narrative?.recommendation ||
      (pctVal > 0.5
        ? `Tỷ trọng tham chiếu 50–60%. Chốt lời từng phần quanh ${fmt(resistance)}. Cắt lỗ −5%.`
        : pctVal < -0.5
          ? `Tỷ trọng tham chiếu 25–35%. Theo dõi hỗ trợ ${fmt(support)}. Không bắt đáy sớm.`
          : `Tỷ trọng tham chiếu 40–50%. Chờ kiểm định ${fmt(support)} hoặc breakout ${fmt(resistance)}.`),
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
