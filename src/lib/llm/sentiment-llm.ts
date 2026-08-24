import { analyzeSentiment, sentimentLabel } from "@/lib/sentiment";
import { logger } from "@/lib/logger";

import { AGENT_SYSTEM_PROMPT, SENTIMENT_SYSTEM_PROMPT, buildSentimentUserPrompt } from "./prompts";
import { chatWithFallback, chatWithFallbackDetailed, chatRaceProviders } from "./router";
import type { LlmChatResult, SentimentLlmResult } from "./types";

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

function parseSentimentJson(raw: string): {
  score: number;
  label: string;
  confidence: number;
  rationale: string;
} | null {
  const match = raw.trim().match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const score = clampScore(Number(obj.score));
    const confidence = Math.max(0, Math.min(1, Number(obj.confidence ?? 0.6)));
    const label =
      typeof obj.label === "string" && obj.label.length > 0 ? obj.label : sentimentLabel(score);
    const rationale = typeof obj.rationale === "string" ? obj.rationale.slice(0, 400) : "";
    return { score, label, confidence, rationale };
  } catch {
    return null;
  }
}

export async function scoreSentimentHybrid(
  symbol: string,
  headlines: string[],
  opts: { forceRuleOnly?: boolean } = {},
): Promise<SentimentLlmResult> {
  const texts = headlines.filter((h) => h && h.trim().length > 0);
  const combined = texts.join("\n");
  const ruleScore = analyzeSentiment(combined);
  const ruleLabel = sentimentLabel(ruleScore);

  if (opts.forceRuleOnly || texts.length === 0 || process.env.LLM_SENTIMENT_DISABLED === "1") {
    return {
      score: Number(ruleScore.toFixed(3)),
      label: ruleLabel,
      confidence: texts.length > 0 ? 0.55 : 0.3,
      rationale: texts.length > 0 ? "Rule-based NLP." : "Không có tin để chấm.",
      source: "rule-engine",
    };
  }

  try {
    const llm = await chatWithFallback(
      [
        { role: "system", content: SENTIMENT_SYSTEM_PROMPT },
        { role: "user", content: buildSentimentUserPrompt(symbol, texts) },
      ],
      { maxTokens: 300, temperature: 0.1, timeoutMs: 8_000 },
    );

    if (!llm) {
      return {
        score: Number(ruleScore.toFixed(3)),
        label: ruleLabel,
        confidence: 0.55,
        rationale: "Rule-based NLP.",
        source: "rule-engine",
      };
    }

    const parsed = parseSentimentJson(llm.text);
    if (!parsed) {
      return {
        score: Number(ruleScore.toFixed(3)),
        label: ruleLabel,
        confidence: 0.55,
        rationale: "Rule-based NLP.",
        source: "rule-engine",
      };
    }

    const blended = clampScore(0.4 * ruleScore + 0.6 * parsed.score);
    return {
      score: Number(blended.toFixed(3)),
      label: sentimentLabel(blended),
      confidence: Number(Math.min(0.95, 0.5 * 0.55 + 0.5 * parsed.confidence).toFixed(2)),
      rationale: parsed.rationale || `Hybrid: rule ${ruleScore.toFixed(2)} + LLM ${parsed.score.toFixed(2)}`,
      source: "hybrid",
      model: `${llm.provider}/${llm.model}`,
    };
  } catch (err) {
    logger.warn("sentiment_llm_error", {
      symbol,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      score: Number(ruleScore.toFixed(3)),
      label: ruleLabel,
      confidence: 0.55,
      rationale: "Rule-based NLP.",
      source: "rule-engine",
    };
  }
}

export type AgentNarrativeMeta = {
  result: LlmChatResult | null;
  errors: string[];
  attempted: string[];
  transient: boolean;
};

export async function agentNarrative(
  userQuestion: string,
  contextBlock: string,
): Promise<LlmChatResult | null> {
  const { result } = await agentNarrativeDetailed(userQuestion, contextBlock);
  return result;
}

function buildUserPrompt(
  userQuestion: string,
  ctx: string,
  mode: "full" | "compact" | "rescue",
): string {
  if (mode === "rescue") {
    return [
      "Dữ liệu thô từ hệ thống (chỉ dùng số liệu, không copy khuôn mẫu):",
      ctx.slice(0, 1800),
      "",
      `Câu hỏi: "${userQuestion}"`,
      "",
      "Viết câu trả lời tự nhiên như cố vấn đang chat. Dùng số liệu ở trên nếu có.",
      "Không được trả lời kiểu template kỹ thuật (giá / RSI / Hold).",
      "Nếu thiếu BCTC quý cụ thể, nói rõ và phân tích từ dữ liệu sẵn có + gợi ý khách cần xem thêm gì.",
      "120–280 chữ, không markdown, disclaimer ngắn.",
    ].join("\n");
  }

  if (mode === "compact") {
    return [
      "Số liệu nội bộ (tham khảo, không trích nhãn):",
      ctx,
      "",
      `Câu hỏi: "${userQuestion}"`,
      "",
      "Trả lời như người, thẳng ý, có số, 1–2 việc làm ngay. Không markdown. Không lộ Data Engine.",
    ].join("\n");
  }

  return [
    "DỮ LIỆU THÔ từ Data Engine (chỉ là input số liệu — bạn phải viết lại hoàn toàn bằng lời cố vấn):",
    "",
    ctx,
    "",
    "---",
    `Khách hỏi: "${userQuestion}"`,
    "",
    "Yêu cầu bắt buộc:",
    "1) Bạn là cố vấn tài chính đang chat — viết mạch lạc, tự nhiên, giống người.",
    "2) Data Engine chỉ cung cấp số liệu thô; KHÔNG được copy nguyên câu kiểu 'giá gần nhất… tín hiệu Hold… RSI…'.",
    "3) Sắp xếp: mở bài trả lời thẳng câu hỏi → phân tích (kỹ thuật/cơ bản/bối cảnh) → 1–3 việc làm tiếp → disclaimer ngắn.",
    "4) Nếu câu hỏi về KQKD quý mà chưa có số BCTC đầy đủ trong dữ liệu: nói thẳng là chưa có đủ số liệu quý đó, rồi dùng giá/xu hướng/định giá sẵn có để đưa góc nhìn tham khảo.",
    "5) 180–400 chữ, không markdown (#, *, bullet), không nhắc intent/API/Data Engine.",
  ].join("\n");
}

/**
 * LLM-first narrative: race providers → short retry → only then null.
 * Data-engine text must never be the primary user-facing answer when LLM works.
 */
export async function agentNarrativeDetailed(
  userQuestion: string,
  contextBlock: string,
  opts: { followUp?: boolean } = {},
): Promise<AgentNarrativeMeta> {
  const followUp = Boolean(opts.followUp);
  const ctx = contextBlock.length > 3200 ? contextBlock.slice(0, 3200) + "\n…" : contextBlock;
  const allErrors: string[] = [];
  const allAttempted: string[] = [];

  // Pass 1: race GLM + OpenRouter with full/compact prompt
  const pass1 = await chatRaceProviders(
    [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildUserPrompt(userQuestion, ctx, followUp ? "compact" : "full"),
      },
    ],
    {
      maxTokens: followUp ? 1400 : 2000,
      temperature: 0.45,
      timeoutMs: followUp ? 18_000 : 24_000,
    },
  );
  allErrors.push(...pass1.errors);
  allAttempted.push(...pass1.attempted);

  if (pass1.result?.text?.trim()) {
    return {
      result: pass1.result,
      errors: allErrors,
      attempted: allAttempted,
      transient: false,
    };
  }

  // Pass 2: rescue — shorter prompt, sequential, slightly longer wait
  logger.warn("agent_narrative_pass1_failed", { errors: pass1.errors.slice(0, 3) });
  const pass2 = await chatWithFallbackDetailed(
    [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildUserPrompt(userQuestion, ctx, "rescue"),
      },
    ],
    {
      maxTokens: 1000,
      temperature: 0.4,
      timeoutMs: 20_000,
    },
  );
  allErrors.push(...pass2.errors);
  allAttempted.push(...pass2.attempted);

  if (pass2.result?.text?.trim()) {
    return {
      result: pass2.result,
      errors: allErrors,
      attempted: allAttempted,
      transient: false,
    };
  }

  const transient = pass1.transient || pass2.transient;
  logger.error("agent_narrative_all_passes_failed", {
    transient,
    errors: allErrors.slice(0, 6),
  });

  return {
    result: null,
    errors: allErrors,
    attempted: allAttempted,
    transient,
  };
}
