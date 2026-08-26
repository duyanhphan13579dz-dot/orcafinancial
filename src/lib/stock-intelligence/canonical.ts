export type PeriodKind = "actual" | "estimate" | "target";
export type DataStatus = "live" | "fresh" | "stale" | "degraded" | "insufficient_data";
export type StatementType = "income" | "balance" | "cashflow";

export interface DataProvenance {
  source: string;
  retrievedAt: string;
  period: string | null;
  kind: PeriodKind;
  status: DataStatus;
  confidence: number;
  currency?: string;
  unit?: string;
}

export interface CanonicalValue<T> extends DataProvenance {
  value: T;
}

export interface FinancialPeriod {
  label: string;
  fiscalYear: number;
  quarter: 1 | 2 | 3 | 4;
  periodEnd: string;
  kind: PeriodKind;
  durationMonths: 3 | 6 | 9 | 12;
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

export interface CanonicalStatement<T extends Record<string, unknown> = Record<string, unknown>> {
  symbol: string;
  type: StatementType;
  period: FinancialPeriod;
  data: T;
  provenance: DataProvenance;
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

function endOfQuarter(year: number, quarter: number): string {
  const month = quarter * 3;
  return `${year}-${String(month).padStart(2, "0")}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
}

function parsePeriodLabelInternal(label: string): FinancialPeriod | null {
  const normalized = label.trim().toUpperCase().replace(/\s+/g, "");
  const suffix = /([AET])$/.exec(normalized)?.[1];
  const kind: PeriodKind = suffix === "E" ? "estimate" : suffix === "T" ? "target" : "actual";
  const clean = normalized.replace(/[AET]$/, "");
  const withKind = (base: Omit<FinancialPeriod, "kind">): FinancialPeriod => ({ ...base, kind });
  const quarter = /Q([1-4])[/_-]?(\d{4})/.exec(clean);
  if (quarter) {
    const q = Number(quarter[1]) as 1 | 2 | 3 | 4;
    const year = Number(quarter[2]);
    return withKind({ label: `Q${q}/${year}${kind === "estimate" ? "E" : kind === "target" ? "T" : "A"}`, fiscalYear: year, quarter: q, periodEnd: endOfQuarter(year, q), durationMonths: 3 });
  }
  const half = /(?:H|6T)[/_-]?(\d{4})/.exec(clean);
  if (half) {
    const year = Number(half[1]);
    return withKind({ label: `H1/${year}${kind === "estimate" ? "E" : kind === "target" ? "T" : "A"}`, fiscalYear: year, quarter: 2, periodEnd: `${year}-06-30`, durationMonths: 6 });
  }
  const nine = /(?:9M|9T)[/_-]?(\d{4})/.exec(clean);
  if (nine) {
    const year = Number(nine[1]);
    return withKind({ label: `9M/${year}${kind === "estimate" ? "E" : kind === "target" ? "T" : "A"}`, fiscalYear: year, quarter: 3, periodEnd: `${year}-09-30`, durationMonths: 9 });
  }
  const fy = /(?:FY|Y|12M)[/_-]?(\d{4})/.exec(clean);
  if (fy) {
    const year = Number(fy[1]);
    return withKind({ label: `FY${year}${kind === "estimate" ? "E" : kind === "target" ? "T" : "A"}`, fiscalYear: year, quarter: 4, periodEnd: `${year}-12-31`, durationMonths: 12 });
  }
  return null;
}

export function parseFinancialPeriod(label: string): FinancialPeriod | null {
  return parsePeriodLabelInternal(label);
}

export function buildFinancialPeriodSet(labels: string[]): FinancialPeriodSet | null {
  const periods = labels.map(parsePeriodLabelInternal).filter((p): p is FinancialPeriod => Boolean(p));
  if (periods.length === 0) return null;
  const unique = new Map(periods.map((period) => [period.label, period]));
  const kindRank: Record<PeriodKind, number> = { actual: 0, estimate: 1, target: 2 };
  const sorted = [...unique.values()].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || kindRank[a.kind] - kindRank[b.kind]);
  const latestQuarter = sorted.find((p) => p.durationMonths === 3 && p.kind === "actual") ?? sorted.find((p) => p.durationMonths === 3) ?? sorted[0];
  const previousQuarter = sorted.find((p) => p.durationMonths === 3 && p.periodEnd < latestQuarter.periodEnd) ?? null;
  const sameQuarterPreviousYear = sorted.find((p) => p.durationMonths === 3 && p.quarter === latestQuarter.quarter && p.fiscalYear === latestQuarter.fiscalYear - 1) ?? null;
  const ytdMonths = latestQuarter.quarter * 3;
  const suffix = latestQuarter.kind === "estimate" ? "E" : latestQuarter.kind === "target" ? "T" : "A";
  const currentYtd = ytdMonths === 3 ? `Q1/${latestQuarter.fiscalYear}${suffix}` : ytdMonths === 6 ? `H1/${latestQuarter.fiscalYear}${suffix}` : ytdMonths === 9 ? `9M/${latestQuarter.fiscalYear}${suffix}` : `FY${latestQuarter.fiscalYear}${suffix}`;
  const previousYtd = latestQuarter.fiscalYear > 0 ? currentYtd.replace(String(latestQuarter.fiscalYear), String(latestQuarter.fiscalYear - 1)) : null;
  return { latestQuarter, previousQuarter, sameQuarterPreviousYear, currentYtd, previousYtd, ttm: `TTM đến ${latestQuarter.label}`, latestFy: `FY${latestQuarter.fiscalYear}${latestQuarter.kind === "estimate" ? "E" : latestQuarter.kind === "target" ? "T" : "A"}` };
}

export function actualProvenance(source: string, period: string | null, confidence: number, retrievedAt = new Date().toISOString(), extras: Pick<DataProvenance, "currency" | "unit"> = {}): DataProvenance {
  return { source, retrievedAt, period, kind: "actual", status: freshnessStatus(retrievedAt), confidence: clampConfidence(confidence), ...extras };
}

export function estimateProvenance(source: string, period: string | null, confidence: number, extras: Pick<DataProvenance, "currency" | "unit"> = {}): DataProvenance {
  return { source, retrievedAt: new Date().toISOString(), period, kind: "estimate", status: "fresh", confidence: clampConfidence(confidence), ...extras };
}

export function targetProvenance(source: string, period: string | null, confidence: number, extras: Pick<DataProvenance, "currency" | "unit"> = {}): DataProvenance {
  return { source, retrievedAt: new Date().toISOString(), period, kind: "target", status: "fresh", confidence: clampConfidence(confidence), ...extras };
}
