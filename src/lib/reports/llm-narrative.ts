/**
 * LLM narrative for Morning Brief & Market Summary.
 * Falls back to null when no provider is configured or call fails.
 */
import { chatWithFallback } from "@/lib/llm/router";
import { forProvider } from "@/lib/logger";

export type ReportLlmKind = "morning" | "summary";

export interface ReportLlmNarrative {
  headline: string;
  lede: string;
  /** 5–10 bullet points: tin cần chú ý + vì sao quan trọng */
  newsInsights: string[];
  /** 2–4 đoạn nhận định thị trường chi tiết */
  marketCommentary: string;
  /** Ba kịch bản (summary) hoặc chiến lược phiên (morning) */
  actionPoints: string[];
  conclusion: string;
  recommendation: string;
  /** Mã / chủ đề cần theo dõi */
  watchlist: string[];
  model?: string;
  provider?: string;
}

const SYSTEM = `Bạn là chuyên gia phân tích thị trường chứng khoán Việt Nam của ORCA FINANCIAL.
Nhiệm vụ: viết nội dung báo cáo chuyên sâu bằng tiếng Việt, dựa CHỈ trên dữ liệu JSON được cung cấp.

QUY TẮC:
1. Không bịa số liệu, giá, % thay đổi — chỉ dùng số trong dữ liệu.
2. Nếu thiếu dữ liệu thì nói rõ "chưa có dữ liệu" thay vì suy đoán.
3. Giọng văn chuyên nghiệp, súc tích, có chiều sâu (không sáo rỗng).
4. Nhấn mạnh tin / sự kiện CÓ ẢNH HƯỞNG tới VN-Index, thanh khoản, dòng tiền ngành.
5. Khuyến nghị phải cụ thể (tỷ trọng, vùng hỗ trợ/kháng cự nếu có số).
6. Luôn nhớ đây là tham khảo, không phải lời khuyên đầu tư.
7. Trả về ĐÚNG JSON thuần (không markdown fence), schema:
{
  "headline": string,
  "lede": string,
  "newsInsights": string[],
  "marketCommentary": string,
  "actionPoints": string[],
  "conclusion": string,
  "recommendation": string,
  "watchlist": string[]
}`;

function parseNarrative(raw: string): ReportLlmNarrative | null {
  const match = raw.trim().match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const str = (v: unknown, max = 800) =>
      typeof v === "string" ? v.trim().slice(0, max) : "";
    const arr = (v: unknown, maxItems = 12, maxLen = 320): string[] =>
      Array.isArray(v)
        ? v
            .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
            .slice(0, maxItems)
            .map((x) => x.trim().slice(0, maxLen))
        : [];

    const headline = str(obj.headline, 160);
    const lede = str(obj.lede, 400);
    const marketCommentary = str(obj.marketCommentary, 2500);
    const conclusion = str(obj.conclusion, 500);
    const recommendation = str(obj.recommendation, 500);
    if (!headline || !marketCommentary) return null;

    return {
      headline,
      lede:
        lede ||
        marketCommentary.slice(0, 220) +
          (marketCommentary.length > 220 ? "…" : ""),
      newsInsights: arr(obj.newsInsights, 10, 360),
      marketCommentary,
      actionPoints: arr(obj.actionPoints, 8, 400),
      conclusion: conclusion || "Theo dõi sát diễn biến phiên; ưu tiên bảo toàn vốn.",
      recommendation:
        recommendation ||
        "Giữ tỷ trọng vừa phải, chờ tín hiệu rõ hơn trước khi mở vị thế mới.",
      watchlist: arr(obj.watchlist, 10, 40),
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
  const task =
    kind === "morning"
      ? "Viết Morning Brief (bản tin đầu ngày): chọn tin quan trọng nhất, nhận định trước phiên, chiến lược thận trọng."
      : "Viết Market Summary (tổng kết cuối phiên): đọc vị phiên hôm nay chi tiết, ba kịch bản phiên tới, khuyến nghị hành động."

  const user = [
    `LOẠI BÁO CÁO: ${kind}`,
    `NHIỆM VỤ: ${task}`,
    "",
    "DỮ LIỆU TỔNG HỢP TỪ DATA ENGINE (JSON):",
    JSON.stringify(context).slice(0, 14_000),
    "",
    "Hãy trả về JSON theo schema đã quy định. Ưu tiên chiều sâu phân tích, không liệt kê máy móc.",
  ].join("\n");

  try {
    const llm = await chatWithFallback(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
      {
        maxTokens: 2200,
        temperature: 0.35,
        timeoutMs: 35_000,
      },
    );
    if (!llm) {
      log.warn("report_llm_unavailable", { kind });
      return null;
    }
    const parsed = parseNarrative(llm.text);
    if (!parsed) {
      log.warn("report_llm_parse_failed", {
        kind,
        snippet: llm.text.slice(0, 160),
      });
      return null;
    }
    parsed.model = llm.model;
    parsed.provider = llm.provider;
    log.info("report_llm_ok", {
      kind,
      provider: llm.provider,
      model: llm.model,
      latencyMs: llm.latencyMs,
      insights: parsed.newsInsights.length,
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
