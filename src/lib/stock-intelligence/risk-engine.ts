export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "INSUFFICIENT_DATA";

export interface RiskBreakdown {
  market: number;
  liquidity: number;
  financial: number;
  valuation: number;
  volatility: number;
  event: number;
}

export interface TradePlan {
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  riskReward1: number;
  riskReward2: number;
  invalidation: string;
}

export interface RiskAssessment {
  symbol: string;
  overall: number;
  level: RiskLevel;
  breakdown: RiskBreakdown;
  mainRisk: string;
  scenarios: Array<{ name: "bear" | "base" | "bull"; shock: number; fairValueImpact: number; narrative: string }>;
  tradePlan: TradePlan | null;
  dataConfidence: number;
  predictionConfidence: number;
  modelVersion: string;
}

const clamp = (value: number, low = 0, high = 100) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));
const percentile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))];
};

export function buildRiskAssessment(input: { symbol: string; price: number | null; closes: number[]; volumes?: number[]; financialScore?: number | null; valuationScore?: number | null; eventScore?: number | null; }): RiskAssessment {
  const closes = input.closes.filter((value) => Number.isFinite(value) && value > 0);
  const price = input.price ?? closes.at(-1) ?? null;
  const returns = closes.slice(1).map((value, index) => value / closes[index] - 1).filter(Number.isFinite);
  const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const volatility = returns.length ? Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length) * Math.sqrt(252) * 100 : null;
  const volatilityRisk = volatility == null ? 60 : clamp(volatility * 2.4);
  const volume = input.volumes?.filter((value) => Number.isFinite(value) && value >= 0) ?? [];
  const avgVolume = volume.length ? volume.reduce((sum, value) => sum + value, 0) / volume.length : 0;
  const recentVolume = volume.slice(-20).reduce((sum, value) => sum + value, 0) / Math.max(1, Math.min(20, volume.length));
  const liquidityRisk = avgVolume > 0 ? clamp(70 - (recentVolume / avgVolume) * 25) : 60;
  const marketRisk = returns.length ? clamp(55 - (returns.slice(-20).reduce((sum, value) => sum + value, 0) * 100)) : 60;
  const breakdown: RiskBreakdown = { market: Math.round(marketRisk), liquidity: Math.round(liquidityRisk), financial: Math.round(clamp(100 - (input.financialScore ?? 50))), valuation: Math.round(clamp(100 - (input.valuationScore ?? 50))), volatility: Math.round(volatilityRisk), event: Math.round(clamp(input.eventScore == null ? 45 : 100 - input.eventScore)) };
  const overall = Math.round(Object.values(breakdown).reduce((sum, value) => sum + value, 0) / 6);
  const level: RiskLevel = closes.length < 30 ? "INSUFFICIENT_DATA" : overall >= 68 ? "HIGH" : overall >= 42 ? "MEDIUM" : "LOW";
  const support = percentile(closes.slice(-60), 0.2);
  const resistance = percentile(closes.slice(-60), 0.8);
  let tradePlan: TradePlan | null = null;
  if (price != null && support != null && resistance != null && resistance > price && price > 0) {
    const stopLoss = Math.min(price * 0.94, support * 0.98);
    const entryLow = Math.min(price, support * 1.01);
    const entryHigh = price * 1.02;
    const takeProfit1 = Math.max(resistance, price * 1.06);
    const takeProfit2 = price * 1.12;
    const risk = Math.max(0.01, price - stopLoss);
    tradePlan = { entryLow: Number(entryLow.toFixed(2)), entryHigh: Number(entryHigh.toFixed(2)), stopLoss: Number(stopLoss.toFixed(2)), takeProfit1: Number(takeProfit1.toFixed(2)), takeProfit2: Number(takeProfit2.toFixed(2)), riskReward1: Number(((takeProfit1 - price) / risk).toFixed(2)), riskReward2: Number(((takeProfit2 - price) / risk).toFixed(2)), invalidation: `Đóng cửa dưới ${stopLoss.toFixed(2)} hoặc thesis cơ bản bị phá vỡ.` };
  }
  const mainRisk = Object.entries(breakdown).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "volatility";
  return { symbol: input.symbol, overall, level, breakdown, mainRisk, scenarios: [{ name: "bear", shock: -0.1, fairValueImpact: -0.15, narrative: "EPS giảm 10% có thể làm fair value giảm khoảng 15%." }, { name: "base", shock: 0, fairValueImpact: 0, narrative: "Không có cú sốc bổ sung trong kịch bản cơ sở." }, { name: "bull", shock: 0.1, fairValueImpact: 0.12, narrative: "EPS tăng 10% có thể hỗ trợ fair value tăng khoảng 12%." }], tradePlan, dataConfidence: closes.length >= 120 ? 0.8 : closes.length >= 30 ? 0.6 : 0.25, predictionConfidence: tradePlan ? 0.55 : 0.25, modelVersion: "ORCA Risk v1.0" };
}
