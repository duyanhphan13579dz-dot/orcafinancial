import type { LlmChatOptions, LlmMessage, LlmProvider, LlmChatResult } from "../types";

/** Prefer currently listed free GLM on OpenRouter. */
function modelCandidates(): string[] {
  const primary = process.env.OPENROUTER_MODEL?.trim() || "z-ai/glm-5.2:free";
  const list = [primary, "z-ai/glm-5.2:free", "z-ai/glm-4.5-air:free", "openrouter/free"];
  return [...new Set(list)];
}

function resolveApiKey(): string | undefined {
  return (
    process.env.OPENROUTER_API_KEY?.trim() ||
    process.env.OPENROUTES_API_KEY?.trim() ||
    undefined
  );
}

function isConfigured() {
  return Boolean(resolveApiKey());
}

async function chatOne(
  apiKey: string,
  model: string,
  messages: LlmMessage[],
  opts: LlmChatOptions,
): Promise<LlmChatResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 16_000);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "http-referer":
          process.env.OPENROUTER_SITE_URL ??
          process.env.APP_URL ??
          "https://orcafinancial.vercel.app",
        "x-title": process.env.OPENROUTER_APP_NAME ?? "ORCA Financial",
      },
      body: JSON.stringify({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: opts.maxTokens ?? 1600,
        temperature: opts.temperature ?? 0.5,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenRouter HTTP ${res.status} (${model}): ${errText.slice(0, 220)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) throw new Error(`OpenRouter empty response (${model})`);
    return { text: text.trim(), provider: "openrouter", model, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function chat(messages: LlmMessage[], opts: LlmChatOptions = {}): Promise<LlmChatResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");

  const errors: string[] = [];
  for (const model of modelCandidates()) {
    try {
      return await chatOne(apiKey, model, messages, opts);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(errors.slice(0, 2).join(" | ") || "OpenRouter failed");
}

export const openrouterProvider: LlmProvider = {
  id: "openrouter",
  label: "OpenRouter",
  isConfigured,
  chat,
};
