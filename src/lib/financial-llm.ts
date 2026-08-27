import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureFinancialIngestionTables } from "@/db/ensure-financial-ingestion-tables";
import { financialLlmOutputs, financialNormalizedFacts } from "@/db/schema";
import { chatWithFallback } from "@/lib/llm";

export type FinancialAnalysisType = "basic" | "financials";

const BASIC_SCHEMA = {
  type: "object",
  properties: {
    overview: { type: "string" },
    positives: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    charts: {
      type: "object",
      properties: {
        revenue: { type: "array", items: { type: "object", properties: { period: { type: "string" }, value: { type: "number" } }, required: ["period", "value"], additionalProperties: false } },
        ebitda: { type: "array", items: { type: "object", properties: { period: { type: "string" }, value: { type: "number" } }, required: ["period", "value"], additionalProperties: false } },
        netIncome: { type: "array", items: { type: "object", properties: { period: { type: "string" }, value: { type: "number" } }, required: ["period", "value"], additionalProperties: false } },
      },
      required: ["revenue", "ebitda", "netIncome"],
      additionalProperties: false,
    },
  },
  required: ["overview", "positives", "risks", "charts"],
  additionalProperties: false,
};

const FINANCIALS_SCHEMA = {
  type: "object",
  properties: {
    incomeStatement: { type: "array", items: { type: "object", properties: { period: { type: "string" }, revenue: { type: "number" }, grossProfit: { type: "number" }, ebitda: { type: "number" }, netIncome: { type: "number" } }, required: ["period", "revenue", "grossProfit", "ebitda", "netIncome"], additionalProperties: false } },
    balanceSheet: { type: "array", items: { type: "object", properties: { period: { type: "string" }, totalAssets: { type: "number" }, totalLiabilities: { type: "number" }, equity: { type: "number" }, cash: { type: "number" } }, required: ["period", "totalAssets", "totalLiabilities", "equity", "cash"], additionalProperties: false } },
    cashFlowStatement: { type: "array", items: { type: "object", properties: { period: { type: "string" }, operatingCashFlow: { type: "number" }, investingCashFlow: { type: "number" }, financingCashFlow: { type: "number" }, freeCashFlow: { type: "number" } }, required: ["period", "operatingCashFlow", "investingCashFlow", "financingCashFlow", "freeCashFlow"], additionalProperties: false } },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["incomeStatement", "balanceSheet", "cashFlowStatement", "notes"],
  additionalProperties: false,
};

function fingerprint(symbol: string, type: FinancialAnalysisType, facts: unknown): string {
  return createHash("sha256").update(JSON.stringify({ symbol, type, facts })).digest("hex");
}

function parseJson(text: string): Record<string, unknown> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("LLM không trả JSON hợp lệ.");
  const parsed: unknown = JSON.parse(match[0]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("LLM trả JSON không đúng dạng object.");
  return parsed as Record<string, unknown>;
}

function promptFor(type: FinancialAnalysisType, symbol: string, facts: unknown): string {
  const schema = type === "basic" ? BASIC_SCHEMA : FINANCIALS_SCHEMA;
  return `Bạn là chuyên gia phân tích báo cáo tài chính Việt Nam. Mã cổ phiếu: ${symbol}. Dữ liệu dưới đây là normalized facts đã qua data-engine quality gate. Chỉ được sao chép đúng số liệu, kỳ, đơn vị và phạm vi báo cáo; không được tự tạo, nội suy, làm tròn hoặc thay đổi số. Nếu thiếu trường, dùng 0 chỉ khi dữ liệu nguồn thực sự ghi nhận 0; nếu không thể xác định, trả về lỗi thay vì đoán. Trả đúng JSON theo schema sau, không markdown. Với mục basic, tạo chuỗi chart theo từng period cho revenue, ebitda, netIncome. Với mục financials, lập ba bảng: kết quả kinh doanh, cân đối kế toán và lưu chuyển tiền tệ. Mọi nhận xét phải nêu rõ kỳ và nguồn, không gọi estimate là actual.\nSCHEMA=${JSON.stringify(schema)}\nFACTS=${JSON.stringify(facts)}`;
}

function assertOutput(type: FinancialAnalysisType, output: Record<string, unknown>): void {
  const required = type === "basic" ? ["overview", "positives", "risks", "charts"] : ["incomeStatement", "balanceSheet", "cashFlowStatement", "notes"];
  for (const key of required) if (!(key in output)) throw new Error(`LLM output thiếu trường ${key}.`);
}

export async function generateFinancialLlmOutput(symbol: string, type: FinancialAnalysisType, limit = 8) {
  await ensureFinancialIngestionTables();
  const facts = await db.select().from(financialNormalizedFacts).where(eq(financialNormalizedFacts.symbol, symbol)).orderBy(desc(financialNormalizedFacts.fiscalYear), desc(financialNormalizedFacts.period)).limit(Math.min(60, Math.max(3, limit * 3)));
  const accepted = facts.filter((fact) => fact.qualityStatus === "accepted" && fact.verificationStatus === "verified");
  if (!accepted.length) throw new Error(`Chưa có normalized facts đạt quality gate cho ${symbol}.`);
  const inputFingerprint = fingerprint(symbol, type, accepted);
  const previous = await db.select({ output: financialLlmOutputs.output, model: financialLlmOutputs.model, updatedAt: financialLlmOutputs.updatedAt }).from(financialLlmOutputs).where(eq(financialLlmOutputs.inputFingerprint, inputFingerprint)).limit(1);
  if (previous[0]) return { output: previous[0].output, model: previous[0].model, cached: true, inputFingerprint, factCount: accepted.length };

  const result = await chatWithFallback([
    { role: "system", content: "Bạn chỉ trả về JSON hợp lệ theo yêu cầu. Không sử dụng kiến thức bên ngoài dữ liệu được cung cấp." },
    { role: "user", content: promptFor(type, symbol, accepted) },
  ], { maxTokens: type === "financials" ? 10000 : 6000, temperature: 0.1 });
  if (!result) throw new Error("Chưa cấu hình LLM provider khả dụng.");
  const output = parseJson(result.text);
  assertOutput(type, output);
  await db.insert(financialLlmOutputs).values({
    symbol,
    analysisType: type,
    periodKey: accepted.map((fact) => `${fact.period}/${fact.fiscalYear}`).join(","),
    inputFingerprint,
    model: result.model,
    sourceDocumentIds: accepted.map((fact) => fact.documentId).filter((id): id is number => id != null),
    output,
    status: "valid",
  }).onConflictDoUpdate({
    target: financialLlmOutputs.inputFingerprint,
    set: { output, model: result.model, sourceDocumentIds: accepted.map((fact) => fact.documentId).filter((id): id is number => id != null), status: "valid", updatedAt: new Date() },
  });
  return { output, model: result.model, cached: false, inputFingerprint, factCount: accepted.length };
}
