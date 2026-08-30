import { externalSourceAdapters, normalizeReportedRecord } from "@/lib/connectors/external-sources";
import { getLatestCompletedQuarter } from "@/lib/financial-statements";
import { isFuturePeriod } from "@/lib/realtime-time";

export interface VndirectFinancialQuarter {
  period: string;
  quarter: number;
  fiscalYear: number;
  income: Record<string, number>;
  balance: Record<string, number>;
  cashflow: Record<string, number>;
  filingDate?: string;
  sourceUrl: string;
}

export interface VndirectFinancialImport {
  symbol: string;
  source: "vndirect";
  sourceUrl: string;
  reportedAt: string;
  filingDate: string;
  quarters: VndirectFinancialQuarter[];
}

type Json = Record<string, unknown>;

const FIELD_ALIASES = {
  income: {
    revenue: ["revenue", "sales", "netRevenue", "doanhThuThuan", "numericValue_51"],
    costOfGoodsSold: ["costOfGoodsSold", "cogs", "costOfSales", "giaVonHangBan", "numericValue_52"],
    grossProfit: ["grossProfit", "loiNhuanGop", "numericValue_53"],
    operatingExpenses: ["operatingExpenses", "opex", "chiPhiHoatDong"],
    operatingIncome: ["operatingIncome", "ebit", "loiNhuanHoatDong", "numericValue_54"],
    interestExpense: ["interestExpense", "financeCost", "chiPhiLaiVay"],
    pretaxIncome: ["pretaxIncome", "ebt", "loiNhuanTruocThue"],
    incomeTax: ["incomeTax", "taxExpense", "chiPhiThueTNDN"],
    netIncome: ["netIncome", "profitAfterTax", "loiNhuanSauThue", "numericValue_60"],
    ebitda: ["ebitda"],
    eps: ["eps", "earningsPerShare"],
  },
  balance: {
    cashAndEquivalents: ["cashAndEquivalents", "cash", "tienVaTuongDuongTien"],
    shortTermInvestments: ["shortTermInvestments", "shortInvestments", "dauTuNganHan"],
    receivables: ["receivables", "accountsReceivable", "phaiThu"],
    inventory: ["inventory", "hangTonKho"],
    currentAssets: ["currentAssets", "taiSanNganHan"],
    fixedAssets: ["fixedAssets", "propertyPlantEquipment", "taiSanCoDinh"],
    totalAssets: ["totalAssets", "taiSan"],
    currentLiabilities: ["currentLiabilities", "noNganHan"],
    longTermDebt: ["longTermDebt", "nonCurrentDebt", "noDaiHan"],
    totalLiabilities: ["totalLiabilities", "liabilities", "noPhaiTra"],
    equity: ["equity", "ownersEquity", "vonChuSoHuu"],
    retainedEarnings: ["retainedEarnings", "loiNhuanChuaPhanPhoi"],
    bookValuePerShare: ["bookValuePerShare", "bvps"],
  },
  cashflow: {
    operatingCashFlow: ["operatingCashFlow", "cfo", "cashFromOperating"],
    capex: ["capex", "capitalExpenditure", "purchaseOfPpe"],
    investingCashFlow: ["investingCashFlow", "cfi", "cashFromInvesting"],
    dividendsPaid: ["dividendsPaid", "dividendPaid"],
    financingCashFlow: ["financingCashFlow", "cff", "cashFromFinancing"],
    netChangeCash: ["netChangeCash", "netCashChange"],
    freeCashFlow: ["freeCashFlow", "fcf"],
  },
} as const;

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/,/g, "").replace(/%$/, "").trim();
  if (!normalized || !/^-?\d+(\.\d+)?$/.test(normalized)) return undefined;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : undefined;
}

function firstRecord(input: unknown): Json {
  if (Array.isArray(input)) return (input[0] ?? {}) as Json;
  return (input ?? {}) as Json;
}

function mapSection(section: unknown, aliases: Record<string, readonly string[]>): Record<string, number> {
  const source = firstRecord(section);
  const output: Record<string, number> = {};
  for (const [canonical, candidates] of Object.entries(aliases)) {
    for (const candidate of candidates) {
      const value = asNumber(source[candidate]);
      if (value !== undefined) {
        output[canonical] = value;
        break;
      }
    }
  }
  return output;
}

function rowsFromPayload(payload: unknown): Json[] {
  const root = (payload ?? {}) as Json;
  const data = (root.data ?? root.result ?? root) as Json;
  const rows = data.quarters ?? data.items ?? data.records ?? data.financials;
  return Array.isArray(rows) ? (rows as Json[]) : [data];
}

function parseFilingDate(row: Json): string {
  const rawDate = typeof row.filingDate === "string" ? row.filingDate : typeof row.reportDate === "string" ? row.reportDate : typeof row.fiscalDate === "string" ? row.fiscalDate : null;
  if (rawDate) {
    const parsed = Date.parse(rawDate);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function normalizeQuarter(symbol: string, row: Json): VndirectFinancialQuarter | null {
  const fiscalYear = Number(row.fiscalYear ?? row.year ?? row.nam);
  const quarterValue = String(row.quarter ?? row.period ?? row.quy ?? "").toUpperCase();
  const quarterMatch = quarterValue.match(/Q?([1-4])/);
  const quarter = quarterMatch ? Number(quarterMatch[1]) : 0;
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1990 || !quarter) return null;

  const period = `Q${quarter}/${fiscalYear}`;
  const latestCompleted = getLatestCompletedQuarter();
  if (isFuturePeriod(period, latestCompleted.fiscalYear)) return null;

  const incomeSource = row.income ?? row.incomeStatement ?? row.income_statement;
  const balanceSource = row.balance ?? row.balanceSheet ?? row.balance_sheet;
  const cashflowSource = row.cashflow ?? row.cashFlow ?? row.cashFlowStatement ?? row.cash_flow;

  const filingDate = parseFilingDate(row);
  const sourceUrl = `https://dboard.vndirect.com.vn/bao-cao-tai-chinh/${symbol.toUpperCase()}`;

  return {
    period,
    quarter,
    fiscalYear,
    income: mapSection(incomeSource, FIELD_ALIASES.income),
    balance: mapSection(balanceSource, FIELD_ALIASES.balance),
    cashflow: mapSection(cashflowSource, FIELD_ALIASES.cashflow),
    filingDate,
    sourceUrl,
  };
}

export async function fetchVndirectFinancialStatements(symbol: string): Promise<VndirectFinancialImport> {
  const cleanSymbol = symbol.trim().toUpperCase();
  const pathTemplate = process.env.VNDIRECT_FINANCIALS_PATH?.trim() || "v4/financial_statements?q=code:{symbol}~reportType:QUARTER";
  const encoded = encodeURIComponent(cleanSymbol);
  const path = pathTemplate.includes("{symbol}")
    ? pathTemplate.replaceAll("{symbol}", encoded)
    : `${pathTemplate}${pathTemplate.includes("?") ? "&" : "?"}symbol=${encoded}`;

  let payload: unknown;
  try {
    payload = await externalSourceAdapters.vndirect.fetchJson<unknown>(path);
  } catch (err) {
    // Return structured default with direct source link if external endpoint is offline
    const observedAt = new Date().toISOString();
    const sourceUrl = `https://dboard.vndirect.com.vn/bao-cao-tai-chinh/${cleanSymbol}`;
    return {
      symbol: cleanSymbol,
      source: "vndirect",
      sourceUrl,
      reportedAt: observedAt,
      filingDate: observedAt,
      quarters: [],
    };
  }

  const quarters = rowsFromPayload(payload)
    .map((row) => normalizeQuarter(cleanSymbol, row))
    .filter((row): row is VndirectFinancialQuarter => Boolean(row));

  const observedAt = new Date().toISOString();
  const sourceUrl = `https://dboard.vndirect.com.vn/bao-cao-tai-chinh/${cleanSymbol}`;
  const latestFilingDate = quarters[0]?.filingDate ?? observedAt;

  normalizeReportedRecord({
    source: "vndirect",
    sourceUrl,
    symbol: cleanSymbol,
    observedAt,
    kind: "financial-statement",
    data: { quarterCount: quarters.length, filingDate: latestFilingDate },
  });

  return {
    symbol: cleanSymbol,
    source: "vndirect",
    sourceUrl,
    reportedAt: observedAt,
    filingDate: latestFilingDate,
    quarters,
  };
}
