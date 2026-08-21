/**
 * LLM narrative for Morning Brief & Market Summary.
 *
 * Morning pipeline (as designed):
 * 1. Data Engine supplies news + VN/global indices
 * 2. LLM classifies news: vi mô / vĩ mô / trong nước / quốc tế / doanh nghiệp
 * 3. LLM scores impact of key news
 * 4. LLM assesses VN → world index moves impact
 * 5. Strategy conclusion for the opening session
 */
import { chatWithFallback } from "@/lib/llm/router";
import { forProvider } from "@/lib/logger";

export type ReportLlmKind = "morning" | "summary";

export type NewsCategory =
  | "vi_mo"
  | "vi_mo_macro"
  | "trong_nuoc"
  | "quoc_te"
  | "doanh_nghiep";

export type ImpactLevel = "thap" | "trung_binh" | "cao" | "rat_cao";

export interface ClassifiedNewsItem {
  title: string;
  category: NewsCategory;
  impact: ImpactLevel;
  /** Vì sao tin này quan trọng với phiên hôm nay */
  rationale: string;
  source?: string;
}

export interface IndexImpactItem {
  name: string;
  changePct: number | null;
  impact: ImpactLevel;
  note: string;
}

export interface ReportLlmNarrative {
  headline: string;
  lede: string;
  /** Classified + scored news (morning) */
  classifiedNews: ClassifiedNewsItem[];
  /** Legacy flat list still used by summary */
  newsInsights: string[];
  /** Assessment of VN + global index moves */
  indexImpacts: IndexImpactItem[];
  /** Multi-paragraph market commentary */
  marketCommentary: string;
  actionPoints: string[];
  conclusion: string;
  recommendation: string;
  watchlist: string[];
  model?: string;
  provider?: string;
}

const MORNING_SYSTEM = `Bạn là chuyên gia phân tích đầu phiên của ORCA FINANCIAL (thị trường chứng khoán Việt Nam).

QUY TRÌNH BẮT BUỘC (làm đúng thứ tự, dựa CHỈ trên JSON dữ liệu):
1) Phân loại từng tin quan trọng vào đúng một nhóm:
   - "vi_mo": vi mô ngành / dòng tiền / kỹ thuật hẹp
   - "vi_mo_macro": vĩ mô (lãi suất, lạm phát, tỷ giá, chính sách tiền tệ/tài khóa)
   - "trong_nuoc": sự kiện trong nước (chính sách VN, TTCK VN, pháp lý)
   - "quoc_te": sự kiện quốc tế ảnh hưởng VN
   - "doanh_nghiep": kết quả KD, M&A, lãnh đạo, sự cố doanh nghiệp
2) Chấm mức độ ảnh hưởng của mỗi tin: "thap" | "trung_binh" | "cao" | "rat_cao" + rationale ngắn.
3) Đánh giá ảnh hưởng của biến động chỉ số VN (VN-Index, HNX, UPCOM) và thế giới (nếu có trong dữ liệu) tới phiên mở cửa hôm nay.
4) Kết luận chiến lược đầu ngày: tỷ trọng, ưu tiên ngành/mã, rủi ro cần tránh.

QUY TẮC:
- Không bịa số liệu; thiếu dữ liệu thì ghi "chưa có dữ liệu".
- Ưu tiên tin impact cao/rất cao; bỏ tin nhiễu.
- Giọng tiếng Việt chuyên nghiệp, súc tích.
- Trả về JSON thuần (không markdown) theo schema:
{
  "headline": string,
  "lede": string,
  "classifiedNews": [
    { "title": string, "category": "vi_mo"|"vi_mo_macro"|"trong_nuoc"|"quoc_te"|"doanh_nghiep", "impact": "thap"|"trung_binh"|"cao"|"rat_cao", "rationale": string, "source": string }
  ],
  "indexImpacts": [
    { "name": string, "changePct": number|null, "impact": "thap"|"trung_binh"|"cao"|"rat_cao", "note": string }
  ],
  "marketCommentary": string,
  "actionPoints": string[],
  "conclusion": string,
  "recommendation": string,
  "watchlist": string[]
}`;

const SUMMARY_SYSTEM = `Bạn là chuyên gia tổng kết cuối phiên của ORCA FINANCIAL.
Dựa CHỈ trên JSON dữ liệu, viết nhận định chuyên sâu bằng tiếng Việt.
Không bịa số liệu. Trả JSON thuần:
{
  "headline": string,
  "lede": string,
  "newsInsights": string[],
  "marketCommentary": string,
  "actionPoints": string[],
  "conclusion": string,
  "recommendation": string,
  "watchlist": string[],
  "classifiedNews": [],
  "indexImpacts": []
}`;

const CATEGORIES = new Set<string>([
  "vi_mo",
  "vi_mo_macro",
  "trong_nuoc",
  "quoc_te",
  "doanh_nghiep",
]);
const IMPACTS = new Set<string>(["thap", "trung_binh", "cao", "rat_cao"]);

function str(v: unknown, max = 800): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function arrStr(v: unknown, maxItems = 12, maxLen = 360): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, maxItems)
    .map((x) => x.trim().slice(0, maxLen));
}

function parseClassified(raw: unknown): ClassifiedNewsItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ClassifiedNewsItem[] = [];
  for (const item of raw.slice(0, 16)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = str(o.title, 280);
    if (!title) continue;
    const category = CATEGORIES.has(String(o.category)) ? (o.category as NewsCategory) : "trong_nuoc";
    const impact = IMPACTS.has(String(o.impact)) ? (o.impact as ImpactLevel) : "trung_binh";
    out.push({
      title,
      category,
      impact,
      rationale: str(o.rationale, 280) || "—",
      source: str(o.source, 80) || undefined,
    });
  }
  return out;
}

function parseIndexImpacts(raw: unknown): IndexImpactItem[] {
  if (!Array.isArray(raw)) return [];
  const out: IndexImpactItem[] = [];
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = str(o.name, 80);
    if (!name) continue;
    const cp = o.changePct;
    const changePct =
      typeof cp === "number" && Number.isFinite(cp)
        ? cp
        : cp === null
          ? null
          : Number.isFinite(Number(cp))
            ? Number(cp)
            : null;
    const impact = IMPACTS.has(String(o.impact)) ? (o.impact as ImpactLevel) : "trung_binh";
    out.push({
      name,
      changePct,
      impact,
      note: str(o.note, 320) || "—",
    });
  }
  return out;
}

function parseNarrative(raw: string): ReportLlmNarrative | null {
  const match = raw.trim().match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const headline = str(obj.headline, 180);
    const marketCommentary = str(obj.marketCommentary, 3200);
    if (!headline || !marketCommentary) return null;

    const classifiedNews = parseClassified(obj.classifiedNews);
    const newsInsights =
      arrStr(obj.newsInsights, 12, 360) ||
      classifiedNews.map((n) => `[${n.impact}] ${n.title}: ${n.rationale}`);

    return {
      headline,
      lede: str(obj.lede, 450) || marketCommentary.slice(0, 220),
      classifiedNews,
      newsInsights,
      indexImpacts: parseIndexImpacts(obj.indexImpacts),
      marketCommentary,
      actionPoints: arrStr(obj.actionPoints, 10, 400),
      conclusion: str(obj.conclusion, 600) || "Ưu tiên quan sát và bảo toàn vốn đầu phiên.",
      recommendation:
        str(obj.recommendation, 600) ||
        "Giữ tỷ trọng vừa phải; chờ tín hiệu rõ sau 30–60 phút đầu phiên.",
      watchlist: arrStr(obj.watchlist, 12, 40),
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
      ? [
          "THỰC HIỆN ĐÚNG 4 BƯỚC:",
          "(1) Phân loại tin: vi mô / vĩ mô / trong nước / quốc tế / doanh nghiệp",
          "(2) Chấm impact từng tin quan trọng",
          "(3) Đánh giá ảnh hưởng biến động chỉ số VN → thế giới tới phiên mở cửa",
          "(4) Kết luận chiến lược đầu ngày (tỷ trọng, ưu tiên, rủi ro)",
        ].join("\n")
      : "Tổng kết cuối phiên: nhận định sâu, tin đáng chú ý, ba kịch bản phiên tới, khuyến nghị.";

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
        maxTokens: kind === "morning" ? 2800 : 2200,
        temperature: 0.3,
        timeoutMs: 40_000,
      },
    );
    if (!llm) {
      log.warn("report_llm_unavailable", { kind });
      return null;
    }
    const parsed = parseNarrative(llm.text);
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
      classified: parsed.classifiedNews.length,
      indexImpacts: parsed.indexImpacts.length,
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
