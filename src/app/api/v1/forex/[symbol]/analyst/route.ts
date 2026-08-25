import { NextRequest } from "next/server";
import { fail, handleError, ok } from "@/lib/api";
import { runForexAnalysis } from "@/lib/forex/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ symbol: string }> },
) {
  try {
    const { symbol: raw } = await ctx.params;
    const symbol = raw?.toUpperCase();
    if (!symbol) return fail("Missing symbol", 400);
    const tf = req.nextUrl.searchParams.get("timeframe") ?? "1h";

    const analysis = await runForexAnalysis(symbol, tf);
    // analyst is attached by enrich step inside runForexAnalysis when wired;
    // fallback: return analysis blob
    const analyst =
      (analysis as { analyst?: unknown }).analyst ??
      null;

    return ok(
      {
        symbol,
        timeframe: tf,
        analyst,
        recommendation: analysis.recommendation,
        confidence: analysis.confidence,
        macro: (analysis as { macro?: unknown }).macro ?? null,
        alerts: (analysis as { alerts?: unknown }).alerts ?? [],
      },
      { source: "forex-ai-analyst" },
    );
  } catch (err) {
    return handleError(err, "forex_analyst");
  }
}
