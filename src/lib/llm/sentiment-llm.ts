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

/** Compact prompt for follow-up turns (lower latency). */
export async function agentNarrativeDetailed(
  userQuestion: string,
  contextBlock: string,
  opts: { followUp?: boolean } = {},
): Promise<AgentNarrativeMeta> {
  const followUp = Boolean(opts.followUp);
  // Cap context size to cut tokens/latency on continuous chat
  const ctx = contextBlock.length > 3500 ? contextBlock.slice(0, 3500) + "\n…" : contextBlock;

  const detailed = await chatWithFallbackDetailed(
    [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      {
        role: "user",
        content: followUp
          ? [
              "Ngữ cảnh số liệu (nội bộ, không trích nhãn):",
              ctx,
              "",
              `Câu hỏi tiếp: "${userQuestion}"`,
              "",
              "Trả lời ngắn–vừa (120–280 chữ), thẳng ý, có số nếu có, 1–2 việc làm ngay. Không markdown. Disclaimer ngắn.",
            ].join("\n")
          : [
              "Ghi chú nội bộ (chỉ tham khảo — KHÔNG trích nhãn):",
              "",
              ctx,
              "",
              "---",
              `Khách vừa nhắn: "${userQuestion}"`,
              "",
              "Trả lời như cố vấn chat trực tiếp: mở thẳng ý, thân bài rõ có số liệu, 1–3 việc làm ngay, 150–350 chữ, không markdown, disclaimer ngắn.",
            ].join("\n"),
      },
    ],
    {
      maxTokens: followUp ? 1200 : 1800,
      temperature: 0.4,
      timeoutMs: followUp ? 14_000 : 16_000,
    },
  );

  return {
    result: detailed.result,
    errors: detailed.errors,
    attempted: detailed.attempted,
    transient: detailed.transient,
  };
}
