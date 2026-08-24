import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { buildCryptoAiBundle } from "@/lib/crypto/ai-context";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Phase 6 — ORCA AI Crypto brief (structured + context block)
 * GET /api/v1/crypto/[symbol]/ai-brief
 */
export async function GET(
  req: NextRequest,
  c: { params: Promise<{ symbol: string }> },
) {
  const limited = checkRateLimit(req, 20);
  if (limited) return limited;

  const { symbol } = await c.params;
  const base = symbol.toUpperCase().replace(/USDT$/i, "");

  try {
    const includeLaunch =
      req.nextUrl.searchParams.get("launchpad") === "1";
    const bundle = await buildCryptoAiBundle(base, {
      includeLaunchpad: includeLaunch,
    });

    const response = ok(
      {
        symbol: bundle.symbol,
        layersOk: bundle.layersOk,
        layersFailed: bundle.layersFailed,
        contextBlock: bundle.contextBlock,
        snapshot: bundle.snapshot,
        orderFlow: bundle.orderFlow
          ? {
              available: bundle.orderFlow.available,
              imbalance: bundle.orderFlow.orderBook?.imbalance ?? null,
              whaleSummary: bundle.orderFlow.whaleSummary,
            }
          : null,
        whale: bundle.whale
          ? {
              available: bundle.whale.available,
              bias: bundle.whale.whale.bias,
              netFlow: bundle.whale.whale.netFlow,
              assessment: bundle.whale.assessment,
            }
          : null,
        sentiment: bundle.sentimentIntel
          ? {
              label: bundle.sentimentIntel.label,
              score: bundle.sentimentIntel.score,
              divergence: bundle.sentimentIntel.divergence,
            }
          : null,
        onChain: bundle.onChain
          ? {
              available: bundle.onChain.available,
              tvl: bundle.onChain.defi.tvl,
              assessment: bundle.onChain.assessment,
            }
          : null,
      },
      {
        timezone: "Asia/Ho_Chi_Minh",
        source: "orca-crypto-ai",
      },
    );
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=120",
    );
    return response;
  } catch (e) {
    return handleError(e, `crypto_ai_brief:${base}`);
  }
}
