import { logger } from "@/lib/logger";
import { glmProvider } from "./providers/glm";
import { openrouterProvider } from "./providers/openrouter";
import type { LlmChatOptions, LlmMessage, LlmChatResult, LlmProvider, LlmProviderId } from "./types";

/** Only GLM (+ optional OpenRouter for z-ai/glm-*:free). */
const ALL: LlmProvider[] = [glmProvider, openrouterProvider];

function orderedProviders(prefer?: LlmProviderId): LlmProvider[] {
  const envOrder = (process.env.LLM_PROVIDER_ORDER ?? "glm,openrouter")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as LlmProviderId[];

  const byId = new Map(ALL.map((p) => [p.id, p]));
  let list: LlmProvider[] = envOrder
    .map((id) => byId.get(id))
    .filter((p): p is LlmProvider => Boolean(p));

  if (list.length === 0) {
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

export function llmEnvDiagnostics(): {
  keysPresent: Record<string, boolean>;
  configured: LlmProviderId[];
  order: LlmProviderId[];
} {
  const keysPresent = {
    ZAI_API_KEY: Boolean(
      process.env.ZAI_API_KEY?.trim() ||
        process.env.ZHIPU_API_KEY?.trim() ||
        process.env.GLM_API_KEY?.trim() ||
        process.env.BIGMODEL_API_KEY?.trim(),
    ),
    OPENROUTER_API_KEY: Boolean(
      process.env.OPENROUTER_API_KEY?.trim() || process.env.OPENROUTES_API_KEY?.trim(),
    ),
  };
  const configured = orderedProviders().map((p) => p.id);
  return { keysPresent, configured, order: configured };
}

function isHardAuthError(msg: string): boolean {
  return /\b(401|403|invalid api key|incorrect api key|authentication|unauthorized|decommissioned|model_decommissioned|not_found|does not exist)\b/i.test(
    msg,
  );
}

export type ChatWithFallbackResult = {
  result: LlmChatResult | null;
  errors: string[];
  attempted: LlmProviderId[];
};

export async function chatWithFallbackDetailed(
  messages: LlmMessage[],
  opts: LlmChatOptions = {},
): Promise<ChatWithFallbackResult> {
  const providers = orderedProviders(opts.prefer);
  if (providers.length === 0) {
    logger.debug("llm_no_provider_configured");
    return {
      result: null,
      errors: [
        "No LLM provider configured. Set ZAI_API_KEY (or GLM_API_KEY) for Z.AI GLM, or OPENROUTER_API_KEY for z-ai/glm-5.2:free",
      ],
      attempted: [],
    };
  }

  const errors: string[] = [];
  const attempted: LlmProviderId[] = [];
  const baseTimeout = opts.timeoutMs ?? 22_000;
  const perProviderTimeout = (index: number) =>
    Math.max(10_000, baseTimeout - index * 3_000);

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    attempted.push(provider.id);
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
      return { result, errors, attempted };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${provider.id}: ${msg.slice(0, 200)}`);
      logger.warn("llm_provider_failed", { provider: provider.id, error: msg });
      if (isHardAuthError(msg)) continue;
    }
  }

  logger.warn("llm_all_providers_failed", { errors });
  return { result: null, errors, attempted };
}

export async function chatWithFallback(
  messages: LlmMessage[],
  opts: LlmChatOptions = {},
): Promise<LlmChatResult | null> {
  const { result } = await chatWithFallbackDetailed(messages, opts);
  return result;
}
