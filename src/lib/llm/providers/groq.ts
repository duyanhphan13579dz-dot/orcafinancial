import type { LlmChatOptions, LlmMessage, LlmProvider, LlmChatResult } from "../types";

/**
 * Groq (https://console.groq.com) — primary narrative LLM.
 * Env: GROQ_API_KEY
 * Model: GROQ_MODEL (default llama-3.3-70b-versatile)
 */
function resolveApiKey(): string | undefined {
  return process.env.GROQ_API_KEY?.trim() || process.env.GROQ_KEY?.trim() || undefined;
}

function modelCandidates(): string[] {
  const primary = process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile";
  // One fast backup if primary decommissioned
  const list = [primary, "llama-3.1-8b-instant", "openai/gpt-oss-20b"];
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
  const timeoutMs = opts.timeoutMs ?? 14_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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
        max_tokens: opts.maxTokens ?? 1800,
        temperature: opts.temperature ?? 0.5,
      }),
      signal: controller.signal,
    });

    if (res.status === 429 || res.status === 503) {
      const errText = await res.text().catch(() => "");
      if (attempt === 0) {
        await sleep(500);
        return chatOne(apiKey, model, messages, opts, 1);
      }
      throw new Error(`Groq HTTP ${res.status} rate_limited (${model}): ${errText.slice(0, 180)}`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Groq HTTP ${res.status} (${model}): ${errText.slice(0, 240)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (data.error?.message) {
      throw new Error(`Groq API (${model}): ${data.error.message.slice(0, 200)}`);
    }
    const text = data.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) throw new Error(`Groq empty response (${model})`);
    return {
      text: text.trim(),
      provider: "groq",
      model,
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function chat(messages: LlmMessage[], opts: LlmChatOptions = {}): Promise<LlmChatResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) throw new Error("GROQ_API_KEY missing");

  const errors: string[] = [];
  for (const model of modelCandidates()) {
    try {
      return await chatOne(apiKey, model, messages, opts, 0);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(errors.slice(0, 2).join(" | ") || "Groq failed");
}

export const groqProvider: LlmProvider = {
  id: "groq",
  label: "Groq",
  isConfigured,
  chat,
};
