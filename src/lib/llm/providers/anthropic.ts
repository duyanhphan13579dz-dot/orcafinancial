import type { LlmChatOptions, LlmMessage, LlmProvider, LlmChatResult } from "../types";

/** Prefer dated snapshot; alias claude-haiku-4-5 also works on some accounts. */
const DEFAULT_MODEL =
  process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5-20251001";

function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

async function chat(messages: LlmMessage[], opts: LlmChatOptions = {}): Promise<LlmChatResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");

  const model = DEFAULT_MODEL;
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const userMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 22_000);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 2200,
        temperature: opts.temperature ?? 0.45,
        system: system || undefined,
        messages: userMessages,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Anthropic HTTP ${res.status}: ${errText.slice(0, 280)}`);
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((b) => b.type === "text")?.text ?? "";
    if (!text.trim()) throw new Error("Anthropic empty response");
    return { text: text.trim(), provider: "anthropic", model, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export const anthropicProvider: LlmProvider = {
  id: "anthropic",
  label: "Anthropic Claude",
  isConfigured,
  chat,
};
