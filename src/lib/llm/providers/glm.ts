import type { LlmChatOptions, LlmMessage, LlmProvider, LlmChatResult } from "../types";

/**
 * Z.AI / Zhipu GLM (open-weight family).
 * Official free API models: glm-4.7-flash, glm-4.5-flash.
 * Flagship: glm-5.2, glm-5.3 (paid / trial credits).
 *
 * Keys (any one):
 *   ZAI_API_KEY | ZHIPU_API_KEY | GLM_API_KEY | BIGMODEL_API_KEY
 *
 * Base URL (optional):
 *   GLM_BASE_URL — default https://api.z.ai/api/paas/v4
 *   (China alternate: https://open.bigmodel.cn/api/paas/v4)
 *
 * Model (optional):
 *   GLM_MODEL — default tries free Flash first, then 5.2
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
  const primary = process.env.GLM_MODEL?.trim();
  const list = [
    primary,
    // Official free-tier models on Z.AI API
    "glm-4.7-flash",
    "glm-4.5-flash",
    // Stronger (may need credits)
    "glm-5.2",
    "glm-5",
    "glm-4.7",
  ].filter((m): m is string => Boolean(m));
  return [...new Set(list)];
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
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 28_000);

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
