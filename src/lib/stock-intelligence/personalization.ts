export type RiskProfile = "conservative" | "balanced" | "aggressive";
export type Horizon = "short" | "medium" | "long";

export interface PersonalizationProfile { riskProfile: RiskProfile; horizon: Horizon; maxPositionPct: number; alertThresholdPct: number; includeEstimateData: boolean; }
export interface AlertInput { symbol: string; price: number | null; changePct: number | null; volatilityPct: number | null; volumeRatio: number | null; thesisScore: number | null; fairValue: number | null; }
export interface PersonalizedAlert { symbol: string; type: "price" | "volatility" | "volume" | "valuation" | "thesis"; severity: "info" | "warning" | "critical"; message: string; triggered: boolean; }
export interface PersonalizedInsights { profile: PersonalizationProfile; alerts: PersonalizedAlert[]; rankedSymbols: string[]; disclosure: string; }

const defaults: Record<RiskProfile, Pick<PersonalizationProfile, "maxPositionPct" | "alertThresholdPct">> = { conservative: { maxPositionPct: 5, alertThresholdPct: 3 }, balanced: { maxPositionPct: 10, alertThresholdPct: 5 }, aggressive: { maxPositionPct: 20, alertThresholdPct: 8 } };
export function buildProfile(input: Partial<PersonalizationProfile> = {}): PersonalizationProfile { const riskProfile = input.riskProfile ?? "balanced"; return { riskProfile, horizon: input.horizon ?? "medium", maxPositionPct: input.maxPositionPct ?? defaults[riskProfile].maxPositionPct, alertThresholdPct: input.alertThresholdPct ?? defaults[riskProfile].alertThresholdPct, includeEstimateData: input.includeEstimateData ?? false }; }
export function buildPersonalizedInsights(inputs: AlertInput[], profileInput: Partial<PersonalizationProfile> = {}): PersonalizedInsights {
  const profile = buildProfile(profileInput);
  const alerts = inputs.flatMap((input) => {
    const threshold = profile.alertThresholdPct;
    const result: PersonalizedAlert[] = [];
    if (input.changePct != null && Math.abs(input.changePct) >= threshold) result.push({ symbol: input.symbol, type: "price", severity: Math.abs(input.changePct) >= threshold * 2 ? "critical" : "warning", message: `${input.symbol} biến động ${input.changePct.toFixed(2)}%, vượt ngưỡng ${threshold}%.`, triggered: true });
    if (input.volatilityPct != null && input.volatilityPct >= (profile.riskProfile === "conservative" ? 35 : profile.riskProfile === "balanced" ? 50 : 75)) result.push({ symbol: input.symbol, type: "volatility", severity: "warning", message: `${input.symbol} có annualized volatility khoảng ${input.volatilityPct.toFixed(1)}%.`, triggered: true });
    if (input.volumeRatio != null && input.volumeRatio >= 2) result.push({ symbol: input.symbol, type: "volume", severity: "info", message: `${input.symbol} có volume gấp ${input.volumeRatio.toFixed(1)} lần trung bình gần đây.`, triggered: true });
    if (input.price != null && input.fairValue != null && input.fairValue > input.price * 1.15) result.push({ symbol: input.symbol, type: "valuation", severity: "info", message: `${input.symbol} đang thấp hơn expected value khoảng ${((input.fairValue / input.price - 1) * 100).toFixed(1)}%.`, triggered: true });
    if (input.thesisScore != null && input.thesisScore < 40) result.push({ symbol: input.symbol, type: "thesis", severity: "critical", message: `Thesis score của ${input.symbol} xuống ${input.thesisScore}/100; cần rà soát invalidation.`, triggered: true });
    return result;
  });
  const rankedSymbols = [...new Set(inputs.map((input) => input.symbol))].sort((a, b) => (alerts.filter((alert) => alert.symbol === b).length - alerts.filter((alert) => alert.symbol === a).length));
  return { profile, alerts, rankedSymbols, disclosure: "Personalization chỉ sắp xếp tín hiệu theo hồ sơ rủi ro/horizon; không thay thế đánh giá độc lập hoặc tư vấn đầu tư cá nhân." };
}
