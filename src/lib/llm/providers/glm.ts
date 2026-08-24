import type { LlmChatOptions, LlmMessage, LlmProvider, LlmChatResult } from "../types";

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
  const primary = process.env.GLM_MODEL?.trim() || "glm-4.5-flash";
  // Keep 2 candidates max for direct Z.AI
  const list = [primary, "glm-4.7-flash", "glm-4.5-flash"];
  return [...new Set(list)].slice(0, 2);
}

function isConfigured() {
  return Boolean(resolveApiKey());
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function chatOne(
  apiKey: string,
  model: string,
  messages: LlmMessage[],
  opts: LlmChatOptions,
  attempt: number,
): Promise<LlmChatResult> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 16_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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
        max_tokens: opts.maxTokens ?? 1600,
        temperature: opts.temperature ?? 0.5,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (res.status === 429 || res.status === 503) {
      const errText = await res.text().catch(() => "");
      if (attempt === 0) {
        await sleep(700);
        return chatOne(apiKey, model, messages, opts, 1);
      }
      throw new Error(`GLM HTTP ${res.status} rate_limited (${model}): ${errText.slice(0, 160)}`);
    }

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
      return await chatOne(apiKey, model, messages, opts, 0);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(errors.slice(0, 2).join(" | ") || "GLM failed");
}

export const glmProvider: LlmProvider = {
  id: "glm",
  label: "Z.AI GLM",
  isConfigured,
  chat,
};
