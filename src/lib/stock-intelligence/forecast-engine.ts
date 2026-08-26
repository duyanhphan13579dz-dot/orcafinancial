import type { DataProvenance, PeriodKind } from "@/lib/stock-intelligence/canonical";

export interface HistoricalFinancialPoint {
  period: string;
  fiscalYear: number;
  revenue: number;
  ebitda: number;
  netIncome: number;
  eps: number;
  provenance: DataProvenance;
}

export interface ForecastAssumptions {
  revenueGrowth: number;
  ebitdaMargin: number;
  netMargin: number;
  taxRate: number;
  capexRate: number;
  wacc: number;
  terminalGrowth: number;
  epsGrowth: number;
}

export interface ForecastPoint {
  period: string;
  fiscalYear: number;
  kind: "estimate";
  revenue: number;
  ebitda: number;
  netIncome: number;
  eps: number;
  provenance: DataProvenance;
}

export interface ScenarioCase {
  name: "bull" | "base" | "bear";
  probability: number;
  assumptions: ForecastAssumptions;
  forecast: ForecastPoint[];
  targetMultiple: number;
  fairValue: number | null;
  weightedContribution: number | null;
  rationale: string;
}

export interface ForecastScenarioResult {
  historical: HistoricalFinancialPoint[];
  assumptions: ForecastAssumptions;
  forecast: ForecastPoint[];
  scenarios: ScenarioCase[];
  expectedValue: number | null;
  targetPrice: number | null;
  valuationConfidence: number;
  dataConfidence: number;
  predictionConfidence: number;
  status: "ready" | "insufficient_data";
  warnings: string[];
  modelVersion: string;
  driverBridge: { revenue: string; margin: string; eps: string; cashflow: string };
  assumptionBridge: string[];
  sensitivity: Array<{ variable: "revenueGrowth" | "ebitdaMargin" | "targetMultiple"; down: number; base: number; up: number }>;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));
const avg = (values: number[], fallback: number) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
const safeGrowth = (current: number, previous: number) => previous !== 0 ? current / previous - 1 : 0;

function estimateProvenance(period: string): DataProvenance {
  return { source: "orca-forecast-engine-v1", retrievedAt: new Date().toISOString(), period, kind: "estimate", status: "fresh", confidence: 0.55, currency: "VND", unit: "reported-unit" };
}

function buildForecast(history: HistoricalFinancialPoint[], assumptions: ForecastAssumptions, years: number): ForecastPoint[] {
  const latest = history[history.length - 1];
  const points: ForecastPoint[] = [];
  let revenue = latest.revenue;
  let eps = latest.eps;
  for (let i = 1; i <= years; i += 1) {
    const fiscalYear = latest.fiscalYear + i;
    revenue *= 1 + assumptions.revenueGrowth;
    eps *= 1 + assumptions.epsGrowth;
    const ebitda = revenue * assumptions.ebitdaMargin;
    const netIncome = revenue * assumptions.netMargin;
    points.push({ period: `FY${fiscalYear}E`, fiscalYear, kind: "estimate", revenue, ebitda, netIncome, eps, provenance: estimateProvenance(`FY${fiscalYear}E`) });
  }
  return points;
}

function fairValueFromScenario(scenario: ScenarioCase, currentPrice: number | null): number | null {
  const terminal = scenario.forecast[scenario.forecast.length - 1];
  if (!terminal || !Number.isFinite(terminal.eps) || terminal.eps <= 0) return currentPrice;
  return Number((terminal.eps * scenario.targetMultiple).toFixed(2));
}

export function buildForecastScenarios(input: { symbol: string; historical: HistoricalFinancialPoint[]; currentPrice: number | null; years?: number; }): ForecastScenarioResult {
  const history = [...input.historical].filter((point) => [point.revenue, point.ebitda, point.netIncome, point.eps].every(Number.isFinite)).sort((a, b) => `${a.fiscalYear}-${a.period}`.localeCompare(`${b.fiscalYear}-${b.period}`));
  const warnings: string[] = [];
  if (history.length < 2) {
    return { historical: history, assumptions: { revenueGrowth: 0, ebitdaMargin: 0, netMargin: 0, taxRate: 0.2, capexRate: 0, wacc: 0.12, terminalGrowth: 0.03, epsGrowth: 0 }, forecast: [], scenarios: [], expectedValue: null, targetPrice: null, valuationConfidence: 0, dataConfidence: 0.2, predictionConfidence: 0, status: "insufficient_data", warnings: ["Cần tối thiểu hai kỳ tài chính hợp lệ để xây dự phóng."], modelVersion: "ORCA Forecast v1.1", driverBridge: { revenue: "Chưa đủ dữ liệu.", margin: "Chưa đủ dữ liệu.", eps: "Chưa đủ dữ liệu.", cashflow: "Chưa đủ dữ liệu." }, assumptionBridge: [], sensitivity: [] };
  }
  if (history.some((point) => point.provenance.kind !== ("actual" as PeriodKind))) warnings.push("Historical input không hoàn toàn là actual; prediction confidence đã bị giảm.");
  const revenueGrowth = clamp(avg(history.slice(1).map((point, index) => safeGrowth(point.revenue, history[index].revenue)), 0), -0.3, 0.5);
  const ebitdaMargin = clamp(avg(history.map((point) => point.revenue ? point.ebitda / point.revenue : 0), 0.1), -0.2, 0.7);
  const netMargin = clamp(avg(history.map((point) => point.revenue ? point.netIncome / point.revenue : 0), 0.05), -0.3, 0.5);
  const epsGrowth = clamp(avg(history.slice(1).map((point, index) => safeGrowth(point.eps, history[index].eps)), revenueGrowth), -0.5, 0.8);
  const assumptions: ForecastAssumptions = { revenueGrowth, ebitdaMargin, netMargin, taxRate: 0.2, capexRate: 0.08, wacc: 0.12, terminalGrowth: 0.03, epsGrowth };
  const years = Math.min(5, Math.max(1, input.years ?? 3));
  const forecast = buildForecast(history, assumptions, years);
  const variants: Array<{ name: ScenarioCase["name"]; probability: number; growth: number; margin: number; multiple: number; rationale: string }> = [
    { name: "bull", probability: 0.25, growth: 0.06, margin: 0.03, multiple: 18, rationale: "Tăng trưởng doanh thu và biên lợi nhuận cải thiện." },
    { name: "base", probability: 0.55, growth: 0, margin: 0, multiple: 14, rationale: "Duy trì xu hướng lịch sử gần nhất." },
    { name: "bear", probability: 0.20, growth: -0.06, margin: -0.03, multiple: 10, rationale: "Tăng trưởng chậm lại và biên lợi nhuận chịu áp lực." },
  ];
  const probabilitySum = variants.reduce((sum, variant) => sum + variant.probability, 0);
  const scenarios = variants.map((variant) => {
    const probability = probabilitySum > 0 ? variant.probability / probabilitySum : 0;
    const scenarioAssumptions = { ...assumptions, revenueGrowth: clamp(assumptions.revenueGrowth + variant.growth, -0.5, 0.8), ebitdaMargin: clamp(assumptions.ebitdaMargin + variant.margin, -0.3, 0.8), netMargin: clamp(assumptions.netMargin + variant.margin, -0.4, 0.6), epsGrowth: clamp(assumptions.epsGrowth + variant.growth, -0.7, 1) };
    const scenarioForecast = buildForecast(history, scenarioAssumptions, years);
    const result: ScenarioCase = { name: variant.name, probability, assumptions: scenarioAssumptions, forecast: scenarioForecast, targetMultiple: variant.multiple, fairValue: null, weightedContribution: null, rationale: variant.rationale };
    result.fairValue = fairValueFromScenario(result, input.currentPrice);
    return result;
  });
  const values = scenarios.filter((scenario) => scenario.fairValue != null);
  const expectedValue = values.length ? Number(values.reduce((sum, scenario) => sum + (scenario.fairValue as number) * scenario.probability, 0).toFixed(2)) : null;
  scenarios.forEach((scenario) => { scenario.weightedContribution = scenario.fairValue == null ? null : Number((scenario.fairValue * scenario.probability).toFixed(2)); });
  const predictionConfidence = Number(clamp(0.45 + Math.min(0.25, history.length * 0.03) - (history.some((point) => point.provenance.kind !== "actual") ? 0.12 : 0), 0.1, 0.85).toFixed(2));
  const latest = history[history.length - 1];
  const prior = history[history.length - 2];
  const marginDelta = latest.revenue > 0 && prior.revenue > 0 ? (latest.ebitda / latest.revenue - prior.ebitda / prior.revenue) * 100 : 0;
  const sensitivity = [
    { variable: "revenueGrowth" as const, down: Number((expectedValue == null ? 0 : expectedValue * 0.88).toFixed(2)), base: expectedValue ?? 0, up: Number((expectedValue == null ? 0 : expectedValue * 1.12).toFixed(2)) },
    { variable: "ebitdaMargin" as const, down: Number((expectedValue == null ? 0 : expectedValue * 0.9).toFixed(2)), base: expectedValue ?? 0, up: Number((expectedValue == null ? 0 : expectedValue * 1.1).toFixed(2)) },
    { variable: "targetMultiple" as const, down: Number((expectedValue == null ? 0 : expectedValue * 0.82).toFixed(2)), base: expectedValue ?? 0, up: Number((expectedValue == null ? 0 : expectedValue * 1.18).toFixed(2)) },
  ];
  const dataConfidence = Number(avg(history.map((point) => point.provenance.confidence), 0.45).toFixed(2));
  const valuationConfidence = Number(Math.min(dataConfidence, predictionConfidence, expectedValue == null ? 0 : 0.85).toFixed(2));
  const assumptionBridge = [
    `Doanh thu: tăng trưởng nền ${(assumptions.revenueGrowth * 100).toFixed(1)}%/năm, chưa phân rã volume/giá/mix do thiếu dữ liệu vận hành.`,
    `Biên EBITDA: ${(assumptions.ebitdaMargin * 100).toFixed(1)}%; điều chỉnh theo kịch bản lần lượt ${variants.map((variant) => `${variant.name} ${variant.margin >= 0 ? "+" : ""}${(variant.margin * 100).toFixed(1)} điểm %`).join(", ")}.`,
    `EPS: tăng trưởng nền ${(assumptions.epsGrowth * 100).toFixed(1)}%/năm; hệ số mục tiêu ${variants.map((variant) => `${variant.name} ${variant.multiple} lần`).join(", ")}.`,
    "Thuế, chi đầu tư, vốn lưu động và lãi vay là giả định mô hình; cần thay bằng số liệu công bố khi có nguồn actual.",
  ];
  return { historical: history, assumptions, forecast, scenarios, expectedValue, targetPrice: expectedValue, valuationConfidence, dataConfidence, predictionConfidence, status: "ready", warnings, modelVersion: "ORCA Forecast v1.2", driverBridge: { revenue: `Tăng trưởng doanh thu nền ${(assumptions.revenueGrowth * 100).toFixed(1)}%/năm từ chuỗi lịch sử.`, margin: `Biên EBITDA nền ${(assumptions.ebitdaMargin * 100).toFixed(1)}%; thay đổi gần nhất ${marginDelta.toFixed(2)} điểm %.`, eps: `EPS tăng trưởng theo giả định ${(assumptions.epsGrowth * 100).toFixed(1)}%/năm.`, cashflow: "FCF được xem là cần kiểm chứng với CFO/capex actual trước khi sử dụng trong định giá." }, assumptionBridge, sensitivity };
}
