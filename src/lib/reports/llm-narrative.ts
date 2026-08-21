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
}

export interface MorningBriefContent {
  headline: string;
  lede: string;
  /** 01 · Điểm tin vĩ mô */
  macroIntro: string;
  macroNews: NewsBullet[];
  macroCommoditiesNote: string;
  /** 02 · Tin doanh nghiệp */
  corporateIntro: string;
  corporateNews: NewsBullet[];
  corporateNote: string;
  /** 03 · Tin thị trường */
  marketIntro: string;
  marketNews: NewsBullet[];
  cryptoLine: string;
  /** 04 · Chiến lược thận trọng */
  strategyIntro: string;
  strategyPoints: string[];
  /** 05 · Rủi ro */
  risks: string[];
  riskWarning: string;
  conclusion: string;
  recommendation: string;
  model?: string;
  provider?: string;
}

/** Compatibility shape used by summary + older callers */
export interface ReportLlmNarrative extends MorningBriefContent {
  newsInsights: string[];
  actionPoints: string[];
  marketCommentary: string;
  watchlist: string[];
  classifiedNews: never[];
  indexImpacts: never[];
}

const MORNING_SYSTEM = `Bạn là biên tập viên Morning Brief của ORCA FINANCIAL.
Nhiệm vụ: viết BẢN TIN ĐẦU NGÀY theo ĐÚNG cấu trúc mẫu báo cáo chuyên nghiệp dưới đây, dựa CHỈ trên JSON Data Engine.

CẤU TRÚC BẮT BUỘC (giọng tiếng Việt chuyên nghiệp, súc tích, không sáo rỗng):
01 · ĐIỂM TIN VĨ MÔ — chọn tin vĩ mô / chính sách / quốc tế / tỷ giá / hàng hoá có khả năng chi phối tâm lý TTCK VN hôm nay.
02 · TIN DOANH NGHIỆP — tin KQKD, nhân sự, sự kiện DN nổi bật 24h.
03 · TIN THỊ TRƯỜNG — diễn biến phiên trước, dòng tiền, khối ngoại, tín hiệu mở cửa (dùng số liệu VN-Index nếu có).
04 · CHIẾN LƯỢC THẬN TRỌNG — kỷ luật giao dịch, tỷ trọng, danh mục phòng thủ, hỗ trợ/kháng cự nếu có số.
05 · RỦI RO CẦN CẢNH GIÁC — 3–5 rủi ro cụ thể + một đoạn CẢNH BÁO RỦI RO tổng hợp.
Cuối: KẾT LUẬN & NHẬN ĐỊNH CHỐT + KHUYẾN NGHỊ CHIẾN LƯỢC ngắn, hành động được.

QUY TẮC:
1. Không bịa giá/%/điểm; thiếu số liệu thì nói "chưa có dữ liệu".
2. Mỗi bullet tin: giữ nguyên ý tiêu đề tin từ nguồn; ghi source nếu có.
3. Bỏ tin nhiễu (giật gân không liên quan TTCK) — ưu tiên tin ảnh hưởng dòng tiền/tâm lý.
4. headline mặc định gần với: "Điểm tin đầu ngày & chiến lược thận trọng".
5. Trả JSON thuần (không markdown fence):
{
  "headline": string,
  "lede": string,
  "macroIntro": string,
  "macroNews": [{ "title": string, "source": string, "time": string }],
  "macroCommoditiesNote": string,
  "corporateIntro": string,
  "corporateNews": [{ "title": string, "source": string, "time": string }],
  "corporateNote": string,
  "marketIntro": string,
  "marketNews": [{ "title": string, "source": string, "time": string }],
  "cryptoLine": string,
  "strategyIntro": string,
  "strategyPoints": string[],
  "risks": string[],
  "riskWarning": string,
  "conclusion": string,
  "recommendation": string
}`;

const SUMMARY_SYSTEM = `Bạn là chuyên gia tổng kết cuối phiên ORCA FINANCIAL.
Dựa CHỈ trên JSON, viết nhận định cuối phiên. Không bịa số liệu. JSON thuần:
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
  "marketNews": [{ "title": string, "source": string, "time": string }],
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
    });
  }
  return out;
}

function arrStr(v: unknown, maxItems = 10, maxLen = 400): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, maxItems)
    .map((x) => x.trim().slice(0, maxLen));
}

function parseMorning(raw: string): ReportLlmNarrative | null {
  const match = raw.trim().match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const o = JSON.parse(match[0]) as Record<string, unknown>;
    const headline = str(o.headline, 160) || "Điểm tin đầu ngày & chiến lược thận trọng";
    const lede = str(o.lede, 500);
    const conclusion = str(o.conclusion, 700);
    const recommendation = str(o.recommendation, 500);
    if (!lede && !conclusion) return null;

    const strategyPoints = arrStr(o.strategyPoints, 8, 420);
    const risks = arrStr(o.risks, 6, 320);
    const macroNews = bullets(o.macroNews, 8);
    const corporateNews = bullets(o.corporateNews, 8);
    const marketNews = bullets(o.marketNews, 8);

    const marketCommentary =
      str(o.marketIntro, 800) ||
      str(o.macroIntro, 800) ||
      conclusion;

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
      strategyIntro: str(o.strategyIntro, 600),
      strategyPoints,
      risks,
      riskWarning: str(o.riskWarning, 500),
      conclusion:
        conclusion ||
        "Phiên hôm nay nghiêng về kịch bản giằng co; ưu tiên quan sát và chọn lọc.",
      recommendation:
        recommendation ||
        "Giữ tỷ trọng 30–45%. Không mua đuổi, không dùng margin cao. Cắt lỗ −5% đến −7%.",
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
      ? "Viết Morning Brief đúng mẫu: 01 Vĩ mô → 02 Doanh nghiệp → 03 Thị trường → 04 Chiến lược → 05 Rủi ro → Kết luận → Khuyến nghị. Lọc tin nhiễu, ưu tiên tin ảnh hưởng TTCK VN."
      : "Viết tổng kết cuối phiên: diễn biến, tin đáng chú ý, rủi ro, khuyến nghị phiên tới.";

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
