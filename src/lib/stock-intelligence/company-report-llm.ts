import { chatWithFallback } from "@/lib/llm";

export interface CompanyReportLlmNarrative {
  executiveSummary: string;
  investmentThesis: string[];
  businessModel: string;
  industryCompetitivePositioning: string;
  financialAnalysis: string;
  forecastAndAssumptions: string;
  valuationView: string;
  catalysts: string[];
  risksAndInvalidation: string[];
  esgAndGovernance: string;
  conclusion: string;
  recommendation: string;
  model?: string;
  provider?: string;
}

const SYSTEM_PROMPT = `Bạn là chuyên viên phân tích doanh nghiệp theo chuẩn báo cáo equity research quốc tế. Bạn phải viết narrative tiếng Việt theo đúng JSON schema được yêu cầu, dựa CHỈ trên dữ liệu ORCA cung cấp.

NGUYÊN TẮC BẮT BUỘC:
1. Không dùng kiến thức bên ngoài dữ liệu đầu vào.
2. Không tạo số liệu, tỷ lệ, kỳ báo cáo, giá mục tiêu, bội số định giá hoặc dự báo mới. Nếu dữ liệu thiếu, viết rõ "chưa có dữ liệu" hoặc "chưa đủ độ tin cậy".
3. Không gọi estimate/degraded/benchmark là actual hoặc số liệu đã kiểm toán.
4. Phân biệt dữ liệu lịch sử, dự báo, technical signal và investment thesis.
5. Mỗi luận điểm phải nêu cơ sở từ dữ liệu được cung cấp; không biến tương quan thành quan hệ nhân quả chắc chắn.
6. Báo cáo có thể đưa ra quan điểm nghiên cứu, nhưng phải nêu điều kiện làm suy yếu hoặc vô hiệu hóa luận điểm.
7. Không liệt kê mã cổ phiếu khác và không đưa lời khuyên cá nhân hóa.
8. Trả JSON thuần, không markdown, không thêm key.`;

const SCHEMA = {
  type: "object",
  properties: {
    executiveSummary: { type: "string" },
    investmentThesis: { type: "array", items: { type: "string" } },
    businessModel: { type: "string" },
    industryCompetitivePositioning: { type: "string" },
    financialAnalysis: { type: "string" },
    forecastAndAssumptions: { type: "string" },
    valuationView: { type: "string" },
    catalysts: { type: "array", items: { type: "string" } },
    risksAndInvalidation: { type: "array", items: { type: "string" } },
    esgAndGovernance: { type: "string" },
    conclusion: { type: "string" },
    recommendation: { type: "string" },
  },
  required: ["executiveSummary", "investmentThesis", "businessModel", "industryCompetitivePositioning", "financialAnalysis", "forecastAndAssumptions", "valuationView", "catalysts", "risksAndInvalidation", "esgAndGovernance", "conclusion", "recommendation"],
  additionalProperties: false,
};

function asText(value: unknown, max = 1800): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function asTextArray(value: unknown, maxItems = 6): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim().slice(0, 600)).slice(0, maxItems) : [];
}

function parse(raw: string): CompanyReportLlmNarrative | null {
  const match = raw.trim().match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const value = JSON.parse(match[0]) as Record<string, unknown>;
    const result: CompanyReportLlmNarrative = {
      executiveSummary: asText(value.executiveSummary),
      investmentThesis: asTextArray(value.investmentThesis),
      businessModel: asText(value.businessModel),
      industryCompetitivePositioning: asText(value.industryCompetitivePositioning),
      financialAnalysis: asText(value.financialAnalysis),
      forecastAndAssumptions: asText(value.forecastAndAssumptions),
      valuationView: asText(value.valuationView),
      catalysts: asTextArray(value.catalysts),
      risksAndInvalidation: asTextArray(value.risksAndInvalidation),
      esgAndGovernance: asText(value.esgAndGovernance),
      conclusion: asText(value.conclusion),
      recommendation: asText(value.recommendation, 700),
    };
    if (!result.executiveSummary || !result.conclusion) return null;
    return result;
  } catch {
    return null;
  }
}

export async function generateCompanyReportNarrative(context: Record<string, unknown>): Promise<CompanyReportLlmNarrative | null> {
  const user = [
    "FORM BÁO CÁO: 1) Tóm tắt điều hành 2) Luận điểm đầu tư 3) Mô hình kinh doanh 4) Ngành và vị thế cạnh tranh 5) Phân tích tài chính 6) Dự phóng và giả định 7) Quan điểm định giá 8) Catalyst 9) Rủi ro và điều kiện vô hiệu hóa 10) ESG và quản trị 11) Kết luận 12) Khuyến nghị nghiên cứu.",
    "SCHEMA:",
    JSON.stringify(SCHEMA),
    "DỮ LIỆU ORCA:",
    JSON.stringify(context).slice(0, 24_000),
    "Chỉ trả JSON theo schema.",
  ].join("\n\n");
  try {
    const result = await chatWithFallback([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: user },
    ], {
      purpose: "report",
      responseFormat: "json_object",
      reasoningEffort: "medium",
      temperature: 0.2,
      maxTokens: 7000,
      timeoutMs: 45_000,
      overallTimeoutMs: 55_000,
    });
    if (!result) return null;
    const parsed = parse(result.text);
    if (!parsed) return null;
    parsed.model = result.model;
    parsed.provider = result.provider;
    return parsed;
  } catch {
    return null;
  }
}
