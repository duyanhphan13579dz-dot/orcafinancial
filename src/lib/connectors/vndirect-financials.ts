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
  /** ROADMAP G1: raw response upstream giữ lại để lưu trước khi normalize. */
  rawPayload?: unknown;
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
  // VnDirect finfo trả fiscalDate dạng "2026-09-30" → suy ra quý kế toán.
  const fd = String(row.fiscalDate ?? row.reportDate ?? row.periodEnd ?? "");
  const fm = fd.match(/^(20\d{2})-(\d{2})-\d{2}/);
  if (fm) {
    const mm = Number(fm[2]);
    const q = mm <= 3 ? 1 : mm <= 6 ? 2 : mm <= 9 ? 3 : 4;
    return { period: `Q${q}/${fm[1]}`, fiscalYear: Number(fm[1]) };
  }
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

/**
 * BCTC từ API CÔNG KHAI của VNDirect (bắt từ DevTools của người dùng, không cần
 * token): api-finfo.vndirect.com.vn/v4/financial_statements.
 * modelType 2,90,102,412 = bộ 3 báo cáo + chỉ tiêu; fiscalDate liệt kê 9 kỳ gần
 * nhất để giới hạn phạm vi giống request gốc.
 */
export const VNDIRECT_FINFO_FINANCIALS_URL =
  "https://api-finfo.vndirect.com.vn/v4/financial_statements";

function lastQuarterEnds(count: number, now = new Date()): string[] {
  const ends: Array<[number, number]> = [
    [3, 31],
    [6, 30],
    [9, 30],
    [12, 31],
  ];
  const out: string[] = [];
  let y = now.getUTCFullYear();
  let idx = 3;
  // lùi về kỳ đã hoàn tất gần nhất
  while (out.length < count) {
    const [m, d] = ends[idx];
    const end = new Date(Date.UTC(y, m - 1, d));
    if (end < now) out.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    idx -= 1;
    if (idx < 0) {
      idx = 3;
      y -= 1;
    }
  }
  return out;
}

export async function fetchVndirectFinfoFinancialStatements(
  symbol: string,
  limit = 8,
  fetchImpl: typeof fetch = fetch,
): Promise<VndirectFinancialImport> {
  const sym = symbol.toUpperCase();
  const fiscalDates = lastQuarterEnds(9).join(",");
  const url =
    process.env.VNDIRECT_FINFO_URL?.trim() ||
    `${VNDIRECT_FINFO_FINANCIALS_URL}?q=code:${sym}~reportType:QUARTER~modelType:2,90,102,412~fiscalDate:${fiscalDates}&sort=fiscalDate&size=2000`;
  try {
    const res = await fetchImpl(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(9_000),
    });
    if (!res.ok) {
      return {
        symbol: sym,
        source: "vndirect",
        sourceUrl: url,
        quarters: [],
        warnings: [`VnDirect finfo HTTP ${res.status}`],
      };
    }
    const payload = (await res.json()) as unknown;
    const quarters = quartersFromRows(rowsFrom(payload), limit);
    return {
      symbol: sym,
      source: "vndirect",
      sourceUrl: url,
      quarters,
      warnings: quarters.length ? [] : ["VnDirect finfo: không parse được quý nào"],
      rawPayload: payload,
    };
  } catch (e) {
    return {
      symbol: sym,
      source: "vndirect",
      sourceUrl: url,
      quarters: [],
      warnings: [e instanceof Error ? e.message : "vndirect finfo failed"],
    };
  }
}

export async function fetchVndirectFinancialStatements(
  symbol: string,
  limit = 8,
): Promise<VndirectFinancialImport> {
  const sym = symbol.toUpperCase();
  const warnings: string[] = [];

  // 1) API công khai của VNDirect (finfo) — không cần cấu hình.
  const finfo = await fetchVndirectFinfoFinancialStatements(sym, limit);
  warnings.push(...finfo.warnings);
  if (finfo.quarters.length > 0) return finfo;

  // 2) Datafeed được cấp quyền (nếu cấu hình) — ưu tiên nếu có token riêng.
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
        rawPayload: payload,
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
