import { externalSourceAdapters, normalizeReportedRecord } from "@/lib/connectors/external-sources";

export interface TcbsFinancialQuarter {
  period: string;
  quarter: number;
  fiscalYear: number;
  income: Record<string, number>;
  balance: Record<string, number>;
  cashflow: Record<string, number>;
}

export type VndirectFinancialQuarter = TcbsFinancialQuarter;

export interface TcbsFinancialImport {
  symbol: string;
  source: "reported-api";
  sourceUrl: string;
  reportedAt: string;
  quarters: TcbsFinancialQuarter[];
}

export type VndirectFinancialImport = TcbsFinancialImport;

type Json = Record<string, unknown>;

const FIELD_ALIASES = {
  income: {
    revenue: ["revenue", "sales", "netRevenue", "doanhThuThuan"],
    costOfGoodsSold: ["costOfGoodsSold", "cogs", "costOfSales", "giaVonHangBan"],
    grossProfit: ["grossProfit", "loiNhuanGop"],
    operatingExpenses: ["operatingExpenses", "opex", "chiPhiHoatDong"],
    operatingIncome: ["operatingIncome", "ebit", "loiNhuanHoatDong"],
    interestExpense: ["interestExpense", "financeCost", "chiPhiLaiVay"],
    pretaxIncome: ["pretaxIncome", "ebt", "loiNhuanTruocThue"],
    incomeTax: ["incomeTax", "taxExpense", "chiPhiThueTNDN"],
    netIncome: ["netIncome", "profitAfterTax", "loiNhuanSauThue"],
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
  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
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
  return Array.isArray(rows) ? rows as Json[] : [data];
}

function normalizeQuarter(row: Json): TcbsFinancialQuarter | null {
  const fiscalYear = Number(row.fiscalYear ?? row.year ?? row.nam);
  const quarterValue = String(row.quarter ?? row.period ?? row.quy ?? "").toUpperCase();
  const quarterMatch = quarterValue.match(/Q?([1-4])/);
  const quarter = quarterMatch ? Number(quarterMatch[1]) : 0;
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1990 || !quarter) return null;
  const incomeSource = row.income ?? row.incomeStatement ?? row.income_statement;
  const balanceSource = row.balance ?? row.balanceSheet ?? row.balance_sheet;
  const cashflowSource = row.cashflow ?? row.cashFlow ?? row.cashFlowStatement ?? row.cash_flow;
  return {
    period: `Q${quarter}/${fiscalYear}`,
    quarter,
    fiscalYear,
    income: mapSection(incomeSource, FIELD_ALIASES.income),
    balance: mapSection(balanceSource, FIELD_ALIASES.balance),
    cashflow: mapSection(cashflowSource, FIELD_ALIASES.cashflow),
  };
}

export async function fetchVndirectFinancialStatements(symbol: string): Promise<VndirectFinancialImport> {
  const pathTemplate = process.env.VNDIRECT_FINANCIALS_PATH?.trim() || "v4/financial_statements?q=code:{symbol}~reportType:QUARTER";
  const encoded = encodeURIComponent(symbol.trim().toUpperCase());
  const path = pathTemplate.includes("{symbol}")
    ? pathTemplate.replaceAll("{symbol}", encoded)
    : `${pathTemplate}${pathTemplate.includes("?") ? "&" : "?"}symbol=${encoded}`;
  const payload = await externalSourceAdapters.vndirect.fetchJson<unknown>(path);
  const quarters = rowsFromPayload(payload).map(normalizeQuarter).filter((row): row is VndirectFinancialQuarter => Boolean(row));
  if (!quarters.length) throw new Error(`VNDirect returned no valid financial quarters for ${symbol}`);
  const baseUrl = process.env.VNDIRECT_API_URL?.trim() || "https://finfo-api.vndirect.com.vn";
  const sourceUrl = `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  const observedAt = new Date().toISOString();
  const normalized = normalizeReportedRecord({
    source: "vndirect",
    sourceUrl,
    symbol,
    observedAt,
    kind: "financial-statement",
    data: { quarterCount: quarters.length },
  });
  return { symbol: normalized.symbol, source: "reported-api", sourceUrl, reportedAt: observedAt, quarters };
}

export async function fetchTcbsFinancialStatements(symbol: string): Promise<TcbsFinancialImport> {
  return fetchVndirectFinancialStatements(symbol);
}
