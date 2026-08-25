/**
 * Phase 12 — Alert System
 *
 * Evaluates alert conditions against live analysis snapshot.
 * In-memory evaluation (persist/subscribe can be added later).
 */

export type AlertKind =
  | "price"
  | "entry"
  | "tp"
  | "sl"
  | "confidence"
  | "technical"
  | "macro";

export type AlertSeverity = "info" | "watch" | "action" | "critical";

export interface ForexAlert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  symbol: string;
  title: string;
  message: string;
  triggeredAt: string;
  meta?: Record<string, unknown>;
}

export interface AlertEvalInput {
  symbol: string;
  price: number;
  recommendation: "BUY" | "SELL" | "NEUTRAL";
  confidence: number;
  /** previous confidence 0..1 if known */
  prevConfidence?: number | null;
  entry?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  takeProfit2?: number | null;
  rsi14?: number | null;
  macdHistogram?: number | null;
  prevMacdHistogram?: number | null;
  ema20?: number | null;
  ema50?: number | null;
  prevEma20?: number | null;
  support?: number | null;
  resistance?: number | null;
  macroMinutesUntil?: number | null;
  macroTitle?: string | null;
  macroImpact?: string | null;
  /** Optional user price thresholds */
  priceAbove?: number | null;
  priceBelow?: number | null;
}

function near(a: number, b: number, tolPct = 0.0003): boolean {
  if (!b) return false;
  return Math.abs(a - b) / Math.abs(b) <= tolPct;
}

export function evaluateAlerts(input: AlertEvalInput): ForexAlert[] {
  const alerts: ForexAlert[] = [];
  const now = new Date().toISOString();
  const sym = input.symbol.toUpperCase();
  let i = 0;
  const push = (
    kind: AlertKind,
    severity: AlertSeverity,
    title: string,
    message: string,
    meta?: Record<string, unknown>,
  ) => {
    alerts.push({
      id: `${sym}-${kind}-${i++}`,
      kind,
      severity,
      symbol: sym,
      title,
      message,
      triggeredAt: now,
      meta,
    });
  };

  // Price thresholds
  if (input.priceAbove != null && input.price >= input.priceAbove) {
    push("price", "action", "Price above target", `${sym} ≥ ${input.priceAbove}`, {
      price: input.price,
    });
  }
  if (input.priceBelow != null && input.price <= input.priceBelow) {
    push("price", "action", "Price below target", `${sym} ≤ ${input.priceBelow}`, {
      price: input.price,
    });
  }

  // Entry / TP / SL proximity
  if (input.entry != null && near(input.price, input.entry)) {
    push(
      "entry",
      "action",
      "Price near entry",
      `${sym} reached BUY/SELL entry zone (~${input.entry})`,
      { entry: input.entry, price: input.price },
    );
  }
  if (input.takeProfit != null && near(input.price, input.takeProfit, 0.0004)) {
    push("tp", "action", "TP1 zone", `${sym} near TP1 ${input.takeProfit}`, {
      tp: input.takeProfit,
    });
  }
  if (input.takeProfit2 != null && near(input.price, input.takeProfit2, 0.0004)) {
    push("tp", "watch", "TP2 zone", `${sym} near TP2 ${input.takeProfit2}`, {
      tp2: input.takeProfit2,
    });
  }
  if (input.stopLoss != null && near(input.price, input.stopLoss, 0.0004)) {
    push("sl", "critical", "SL zone", `${sym} near stop-loss ${input.stopLoss}`, {
      sl: input.stopLoss,
    });
  }

  // Confidence drop
  if (
    input.prevConfidence != null &&
    input.prevConfidence - input.confidence >= 0.12
  ) {
    push(
      "confidence",
      "watch",
      "Confidence dropped",
      `Confidence ${(input.prevConfidence * 100).toFixed(0)}% → ${(input.confidence * 100).toFixed(0)}%`,
      { from: input.prevConfidence, to: input.confidence },
    );
  }

  // Technical
  if (input.rsi14 != null && input.rsi14 >= 70) {
    push("technical", "watch", "RSI overbought", `RSI(14) ${input.rsi14.toFixed(1)} ≥ 70`);
  }
  if (input.rsi14 != null && input.rsi14 <= 30) {
    push("technical", "watch", "RSI oversold", `RSI(14) ${input.rsi14.toFixed(1)} ≤ 30`);
  }
  if (
    input.macdHistogram != null &&
    input.prevMacdHistogram != null &&
    input.prevMacdHistogram <= 0 &&
    input.macdHistogram > 0
  ) {
    push("technical", "action", "MACD bullish cross", "MACD histogram crossed above 0");
  }
  if (
    input.macdHistogram != null &&
    input.prevMacdHistogram != null &&
    input.prevMacdHistogram >= 0 &&
    input.macdHistogram < 0
  ) {
    push("technical", "action", "MACD bearish cross", "MACD histogram crossed below 0");
  }
  if (
    input.ema20 != null &&
    input.ema50 != null &&
    input.prevEma20 != null &&
    input.prevEma20 <= input.ema50 &&
    input.ema20 > input.ema50
  ) {
    push("technical", "action", "EMA bullish cross", "EMA20 crossed above EMA50");
  }
  if (input.resistance != null && input.price > input.resistance) {
    push(
      "technical",
      "action",
      "Breakout above resistance",
      `${sym} > resistance ${input.resistance}`,
    );
  }
  if (input.support != null && input.price < input.support) {
    push(
      "technical",
      "action",
      "Breakdown below support",
      `${sym} < support ${input.support}`,
    );
  }

  // Macro countdown
  if (
    input.macroMinutesUntil != null &&
    input.macroMinutesUntil >= 0 &&
    input.macroMinutesUntil <= 30 &&
    (input.macroImpact === "HIGH" || input.macroImpact === "EXTREME")
  ) {
    push(
      "macro",
      "critical",
      "High-impact event soon",
      `${input.macroTitle ?? "Event"} in ${input.macroMinutesUntil} minutes`,
      { impact: input.macroImpact },
    );
  } else if (
    input.macroMinutesUntil != null &&
    input.macroMinutesUntil > 30 &&
    input.macroMinutesUntil <= 120 &&
    (input.macroImpact === "HIGH" || input.macroImpact === "EXTREME")
  ) {
    push(
      "macro",
      "watch",
      "Macro event within 2h",
      `${input.macroTitle ?? "Event"} in ${input.macroMinutesUntil} min`,
    );
  }

  return alerts;
}
