import { logger } from "@/lib/logger";
import { anthropicProvider } from "./providers/anthropic";
import { geminiProvider } from "./providers/gemini";
import { groqProvider } from "./providers/groq";
import { openrouterProvider } from "./providers/openrouter";
import type { LlmChatOptions, LlmMessage, LlmChatResult, LlmProvider, LlmProviderId } from "./types";

/**
 * Default cascade prioritises speed then quality:
 * Groq (fastest) → Gemini → OpenRouter → Anthropic.
 * Override via LLM_PROVIDER_ORDER=groq,gemini,openrouter,anthropic
 */
const ALL: LlmProvider[] = [
  groqProvider,
  geminiProvider,
  openrouterProvider,
  anthropicProvider,
];

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

/** Hard failures that should not waste full timeout on retries. */
function isHardAuthError(msg: string): boolean {
  return /\b(401|403|invalid api key|incorrect api key|authentication|unauthorized)\b/i.test(
    msg,
  );
}

/**
 * Try each configured provider in order. Returns null if all fail or none configured.
 * Fail-fast on auth errors; shorter per-provider budget when cascading.
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
  const baseTimeout = opts.timeoutMs ?? 22_000;
  // First provider gets full budget; later ones slightly shorter to keep total latency down
  const perProviderTimeout = (index: number) =>
    Math.max(10_000, baseTimeout - index * 3_000);

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    try {
      const result = await provider.chat(messages, {
        ...opts,
        timeoutMs: perProviderTimeout(i),
      });
      logger.info("llm_ok", {
        provider: provider.id,
        model: result.model,
        latencyMs: result.latencyMs,
        attempt: i + 1,
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${provider.id}: ${msg}`);
      logger.warn("llm_provider_failed", { provider: provider.id, error: msg });

      // Auth failures on a key won't recover by waiting — continue to next provider immediately
      if (isHardAuthError(msg)) continue;
    }
  }

  logger.warn("llm_all_providers_failed", { errors });
  return null;
}
