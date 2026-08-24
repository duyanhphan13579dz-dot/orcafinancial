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
      "Số liệu tham khảo (đừng đọc thành báo cáo):",
      ctx.slice(0, 1400),
      "",
      `Bạn vừa hỏi: "${userQuestion}"`,
      "",
      "Trả lời như đang chat với bạn thân. Nói tự nhiên, có số nếu cần, không liệt kê kiểu RSI/Hold template.",
      "Thiếu số quý thì nói thật. Khoảng 120–220 chữ. Không markdown.",
    ].join("\n");
  }

  if (mode === "compact") {
    return [
      "Số liệu nội bộ (chỉ để bạn tham khảo):",
      ctx,
      "",
      `Câu hỏi tiếp: "${userQuestion}"`,
      "",
      "Trả lời ngắn, tự nhiên như chat. Nhét số vào câu chuyện, đừng ra template. 100–200 chữ. Không markdown.",
    ].join("\n");
  }

  return [
    "Dưới đây là số liệu thô — viết lại thành lời cố vấn, KHÔNG copy nguyên xi:",
    ctx,
    "",
    "---",
    `Khách hỏi: "${userQuestion}"`,
    "",
    "Viết như người đang chat: mở thẳng ý, số liệu lồng trong câu, gợi ý việc làm, disclaimer ngắn.",
    "Không markdown. 150–300 chữ. Không lộ hệ thống nội bộ.",
  ].join("\n");
}

/**
 * Single race pass (no second full pass) to stay under Vercel gateway timeout.
 * Optional quick rescue only if first race fails fast.
 */
export async function agentNarrativeDetailed(
  userQuestion: string,
  contextBlock: string,
  opts: { followUp?: boolean } = {},
): Promise<AgentNarrativeMeta> {
  const followUp = Boolean(opts.followUp);
  const ctx = contextBlock.length > 2800 ? contextBlock.slice(0, 2800) + "\n…" : contextBlock;
  const allErrors: string[] = [];
  const allAttempted: string[] = [];
  const started = Date.now();

  const pass1 = await chatRaceProviders(
    [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildUserPrompt(userQuestion, ctx, followUp ? "compact" : "full"),
      },
    ],
    {
      maxTokens: followUp ? 1100 : 1600,
      temperature: 0.55,
      // Keep under Vercel limit; race returns on first success
      timeoutMs: followUp ? 14_000 : 16_000,
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

  // Rescue only if we still have budget (< 35s total)
  const elapsed = Date.now() - started;
  if (elapsed < 35_000) {
    logger.warn("agent_narrative_pass1_failed", { errors: pass1.errors.slice(0, 3), elapsed });
    const pass2 = await chatWithFallbackDetailed(
      [
        { role: "system", content: AGENT_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildUserPrompt(userQuestion, ctx, "rescue"),
        },
      ],
      {
        maxTokens: 900,
        temperature: 0.5,
        timeoutMs: Math.min(12_000, 50_000 - elapsed),
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
  }

  const transient = pass1.transient || allErrors.some((e) => isTransientLlmErrorLocal(e));
  logger.error("agent_narrative_all_passes_failed", {
    transient,
    errors: allErrors.slice(0, 6),
    elapsed: Date.now() - started,
  });

  return {
    result: null,
    errors: allErrors,
    attempted: allAttempted,
    transient,
  };
}

function isTransientLlmErrorLocal(msg: string): boolean {
  return /\b(429|503|rate.?limit|timeout|abort|ECONNRESET|ETIMEDOUT|fetch failed|network|overloaded|capacity)\b/i.test(
    msg,
  );
}
