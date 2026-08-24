import { logger } from "@/lib/logger";
import { groqProvider } from "./providers/groq";
import { openrouterProvider } from "./providers/openrouter";
import type {
  LlmChatOptions,
  LlmMessage,
  LlmChatResult,
  LlmProvider,
  LlmProviderId,
} from "./types";

/**
 * Provider order:
 *
 * 1. Groq
 * 2. OpenRouter
 *
 * The router is sequential on purpose:
 * - predictable
 * - cheaper
 * - avoids sending duplicate requests
 * - easier to diagnose
 */

const ALL: LlmProvider[] = [
  groqProvider,
  openrouterProvider,
];

function getProviderOrder(): LlmProviderId[] {
  const raw =
    process.env.LLM_PROVIDER_ORDER ??
    "groq,openrouter";

  const parsed = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean) as LlmProviderId[];

  const valid: LlmProviderId[] = [];

  for (const id of parsed) {
    if (
      (id === "groq" || id === "openrouter") &&
      !valid.includes(id)
    ) {
      valid.push(id);
    }
  }

  if (valid.length === 0) {
    return ["groq", "openrouter"];
  }

  return valid;
}

function orderedProviders(
  prefer?: LlmProviderId,
): LlmProvider[] {
  const order = getProviderOrder();

  const byId = new Map(
    ALL.map((provider) => [provider.id, provider]),
  );

  let list = order
    .map((id) => byId.get(id))
    .filter(
      (provider): provider is LlmProvider =>
        Boolean(provider),
    );

  if (list.length === 0) {
    list = [...ALL];
  }

  if (prefer) {
    const preferred = list.find(
      (provider) => provider.id === prefer,
    );

    if (preferred) {
      list = [
        preferred,
        ...list.filter(
          (provider) => provider.id !== prefer,
        ),
      ];
    }
  }

  return list.filter((provider) =>
    provider.isConfigured(),
  );
}

export function listConfiguredProviders(): Array<{
  id: LlmProviderId;
  label: string;
}> {
  return orderedProviders().map((provider) => ({
    id: provider.id,
    label: provider.label,
  }));
}

export function llmEnvDiagnostics(): {
  keysPresent: Record<string, boolean>;
  configured: LlmProviderId[];
  order: LlmProviderId[];
  models: {
    GROQ_MODEL: string;
    OPENROUTER_MODEL: string;
  };
} {
  const keysPresent = {
    GROQ_API_KEY: Boolean(
      process.env.GROQ_API_KEY?.trim() ||
        process.env.GROQ_KEY?.trim(),
    ),

    OPENROUTER_API_KEY: Boolean(
      process.env.OPENROUTER_API_KEY?.trim() ||
        process.env.OPENROUTES_API_KEY?.trim(),
    ),
  };

  const configured =
    orderedProviders().map(
      (provider) => provider.id,
    );

  const order = getProviderOrder();

  return {
    keysPresent,
    configured,
    order,
    models: {
      GROQ_MODEL:
        process.env.GROQ_MODEL?.trim() ||
        "openai/gpt-oss-120b",

      OPENROUTER_MODEL:
        process.env.OPENROUTER_MODEL?.trim() ||
        "meta-llama/llama-3.3-70b-instruct",
    },
  };
}

export function isLlmStrict(): boolean {
  const raw = process.env.LLM_STRICT;

  if (raw !== undefined && raw !== "") {
    return !/^(0|false|no|off)$/i.test(raw);
  }

  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL === "1"
  );
}

/**
 * Errors that are normally temporary.
 */
export function isTransientLlmError(
  msg: string,
): boolean {
  return /\b(408|409|425|429|500|502|503|504|rate.?limit|timeout|abort|ECONNRESET|ETIMEDOUT|fetch failed|network|overloaded|capacity|temporarily unavailable)\b/i.test(
    msg,
  );
}

/**
 * Errors that indicate the current provider/model cannot
 * satisfy the request and should not be retried repeatedly
 * against the same model.
 */
export function isHardLlmError(
  msg: string,
): boolean {
  return /\b(400|401|402|403|404|invalid.?api.?key|incorrect.?api.?key|authentication|unauthorized|forbidden|insufficient.?credits|credit|model.?not.?found|model.?unavailable|unavailable|decommissioned|model_decommissioned|not_found|does not exist)\b/i.test(
    msg,
  );
}

export type ChatWithFallbackResult = {
  result: LlmChatResult | null;
  errors: string[];
  attempted: LlmProviderId[];
  transient: boolean;
};

/**
 * Sequential provider fallback:
 *
 * Groq
 *   ↓ fail
 * OpenRouter
 *   ↓ fail
 * final error
 *
 * Individual providers are responsible for trying their
 * own model candidates.
 */
export async function chatWithFallbackDetailed(
  messages: LlmMessage[],
  opts: LlmChatOptions = {},
): Promise<ChatWithFallbackResult> {
  const providers = orderedProviders(opts.prefer);

  if (providers.length === 0) {
    return {
      result: null,
      errors: [
        "No LLM provider configured. Set GROQ_API_KEY and/or OPENROUTER_API_KEY on Vercel Production.",
      ],
      attempted: [],
      transient: false,
    };
  }

  const errors: string[] = [];
  const attempted: LlmProviderId[] = [];

  const baseTimeout =
    opts.timeoutMs ?? 16_000;

  for (
    let index = 0;
    index < providers.length;
    index++
  ) {
    const provider = providers[index];

    attempted.push(provider.id);

    /*
     * Give the first provider the full timeout.
     * Give later fallbacks a slightly smaller timeout
     * so the overall request does not become excessively slow.
     */
    const providerTimeout = Math.max(
      8_000,
      baseTimeout - index * 2_000,
    );

    try {
      const result = await provider.chat(
        messages,
        {
          ...opts,
          timeoutMs: providerTimeout,
        },
      );

      logger.info("llm_ok", {
        provider: provider.id,
        model: result.model,
        latencyMs: result.latencyMs,
        attempt: index + 1,
      });

      return {
        result,
        errors,
        attempted,
        transient: false,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      const safeMessage = message.slice(0, 500);

      errors.push(
        `${provider.id}: ${safeMessage}`,
      );

      logger.warn(
        "llm_provider_failed",
        {
          provider: provider.id,
          error: safeMessage,
          attempt: index + 1,
          hardError:
            isHardLlmError(safeMessage),
          transient:
            isTransientLlmError(safeMessage),
        },
      );

      /*
       * Always move to the next provider.
       *
       * Hard errors are not retried against the same provider
       * by this router. The provider itself already handles its
       * model-level fallback.
       */
      continue;
    }
  }

  const transient = errors.some((error) =>
    isTransientLlmError(error),
  );

  logger.warn(
    "llm_all_providers_failed",
    {
      errors,
      attempted,
      transient,
    },
  );

  return {
    result: null,
    errors,
    attempted,
    transient,
  };
}

/**
 * Compatibility helper.
 *
 * The product currently prefers predictable sequential
 * fallback instead of parallel requests.
 */
export async function chatRaceProviders(
  messages: LlmMessage[],
  opts: LlmChatOptions = {},
): Promise<ChatWithFallbackResult> {
  return chatWithFallbackDetailed(
    messages,
    opts,
  );
}

export async function chatWithFallback(
  messages: LlmMessage[],
  opts: LlmChatOptions = {},
): Promise<LlmChatResult | null> {
  const { result } =
    await chatWithFallbackDetailed(
      messages,
      opts,
    );

  return result;
}