/**
 * Crypto sentiment with optional LLM hybrid scoring.
 * Keeps English lexicon rule-engine as baseline; upgrades via free-tier LLM when configured.
 */
import { cryptoSentimentScore } from "./analysis";
import { scoreSentimentHybrid } from "@/lib/llm";

export async function scoreCryptoSentimentHybrid(
  symbol: string,
  texts: string[],
): Promise<{
  score: number;
  label: string;
  confidence: number;
  rationale: string;
  source: string;
  model?: string;
}> {
  // English rule baseline (existing)
  const ruleScore = cryptoSentimentScore(texts);

  // Hybrid uses Vietnamese+English LLM path when keys exist;
  // scoreSentimentHybrid already blends rule (VN lexicon) + LLM.
  // For crypto news (mostly English) we still benefit from LLM JSON scoring.
  const hybrid = await scoreSentimentHybrid(symbol, texts);

  // Prefer hybrid when LLM/hybrid path used; otherwise keep pure English lexicon
  if (hybrid.source === "hybrid" || hybrid.source === "llm") {
    return {
      score: hybrid.score,
      label: hybrid.label,
      confidence: hybrid.confidence,
      rationale: hybrid.rationale,
      source: hybrid.source,
      model: hybrid.model,
    };
  }

  const label =
    ruleScore > 0.3 ? "Tích cực" : ruleScore < -0.3 ? "Tiêu cực" : "Trung lập";

  return {
    score: Number(ruleScore.toFixed(3)),
    label,
    confidence: texts.length > 0 ? 0.55 : 0.3,
    rationale: "Rule-based English crypto lexicon",
    source: "rule-engine",
  };
}
