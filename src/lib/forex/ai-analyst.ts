/**
 * Phase 11 — AI Forex Analyst
 *
 * Builds structured context for LLM and a deterministic narrative
 * (works without LLM; LLM can refine when available).
 */

import type { MtfResult } from "./mtf";
import type { FxIntelligence } from "./fx-intelligence";
import type { TradeSetup } from "./trade-setup";
import type { MacroContext } from "./macro";
import type { LayerScore } from "./analysis";

export interface AnalystStructuredInput {
  symbol: string;
  name?: string;
  timeframe: string;
  price: {
    last: number;
    changePercent: number | null;
    bid: number | null;
    ask: number | null;
    spreadPips: number | null;
    freshness?: string;
  };
  technical: {
    recommendation: "BUY" | "SELL" | "NEUTRAL";
    confidence: number;
    compositeScore?: number | null;
    marketStructure?: string | null;
    volatilityRegime?: string | null;
    layers?: LayerScore[];
    rsi14?: number | null;
    atr14?: number | null;
    support?: number | null;
    resistance?: number | null;
  };
  mtf: MtfResult | null;
  fx: FxIntelligence | null;
  macro: MacroContext | null;
  risk: TradeSetup["risk"] | null;
  setupQuality?: string | null;
}

export interface AnalystNarrative {
  marketSummary: string;
  bullCase: string;
  bearCase: string;
  invalidation: string;
  traderSummary: {
    bias: string;
    confidence: number;
    risk: string;
    action: string;
  };
  structured: AnalystStructuredInput;
  generatedAt: string;
  mode: "deterministic" | "llm";
}

function riskLabel(setup: TradeSetup["risk"] | null, macro: MacroContext | null): string {
  if (macro?.eventRisk === "EXTREME" || macro?.eventRisk === "HIGH") return "High (macro)";
  if (!setup?.riskReward) return "Medium";
  if (setup.riskReward >= 2) return "Controlled";
  if (setup.riskReward >= 1.3) return "Medium";
  return "Elevated (R:R tight)";
}

export function buildAnalystNarrative(input: AnalystStructuredInput): AnalystNarrative {
  const { symbol, timeframe, price, technical, mtf, fx, macro, risk } = input;
  const rec = technical.recommendation;
  const confPct = Math.round(technical.confidence * 100);

  const biasWord =
    rec === "BUY" ? "Bullish" : rec === "SELL" ? "Bearish" : "Neutral / Wait";

  const mtfLine = mtf
    ? `MTF overall ${mtf.overall} (alignment ${(mtf.alignment * 100).toFixed(0)}%): ${mtf.summary}`
    : "MTF data unavailable";

  const struct = technical.marketStructure ?? "unknown";
  const regime = technical.volatilityRegime ?? "normal";

  const marketSummary = [
    `${symbol} trên khung ${timeframe}: khuyến nghị kỹ thuật ${rec} với confidence ${confPct}%.`,
    `Giá ${price.last}${price.changePercent != null ? ` (${price.changePercent >= 0 ? "+" : ""}${price.changePercent.toFixed(2)}%)` : ""}.`,
    `Cấu trúc thị trường ${struct}, volatility regime ${regime}.`,
    mtfLine + ".",
    fx?.session
      ? `Phiên hiện tại: ${fx.session.label} (vol ${fx.session.volatility}, liq ${fx.session.liquidity}).`
      : "",
    macro?.eventRisk && macro.eventRisk !== "NONE"
      ? `Macro: ${macro.eventRiskNote}.`
      : "Không có sự kiện macro trọng yếu sát giờ.",
  ]
    .filter(Boolean)
    .join(" ");

  const res = technical.resistance;
  const sup = technical.support;
  const entry = risk?.entry ?? price.last;
  const sl = risk?.stopLoss;
  const tp = risk?.takeProfit;

  const bullCase =
    rec === "SELL"
      ? `Bull case (đối trọng): nếu giá giữ trên ${sup != null ? sup.toFixed(5) : "vùng hỗ trợ gần nhất"} và MTF chuyển trung lập/tăng, short thesis yếu đi — cân nhắc đóng sớm.`
      : `Bull case: nếu phá ${res != null ? res.toFixed(5) : "kháng cự gần"} kèm MTF đồng thuận tăng, mở rộng hướng ${tp != null ? tp.toFixed(5) : "TP1"}. ${
          fx?.dxy.pairExpected === "bullish" ? "DXY/strength đang ủng hộ chiều mua." : ""
        }`.
        trim();

  const bearCase =
    rec === "BUY"
      ? `Bear case (đối trọng): mất ${sup != null ? sup.toFixed(5) : "hỗ trợ"} hoặc MTF đảo chiều giảm → long thesis invalid.`
      : `Bear case: nếu phá ${sup != null ? sup.toFixed(5) : "hỗ trợ"} / giữ dưới kháng cự, đà giảm hướng ${tp != null ? tp.toFixed(5) : "TP"}. ${
          fx?.dxy.pairExpected === "bearish" ? "DXY correlation đang bất lợi cho long." : ""
        }`.
        trim();

  const invalidation =
    rec === "BUY"
      ? `Tín hiệu BUY mất hiệu lực nếu giá đóng cửa dưới SL ${sl != null ? sl.toFixed(5) : "(chưa xác định)"} hoặc MTF HTF chuyển bearish + macro event risk EXTREME.`
      : rec === "SELL"
        ? `Tín hiệu SELL mất hiệu lực nếu giá đóng cửa trên SL ${sl != null ? sl.toFixed(5) : "(chưa xác định)"} hoặc MTF HTF chuyển bullish.`
        : `Chưa có bias hướng — invalidation = chờ break có volume/structure rõ trên ${timeframe}.`;

  const action =
    macro?.stance === "wait"
      ? "WAIT — tránh vào lệnh sát sự kiện macro"
      : rec === "NEUTRAL"
        ? "WAIT / quan sát"
        : rec === "BUY"
          ? `Ưu tiên long gần ${entry.toFixed(5)}, SL ${sl != null ? sl.toFixed(5) : "—"}, TP ${tp != null ? tp.toFixed(5) : "—"}`
          : `Ưu tiên short gần ${entry.toFixed(5)}, SL ${sl != null ? sl.toFixed(5) : "—"}, TP ${tp != null ? tp.toFixed(5) : "—"}`;

  return {
    marketSummary,
    bullCase,
    bearCase,
    invalidation,
    traderSummary: {
      bias: biasWord,
      confidence: confPct,
      risk: riskLabel(risk, macro),
      action,
    },
    structured: input,
    generatedAt: new Date().toISOString(),
    mode: "deterministic",
  };
}

/** Compact JSON for LLM system prompt injection. */
export function analystPayloadForLlm(input: AnalystStructuredInput): string {
  return JSON.stringify(
    {
      price: input.price,
      technical: {
        recommendation: input.technical.recommendation,
        confidence: input.technical.confidence,
        structure: input.technical.marketStructure,
        regime: input.technical.volatilityRegime,
        support: input.technical.support,
        resistance: input.technical.resistance,
      },
      mtf: input.mtf
        ? {
            overall: input.mtf.overall,
            alignment: input.mtf.alignment,
            context: input.mtf.context,
            frames: input.mtf.frames.map((f) => ({ tf: f.label, bias: f.bias })),
          }
        : null,
      dxy: input.fx?.dxy ?? null,
      currencyStrength: input.fx?.pairBiasFromStrength ?? null,
      session: input.fx?.session ?? null,
      macro: input.macro
        ? {
            eventRisk: input.macro.eventRisk,
            note: input.macro.eventRiskNote,
            next: input.macro.nextHighImpact
              ? {
                  title: input.macro.nextHighImpact.title,
                  inMinutes: input.macro.nextHighImpact.minutesUntil,
                  impact: input.macro.nextHighImpact.impact,
                }
              : null,
          }
        : null,
      risk: input.risk
        ? {
            entry: input.risk.entry,
            sl: input.risk.stopLoss,
            tp: input.risk.takeProfit,
            rr: input.risk.riskReward,
            riskPips: input.risk.riskPips,
          }
        : null,
    },
    null,
    0,
  );
}
