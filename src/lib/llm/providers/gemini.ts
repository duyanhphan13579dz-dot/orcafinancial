import type { LlmChatOptions, LlmMessage, LlmProvider, LlmChatResult } from "../types";

/**
 * Default model for free-tier keys.
 * Google shut down gemini-2.0-flash (and 2.0-flash-lite) on 2026-06-01.
 * gemini-2.5-flash remains available on free tier until ~Oct 2026.
 * Override via GEMINI_MODEL if needed.
 */
const DEFAULT_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

function isConfigured() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

async function chat(messages: LlmMessage[], opts: LlmChatOptions = {}): Promise<LlmChatResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  const model = DEFAULT_MODEL;
  const system = messages.find((m) => m.role === "system")?.content;
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: opts.maxTokens ?? 2200,
      temperature: opts.temperature ?? 0.45,
    },
  };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 22_000);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) throw new Error("Gemini empty response");
    return { text: text.trim(), provider: "gemini", model, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export const geminiProvider: LlmProvider = {
  id: "gemini",
  label: "Google Gemini (free tier)",
  isConfigured,
  chat,
};
