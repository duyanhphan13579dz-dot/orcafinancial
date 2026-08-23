/** Shared types for multi-provider LLM layer. */

export type LlmProviderId =
  | "glm"
  | "openrouter"
  | "gemini"
  | "groq"
  | "anthropic";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmChatOptions {
  /** Max output tokens (default 1500). */
  maxTokens?: number;
  /** Temperature 0–1 (default 0.3 for analysis). */
  temperature?: number;
  /** Timeout ms per provider call (default 25_000). */
  timeoutMs?: number;
  /** Prefer a specific provider (still falls back if unavailable). */
  prefer?: LlmProviderId;
}

export interface LlmChatResult {
  text: string;
  provider: LlmProviderId;
  model: string;
  latencyMs: number;
}

export interface LlmProvider {
  id: LlmProviderId;
  /** Human-readable name for logs / UI. */
  label: string;
  /** True when required env key is present. */
  isConfigured: () => boolean;
  /** Chat completion; throws on failure. */
  chat: (messages: LlmMessage[], opts?: LlmChatOptions) => Promise<LlmChatResult>;
}

export interface SentimentLlmResult {
  score: number;
  label: string;
  confidence: number;
  rationale: string;
  source: "llm" | "rule-engine" | "hybrid";
  model?: string;
}
