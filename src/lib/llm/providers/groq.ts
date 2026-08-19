import type { LlmChatOptions, LlmMessage, LlmProvider, LlmChatResult } from "../types";

const DEFAULT_MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

function isConfigured() {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

async function chat(messages: LlmMessage[], opts: LlmChatOptions = {}): Promise<LlmChatResult> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error("GROQ_API_KEY missing");

  const model = DEFAULT_MODEL;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 25_000);

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
        max_tokens: opts.maxTokens ?? 1500,
        temperature: opts.temperature ?? 0.3,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Groq HTTP ${res.status}: ${errText.slice(0, 200)}`);
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
  label: "Groq (free tier)",
  isConfigured,
  chat,
};
