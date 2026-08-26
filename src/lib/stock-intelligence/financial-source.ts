import type { StatementType } from "@/lib/stock-intelligence/canonical";
import type { FinancialQuarter } from "@/lib/financial-statements";
import { actualProvenance, estimateProvenance, parseFinancialPeriod, type CanonicalStatement, type DataProvenance } from "@/lib/stock-intelligence/canonical";

export type FinancialSourceKind = "fmp" | "vietstock" | "filing" | "synthetic";

export interface RawFinancialRecord {
  period: string;
  fiscalYear?: number;
  reportedCurrency?: string;
  data: Record<string, unknown>;
  source: string;
  retrievedAt?: string;
}

export interface FinancialSourceResult {
  symbol: string;
  statements: CanonicalStatement[];
  source: FinancialSourceKind;
  actual: boolean;
  confidence: number;
  warnings: string[];
}

export interface FinancialSourceAdapter {
  readonly kind: FinancialSourceKind;
  fetch(symbol: string, type: StatementType, limit: number): Promise<RawFinancialRecord[]>;
}

const FMP_ENDPOINT = "https://financialmodelingprep.com/stable";

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function mapFmpPeriod(row: Record<string, unknown>): string | null {
  const date = typeof row.date === "string" ? row.date : typeof row.filingDate === "string" ? row.filingDate : null;
  if (!date) return null;
  const match = /^(\d{4})-(\d{2})-/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const quarter = Math.max(1, Math.min(4, Math.ceil(month / 3)));
  return `Q${quarter}/${year}`;
}

function fmpPath(type: StatementType): string {
  if (type === "income") return "income-statement";
  if (type === "balance") return "balance-sheet-statement";
  return "cash-flow-statement";
}

export class FmpFinancialAdapter implements FinancialSourceAdapter {
  readonly kind = "fmp" as const;

  async fetch(symbol: string, type: StatementType, limit: number): Promise<RawFinancialRecord[]> {
    const key = process.env.FMP_API_KEY;
    if (!key) return [];
    const url = `${FMP_ENDPOINT}/${fmpPath(type)}?symbol=${encodeURIComponent(symbol)}&period=quarter&limit=${Math.min(20, Math.max(1, limit))}`;
    const response = await fetch(url, { headers: { apikey: key }, cache: "no-store" });
    if (!response.ok) throw new Error(`FMP ${type} request failed: ${response.status}`);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) return [];
    return payload.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const period = mapFmpPeriod(row);
      if (!period) return [];
      const data = Object.fromEntries(Object.entries(row).filter(([key]) => !["date", "filingDate", "acceptedDate", "calendarYear", "period", "symbol", "reportedCurrency"].includes(key)));
      return [{ period, fiscalYear: asNumber(row.calendarYear) ?? undefined, reportedCurrency: typeof row.reportedCurrency === "string" ? row.reportedCurrency : undefined, data, source: "fmp", retrievedAt: new Date().toISOString() }];
    });
  }
}

export class SyntheticFinancialAdapter implements FinancialSourceAdapter {
  readonly kind = "synthetic" as const;

  constructor(private readonly quarters: FinancialQuarter[]) {}

  async fetch(_symbol: string, type: StatementType, limit: number): Promise<RawFinancialRecord[]> {
    return this.quarters.slice(0, limit).map((quarter) => ({
      period: quarter.period,
      fiscalYear: quarter.fiscalYear,
      reportedCurrency: "VND",
      data: quarter[type] as unknown as Record<string, unknown>,
      source: "sector-synthetic-v1",
      retrievedAt: new Date().toISOString(),
    }));
  }
}

export async function loadCanonicalStatements(symbol: string, type: StatementType, limit: number, fallback: FinancialSourceAdapter): Promise<FinancialSourceResult> {
  const primary = new FmpFinancialAdapter();
  const warnings: string[] = [];
  let records: RawFinancialRecord[] = [];
  let source: FinancialSourceKind = primary.kind;
  let actual = true;
  try {
    records = await primary.fetch(symbol, type, limit);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Primary financial provider failed.");
  }
  if (records.length === 0) {
    records = await fallback.fetch(symbol, type, limit);
    source = fallback.kind;
    actual = false;
    warnings.push("Không có financial provider actual khả dụng; dữ liệu fallback phải được hiển thị là estimate/degraded.");
  }
  const statements = records.flatMap((record): CanonicalStatement[] => {
    const period = parseFinancialPeriod(record.period);
    if (!period) return [];
    const provenance: DataProvenance = actual
      ? actualProvenance(record.source, period.label, 0.85, record.retrievedAt, { currency: record.reportedCurrency, unit: "reported" })
      : estimateProvenance(record.source, period.label, 0.45, { currency: record.reportedCurrency, unit: "modeled" });
    if (!actual) provenance.status = "degraded";
    return [{ symbol, type, period, data: record.data, provenance }];
  });
  return { symbol, statements, source, actual, confidence: actual ? 0.85 : 0.45, warnings };
}
