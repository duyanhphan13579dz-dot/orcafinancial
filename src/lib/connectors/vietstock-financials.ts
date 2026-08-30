import { externalSourceAdapters, normalizeReportedRecord } from "@/lib/connectors/external-sources";
import { getLatestCompletedQuarter } from "@/lib/financial-statements";
import { isFuturePeriod } from "@/lib/realtime-time";

export interface VietstockFinancialQuarter {
  period: string;
  quarter: number;
  fiscalYear: number;
  income: Record<string, number>;
  balance: Record<string, number>;
  cashflow: Record<string, number>;
  filingDate?: string;
  sourceUrl: string;
}

export interface VietstockFinancialImport {
  symbol: string;
  source: "vietstock";
  sourceUrl: string;
  reportedAt: string;
  filingDate: string;
  quarters: VietstockFinancialQuarter[];
}

type Json = Record<string, unknown>;

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/,/g, "").replace(/%$/, "").trim();
  if (!normalized || !/^-?\d+(\.\d+)?$/.test(normalized)) return undefined;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : undefined;
}

function parseFilingDate(row: Json): string {
  const rawDate = typeof row.PublishDate === "string" ? row.PublishDate : typeof row.filingDate === "string" ? row.filingDate : typeof row.reportDate === "string" ? row.reportDate : null;
  if (rawDate) {
    const parsed = Date.parse(rawDate);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function normalizeQuarter(symbol: string, row: Json): VietstockFinancialQuarter | null {
  const fiscalYear = Number(row.FiscalYear ?? row.fiscalYear ?? row.year);
  const quarterValue = String(row.FiscalQuarter ?? row.quarter ?? row.period ?? "").toUpperCase();
  const quarterMatch = quarterValue.match(/Q?([1-4])/);
  const quarter = quarterMatch ? Number(quarterMatch[1]) : 0;
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1990 || !quarter) return null;

  const period = `Q${quarter}/${fiscalYear}`;
  const latestCompleted = getLatestCompletedQuarter();
  if (isFuturePeriod(period, latestCompleted.fiscalYear)) return null;

  const income = (row.IncomeStatement ?? row.income ?? {}) as Record<string, number>;
  const balance = (row.BalanceSheet ?? row.balance ?? {}) as Record<string, number>;
  const cashflow = (row.CashFlowStatement ?? row.cashflow ?? {}) as Record<string, number>;

  const filingDate = parseFilingDate(row);
  const sourceUrl = `https://finance.vietstock.vn/${symbol.toUpperCase()}/bao-cao-tai-chinh.htm`;

  return {
    period,
    quarter,
    fiscalYear,
    income,
    balance,
    cashflow,
    filingDate,
    sourceUrl,
  };
}

export async function fetchVietstockFinancialStatements(symbol: string): Promise<VietstockFinancialImport> {
  const cleanSymbol = symbol.trim().toUpperCase();
  const path = `api/finance/financialstatements?symbol=${encodeURIComponent(cleanSymbol)}&type=quarter`;

  let payload: unknown;
  try {
    payload = await externalSourceAdapters.vietstock.fetchJson<unknown>(path);
  } catch (err) {
    const observedAt = new Date().toISOString();
    const sourceUrl = `https://finance.vietstock.vn/${cleanSymbol}/bao-cao-tai-chinh.htm`;
    return {
      symbol: cleanSymbol,
      source: "vietstock",
      sourceUrl,
      reportedAt: observedAt,
      filingDate: observedAt,
      quarters: [],
    };
  }

  const root = (payload ?? {}) as Json;
  const items = Array.isArray(root.data) ? (root.data as Json[]) : Array.isArray(root) ? (root as Json[]) : [];
  const quarters = items
    .map((row) => normalizeQuarter(cleanSymbol, row))
    .filter((row): row is VietstockFinancialQuarter => Boolean(row));

  const observedAt = new Date().toISOString();
  const sourceUrl = `https://finance.vietstock.vn/${cleanSymbol}/bao-cao-tai-chinh.htm`;
  const latestFilingDate = quarters[0]?.filingDate ?? observedAt;

  normalizeReportedRecord({
    source: "vietstock",
    sourceUrl,
    symbol: cleanSymbol,
    observedAt,
    kind: "financial-statement",
    data: { quarterCount: quarters.length, filingDate: latestFilingDate },
  });

  return {
    symbol: cleanSymbol,
    source: "vietstock",
    sourceUrl,
    reportedAt: observedAt,
    filingDate: latestFilingDate,
    quarters,
  };
}
