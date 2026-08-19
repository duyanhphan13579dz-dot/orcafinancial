import { logger } from "@/lib/logger";
import { anthropicProvider } from "./providers/anthropic";
import { geminiProvider } from "./providers/gemini";
import { groqProvider } from "./providers/groq";
import { openrouterProvider } from "./providers/openrouter";
import type { LlmChatOptions, LlmMessage, LlmChatResult, LlmProvider, LlmProviderId } from "./types";

/**
 * Cascade order prioritises free tiers:
 * Gemini → Groq → OpenRouter → Anthropic (optional paid/credit).
 * Override via LLM_PROVIDER_ORDER=gemini,groq,openrouter,anthropic
 */
const ALL: LlmProvider[] = [geminiProvider, groqProvider, openrouterProvider, anthropicProvider];

function orderedProviders(prefer?: LlmProviderId): LlmProvider[] {
  const envOrder = (process.env.LLM_PROVIDER_ORDER ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as LlmProviderId[];

  const byId = new Map(ALL.map((p) => [p.id, p]));
  let list: LlmProvider[];

  if (envOrder.length > 0) {
    list = envOrder.map((id) => byId.get(id)).filter((p): p is LlmProvider => Boolean(p));
    for (const p of ALL) {
      if (!list.includes(p)) list.push(p);
    }
  } else {
    list = [...ALL];
  }

  if (prefer) {
    const preferred = list.find((p) => p.id === prefer);
    if (preferred) {
      list = [preferred, ...list.filter((p) => p.id !== prefer)];
    }
  }

  return list.filter((p) => p.isConfigured());
}

export function listConfiguredProviders(): Array<{ id: LlmProviderId; label: string }> {
  return orderedProviders().map((p) => ({ id: p.id, label: p.label }));
}

/**
 * Try each configured provider in order. Returns null if all fail or none configured.
 */
export async function chatWithFallback(
  messages: LlmMessage[],
  opts: LlmChatOptions = {},
): Promise<LlmChatResult | null> {
  const providers = orderedProviders(opts.prefer);
  if (providers.length === 0) {
    logger.debug("llm_no_provider_configured");
    return null;
  }

  const errors: string[] = [];
  for (const provider of providers) {
    try {
      const result = await provider.chat(messages, opts);
      logger.info("llm_ok", {
        provider: provider.id,
        model: result.model,
        latencyMs: result.latencyMs,
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${provider.id}: ${msg}`);
      logger.warn("llm_provider_failed", { provider: provider.id, error: msg });
    }
  }

  logger.warn("llm_all_providers_failed", { errors });
  return null;
}
