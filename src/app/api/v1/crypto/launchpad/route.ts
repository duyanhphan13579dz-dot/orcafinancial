import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { fetchLaunchpadIntelligence } from "@/lib/crypto/launchpad";

export const dynamic = "force-dynamic";

/**
 * Phase 5 — Launchpad / Launchpool / New listings
 * GET /api/v1/crypto/launchpad
 */
export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 30);
  if (limited) return limited;

  try {
    const data = await fetchLaunchpadIntelligence();
    const response = ok(data, {
      timezone: "Asia/Ho_Chi_Minh",
      source: data.source,
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=120, stale-while-revalidate=300",
    );
    return response;
  } catch (e) {
    return handleError(e, "crypto_launchpad");
  }
}
