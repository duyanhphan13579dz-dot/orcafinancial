import { chatWithFallback } from "@/lib/llm";

export interface AnalysisLaneOutput {
  focus: string;
  keyFindings: string[];
  caveats: string[];
  charts: Array<{
    type: "line" | "bar" | "area" | "pie";
    title: string;
    xKey: string;
    yKeys: string[];
  }>;
}

const ANALYSIS_SYSTEM = [
  "Bạn là lane phân tích dữ liệu của ORCA Financial.",
  "Bạn chỉ được diễn giải dữ liệu deterministic đã cung cấp; không được tự tính lại hoặc tạo số liệu mới.",
  "Không gọi market-proxy là BCTC reported. Không được tạo doanh thu, lợi nhuận, EPS, tài sản, nợ, CFO, CFI, CFF hoặc định giá nếu không có trong dữ liệu.",
  "Chọn các insight liên quan nhất đến focus và đề xuất chart schema phù hợp với các key thực sự tồn tại.",
  "Trả về JSON thuần đúng schema: focus, keyFindings, caveats, charts.",
].join("\n");

function parseOutput(text: string): AnalysisLaneOutput | null {
  try {
    const parsed = JSON.parse(text) as Partial<AnalysisLaneOutput>;
    if (typeof parsed.focus !== "string" || !Array.isArray(parsed.keyFindings) || !Array.isArray(parsed.caveats) || !Array.isArray(parsed.charts)) {
      return null;
    }
    const charts = parsed.charts.filter(
      (chart): chart is AnalysisLaneOutput["charts"][number] =>
        Boolean(chart && typeof chart.title === "string" && typeof chart.xKey === "string" && Array.isArray(chart.yKeys) &&
          ["line", "bar", "area", "pie"].includes(chart.type)),
    );
    return {
      focus: parsed.focus.slice(0, 500),
      keyFindings: parsed.keyFindings.filter((item): item is string => typeof item === "string").slice(0, 8),
      caveats: parsed.caveats.filter((item): item is string => typeof item === "string").slice(0, 8),
      charts: charts.slice(0, 6),
    };
  } catch {
    return null;
  }
}

export async function runAnalysisLane(input: {
  focus: string;
  deterministicReport: unknown;
}): Promise<AnalysisLaneOutput | null> {
  const text = await chatWithFallback(
    [
      { role: "system", content: ANALYSIS_SYSTEM },
      {
        role: "user",
        content: [
          `FOCUS: ${input.focus.slice(0, 300)}`,
          "DỮ LIỆU DETERMINISTIC:",
          JSON.stringify(input.deterministicReport).slice(0, 14_000),
        ].join("\n"),
      },
    ],
    {
      purpose: "analysis",
      responseFormat: "json_object",
      reasoningEffort: "medium",
      maxTokens: 2_000,
      temperature: 0.2,
      timeoutMs: 25_000,
      overallTimeoutMs: 35_000,
    },
  );
  return text ? parseOutput(text.text) : null;
}
