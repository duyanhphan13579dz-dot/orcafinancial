import type {
  LlmChatOptions,
  LlmMessage,
  LlmProvider,
  LlmChatResult,
} from "../types";

/**
 * Groq — primary LLM provider.
 *
 * Production models currently preferred:
 * - openai/gpt-oss-120b
 * - openai/gpt-oss-20b
 * - llama-3.3-70b-versatile (high free-tier headroom)
 * - llama-3.1-8b-instant
 *
 * Env:
 * - GROQ_API_KEY
 * - GROQ_MODEL
 * - GROQ_FINANCE_MODEL
 * - GROQ_FALLBACK_MODELS (comma-separated model IDs)
 */

function resolveApiKey(): string | undefined {
  return (
    process.env.GROQ_API_KEY?.trim() ||
    process.env.GROQ_KEY?.trim() ||
    undefined
  );
}

function modelCandidates(opts: LlmChatOptions): string[] {
  const purpose = opts.purpose === "finance" ? "analysis" : (opts.purpose ?? "agent");
  const configuredFallbacks = (process.env.GROQ_FALLBACK_MODELS ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  const laneDefaults: Record<"analysis" | "report" | "agent", { primary: string; fallback: string[] }> = {
    analysis: {
      primary: process.env.GROQ_ANALYSIS_MODEL?.trim() || process.env.GROQ_FINANCE_MODEL?.trim() || "qwen/qwen3.8-27b",
      fallback: ["openai/gpt-oss-20b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    },
    report: {
      primary: process.env.GROQ_REPORT_MODEL?.trim() || "openai/gpt-oss-120b",
      fallback: ["openai/gpt-oss-20b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    },
    agent: {
      primary: process.env.GROQ_AGENT_MODEL?.trim() || process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b",
      fallback: ["openai/gpt-oss-20b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    },
  };
  const lane = laneDefaults[purpose];
  const laneFallbacks = (process.env[`GROQ_${purpose.toUpperCase()}_FALLBACK_MODELS`] ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const primary = opts.modelOverride?.trim() || lane.primary;
  return [...new Set([primary, ...laneFallbacks, ...configuredFallbacks, ...lane.fallback])];
}

function isConfigured(): boolean {
  return Boolean(resolveApiKey());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(message: string): boolean {
  return /\b(408|409|425|429|500|502|503|504)\b|rate.?limit|timeout|abort|ECONNRESET|ETIMEDOUT|fetch failed|network|overloaded|capacity|temporarily unavailable/i.test(message);
}

function retryDelayMs(attempt: number): number {
  const base = Math.min(2_000, 350 * 2 ** attempt);
  return base + Math.floor(Math.random() * 180);
}

function isGptOssModel(model: string): boolean {
  return /^openai\/gpt-oss-(20b|120b)$/i.test(model.trim());
}

function isRateLimitError(status: number, body: string): boolean {
  if (status === 429) return true;
  return /rate.?limit|too many requests|tokens per (minute|day)/i.test(body);
}

type GroqMessage = {
  content?: string | null;
  reasoning?: string | null;
  refusal?: string | null;
};

type GroqResponse = {
  choices?: Array<{
    message?: GroqMessage;
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

function extractAssistantText(data: GroqResponse): {
  text: string;
  finishReason?: string | null;
  hasReasoning: boolean;
  refusal?: string | null;
} {
  const choice = data.choices?.[0];
  const message = choice?.message;

  const text =
    typeof message?.content === "string" ? message.content.trim() : "";

  const reasoning =
    typeof message?.reasoning === "string"
      ? message.reasoning.trim()
      : "";

  const refusal =
    typeof message?.refusal === "string"
      ? message.refusal.trim()
      : null;

  return {
    text,
    finishReason: choice?.finish_reason,
    hasReasoning: Boolean(reasoning),
    refusal,
  };
}

async function chatOne(
  apiKey: string,
  model: string,
  messages: LlmMessage[],
  opts: LlmChatOptions,
  attempt: number,
): Promise<LlmChatResult> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 14_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const isGptOss = isGptOssModel(model);

    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: opts.maxTokens ?? 1800,
      temperature: opts.temperature ?? 0.5,
    };

    if (isGptOss) {
      body.reasoning_effort = opts.reasoningEffort && opts.reasoningEffort !== "default" ? opts.reasoningEffort : "low";
      body.reasoning_format = "hidden";
    } else if (opts.reasoningEffort) {
      body.reasoning_effort = opts.reasoningEffort;
      body.reasoning_format = "hidden";
    }

    if (opts.responseFormat === "json_object") {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );

    /*
     * 429 / capacity: do NOT hammer the same model.
     * One short pause then fail this model so the caller can try the next.
     */
    if (res.status === 429 || res.status === 503) {
      const errText = await res.text().catch(() => "");

      const kind = isRateLimitError(res.status, errText)
        ? "rate_limited"
        : "unavailable";

      throw new Error(
        `Groq HTTP ${res.status} ${kind} (${model})`,
      );
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");

      throw new Error(
        `Groq HTTP ${res.status} (${model}): ${errText.slice(0, 200)}`,
      );
    }

    const data = (await res.json()) as GroqResponse;

    if (data.error?.message) {
      const msg = data.error.message;
      if (/rate.?limit/i.test(msg)) {
        throw new Error(`Groq rate_limited (${model})`);
      }
      throw new Error(
        `Groq API (${model}): ${msg.slice(0, 180)}`,
      );
    }

    const extracted = extractAssistantText(data);

    if (!extracted.text) {
      const details = [
        `Groq empty response (${model})`,
        extracted.finishReason
          ? `finish_reason=${extracted.finishReason}`
          : undefined,
        extracted.hasReasoning
          ? "reasoning_present=true"
          : undefined,
        extracted.refusal
          ? `refusal=${extracted.refusal.slice(0, 80)}`
          : undefined,
      ]
        .filter(Boolean)
        .join(" | ");

      throw new Error(details);
    }

    return {
      text: extracted.text,
      provider: "groq",
      model,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        `Groq timeout (${model}) after ${timeoutMs}ms`,
      );
    }

    if (
      error instanceof Error &&
      /aborted|aborterror/i.test(error.message)
    ) {
      throw new Error(
        `Groq timeout (${model}) after ${timeoutMs}ms`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function chat(
  messages: LlmMessage[],
  opts: LlmChatOptions = {},
): Promise<LlmChatResult> {
  const apiKey = resolveApiKey();

  if (!apiKey) {
    throw new Error("GROQ_API_KEY missing");
  }

  const errors: string[] = [];
  let hitRateLimit = false;

  const maxRetries = Math.min(2, Math.max(0, opts.maxRetries ?? 1));
  const deadline = Date.now() + (opts.overallTimeoutMs ?? 45_000);

  for (const model of modelCandidates(opts)) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Groq overall timeout");
      try {
        return await chatOne(
          apiKey,
          model,
          messages,
          { ...opts, timeoutMs: Math.min(opts.timeoutMs ?? 14_000, remaining) },
          attempt,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (/rate_limited|HTTP 429/i.test(message)) {
          hitRateLimit = true;
        }

        if (attempt < maxRetries && isRetryable(message)) {
          await sleep(retryDelayMs(attempt));
          continue;
        }

        errors.push(message);
        break;
      }
    }
  }

  const summary = hitRateLimit
    ? `Groq rate_limited on all models: ${errors.map((e) => e.split("(")[0].trim()).join("; ")}`
    : errors.join(" | ") || "Groq failed";

  throw new Error(summary.slice(0, 400));
}

export const groqProvider: LlmProvider = {
  id: "groq",
  label: "Groq",
  isConfigured,
  chat,
};
