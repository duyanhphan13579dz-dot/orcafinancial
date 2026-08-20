import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { runForexAnalysis } from "@/lib/forex/service";

const V = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, c: { params: Promise<{ symbol: string }> }) {
  const l = checkRateLimit(req, 60);
  if (l) return l;
  const { symbol } = await c.params;
  const tf = req.nextUrl.searchParams.get("timeframe") ?? "1h";
  if (!V.has(tf)) return fail("Invalid timeframe", 400);
  try {
    const a = await runForexAnalysis(symbol.toUpperCase(), tf);
    return ok(
      {
        symbol: a.symbol,
        timeframe: tf,
        recommendation: a.recommendation,
        entryPrice: a.entryPrice,
        stopLoss: a.stopLoss,
        takeProfit: a.takeProfit,
        confidence: a.confidence,
        reasons: a.reasons,
        disclaimer: a.disclaimer,
      },
      { source: a.source, timezone: "Asia/Ho_Chi_Minh" },
      { cacheSeconds: 20 },
    );
  } catch (e) {
    return handleError(e, `forex_recommendation:${symbol}`);
  }
}
