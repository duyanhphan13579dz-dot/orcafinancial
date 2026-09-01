import type { PeriodKind, StatementType } from "@/lib/stock-intelligence/canonical";
import type { FinancialQuarter } from "@/lib/financial-statements";
import { actualProvenance, estimateProvenance, targetProvenance, parseFinancialPeriod, type CanonicalStatement, type DataProvenance } from "@/lib/stock-intelligence/canonical";

export type FinancialSourceKind = "fmp" | "vndirect" | "vietstock" | "cafef" | "filing" | "synthetic" | "tcbs";

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

function asNumberRecord(data: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(data)) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
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
    return [
      {
        symbol,
        type,
        period,
        data: asNumberRecord(record.data),
        provenance,
      },
    ];
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

export class EmptyFinancialAdapter implements FinancialSourceAdapter {
  readonly kind: FinancialSourceKind = "synthetic";
  async fetch(): Promise<RawFinancialRecord[]> {
    return [];
  }
}
