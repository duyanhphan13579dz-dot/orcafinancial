import type { LlmChatOptions, LlmMessage, LlmProvider, LlmChatResult } from "../types";

/**
 * Z.AI / Zhipu GLM.
 * Keys: ZAI_API_KEY | ZHIPU_API_KEY | GLM_API_KEY | BIGMODEL_API_KEY
 * Model: GLM_MODEL (default glm-4.7-flash only — avoid multi-model cascade timeouts)
 */
function resolveApiKey(): string | undefined {
  return (
    process.env.ZAI_API_KEY?.trim() ||
    process.env.ZHIPU_API_KEY?.trim() ||
    process.env.GLM_API_KEY?.trim() ||
    process.env.BIGMODEL_API_KEY?.trim() ||
    undefined
  );
}

function baseUrl(): string {
  const raw =
    process.env.GLM_BASE_URL?.trim() ||
    process.env.ZAI_BASE_URL?.trim() ||
    "https://api.z.ai/api/paas/v4";
  return raw.replace(/\/$/, "");
}

function modelCandidates(): string[] {
  const primary = process.env.GLM_MODEL?.trim() || "glm-4.7-flash";
  // Only one primary + one backup to avoid 30s+ cascade
  const backup = primary === "glm-4.7-flash" ? "glm-4.5-flash" : "glm-4.7-flash";
  return [...new Set([primary, backup])];
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
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);

  try {
    const res = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: opts.maxTokens ?? 2200,
        temperature: opts.temperature ?? 0.45,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`GLM HTTP ${res.status} (${model}): ${errText.slice(0, 240)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (data.error?.message) {
      throw new Error(`GLM API (${model}): ${data.error.message.slice(0, 200)}`);
    }
    const text = data.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) throw new Error(`GLM empty response (${model})`);
    return {
      text: text.trim(),
      provider: "glm",
      model,
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function chat(messages: LlmMessage[], opts: LlmChatOptions = {}): Promise<LlmChatResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) throw new Error("ZAI_API_KEY / GLM_API_KEY missing");

  const errors: string[] = [];
  for (const model of modelCandidates()) {
    try {
      return await chatOne(apiKey, model, messages, opts);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(errors.slice(0, 3).join(" | ") || "GLM all models failed");
}

export const glmProvider: LlmProvider = {
  id: "glm",
  label: "Z.AI GLM",
  isConfigured,
  chat,
};
