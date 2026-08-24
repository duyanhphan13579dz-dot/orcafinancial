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
 */

function resolveApiKey(): string | undefined {
  return (
    process.env.GROQ_API_KEY?.trim() ||
    process.env.GROQ_KEY?.trim() ||
    undefined
  );
}

function modelCandidates(): string[] {
  const primary =
    process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";

  /*
   * Prefer smaller / higher-quota models after the primary so a 429 on
   * gpt-oss-120b does not waste the whole request.
   */
  const list = [
    primary,
    "openai/gpt-oss-20b",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
  ];

  return [...new Set(list)];
}

function isConfigured(): boolean {
  return Boolean(resolveApiKey());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      body.reasoning_effort = "low";
      body.reasoning_format = "hidden";
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

      if (attempt === 0 && res.status === 503) {
        await sleep(350);
        return chatOne(apiKey, model, messages, opts, 1);
      }

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

  for (const model of modelCandidates()) {
    try {
      return await chatOne(apiKey, model, messages, opts, 0);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      if (/rate_limited|HTTP 429/i.test(message)) {
        hitRateLimit = true;
      }

      errors.push(message);
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
