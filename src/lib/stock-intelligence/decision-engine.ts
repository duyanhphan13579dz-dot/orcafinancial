import type { AnalysisResult } from "@/lib/analysis";
import type { FundamentalReport } from "@/lib/fundamental";
import type { HealthDetail } from "@/lib/financial-health-detail";
import type { Recommendation } from "@/lib/analysis";

export interface ScoreDimension { key: string; label: string; score: number; weight: number; rationale: string; }
export interface OrcaDecision {
  symbol: string;
  verdict: Recommendation;
  score: number;
  predictionConfidence: number;
  risk: "LOW" | "MEDIUM" | "HIGH";
  trend: "BULLISH" | "NEUTRAL" | "BEARISH";
  valuation: "ATTRACTIVE" | "FAIR" | "EXPENSIVE" | "INSUFFICIENT_DATA";
  horizons: { shortTerm: Recommendation; mediumTerm: Recommendation; longTerm: Recommendation };
  dimensions: ScoreDimension[];
  why: string[];
  whyNot: string[];
  modelVersion: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 50));
const toRecommendation = (score: number): Recommendation => score >= 82 ? "Strong Buy" : score >= 62 ? "Buy" : score <= 18 ? "Strong Sell" : score <= 38 ? "Sell" : "Hold";
const safe = (v: unknown, fallback = 50) => typeof v === "number" && Number.isFinite(v) ? v : fallback;

export function buildOrcaDecision(input: {
  symbol: string;
  technical: AnalysisResult | null;
  fundamental: FundamentalReport | null;
  health: HealthDetail | null;
  sentimentScore?: number | null;
}): OrcaDecision {
  const technical = input.technical;
  const fundamental = input.fundamental;
  const health = input.health;
  const technicalScore = technical ? clamp(50 + technical.score * 50) : 50;
  const fundamentalScore = health ? clamp(health.overall) : safe((fundamental as { financialHealth?: { overallScore?: number } } | null)?.financialHealth?.overallScore ? safe((fundamental as { financialHealth: { overallScore: number } }).financialHealth.overallScore) * 100 : null);
  const fair = (fundamental as { valuation?: { currentPrice?: number; intrinsicValueRange?: { low: number; mid: number; high: number } | null } } | null)?.valuation;
  const price = fair?.currentPrice;
  const mid = fair?.intrinsicValueRange?.mid;
  const valuationScore = price && mid ? clamp(50 + ((mid / price) - 1) * 180) : 50;
  const riskScore = technical?.volatilityPct != null ? clamp(100 - technical.volatilityPct * 2) : 50;
  const sentimentScore = input.sentimentScore == null ? 50 : clamp(50 + input.sentimentScore * 50);
  const dimensions: ScoreDimension[] = [
    { key: "technical", label: "Technical", score: Math.round(technicalScore), weight: 0.25, rationale: technical?.reasons?.[0] ?? "Chưa đủ dữ liệu kỹ thuật." },
    { key: "fundamental", label: "Fundamental", score: Math.round(fundamentalScore), weight: 0.25, rationale: health?.summary ?? "Chưa đủ dữ liệu cơ bản." },
    { key: "valuation", label: "Valuation", score: Math.round(valuationScore), weight: 0.15, rationale: mid && price ? `Fair value trung tâm ${mid.toFixed(2)} so với giá hiện tại ${price.toFixed(2)}.` : "Chưa đủ dữ liệu định giá." },
    { key: "risk", label: "Risk", score: Math.round(riskScore), weight: 0.15, rationale: technical?.volatilityPct != null ? `Biến động năm hóa ${technical.volatilityPct.toFixed(1)}%.` : "Chưa đủ dữ liệu rủi ro." },
    { key: "sentiment", label: "Sentiment", score: Math.round(sentimentScore), weight: 0.10, rationale: input.sentimentScore == null ? "Chưa đủ dữ liệu tin tức." : "Điểm sentiment lấy từ news intelligence hiện có." },
    { key: "marketContext", label: "Market Context", score: 50, weight: 0.10, rationale: "Market context chưa được cung cấp cho symbol này." },
  ];
  const score = Math.round(dimensions.reduce((sum, d) => sum + d.score * d.weight, 0));
  const trend = technicalScore >= 62 ? "BULLISH" : technicalScore <= 38 ? "BEARISH" : "NEUTRAL";
  const risk: OrcaDecision["risk"] = riskScore >= 68 ? "LOW" : riskScore >= 42 ? "MEDIUM" : "HIGH";
  const valuation: OrcaDecision["valuation"] = !price || !mid ? "INSUFFICIENT_DATA" : valuationScore >= 62 ? "ATTRACTIVE" : valuationScore <= 38 ? "EXPENSIVE" : "FAIR";
  const why = dimensions.filter((d) => d.score >= 65).sort((a, b) => b.score - a.score).slice(0, 3).map((d) => `${d.label}: ${d.rationale}`);
  const whyNot = dimensions.filter((d) => d.score < 50).sort((a, b) => a.score - b.score).slice(0, 3).map((d) => `${d.label}: ${d.rationale}`);
  const short = toRecommendation(clamp(score + (technicalScore - 50) * 0.35));
  const medium = toRecommendation(clamp(score + (technicalScore - 50) * 0.15));
  const long = toRecommendation(clamp(score + (fundamentalScore - 50) * 0.25));
  return { symbol: input.symbol, verdict: toRecommendation(score), score, predictionConfidence: Number(Math.min(0.95, 0.55 + Math.abs(score - 50) / 250 + dimensions.filter((d) => d.score !== 50).length * 0.03).toFixed(2)), risk, trend, valuation, horizons: { shortTerm: short, mediumTerm: medium, longTerm: long }, dimensions, why, whyNot, modelVersion: "ORCA Decision v1.0" };
}
