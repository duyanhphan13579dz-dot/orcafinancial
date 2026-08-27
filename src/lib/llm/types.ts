/** Shared types for multi-provider LLM layer. */

export type LlmProviderId = "groq";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmChatOptions {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Maximum number of transient retries per provider/model. */
  maxRetries?: number;
  /** Optional overall budget for the provider fallback chain. */
  overallTimeoutMs?: number;
  /** Select one of the explicit application LLM lanes. */
  purpose?: "analysis" | "report" | "agent" | "finance";
  /** Explicit model override for providers that support it. */
  modelOverride?: string;
  /** Ask compatible providers to return strict JSON. */
  responseFormat?: "json_object";
  /** Provider-specific reasoning depth. */
  reasoningEffort?: "none" | "low" | "medium" | "high" | "default";
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
