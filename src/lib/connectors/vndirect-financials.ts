/**
 * VnDirect financial statements client.
 * Prefer VNDIRECT_DATAFEED_URL (authorized feed).
 */

export interface VndirectQuarter {
  period: string;
  fiscalYear: number;
  income: Record<string, number>;
  balance: Record<string, number>;
  cashflow: Record<string, number>;
}

export interface VndirectFinancialImport {
  symbol: string;
  source: "vndirect";
  sourceUrl: string;
  quarters: VndirectQuarter[];
  warnings: string[];
}

type Json = Record<string, unknown>;

const INCOME_ALIASES: Record<string, string[]> = {
  revenue: ["revenue", "netRevenue", "netSales", "sales", "doanhThuThuan"],
  costOfGoodsSold: ["cogs", "costOfGoodsSold", "giaVon"],
  grossProfit: ["grossProfit", "loiNhuanGop"],
  operatingExpenses: ["operatingExpense", "operatingExpenses"],
  operatingIncome: ["operatingProfit", "ebit", "operatingIncome"],
  interestExpense: ["interestExpense"],
  pretaxIncome: ["profitBeforeTax", "pretaxIncome"],
  incomeTax: ["incomeTax", "corporateIncomeTax"],
  netIncome: ["netProfit", "netIncome", "profitAfterTax"],
  ebitda: ["ebitda"],
  eps: ["eps", "basicEPS"],
};

const BALANCE_ALIASES: Record<string, string[]> = {
  cashAndEquivalents: ["cash", "cashAndCashEquivalents"],
  totalAssets: ["totalAssets", "assets"],
  totalLiabilities: ["totalLiabilities", "liabilities"],
  equity: ["equity", "ownerEquity", "stockholdersEquity"],
  currentAssets: ["currentAssets"],
  currentLiabilities: ["currentLiabilities"],
  longTermDebt: ["longTermDebt"],
  retainedEarnings: ["retainedEarnings"],
  bookValuePerShare: ["bookValuePerShare", "bvps"],
};

const CASHFLOW_ALIASES: Record<string, string[]> = {
  operatingCashFlow: ["operatingCashFlow", "cfo"],
  investingCashFlow: ["investingCashFlow", "cfi"],
  financingCashFlow: ["financingCashFlow", "cff"],
  freeCashFlow: ["freeCashFlow", "fcf"],
  capex: ["capex", "capitalExpenditure"],
  netChangeCash: ["netChangeInCash", "netChangeCash"],
};

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(/,/g, "")))) {
    return Number(v.replace(/,/g, ""));
  }
  return undefined;
}

function pick(row: Json, aliases: string[]): number | undefined {
  const lower = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]));
  for (const key of aliases) {
    const v = num(lower[key.toLowerCase()]);
    if (v != null) return v;
  }
  return undefined;
}

function mapSection(row: Json, aliases: Record<string, string[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [field, keys] of Object.entries(aliases)) {
    const v = pick(row, keys);
    if (v != null) out[field] = v;
  }
  return out;
}

function parsePeriod(row: Json): { period: string; fiscalYear: number } | null {
  const year = num(row.year ?? row.Year ?? row.fiscalYear ?? row.FiscalYear);
  const quarter = num(row.quarter ?? row.Quarter ?? row.Q);
  if (year != null && quarter != null && quarter >= 1 && quarter <= 4) {
    return { period: `Q${quarter}/${year}`, fiscalYear: year };
  }
  if (year != null && (row.periodType === "Y" || row.reportType === "Year" || row.IsYear === true)) {
    return { period: `FY/${year}`, fiscalYear: year };
  }
  const label = String(row.period ?? row.Period ?? row.periodName ?? "");
  const qm = label.match(/Q\s*([1-4])[^\d]*(20\d{2})/i) || label.match(/(20\d{2})[^\d]*Q\s*([1-4])/i);
  if (qm) {
    const q = qm[1].length === 1 ? qm[1] : qm[2];
    const y = qm[1].length === 1 ? qm[2] : qm[1];
    return { period: `Q${q}/${y}`, fiscalYear: Number(y) };
  }
  const ym = label.match(/(20\d{2})/);
  if (ym) return { period: `FY/${ym[1]}`, fiscalYear: Number(ym[1]) };
  return null;
}

function rowsFrom(payload: unknown): Json[] {
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === "object") as Json[];
  if (payload && typeof payload === "object") {
    const obj = payload as Json;
    for (const key of ["data", "Data", "items", "Items", "list", "List", "result", "Result", "financials"]) {
      const v = obj[key];
      if (Array.isArray(v)) return v.filter((x) => x && typeof x === "object") as Json[];
    }
  }
  return [];
}

function quartersFromRows(rows: Json[], limit: number): VndirectQuarter[] {
  const byPeriod = new Map<string, VndirectQuarter>();
  for (const row of rows) {
    const p = parsePeriod(row);
    if (!p) continue;
    const existing = byPeriod.get(p.period) ?? {
      period: p.period,
      fiscalYear: p.fiscalYear,
      income: {},
      balance: {},
      cashflow: {},
    };
    existing.income = { ...existing.income, ...mapSection(row, INCOME_ALIASES) };
    existing.balance = { ...existing.balance, ...mapSection(row, BALANCE_ALIASES) };
    existing.cashflow = { ...existing.cashflow, ...mapSection(row, CASHFLOW_ALIASES) };
    byPeriod.set(p.period, existing);
  }
  return [...byPeriod.values()]
    .filter((q) => Object.keys(q.income).length + Object.keys(q.balance).length > 0)
    .sort((a, b) => b.fiscalYear - a.fiscalYear || b.period.localeCompare(a.period))
    .slice(0, limit);
}

export async function fetchVndirectFinancialStatements(
  symbol: string,
  limit = 8,
): Promise<VndirectFinancialImport> {
  const sym = symbol.toUpperCase();
  const warnings: string[] = [];

  const endpoint = process.env.VNDIRECT_DATAFEED_URL?.trim() || process.env.VNDIRECT_FINANCIALS_URL?.trim();
  if (endpoint) {
    try {
      const url = new URL(endpoint);
      url.searchParams.set("symbol", sym);
      url.searchParams.set("secCode", sym);
      url.searchParams.set("limit", String(limit));
      const headers: Record<string, string> = { accept: "application/json" };
      const token = process.env.VNDIRECT_DATAFEED_TOKEN?.trim() || process.env.VNDIRECT_API_KEY?.trim();
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetch(url, { headers, cache: "no-store" });
      if (!res.ok) throw new Error(`VnDirect datafeed HTTP ${res.status}`);
      const payload = (await res.json()) as unknown;
      const quarters = quartersFromRows(rowsFrom(payload), limit);
      return {
        symbol: sym,
        source: "vndirect",
        sourceUrl: url.toString(),
        quarters,
        warnings: quarters.length ? [] : ["VnDirect datafeed returned no parseable quarters"],
      };
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : "vndirect datafeed failed");
    }
  } else {
    warnings.push("VnDirect: chưa cấu hình VNDIRECT_DATAFEED_URL");
  }

  return {
    symbol: sym,
    source: "vndirect",
    sourceUrl: `https://dstock.vndirect.com.vn/lich-su-gia/${sym}`,
    quarters: [],
    warnings,
  };
}
