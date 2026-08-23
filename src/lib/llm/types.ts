/** Shared types for multi-provider LLM layer. */

export type LlmProviderId = "glm" | "openrouter";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmChatOptions {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
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
  label: string;
  isConfigured: () => boolean;
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
