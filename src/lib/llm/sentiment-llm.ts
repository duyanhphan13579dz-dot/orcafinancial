import { analyzeSentiment, sentimentLabel } from "@/lib/sentiment";
import { logger } from "@/lib/logger";

import { AGENT_SYSTEM_PROMPT, SENTIMENT_SYSTEM_PROMPT, buildSentimentUserPrompt } from "./prompts";
import { chatWithFallback, chatWithFallbackDetailed } from "./router";
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
  mode: "full" | "compact",
): string {
  if (mode === "compact") {
    return [
      "Số liệu nội bộ (tham khảo):",
      ctx,
      "",
      `Câu hỏi: "${userQuestion}"`,
      "",
      "Trả lời tự nhiên như chat, có số nếu cần, 100–220 chữ. Không markdown.",
    ].join("\n");
  }

  return [
    "Số liệu thô từ Data Engine — viết lại thành lời cố vấn, không copy nguyên xi:",
    ctx,
    "",
    "---",
    `Khách hỏi: "${userQuestion}"`,
    "",
    "Viết như người đang chat: mở thẳng ý, số liệu lồng trong câu, gợi ý việc làm, disclaimer ngắn.",
    "150–300 chữ. Không markdown. Không lộ hệ thống nội bộ.",
  ].join("\n");
}

/** One sequential pass Groq → OpenRouter (no long rescue) to avoid gateway kill. */
export async function agentNarrativeDetailed(
  userQuestion: string,
  contextBlock: string,
  opts: { followUp?: boolean } = {},
): Promise<AgentNarrativeMeta> {
  const followUp = Boolean(opts.followUp);
  const ctx = contextBlock.length > 2400 ? contextBlock.slice(0, 2400) + "\n…" : contextBlock;

  const detailed = await chatWithFallbackDetailed(
    [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildUserPrompt(userQuestion, ctx, followUp ? "compact" : "full"),
      },
    ],
    {
      maxTokens: followUp ? 1000 : 1400,
      temperature: 0.5,
      timeoutMs: followUp ? 12_000 : 14_000,
    },
  );

  if (detailed.result?.text?.trim()) {
    return {
      result: detailed.result,
      errors: detailed.errors,
      attempted: detailed.attempted,
      transient: false,
    };
  }

  logger.error("agent_narrative_failed", {
    transient: detailed.transient,
    errors: detailed.errors.slice(0, 6),
  });

  return {
    result: null,
    errors: detailed.errors,
    attempted: detailed.attempted,
    transient: detailed.transient,
  };
}
