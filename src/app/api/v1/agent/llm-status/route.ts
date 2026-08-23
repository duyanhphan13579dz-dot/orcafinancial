import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { getAuthedUser } from "@/lib/auth/guard";
import { chatWithFallbackDetailed, llmEnvDiagnostics, listConfiguredProviders } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * Authenticated diagnostic: which keys are present + live ping of cascade.
 * GET /api/v1/agent/llm-status?ping=1  — optional live test call
 */
export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 30);
  if (limited) return limited;

  try {
    await getAuthedUser(req);

    const diag = llmEnvDiagnostics();
    const configured = listConfiguredProviders();

    const ping = req.nextUrl.searchParams.get("ping") === "1";
    let live: {
      ok: boolean;
      provider?: string;
      model?: string;
      latencyMs?: number;
      errors?: string[];
      snippet?: string;
    } | null = null;

    if (ping) {
      const started = Date.now();
      const detailed = await chatWithFallbackDetailed(
        [
          {
            role: "system",
            content: "Bạn là trợ lý kiểm tra. Trả lời đúng một câu ngắn tiếng Việt.",
          },
          { role: "user", content: "Chỉ trả lời: LLM hoạt động." },
        ],
        { maxTokens: 40, temperature: 0, timeoutMs: 15_000 },
      );

      if (detailed.result) {
        live = {
          ok: true,
          provider: detailed.result.provider,
          model: detailed.result.model,
          latencyMs: detailed.result.latencyMs ?? Date.now() - started,
          snippet: detailed.result.text.slice(0, 80),
        };
      } else {
        live = {
          ok: false,
          errors: detailed.errors,
          latencyMs: Date.now() - started,
        };
      }
    }

    return ok({
      keysPresent: diag.keysPresent,
      configured: configured.map((p) => p.id),
      order: diag.order,
      live,
      hint:
        "Nếu keysPresent.GEMINI_API_KEY=false trên Production: gắn key cho Production and Preview rồi Redeploy. " +
        "Nếu live.ok=false: xem live.errors (401 = key sai, model decommissioned = đổi GROQ_MODEL/GEMINI_MODEL).",
    });
  } catch (err) {
    return handleError(err, "agent_llm_status");
  }
}
