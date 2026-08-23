import { logger } from "@/lib/logger";
import { glmProvider } from "./providers/glm";
import { openrouterProvider } from "./providers/openrouter";
import type { LlmChatOptions, LlmMessage, LlmChatResult, LlmProvider, LlmProviderId } from "./types";

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

  if (list.length === 0) list = [...ALL];

  if (prefer) {
    const preferred = list.find((p) => p.id === prefer);
    if (preferred) list = [preferred, ...list.filter((p) => p.id !== prefer)];
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

export function isLlmStrict(): boolean {
  const raw = process.env.LLM_STRICT;
  if (raw !== undefined && raw !== "") {
    return !/^(0|false|no|off)$/i.test(raw);
  }
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}

/** Transient errors: safe to soft-degrade with data-engine answer. */
export function isTransientLlmError(msg: string): boolean {
  return /\b(429|503|rate.?limit|timeout|abort|ECONNRESET|ETIMEDOUT|fetch failed|network|overloaded|capacity)\b/i.test(
    msg,
  );
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
  transient: boolean;
};

export async function chatWithFallbackDetailed(
  messages: LlmMessage[],
  opts: LlmChatOptions = {},
): Promise<ChatWithFallbackResult> {
  const providers = orderedProviders(opts.prefer);
  if (providers.length === 0) {
    return {
      result: null,
      errors: [
        "No LLM provider configured. Set ZAI_API_KEY (GLM) and/or OPENROUTER_API_KEY on Vercel Production.",
      ],
      attempted: [],
      transient: false,
    };
  }

  const errors: string[] = [];
  const attempted: LlmProviderId[] = [];
  const baseTimeout = opts.timeoutMs ?? 16_000;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    attempted.push(provider.id);
    try {
      const result = await provider.chat(messages, {
        ...opts,
        timeoutMs: Math.max(10_000, baseTimeout - i * 2_000),
      });
      logger.info("llm_ok", {
        provider: provider.id,
        model: result.model,
        latencyMs: result.latencyMs,
        attempt: i + 1,
      });
      return { result, errors, attempted, transient: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${provider.id}: ${msg.slice(0, 220)}`);
      logger.warn("llm_provider_failed", { provider: provider.id, error: msg });
      if (isHardAuthError(msg)) continue;
    }
  }

  const transient = errors.some((e) => isTransientLlmError(e));
  logger.warn("llm_all_providers_failed", { errors, transient });
  return { result: null, errors, attempted, transient };
}

export async function chatWithFallback(
  messages: LlmMessage[],
  opts: LlmChatOptions = {},
): Promise<LlmChatResult | null> {
  const { result } = await chatWithFallbackDetailed(messages, opts);
  return result;
}
