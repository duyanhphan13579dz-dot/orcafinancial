import { NextRequest } from "next/server";
import { fail, handleError, ok } from "@/lib/api";
import { runForexAnalysis } from "@/lib/forex/service";
import { evaluateAlerts } from "@/lib/forex/alerts";
import { buildMacroContext } from "@/lib/forex/macro";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ symbol: string }> },
) {
  try {
    const { symbol: raw } = await ctx.params;
    const symbol = raw?.toUpperCase();
    if (!symbol) return fail("Missing symbol", 400);

    const tf = req.nextUrl.searchParams.get("timeframe") ?? "1h";
    const priceAbove = req.nextUrl.searchParams.get("above");
    const priceBelow = req.nextUrl.searchParams.get("below");

    const analysis = await runForexAnalysis(symbol, tf);
    const macro = buildMacroContext(symbol);
    const ind = analysis.indicators as Record<string, unknown>;

    const alerts = evaluateAlerts({
      symbol,
      price: analysis.entryPrice,
      recommendation: analysis.recommendation,
      confidence: analysis.confidence,
      entry: analysis.entryPrice,
      stopLoss: analysis.stopLoss,
      takeProfit: analysis.takeProfit,
      takeProfit2: analysis.takeProfit2,
      rsi14: typeof ind.rsi14 === "number" ? ind.rsi14 : null,
      macdHistogram:
        typeof ind.macdHistogram === "number" ? ind.macdHistogram : null,
      ema20: typeof ind.ema20 === "number" ? ind.ema20 : null,
      ema50: typeof ind.ema50 === "number" ? ind.ema50 : null,
      support: typeof ind.support === "number" ? ind.support : null,
      resistance: typeof ind.resistance === "number" ? ind.resistance : null,
      macroMinutesUntil: macro.nextHighImpact?.minutesUntil ?? null,
      macroTitle: macro.nextHighImpact?.title ?? null,
      macroImpact: macro.nextHighImpact?.impact ?? null,
      priceAbove: priceAbove != null ? Number(priceAbove) : null,
      priceBelow: priceBelow != null ? Number(priceBelow) : null,
    });

    return ok(
      { symbol, timeframe: tf, alerts, macroRisk: macro.eventRisk },
      { source: "forex-alerts" },
    );
  } catch (err) {
    return handleError(err, "forex_alerts");
  }
}
