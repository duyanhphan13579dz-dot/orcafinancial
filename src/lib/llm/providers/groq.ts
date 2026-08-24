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
   * Keep GPT-OSS models first.
   *
   * The previous implementation used:
   *   [...].slice(0, 2)
   *
   * which accidentally prevented the third fallback model
   * from ever being attempted.
   *
   * We intentionally do not depend on llama-3.1-8b-instant
   * as the first fallback because the user's current Groq
   * project returned HTTP 404 for that model.
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

    /*
     * GPT-OSS is a reasoning model.
     *
     * The previous implementation only sent:
     *   model/messages/max_tokens/temperature
     *
     * In the user's production test, GPT-OSS 120B returned HTTP 200
     * but content was empty.
     *
     * We explicitly request hidden reasoning so the application
     * receives the final answer in message.content without exposing
     * internal reasoning to the user.
     */
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
     * Retry only transient provider errors.
     *
     * Do NOT retry 401/403/404/400 etc. against the same model.
     */
    if (res.status === 429 || res.status === 503) {
      const errText = await res.text().catch(() => "");

      if (attempt === 0) {
        await sleep(500);
        return chatOne(
          apiKey,
          model,
          messages,
          opts,
          1,
        );
      }

      throw new Error(
        `Groq HTTP ${res.status} rate_limited (${model}): ${errText.slice(
          0,
          240,
        )}`,
      );
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");

      throw new Error(
        `Groq HTTP ${res.status} (${model}): ${errText.slice(
          0,
          320,
        )}`,
      );
    }

    const data = (await res.json()) as GroqResponse;

    if (data.error?.message) {
      throw new Error(
        `Groq API (${model}): ${data.error.message.slice(0, 240)}`,
      );
    }

    const extracted = extractAssistantText(data);

    /*
     * GPT-OSS can expose reasoning separately from the final answer.
     * Never return reasoning as the assistant response.
     */
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
          ? `refusal=${extracted.refusal.slice(0, 120)}`
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

  for (const model of modelCandidates()) {
    try {
      return await chatOne(
        apiKey,
        model,
        messages,
        opts,
        0,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      errors.push(message);
    }
  }

  throw new Error(
    errors.join(" | ") || "Groq failed",
  );
}

export const groqProvider: LlmProvider = {
  id: "groq",
  label: "Groq",
  isConfigured,
  chat,
};