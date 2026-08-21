/**
 * LLM narrative aligned to ORCA Morning Brief sample layout:
 * 01 Vĩ mô · 02 Doanh nghiệp · 03 Thị trường · 04 Chiến lược · 05 Rủi ro
 * + Cảnh báo rủi ro · Kết luận · Khuyến nghị chiến lược
 */
import { chatWithFallback } from "@/lib/llm/router";
import { forProvider } from "@/lib/logger";

export type ReportLlmKind = "morning" | "summary";

export interface NewsBullet {
  title: string;
  source?: string;
  time?: string;
  /** Original article URL when available */
  link?: string;
}

export interface MorningBriefContent {
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
  model?: string;
  provider?: string;
}

export interface ReportLlmNarrative extends MorningBriefContent {
  newsInsights: string[];
  actionPoints: string[];
  marketCommentary: string;
  watchlist: string[];
  classifiedNews: never[];
  indexImpacts: never[];
}

const MORNING_SYSTEM = `Bạn là biên tập viên Morning Brief của ORCA FINANCIAL.
Nhiệm vụ: viết BẢN TIN ĐẦU NGÀY theo ĐÚNG cấu trúc mẫu, dựa CHỈ trên JSON Data Engine.

CẤU TRÚC: 01 Vĩ mô · 02 Doanh nghiệp · 03 Thị trường · 04 Chiến lược · 05 Rủi ro · Cảnh báo · Kết luận · Khuyến nghị.

QUY TẮC:
1. Không bịa giá/%/điểm.
2. Mỗi bullet tin PHẢI copy "link" từ mục news trong dữ liệu nếu khớp tiêu đề (để người đọc bấm xem bài gốc).
3. Bỏ tin nhiễu; ưu tiên tin ảnh hưởng TTCK VN.
4. KHÔNG đưa "danh mục tham khảo", "danh mục phòng thủ", "danh mục ưu tiên" hay liệt kê mã cụ thể (VNM, FPT, VCB…). Chiến lược chỉ nói tỷ trọng, kỷ luật vào lệnh/cắt lỗ, vùng hỗ trợ–kháng cự chỉ số — không gợi ý basket cổ phiếu.
5. Trả JSON thuần:
{
  "headline": string,
  "lede": string,
  "macroIntro": string,
  "macroNews": [{ "title": string, "source": string, "time": string, "link": string }],
  "macroCommoditiesNote": string,
  "corporateIntro": string,
  "corporateNews": [{ "title": string, "source": string, "time": string, "link": string }],
  "corporateNote": string,
  "marketIntro": string,
  "marketNews": [{ "title": string, "source": string, "time": string, "link": string }],
  "cryptoLine": string,
  "strategyIntro": string,
  "strategyPoints": string[],
  "risks": string[],
  "riskWarning": string,
  "conclusion": string,
  "recommendation": string
}`;

const SUMMARY_SYSTEM = `Bạn là chuyên gia tổng kết cuối phiên ORCA FINANCIAL.
Dựa CHỈ trên JSON. Mỗi tin marketNews nên kèm link từ dữ liệu.
Không đưa danh mục tham khảo / liệt kê mã cổ phiếu cụ thể.
JSON thuần:
{
  "headline": string,
  "lede": string,
  "macroIntro": "",
  "macroNews": [],
  "macroCommoditiesNote": "",
  "corporateIntro": "",
  "corporateNews": [],
  "corporateNote": "",
  "marketIntro": string,
  "marketNews": [{ "title": string, "source": string, "time": string, "link": string }],
  "cryptoLine": "",
  "strategyIntro": string,
  "strategyPoints": string[],
  "risks": string[],
  "riskWarning": string,
  "conclusion": string,
  "recommendation": string
}`;

function str(v: unknown, max = 1200): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function safeLink(v: unknown): string | undefined {
  const s = str(v, 900);
  if (!s) return undefined;
  if (!/^https?:\/\//i.test(s)) return undefined;
  return s;
}

function bullets(raw: unknown, max = 10): NewsBullet[] {
  if (!Array.isArray(raw)) return [];
  const out: NewsBullet[] = [];
  for (const item of raw.slice(0, max)) {
    if (typeof item === "string" && item.trim()) {
      out.push({ title: item.trim().slice(0, 320) });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = str(o.title, 320);
    if (!title) continue;
    out.push({
      title,
      source: str(o.source, 60) || undefined,
      time: str(o.time, 20) || undefined,
      link: safeLink(o.link),
    });
  }
  return out;
}

const BASKET_RE =
  /danh\s*mục\s*(phòng\s*thủ|tham\s*khảo|ưu\s*tiên)|\b(VNM|FPT|VCB)\b.*\b(FPT|VCB|VNM)\b/i;

function arrStr(v: unknown, maxItems = 10, maxLen = 400): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim().slice(0, maxLen))
    .filter((x) => !BASKET_RE.test(x))
    .slice(0, maxItems);
}

/** Strip reference-basket wording from free text. */
function stripBasket(text: string): string {
  return text
    .replace(/Danh\s*mục\s*(phòng\s*thủ\s*)?(tham\s*khảo|ưu\s*tiên)[^.]{0,120}\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Attach missing links by fuzzy-matching titles against Data Engine news list. */
export function attachNewsLinks(
  items: NewsBullet[],
  catalog: Array<{ title: string; link?: string | null; source?: string | null }>,
): NewsBullet[] {
  if (!items.length || !catalog.length) return items;
  return items.map((it) => {
    if (it.link) return it;
    const t = it.title.toLowerCase();
    const hit = catalog.find((c) => {
      const ct = (c.title || "").toLowerCase();
      return ct && (ct.includes(t.slice(0, 40)) || t.includes(ct.slice(0, 40)));
    });
    if (hit?.link && /^https?:\/\//i.test(hit.link)) {
      return {
        ...it,
        link: hit.link,
        source: it.source || hit.source || undefined,
      };
    }
    return it;
  });
}

function parseMorning(raw: string): ReportLlmNarrative | null {
  const match = raw.trim().match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const o = JSON.parse(match[0]) as Record<string, unknown>;
    const headline = str(o.headline, 160) || "Điểm tin đầu ngày & chiến lược thận trọng";
    const lede = str(o.lede, 500);
    const conclusion = stripBasket(str(o.conclusion, 700));
    const recommendation = stripBasket(
      str(o.recommendation, 500) ||
        "Giữ tỷ trọng 30–45%. Không mua đuổi, không dùng margin cao. Cắt lỗ −5% đến −7%.",
    );
    if (!lede && !conclusion) return null;

    const strategyPoints = arrStr(o.strategyPoints, 8, 420);
    const risks = arrStr(o.risks, 6, 320);
    const macroNews = bullets(o.macroNews, 8);
    const corporateNews = bullets(o.corporateNews, 8);
    const marketNews = bullets(o.marketNews, 8);

    const marketCommentary =
      str(o.marketIntro, 800) || str(o.macroIntro, 800) || conclusion;

    return {
      headline,
      lede:
        lede ||
        "Bản tin đầu ngày tổng hợp tin vĩ mô, doanh nghiệp và thị trường, kèm chiến lược thận trọng ưu tiên bảo toàn vốn.",
      macroIntro: str(o.macroIntro, 900),
      macroNews,
      macroCommoditiesNote: str(o.macroCommoditiesNote, 500),
      corporateIntro: str(o.corporateIntro, 500),
      corporateNews,
      corporateNote: str(o.corporateNote, 400),
      marketIntro: str(o.marketIntro, 900),
      marketNews,
      cryptoLine: str(o.cryptoLine, 280),
      strategyIntro: stripBasket(str(o.strategyIntro, 600)),
      strategyPoints,
      risks,
      riskWarning: str(o.riskWarning, 500),
      conclusion:
        conclusion ||
        "Phiên hôm nay nghiêng về kịch bản giằng co; ưu tiên quan sát và chọn lọc.",
      recommendation,
      newsInsights: [...macroNews, ...corporateNews, ...marketNews].map((n) => n.title),
      actionPoints: strategyPoints,
      marketCommentary,
      watchlist: [],
      classifiedNews: [],
      indexImpacts: [],
    };
  } catch {
    return null;
  }
}

export async function generateReportNarrative(
  kind: ReportLlmKind,
  context: Record<string, unknown>,
): Promise<ReportLlmNarrative | null> {
  if (process.env.LLM_REPORTS_DISABLED === "1") return null;

  const log = forProvider("reports-llm");
  const system = kind === "morning" ? MORNING_SYSTEM : SUMMARY_SYSTEM;
  const task =
    kind === "morning"
      ? "Viết Morning Brief đúng mẫu. Mỗi tin kèm link nếu có. Không liệt kê danh mục cổ phiếu tham khảo."
      : "Viết tổng kết cuối phiên; marketNews kèm link gốc. Không danh mục tham khảo.";

  const user = [
    `LOẠI: ${kind}`,
    task,
    "",
    "DỮ LIỆU DATA ENGINE (JSON):",
    JSON.stringify(context).slice(0, 16_000),
    "",
    "Trả về đúng schema JSON đã quy định.",
  ].join("\n");

  try {
    const llm = await chatWithFallback(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      {
        maxTokens: kind === "morning" ? 3200 : 2200,
        temperature: 0.28,
        timeoutMs: 42_000,
      },
    );
    if (!llm) {
      log.warn("report_llm_unavailable", { kind });
      return null;
    }
    const parsed = parseMorning(llm.text);
    if (!parsed) {
      log.warn("report_llm_parse_failed", { kind, snippet: llm.text.slice(0, 180) });
      return null;
    }
    parsed.model = llm.model;
    parsed.provider = llm.provider;
    log.info("report_llm_ok", {
      kind,
      provider: llm.provider,
      model: llm.model,
      latencyMs: llm.latencyMs,
      macro: parsed.macroNews.length,
      corporate: parsed.corporateNews.length,
      market: parsed.marketNews.length,
    });
    return parsed;
  } catch (err) {
    log.warn("report_llm_error", {
      kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
