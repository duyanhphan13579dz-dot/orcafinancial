import type { LlmChatOptions, LlmMessage, LlmProvider, LlmChatResult } from "../types";

/**
 * Groq free/dev tier shut down llama-3.3-70b-versatile on 2026-08-16.
 * Prefer openai/gpt-oss-120b (capable) with llama-3.1-8b-instant as ultra-fast option.
 * Override via GROQ_MODEL.
 */
const DEFAULT_MODEL =
  process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";

function isConfigured() {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

async function chat(messages: LlmMessage[], opts: LlmChatOptions = {}): Promise<LlmChatResult> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error("GROQ_API_KEY missing");

  const model = DEFAULT_MODEL;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 18_000);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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
      throw new Error(`Groq HTTP ${res.status}: ${errText.slice(0, 280)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) throw new Error("Groq empty response");
    return { text: text.trim(), provider: "groq", model, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export const groqProvider: LlmProvider = {
  id: "groq",
  label: "Groq (fast)",
  isConfigured,
  chat,
};
