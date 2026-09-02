import type { PeriodKind, StatementType } from "@/lib/stock-intelligence/canonical";
import type { FinancialQuarter } from "@/lib/financial-statements";
import { actualProvenance, estimateProvenance, targetProvenance, parseFinancialPeriod, type CanonicalStatement, type DataProvenance } from "@/lib/stock-intelligence/canonical";

export type FinancialSourceKind = "fmp" | "vndirect" | "vietstock" | "cafef" | "filing" | "vnstock-vci" | "vnstock-kbs" | "synthetic";

export interface RawFinancialRecord {
  period: string;
  fiscalYear?: number;
  reportedCurrency?: string;
  data: Record<string, unknown>;
  source: string;
  retrievedAt?: string;
  filingDate?: string;
  unit?: string;
  kind?: PeriodKind;
}

export interface FinancialSourceResult {
  symbol: string;
  statements: CanonicalStatement[];
  source: FinancialSourceKind;
  actual: boolean;
  confidence: number;
  warnings: string[];
  quality: { actualCount: number; estimateCount: number; targetCount: number; latestPeriod: string | null; sourceTier: "filing" | "professional" | "fallback" };
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
  const rawPeriod = typeof row.period === "string" ? row.period.trim().toUpperCase() : null;
  const date = typeof row.date === "string" ? row.date : typeof row.filingDate === "string" ? row.filingDate : null;
  if (rawPeriod && /^(Q[1-4]|H1|9M|FY)\/?\d{4}$/i.test(rawPeriod)) return rawPeriod;
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
    const apiKey = process.env.FMP_API_KEY?.trim();
    if (!apiKey) return [];
    const url = `${FMP_ENDPOINT}/${fmpPath(type)}?symbol=${encodeURIComponent(symbol)}&period=quarter&limit=${Math.min(40, Math.max(1, limit))}&apikey=${apiKey}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`FMP financials HTTP ${response.status}`);
    const payload = (await response.json()) as unknown;
    const rows = Array.isArray(payload) ? payload : [];
    return rows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const record = row as Record<string, unknown>;
      const period = mapFmpPeriod(record);
      if (!period) return [];
      const data: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) {
        const n = asNumber(value);
        if (n != null) data[key] = n;
      }
      return [{
        period,
        fiscalYear: Number(period.slice(-4)),
        reportedCurrency: typeof record.reportedCurrency === "string" ? record.reportedCurrency : "USD",
        data,
        source: "fmp",
        retrievedAt: new Date().toISOString(),
        filingDate: typeof record.filingDate === "string" ? record.filingDate : undefined,
        unit: "as_reported",
        kind: "actual" as const,
      }];
    });
  }
}

export async function loadCanonicalStatements(
  symbol: string,
  type: StatementType,
  limit: number,
  primary: FinancialSourceAdapter,
  fallback?: FinancialSourceAdapter,
): Promise<FinancialSourceResult> {
  const warnings: string[] = [];
  let records: RawFinancialRecord[] = [];
  let source: FinancialSourceKind = primary.kind;
  let actual = true;

  try {
    records = await primary.fetch(symbol, type, limit);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Primary financial provider failed.");
  }
  if (records.length === 0 && fallback) {
    records = await fallback.fetch(symbol, type, limit);
    source = fallback.kind;
    actual = false;
    warnings.push("Không có financial provider actual khả dụng; dữ liệu fallback phải được hiển thị là estimate/degraded.");
  }
  const statements = records.flatMap((record): CanonicalStatement[] => {
    const period = parseFinancialPeriod(record.period);
    if (!period) return [];
    const kind = record.kind ?? (actual ? "actual" : "estimate");
    if (kind === "actual" && period.periodEnd > new Date().toISOString().slice(0, 10)) {
      warnings.push(`Bỏ qua kỳ actual tương lai ${period.label}; chưa đến ngày kết thúc kỳ báo cáo.`);
      return [];
    }
    const provenance: DataProvenance =
      kind === "actual"
        ? actualProvenance(record.source, period.label, actual ? 0.85 : 0.45, record.retrievedAt, {
            currency: record.reportedCurrency,
            unit: record.unit ?? "reported",
          })
        : kind === "target"
          ? targetProvenance(record.source, period.label, 0.4, {
              currency: record.reportedCurrency,
              unit: record.unit ?? "target",
            })
          : estimateProvenance(record.source, period.label, 0.45, {
              currency: record.reportedCurrency,
              unit: record.unit ?? "modeled",
            });
    if (!actual || kind !== "actual") provenance.status = "degraded";
    return [{
      symbol,
      type,
      period,
      data: record.data as Record<string, number>,
      provenance,
    }];
  });
  const sourceTier: FinancialSourceResult["quality"]["sourceTier"] = actual
    ? source === "filing"
      ? "filing"
      : "professional"
    : "fallback";
  const quality = {
    actualCount: statements.filter((statement) => statement.provenance.kind === "actual").length,
    estimateCount: statements.filter((statement) => statement.provenance.kind === "estimate").length,
    targetCount: statements.filter((statement) => statement.provenance.kind === "target").length,
    latestPeriod: statements.map((statement) => statement.period.periodEnd).sort().at(-1) ?? null,
    sourceTier,
  };
  return {
    symbol,
    statements,
    source,
    actual,
    confidence: actual ? 0.85 : 0.45,
    warnings,
    quality,
  };
}

export class NormalizedFinancialAdapter implements FinancialSourceAdapter {
  readonly kind: FinancialSourceKind;

  constructor(private readonly records: RawFinancialRecord[], source: FinancialSourceKind = "vietstock") {
    this.kind = source;
  }

  async fetch(_symbol: string, _type: StatementType, limit: number): Promise<RawFinancialRecord[]> {
    return this.records.slice(0, limit);
  }
}

/**
 * Adapter wrapping in-memory quarters. With ALLOW_SYNTHETIC_FINANCIALS off (production default),
 * returns empty — Phase 0 Verified Financial Data policy.
 * Call sites may still construct it for degraded/audit paths; no sector-synthetic numbers leak when gated.
 */
export class SyntheticFinancialAdapter implements FinancialSourceAdapter {
  readonly kind = "synthetic" as const;

  constructor(private readonly quarters: FinancialQuarter[]) {}

  async fetch(_symbol: string, type: StatementType, limit: number): Promise<RawFinancialRecord[]> {
    const allow =
      process.env.ALLOW_SYNTHETIC_FINANCIALS === "true" ||
      process.env.ALLOW_SYNTHETIC_FINANCIALS === "1" ||
      process.env.NODE_ENV === "test";
    if (!allow) {
      return [];
    }
    return this.quarters.slice(0, limit).map((quarter) => ({
      period: quarter.period,
      fiscalYear: quarter.fiscalYear,
      reportedCurrency: "VND",
      data: (quarter[type] ?? {}) as unknown as Record<string, unknown>,
      source: "sector-synthetic-v2",
      retrievedAt: new Date().toISOString(),
      kind: "estimate" as const,
    }));
  }
}
