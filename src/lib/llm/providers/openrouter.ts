import type {
  LlmChatOptions,
  LlmMessage,
  LlmProvider,
  LlmChatResult,
} from "../types";

/**
 * OpenRouter — fallback provider.
 *
 * Strategy:
 * 1. User-configured OPENROUTER_MODEL
 * 2. openrouter/free
 * 3. z-ai/glm-5.2:free
 */

function modelCandidates(): string[] {
  const primary =
    process.env.OPENROUTER_MODEL?.trim() ||
    "meta-llama/llama-3.3-70b-instruct";

  const list = [
    primary,
    "openrouter/free",
    "z-ai/glm-5.2:free",
  ];

  return [...new Set(list)];
}

function resolveApiKey(): string | undefined {
  return (
    process.env.OPENROUTER_API_KEY?.trim() ||
    process.env.OPENROUTES_API_KEY?.trim() ||
    undefined
  );
}

function isConfigured(): boolean {
  return Boolean(resolveApiKey());
}

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      refusal?: string | null;
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
    code?: string | number;
    metadata?: unknown;
  };
};

async function chatOne(
  apiKey: string,
  model: string,
  messages: LlmMessage[],
  opts: LlmChatOptions,
): Promise<LlmChatResult> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 14_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
          "http-referer":
            process.env.OPENROUTER_SITE_URL ??
            process.env.APP_URL ??
            "https://orcafinancial.vercel.app",
          "x-title":
            process.env.OPENROUTER_APP_NAME ??
            "ORCA Financial",
        },
        body: JSON.stringify({
          model,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          max_tokens: opts.maxTokens ?? 1600,
          temperature: opts.temperature ?? 0.5,
        }),
        signal: controller.signal,
      },
    );

    if (res.status === 429 || res.status === 503) {
      await res.text().catch(() => "");
      throw new Error(
        `OpenRouter HTTP ${res.status} rate_limited (${model})`,
      );
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");

      throw new Error(
        `OpenRouter HTTP ${res.status} (${model}): ${errText.slice(0, 180)}`,
      );
    }

    const data = (await res.json()) as OpenRouterResponse;

    if (data.error?.message) {
      const msg = data.error.message;
      if (/rate.?limit/i.test(msg)) {
        throw new Error(`OpenRouter rate_limited (${model})`);
      }
      throw new Error(
        `OpenRouter API (${model}): ${msg.slice(0, 180)}`,
      );
    }

    const choice = data.choices?.[0];

    const text =
      typeof choice?.message?.content === "string"
        ? choice.message.content.trim()
        : "";

    if (!text) {
      const finishReason = choice?.finish_reason;

      throw new Error(
        [
          `OpenRouter empty response (${model})`,
          finishReason
            ? `finish_reason=${finishReason}`
            : undefined,
          choice?.message?.refusal
            ? `refusal=${choice.message.refusal.slice(0, 80)}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" | "),
      );
    }

    return {
      text,
      provider: "openrouter",
      model,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        `OpenRouter timeout (${model}) after ${timeoutMs}ms`,
      );
    }

    if (
      error instanceof Error &&
      /aborted|aborterror/i.test(error.message)
    ) {
      throw new Error(
        `OpenRouter timeout (${model}) after ${timeoutMs}ms`,
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
    throw new Error("OPENROUTER_API_KEY missing");
  }

  const errors: string[] = [];
  let hitRateLimit = false;

  for (const model of modelCandidates()) {
    try {
      return await chatOne(apiKey, model, messages, opts);
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
    ? `OpenRouter rate_limited: ${errors.map((e) => e.replace(/:\s*\{.*$/, "").slice(0, 80)).join("; ")}`
    : errors.join(" | ") || "OpenRouter failed";

  throw new Error(summary.slice(0, 400));
}

export const openrouterProvider: LlmProvider = {
  id: "openrouter",
  label: "OpenRouter",
  isConfigured,
  chat,
};
