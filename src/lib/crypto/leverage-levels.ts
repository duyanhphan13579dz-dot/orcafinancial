/**
 * Scale signal Entry / SL / TP by leverage.
 *
 * Model (isolated-margin style, simplified):
 * - Base levels come from ATR technical analysis (≈ “1x risk”).
 * - Higher leverage shrinks SL distance so stop sits before estimated liquidation.
 * - TP keeps the original risk:reward ratio.
 * - Entry can bias slightly toward live mark for tighter fills at high lev.
 */

export interface LeverageLevelsInput {
  recommendation: "LONG" | "SHORT" | "NEUTRAL";
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  /** Live mark / last price if available */
  markPrice?: number | null;
  /** 0–500; 0 is treated as spot (1x) */
  leverage: number;
  /** Maintenance margin fraction, default 0.5% */
  maintenanceMargin?: number;
}

export interface LeverageLevels {
  leverage: number;
  effectiveLeverage: number;
  entry: number;
  stopLoss: number | null;
  takeProfit: number | null;
  liquidation: number | null;
  /** Distance entry → SL as % of entry */
  slPct: number | null;
  /** Distance entry → TP as % of entry */
  tpPct: number | null;
  /** Estimated R:R */
  riskReward: number | null;
  note: string;
}

export function computeLeverageLevels(input: LeverageLevelsInput): LeverageLevels {
  const raw = Number.isFinite(input.leverage) ? input.leverage : 0;
  const leverage = Math.min(500, Math.max(0, Math.round(raw)));
  const effective = leverage <= 0 ? 1 : leverage;
  const mm = input.maintenanceMargin ?? 0.005;

  const baseEntry = input.entryPrice;
  const mark =
    input.markPrice != null && Number.isFinite(input.markPrice) && input.markPrice > 0
      ? input.markPrice
      : baseEntry;

  // At higher leverage, entry drifts toward live mark (tighter practical fill)
  // weight: 0 at 1x → ~0.85 at 500x
  const markWeight = Math.min(0.85, Math.log10(effective + 1) / Math.log10(501));
  const entry = baseEntry * (1 - markWeight) + mark * markWeight;

  const side = input.recommendation;
  if (side === "NEUTRAL" || !input.stopLoss || !input.takeProfit) {
    return {
      leverage,
      effectiveLeverage: effective,
      entry,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      liquidation: null,
      slPct: null,
      tpPct: null,
      riskReward: null,
      note: "NEUTRAL — giữ mức gốc, đòn bẩy ít ảnh hưởng.",
    };
  }

  const baseRisk = Math.abs(baseEntry - input.stopLoss);
  const baseReward = Math.abs(input.takeProfit - baseEntry);
  const rr = baseRisk > 0 ? baseReward / baseRisk : 2;

  // Estimated liquidation distance (isolated, simplified)
  // LONG liq ≈ entry * (1 - 1/L + mm); SHORT ≈ entry * (1 + 1/L - mm)
  const invL = 1 / effective;
  let liquidation: number;
  if (side === "LONG") {
    liquidation = entry * (1 - invL + mm);
  } else {
    liquidation = entry * (1 + invL - mm);
  }

  // Max SL distance: 70% of path toward liquidation (safety buffer)
  const liqDist = Math.abs(entry - liquidation);
  const maxSlDist = Math.max(entry * 0.0005, liqDist * 0.7);

  // Also compress original ATR risk as leverage rises: risk_scaled = base / sqrt(L)
  const compress = Math.sqrt(effective);
  const atrScaled = baseRisk / compress;
  const riskDist = Math.min(baseRisk, maxSlDist, atrScaled);
  const rewardDist = riskDist * rr;

  let stopLoss: number;
  let takeProfit: number;
  if (side === "LONG") {
    stopLoss = entry - riskDist;
    takeProfit = entry + rewardDist;
    // Clamp SL above liquidation
    if (stopLoss <= liquidation) stopLoss = liquidation + riskDist * 0.05;
  } else {
    stopLoss = entry + riskDist;
    takeProfit = entry - rewardDist;
    if (stopLoss >= liquidation) stopLoss = liquidation - riskDist * 0.05;
  }

  const slPct = (Math.abs(entry - stopLoss) / entry) * 100;
  const tpPct = (Math.abs(takeProfit - entry) / entry) * 100;

  const note =
    effective <= 1
      ? "Spot / 1x — dùng khoảng ATR gốc."
      : `×${effective} — SL thu hẹp trước vùng liq ước lượng (~${liquidation.toFixed(2)}).`;

  return {
    leverage,
    effectiveLeverage: effective,
    entry,
    stopLoss,
    takeProfit,
    liquidation,
    slPct,
    tpPct,
    riskReward: rr,
    note,
  };
}
