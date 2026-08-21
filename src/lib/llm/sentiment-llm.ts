import {
  analyzeSentiment,
  sentimentLabel,
} from "@/lib/sentiment";
import { logger } from "@/lib/logger";

import {
  AGENT_SYSTEM_PROMPT,
  SENTIMENT_SYSTEM_PROMPT,
  buildSentimentUserPrompt,
} from "./prompts";

import { chatWithFallback } from "./router";
import type { SentimentLlmResult } from "./types";

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;

  return Math.max(
    -1,
    Math.min(1, n),
  );
}

function parseSentimentJson(
  raw: string,
): {
  score: number;
  label: string;
  confidence: number;
  rationale: string;
} | null {
  const trimmed = raw.trim();

  const match = trimmed.match(
    /\{[\s\S]*\}/,
  );

  if (!match) return null;

  try {
    const obj = JSON.parse(
      match[0],
    ) as Record<string, unknown>;

    const score = clampScore(
      Number(obj.score),
    );

    const confidence = Math.max(
      0,
      Math.min(
        1,
        Number(
          obj.confidence ?? 0.6,
        ),
      ),
    );

    const label =
      typeof obj.label === "string" &&
      obj.label.length > 0
        ? obj.label
        : sentimentLabel(score);

    const rationale =
      typeof obj.rationale === "string"
        ? obj.rationale.slice(0, 400)
        : "";

    return {
      score,
      label,
      confidence,
      rationale,
    };
  } catch {
    return null;
  }
}

/**
 * Hybrid sentiment:
 *
 * Rule engine is always available.
 * LLM refines it when a provider is configured.
 */
export async function scoreSentimentHybrid(
  symbol: string,
  headlines: string[],
  opts: {
    forceRuleOnly?: boolean;
  } = {},
): Promise<SentimentLlmResult> {
  const texts = headlines.filter(
    (h) =>
      h &&
      h.trim().length > 0,
  );

  const combined =
    texts.join("\n");

  const ruleScore =
    analyzeSentiment(combined);

  const ruleLabel =
    sentimentLabel(ruleScore);

  if (
    opts.forceRuleOnly ||
    texts.length === 0 ||
    process.env.LLM_SENTIMENT_DISABLED === "1"
  ) {
    return {
      score: Number(
        ruleScore.toFixed(3),
      ),
      label: ruleLabel,
      confidence:
        texts.length > 0
          ? 0.55
          : 0.3,
      rationale:
        texts.length > 0
          ? "Rule-based NLP."
          : "Không có tin để chấm.",
      source: "rule-engine",
    };
  }

  try {
    const llm =
      await chatWithFallback(
        [
          {
            role: "system",
            content:
              SENTIMENT_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content:
              buildSentimentUserPrompt(
                symbol,
                texts,
              ),
          },
        ],
        {
          maxTokens: 400,
          temperature: 0.1,
          timeoutMs: 18_000,
        },
      );

    if (!llm) {
      return {
        score: Number(
          ruleScore.toFixed(3),
        ),
        label: ruleLabel,
        confidence: 0.55,
        rationale:
          "Rule-based NLP.",
        source: "rule-engine",
      };
    }

    const parsed =
      parseSentimentJson(
        llm.text,
      );

    if (!parsed) {
      logger.warn(
        "sentiment_llm_parse_failed",
        {
          symbol,
          snippet:
            llm.text.slice(
              0,
              120,
            ),
        },
      );

      return {
        score: Number(
          ruleScore.toFixed(3),
        ),
        label: ruleLabel,
        confidence: 0.55,
        rationale:
          "Rule-based NLP.",
        source: "rule-engine",
      };
    }

    const blended =
      clampScore(
        0.4 * ruleScore +
          0.6 * parsed.score,
      );

    return {
      score: Number(
        blended.toFixed(3),
      ),
      label:
        sentimentLabel(
          blended,
        ),
      confidence: Number(
        Math.min(
          0.95,
          0.5 * 0.55 +
            0.5 *
              parsed.confidence,
        ).toFixed(2),
      ),
      rationale:
        parsed.rationale ||
        `Hybrid sentiment: rule ${ruleScore.toFixed(
          2,
        )} + LLM ${parsed.score.toFixed(
          2,
        )}`,
      source: "hybrid",
      model: `${llm.provider}/${llm.model}`,
    };
  } catch (err) {
    logger.warn(
      "sentiment_llm_error",
      {
        symbol,
        error:
          err instanceof Error
            ? err.message
            : String(err),
      },
    );

    return {
      score: Number(
        ruleScore.toFixed(3),
      ),
      label: ruleLabel,
      confidence: 0.55,
      rationale:
        "Rule-based NLP.",
      source: "rule-engine",
    };
  }
}

/**
 * Main ORCA financial-advisor LLM.
 */
export async function agentNarrative(
  userQuestion: string,
  contextBlock: string,
) {
  return chatWithFallback(
    [
      {
        role: "system",
        content:
          AGENT_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: `
THÔNG TIN PHÂN TÍCH NỘI BỘ:

${contextBlock}

CÂU HỎI KHÁCH HÀNG:

${userQuestion}

Hãy trả lời trực tiếp khách hàng.

QUAN TRỌNG:
- Không nhắc tới thông tin nội bộ.
- Không nhắc intent.
- Không nhắc Data Engine.
- Không nhắc API/database/provider.
- Không lặp lại câu hỏi.
- Nếu thiếu dữ liệu, vẫn đưa ra preliminary advice.
- Nếu có số liệu có thể tính toán, hãy tính.
- Trả lời như một financial advisor thực sự.
`,
      },
    ],
    {
      maxTokens: 1800,
      temperature: 0.25,
      timeoutMs: 30_000,
    },
  );
}
