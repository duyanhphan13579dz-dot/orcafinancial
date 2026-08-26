import type { ForecastScenarioResult } from "@/lib/stock-intelligence/forecast-engine";
import type { BacktestResult } from "@/lib/stock-intelligence/backtest-engine";

export type ForecastDirection = "BULLISH" | "NEUTRAL" | "BEARISH";

export interface AiForecastResult {
  symbol: string;
  horizons: Array<{ horizon: "7D" | "30D" | "90D"; direction: ForecastDirection; probabilities: { bull: number; neutral: number; bear: number }; explanation: string[] }>;
  predictionConfidence: number;
  historicalAccuracy: number | null;
  modelVersion: string;
  status: "ready" | "insufficient_data";
  guardrails: string[];
}

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));

export function buildAiForecast(input: { symbol: string; forecast: ForecastScenarioResult; backtest: BacktestResult; }): AiForecastResult {
  const guardrails: string[] = [];
  if (input.forecast.status !== "ready" || input.backtest.status !== "ready" || input.backtest.metrics.totalSignals < 10) {
    guardrails.push("Insufficient data: chưa đủ forecast và signal history để phát hành xác suất AI.");
    return { symbol: input.symbol, horizons: [], predictionConfidence: 0, historicalAccuracy: input.backtest.status === "ready" ? input.backtest.metrics.recommendationAccuracy : null, modelVersion: "ORCA AI Forecast v1.0", status: "insufficient_data", guardrails };
  }
  const latestScenario = input.forecast.scenarios.find((scenario) => scenario.name === "base");
  const expected = input.forecast.expectedValue;
  const current = input.forecast.historical.at(-1)?.eps ?? 0;
  const epsSignal = current !== 0 ? (latestScenario?.forecast.at(-1)?.eps ?? current) / current - 1 : 0;
  const backtestBias = input.backtest.metrics.averageReturn;
  const signal = Math.max(-1, Math.min(1, epsSignal * 1.5 + backtestBias * 3));
  const direction: ForecastDirection = signal > 0.08 ? "BULLISH" : signal < -0.08 ? "BEARISH" : "NEUTRAL";
  const baseBull = clamp(0.34 + signal * 0.35 + input.backtest.metrics.recommendationAccuracy * 0.12);
  const baseBear = clamp(0.28 - signal * 0.3 + (1 - input.backtest.metrics.winRate) * 0.1);
  const baseNeutral = clamp(1 - baseBull - baseBear);
  const probs = { bull: Number(baseBull.toFixed(3)), neutral: Number(baseNeutral.toFixed(3)), bear: Number(baseBear.toFixed(3)) };
  const horizons: AiForecastResult["horizons"] = (["7D", "30D", "90D"] as const).map((horizon, index) => {
    const decay = 1 - index * 0.08;
    const hSignal = signal * decay;
    const hDirection: ForecastDirection = hSignal > 0.08 ? "BULLISH" : hSignal < -0.08 ? "BEARISH" : "NEUTRAL";
    return { horizon, direction: hDirection, probabilities: { bull: Number(clamp(probs.bull + hSignal * 0.08).toFixed(3)), neutral: Number(clamp(probs.neutral + (1 - decay) * 0.04).toFixed(3)), bear: Number(clamp(probs.bear - hSignal * 0.08).toFixed(3)) }, explanation: [`Tín hiệu EPS forecast: ${(epsSignal * 100).toFixed(1)}%.`, `Historical accuracy của signal: ${(input.backtest.metrics.recommendationAccuracy * 100).toFixed(1)}%.`, expected != null ? `Expected value theo scenario: ${expected.toFixed(2)}.` : "Chưa có expected value."] };
  });
  const predictionConfidence = Number(clamp(0.35 + input.backtest.metrics.recommendationAccuracy * 0.35 + input.forecast.predictionConfidence * 0.3, 0.1, 0.85).toFixed(2));
  return { symbol: input.symbol, horizons, predictionConfidence, historicalAccuracy: input.backtest.metrics.recommendationAccuracy, modelVersion: "ORCA AI Forecast v1.0", status: "ready", guardrails: ["Tín hiệu là mô hình xác suất có kiểm soát, không phải cam kết giá.", "Historical accuracy và prediction confidence được hiển thị tách biệt."] };
}
