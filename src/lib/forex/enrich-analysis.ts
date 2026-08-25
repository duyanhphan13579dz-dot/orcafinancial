/**
 * Post-process forex analysis with Phase 10–12 layers.
 * Macro uses live calendar when available.
 */

import {
  applyMacroToRecommendation,
  buildMacroContextLive,
  type MacroContext,
} from "./macro";
import {
  buildAnalystNarrative,
  type AnalystNarrative,
} from "./ai-analyst";
import { evaluateAlerts, type ForexAlert } from "./alerts";
import type { TradeSetup } from "./trade-setup";
import type { MtfResult } from "./mtf";
import type { FxIntelligence } from "./fx-intelligence";

export interface EnrichInput {
  symbol: string;
  name?: string;
  timeframe: string;
  recommendation: "BUY" | "SELL" | "NEUTRAL";
  confidence: number;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  takeProfit2?: number | null;
  reasons: string[];
  layers?: unknown[];
  marketStructure?: string;
  volatilityRegime?: string;
  compositeScore?: number;
  indicators?: Record<string, unknown>;
  mtf: MtfResult | null;
  fxIntelligence: FxIntelligence | null;
  tradeSetup: TradeSetup | null;
  quote?: {
    price: number;
    changePercent?: number | null;
    bid?: number | null;
    ask?: number | null;
    spreadPips?: number | null;
    freshness?: string;
  } | null;
}

export async function enrichWithMacroAiAlerts(input: EnrichInput): Promise<{
  recommendation: "BUY" | "SELL" | "NEUTRAL";
  confidence: number;
  reasons: string[];
  macro: MacroContext;
  analyst: AnalystNarrative;
  alerts: ForexAlert[];
}> {
  const macro = await buildMacroContextLive(input.symbol);
  const macroAdj = applyMacroToRecommendation(
    input.recommendation,
    input.confidence,
    macro,
  );

  const price = input.quote?.price ?? input.entryPrice;
  const ind = input.indicators ?? {};

  const analyst = buildAnalystNarrative({
    symbol: input.symbol,
    name: input.name,
    timeframe: input.timeframe,
    price: {
      last: price,
      changePercent: input.quote?.changePercent ?? null,
      bid: input.quote?.bid ?? null,
      ask: input.quote?.ask ?? null,
      spreadPips: input.quote?.spreadPips ?? null,
      freshness: input.quote?.freshness,
    },
    technical: {
      recommendation: macroAdj.recommendation,
      confidence: macroAdj.confidence,
      compositeScore: input.compositeScore,
      marketStructure: input.marketStructure,
      volatilityRegime: input.volatilityRegime,
      layers: input.layers as never,
      rsi14: typeof ind.rsi14 === "number" ? ind.rsi14 : null,
      atr14: typeof ind.atr14 === "number" ? ind.atr14 : null,
      support: typeof ind.support === "number" ? ind.support : null,
      resistance: typeof ind.resistance === "number" ? ind.resistance : null,
    },
    mtf: input.mtf,
    fx: input.fxIntelligence,
    macro,
    risk: input.tradeSetup?.risk ?? null,
    setupQuality: input.tradeSetup?.setupQuality ?? null,
  });

  const alerts = evaluateAlerts({
    symbol: input.symbol,
    price,
    recommendation: macroAdj.recommendation,
    confidence: macroAdj.confidence,
    entry: input.entryPrice,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    takeProfit2: input.takeProfit2,
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
  });

  return {
    recommendation: macroAdj.recommendation,
    confidence: macroAdj.confidence,
    reasons: [...macroAdj.reasons, ...input.reasons].slice(0, 16),
    macro,
    analyst,
    alerts,
  };
}
