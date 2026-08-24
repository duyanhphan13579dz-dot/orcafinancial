import { NextRequest } from "next/server";
import {
  checkRateLimit,
  handleError,
  ok,
} from "@/lib/api";
import {
  chatWithFallbackDetailed,
  llmEnvDiagnostics,
  listConfiguredProviders,
} from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * ORCA Financial - LLM Diagnostic Endpoint
 *
 * Basic:
 *   GET /api/v1/agent/llm-status
 *
 * Live:
 *   GET /api/v1/agent/llm-status?ping=1
 *
 * IMPORTANT:
 * - This endpoint is intentionally PUBLIC.
 * - It does NOT expose API keys.
 * - It only exposes whether keys exist, configured providers,
 *   configured model names, and live provider status.
 * - Rate limiting remains enabled.
 *
 * This is a diagnostic endpoint, not a user-data endpoint,
 * so authentication is intentionally not required.
 */
export async function GET(
  req: NextRequest,
) {
  /*
   * Keep rate limiting even though authentication is not required.
   *
   * This is especially important because ?ping=1 actually
   * sends a request to the LLM providers.
   */
  const limited = checkRateLimit(
    req,
    10,
  );

  if (limited) {
    return limited;
  }

  try {
    const diagnostics =
      llmEnvDiagnostics();

    const configured =
      listConfiguredProviders();

    const ping =
      req.nextUrl.searchParams.get("ping") ===
      "1";

    let live: {
      ok: boolean;
      provider?: string;
      model?: string;
      latencyMs?: number;
      errors?: string[];
      attempted?: string[];
      transient?: boolean;
      snippet?: string;
    } | null = null;

    /*
     * Only perform an actual LLM request when:
     *
     * /api/v1/agent/llm-status?ping=1
     *
     * is used.
     *
     * Without ?ping=1, this endpoint only checks environment
     * configuration and does NOT consume LLM requests.
     */
    if (ping) {
      const started =
        Date.now();

      const result =
        await chatWithFallbackDetailed(
          [
            {
              role: "system",
              content:
                "Bạn là hệ thống kiểm tra LLM của ORCA Financial. " +
                "Chỉ trả lời đúng một câu ngắn bằng tiếng Việt. " +
                "Không giải thích thêm.",
            },
            {
              role: "user",
              content:
                "Chỉ trả lời: LLM hoạt động.",
            },
          ],
          {
            maxTokens: 40,
            temperature: 0,
            timeoutMs: 15_000,
          },
        );

      if (result.result) {
        live = {
          ok: true,
          provider:
            result.result.provider,
          model:
            result.result.model,
          latencyMs:
            result.result.latencyMs ??
            Date.now() - started,
          attempted:
            result.attempted,
          transient:
            result.transient,
          snippet:
            result.result.text.slice(
              0,
              120,
            ),
        };
      } else {
        live = {
          ok: false,
          errors:
            result.errors,
          attempted:
            result.attempted,
          transient:
            result.transient,
          latencyMs:
            Date.now() - started,
        };
      }
    }

    return ok({
      keysPresent:
        diagnostics.keysPresent,

      configured:
        configured.map(
          (provider) => provider.id,
        ),

      order:
        diagnostics.order,

      models:
        diagnostics.models,

      live,

      meta: {
        authenticated: false,
        diagnosticOnly: true,
        pingRequested: ping,
      },

      hint:
        "ORCA LLM pipeline: Groq → OpenRouter. " +
        "keysPresent=true chỉ xác nhận biến môi trường tồn tại, " +
        "không xác nhận API key còn hợp lệ. " +
        "Dùng ?ping=1 để thực hiện live test. " +
        "401/403 = authentication hoặc permission. " +
        "402 = OpenRouter thiếu credit. " +
        "404/model_not_found = model không khả dụng cho key/project. " +
        "429/5xx/timeout = lỗi tạm thời hoặc rate limit.",
    });
  } catch (error) {
    return handleError(
      error,
      "agent_llm_status",
    );
  }
}