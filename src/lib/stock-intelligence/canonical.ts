export type PeriodKind = "actual" | "estimate" | "target";
export type DataStatus = "live" | "fresh" | "stale" | "degraded" | "insufficient_data";

export interface DataProvenance {
  source: string;
  retrievedAt: string;
  period: string | null;
  kind: PeriodKind;
  status: DataStatus;
  confidence: number;
}

export interface CanonicalValue<T> extends DataProvenance {
  value: T;
}

export interface FinancialPeriod {
  label: string;
  fiscalYear: number;
  quarter: 1 | 2 | 3 | 4;
  periodEnd: string;
  kind: "actual";
}

export interface FinancialPeriodSet {
  latestQuarter: FinancialPeriod;
  previousQuarter: FinancialPeriod | null;
  sameQuarterPreviousYear: FinancialPeriod | null;
  currentYtd: string;
  previousYtd: string | null;
  ttm: string;
  latestFy: string;
}

export interface CanonicalStockData {
  symbol: string;
  asOf: string;
  price: CanonicalValue<number>;
  financialPeriod: FinancialPeriodSet | null;
  dataConfidence: number;
  predictionConfidence: number | null;
}

export function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function freshnessStatus(retrievedAt: string, live = false): DataStatus {
  if (live) return "live";
  const age = Date.now() - new Date(retrievedAt).getTime();
  if (!Number.isFinite(age) || age < 0) return "degraded";
  if (age <= 5 * 60_000) return "fresh";
  if (age <= 24 * 60 * 60_000) return "stale";
  return "degraded";
}

function periodFromLabel(label: string): FinancialPeriod | null {
  const match = /Q([1-4])\D*(\d{4})/i.exec(label);
  if (!match) return null;
  const quarter = Number(match[1]) as 1 | 2 | 3 | 4;
  const fiscalYear = Number(match[2]);
  const month = quarter * 3;
  const periodEnd = `${fiscalYear}-${String(month).padStart(2, "0")}-${month === 12 ? "31" : String(new Date(fiscalYear, month, 0).getDate()).padStart(2, "0")}`;
  return { label: `Q${quarter}/${fiscalYear}A`, fiscalYear, quarter, periodEnd, kind: "actual" };
}

export function buildFinancialPeriodSet(labels: string[]): FinancialPeriodSet | null {
  const periods = labels.map(periodFromLabel).filter((p): p is FinancialPeriod => Boolean(p));
  if (periods.length === 0) return null;
  periods.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  const latestQuarter = periods[0];
  const previousQuarter = periods.find((p) => p.periodEnd < latestQuarter.periodEnd) ?? null;
  const sameQuarterPreviousYear = periods.find((p) => p.quarter === latestQuarter.quarter && p.fiscalYear === latestQuarter.fiscalYear - 1) ?? null;
  const ytd = `6T/${latestQuarter.fiscalYear}${latestQuarter.quarter >= 2 ? "A" : "A"}`;
  const previousYtd = latestQuarter.fiscalYear > 0 ? `6T/${latestQuarter.fiscalYear - 1}A` : null;
  const ttm = `TTM đến ${latestQuarter.label}`;
  return { latestQuarter, previousQuarter, sameQuarterPreviousYear, currentYtd: ytd, previousYtd, ttm, latestFy: `FY${latestQuarter.fiscalYear}A` };
}

export function actualProvenance(source: string, period: string | null, confidence: number, retrievedAt = new Date().toISOString()): DataProvenance {
  return { source, retrievedAt, period, kind: "actual", status: freshnessStatus(retrievedAt), confidence: clampConfidence(confidence) };
}

export function estimateProvenance(source: string, period: string | null, confidence: number): DataProvenance {
  return { source, retrievedAt: new Date().toISOString(), period, kind: "estimate", status: "fresh", confidence: clampConfidence(confidence) };
}

export function targetProvenance(source: string, period: string | null, confidence: number): DataProvenance {
  return { source, retrievedAt: new Date().toISOString(), period, kind: "target", status: "fresh", confidence: clampConfidence(confidence) };
}
