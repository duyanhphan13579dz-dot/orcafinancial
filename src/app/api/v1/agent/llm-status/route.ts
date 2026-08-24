import { NextRequest } from "next/server";
import {
  checkRateLimit,
  handleError,
  ok,
} from "@/lib/api";
import { getAuthedUser } from "@/lib/auth/guard";
import {
  chatWithFallbackDetailed,
  llmEnvDiagnostics,
  listConfiguredProviders,
} from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * Authenticated LLM diagnostic endpoint.
 *
 * Basic:
 *   GET /api/v1/agent/llm-status
 *
 * Live:
 *   GET /api/v1/agent/llm-status?ping=1
 *
 * The endpoint never exposes API keys.
 * It only reports whether a key is present and which
 * provider/model was successfully reached.
 */
export async function GET(
  req: NextRequest,
) {
  const limited = checkRateLimit(
    req,
    30,
  );

  if (limited) {
    return limited;
  }

  try {
    await getAuthedUser(req);

    const diag =
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

    if (ping) {
      const started =
        Date.now();

      const detailed =
        await chatWithFallbackDetailed(
          [
            {
              role: "system",
              content:
                "Bạn là trợ lý kiểm tra hệ thống. " +
                "Trả lời đúng một câu ngắn bằng tiếng Việt. " +
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

      if (detailed.result) {
        live = {
          ok: true,
          provider:
            detailed.result.provider,
          model:
            detailed.result.model,
          latencyMs:
            detailed.result.latencyMs ??
            Date.now() - started,
          attempted:
            detailed.attempted,
          transient:
            detailed.transient,
          snippet:
            detailed.result.text.slice(
              0,
              120,
            ),
        };
      } else {
        live = {
          ok: false,
          errors:
            detailed.errors,
          attempted:
            detailed.attempted,
          transient:
            detailed.transient,
          latencyMs:
            Date.now() - started,
        };
      }
    }

    return ok({
      keysPresent:
        diag.keysPresent,

      configured:
        configured.map(
          (provider) => provider.id,
        ),

      order:
        diag.order,

      models:
        diag.models,

      live,

      hint:
        "LLM pipeline: Groq → OpenRouter. " +
        "keysPresent chỉ xác nhận biến môi trường tồn tại, " +
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