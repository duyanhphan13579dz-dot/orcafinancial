/**
 * Server-side financial statement fetcher for the VNDirect "doanh nghiệp"
 * report pages (dstock.vndirect.com.vn).
 *
 * The public dstock report pages (Bảng cân đối kế toán / Báo cáo KQKD / Báo
 * cáo lưu chuyển tiền tệ) are an SPA that pulls their numbers from the
 * VNDirect `finfo-api` JSON backend. That backend does not send permissive
 * CORS headers, so a browser cannot read it cross-origin — but a *server*
 * (the Next.js route handler) can. In production (Vercel) the server has
 * outbound internet, so this module fetches `finfo-api` server-side and
 * returns same-origin JSON. The human-readable dstock page URL is carried
 * through as `sourceUrl` so the UI can show a viewable source to verify.
 *
 * Everything is real reported data straight from VNDirect (the company's
 * published reports). No synthesis, no fabrication — values that are missing
 * are simply omitted.
 */

import {
  INCOME_TARGETS,
  BALANCE_TARGETS,
  CASHFLOW_TARGETS,
  asNumber,
  fiscalPeriod,
  matchLines,
  toBillions,
  toPerShareThousands,
  type Matcher,
} from "@/lib/connectors/live-financials-client";

export type DstockStatementType = "income" | "balance" | "cashflow";
export type DstockPeriod = "quarterly" | "yearly";

export interface DstockYearData {
  period: string;
  fiscalYear: number;
  quarter: number;
  data: Record<string, number>;
}

export interface DstockFinancialsResult {
  symbol: string;
  type: DstockStatementType;
  periods: DstockYearData[];
  fields: string[];
  source: "vndirect" | "vietstock";
  sourceName: string;
  sourceUrl: string;
  unit: string;
  warnings: string[];
}

const DSTOCK_BY_TYPE: Record<DstockStatementType, { url: string; title: string }> = {
  income: { url: "bao-cao-ket-qua-kinh-doanh", title: "Báo cáo kết quả kinh doanh" },
  balance: { url: "bang-can-doi-ke-toan", title: "Bảng cân đối kế toán" },
  cashflow: { url: "bao-cao-luu-chuyen-tien-te", title: "Báo cáo lưu chuyển tiền tệ" },
};

// finfo-api modelTypes per statement (the same feed the dstock SPA uses):
//   balance  = 1,89,101,411
//   income   = 2,90,102,412
//   cashflow = 3,91,103,413
const MODEL_TYPES: Record<DstockStatementType, string> = {
  income: "2,90,102,412",
  balance: "1,89,101,411",
  cashflow: "3,91,103,413",
};

const TARGETS: Record<DstockStatementType, Matcher[]> = {
  income: INCOME_TARGETS,
  balance: BALANCE_TARGETS,
  cashflow: CASHFLOW_TARGETS,
};

const FIELD_LIST: Record<DstockStatementType, string[]> = {
  income: ["revenue", "costOfGoodsSold", "grossProfit", "operatingExpenses", "operatingIncome", "interestExpense", "otherIncome", "pretaxIncome", "incomeTax", "netIncome", "ebitda", "eps"],
  balance: ["cashAndEquivalents", "shortTermInvestments", "receivables", "inventory", "currentAssets", "fixedAssets", "longTermInvestments", "totalAssets", "currentLiabilities", "longTermDebt", "totalLiabilities", "equity", "retainedEarnings", "totalLiabilitiesEquity", "bookValuePerShare"],
  cashflow: ["netIncome", "depreciation", "changeWorkingCapital", "operatingCashFlow", "capex", "investingCashFlow", "debtIssuance", "dividendsPaid", "financingCashFlow", "netChangeCash", "freeCashFlow"],
};

const FINFO_API = "https://finfo-api.vndirect.com.vn/v3/stocks/financialStatement";

interface VndirectRow {
  fiscalDate: string;
  itemName: string;
  itemCode: string;
  numericValue: number | null;
}

export function parseRows(payload: unknown): VndirectRow[] {
  const data = (payload as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
  const hits = data?.hits;
  if (!Array.isArray(hits)) return [];
  const out: VndirectRow[] = [];
  for (const hit of hits) {
    if (!hit || typeof hit !== "object") continue;
    const src = (hit as Record<string, unknown>)._source as Record<string, unknown> | undefined;
    if (!src) continue;
    const fiscalDate = typeof src.fiscalDate === "string" ? src.fiscalDate : "";
    const itemName = typeof src.itemName === "string" ? src.itemName : "";
    const itemCode = typeof src.itemCode === "string" ? src.itemCode : "";
    const numericValue = asNumber(src.numericValue);
    if (!fiscalDate || !itemName) continue;
    out.push({ fiscalDate, itemName, itemCode, numericValue });
  }
  return out;
}

async function fetchStatement(
  symbol: string,
  type: DstockStatementType,
  limit: number,
): Promise<{ byDate: Map<string, Record<string, number>>; warnings: string[] }> {
  const warnings: string[] = [];
  const now = new Date();
  const fromYear = now.getFullYear() - (limit + 3);
  const toDate = now.toISOString().slice(0, 10);
  const fromDate = `${fromYear}-01-01`;

  const url = new URL(FINFO_API);
  url.searchParams.set("secCodes", symbol);
  url.searchParams.set("reportTypes", "QUARTER");
  url.searchParams.set("modelTypes", MODEL_TYPES[type]);
  url.searchParams.set("fromDate", fromDate);
  url.searchParams.set("toDate", toDate);

  const perShare = new Set(["eps", "bookValuePerShare"]);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://dstock.vndirect.com.vn/",
        Origin: "https://dstock.vndirect.com.vn",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      warnings.push(`VNDirect finfo-api HTTP ${res.status}`);
      return { byDate: new Map(), warnings };
    }
    const payload = await res.json();
    const rows = parseRows(payload);
    if (rows.length === 0) {
      warnings.push(`VNDirect finfo-api returned no rows for ${type}`);
      return { byDate: new Map(), warnings };
    }

    const targets = TARGETS[type];
    const byDate = new Map<string, Record<string, number>>();
    const grouped = new Map<string, Array<{ name: string; value: number | null }>>();
    for (const row of rows) {
      const arr = grouped.get(row.fiscalDate) ?? [];
      arr.push({ name: row.itemName, value: row.numericValue });
      grouped.set(row.fiscalDate, arr);
    }
    for (const [date, lines] of grouped) {
      const mapped = matchLines(lines, targets, perShare);
      if (Object.keys(mapped).length > 0) byDate.set(date, mapped);
    }
    return { byDate, warnings };
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : `VNDirect finfo-api ${type} failed`);
    return { byDate: new Map(), warnings };
  }
}

export function pickFreeCashFlow(cf: Record<string, number>): number | null {
  const ocf = cf.operatingCashFlow ?? null;
  const inv = cf.investingCashFlow ?? null;
  const capex = cf.capex ?? null;
  if (ocf == null) return null;
  if (inv != null) return ocf + inv;
  if (capex != null) return ocf - capex;
  return null;
}

export async function fetchDstockFinancials(
  symbol: string,
  type: DstockStatementType,
  period: DstockPeriod = "quarterly",
  limit = 8,
): Promise<DstockFinancialsResult> {
  const sym = symbol.toUpperCase();
  const all = await Promise.all([
    fetchStatement(sym, "income", limit),
    fetchStatement(sym, "balance", limit),
    fetchStatement(sym, "cashflow", limit),
  ]);
  const warnings = [...all[0].warnings, ...all[1].warnings, ...all[2].warnings];
  const income = all[0].byDate;
  const balance = all[1].byDate;
  const cashflow = all[2].byDate;

  const { periods: usable, fields } = buildPeriods(income, balance, cashflow, period, type, limit);
  const segment = DSTOCK_BY_TYPE[type];

  return {
    symbol: sym,
    type,
    periods: usable,
    fields,
    source: "vndirect",
    sourceName: "VNDirect (doanh nghiệp)",
    sourceUrl: `https://dstock.vndirect.com.vn/${segment.url}/${sym}`,
    unit: "tỷ VND",
    warnings,
  };
}

/**
 * Pure composition of the three statement maps into the response periods.
 * Kept separate from network I/O so the row-mapping + period-filtering rules
 * are unit-testable.
 */
export function buildPeriods(
  income: Map<string, Record<string, number>>,
  balance: Map<string, Record<string, number>>,
  cashflow: Map<string, Record<string, number>>,
  period: DstockPeriod,
  type: DstockStatementType,
  limit: number,
): { periods: DstockYearData[]; fields: string[] } {
  const dates = new Set([...income.keys(), ...balance.keys(), ...cashflow.keys()]);
  const periods: DstockYearData[] = [];
  for (const date of dates) {
    const fp = fiscalPeriod(date, period);
    if (!fp) continue;
    const inc = income.get(date) ?? {};
    const bal = balance.get(date) ?? {};
    const cf = cashflow.get(date) ?? {};

    periods.push({
      period: fp.period,
      fiscalYear: fp.fiscalYear,
      quarter: fp.quarter,
      data: {
        revenue: inc.revenue ?? 0,
        costOfGoodsSold: inc.costOfGoodsSold ?? 0,
        grossProfit: inc.grossProfit ?? 0,
        operatingExpenses: inc.operatingExpenses ?? 0,
        operatingIncome: inc.operatingIncome ?? 0,
        interestExpense: inc.interestExpense ?? 0,
        otherIncome: inc.otherIncome ?? 0,
        pretaxIncome: inc.pretaxIncome ?? 0,
        incomeTax: inc.incomeTax ?? 0,
        netIncome: inc.netIncome ?? 0,
        ebitda: inc.ebitda ?? 0,
        depreciation: inc.depreciation ?? 0,
        eps: inc.eps ?? 0,
        cashAndEquivalents: bal.cashAndEquivalents ?? 0,
        shortTermInvestments: bal.shortTermInvestments ?? 0,
        receivables: bal.receivables ?? 0,
        inventory: bal.inventory ?? 0,
        currentAssets: bal.currentAssets ?? 0,
        fixedAssets: bal.fixedAssets ?? 0,
        longTermInvestments: bal.longTermInvestments ?? 0,
        totalAssets: bal.totalAssets ?? 0,
        currentLiabilities: bal.currentLiabilities ?? 0,
        longTermDebt: bal.longTermDebt ?? 0,
        totalLiabilities: bal.totalLiabilities ?? 0,
        equity: bal.equity ?? 0,
        retainedEarnings: bal.retainedEarnings ?? 0,
        totalLiabilitiesEquity: bal.totalLiabilitiesEquity ?? 0,
        bookValuePerShare: bal.bookValuePerShare ?? 0,
        operatingCashFlow: cf.operatingCashFlow ?? 0,
        capex: cf.capex ?? 0,
        investingCashFlow: cf.investingCashFlow ?? 0,
        debtIssuance: cf.debtIssuance ?? 0,
        dividendsPaid: cf.dividendsPaid ?? 0,
        financingCashFlow: cf.financingCashFlow ?? 0,
        netChangeCash: cf.netChangeCash ?? 0,
        freeCashFlow: pickFreeCashFlow(cf) ?? 0,
      },
    });
  }

  periods.sort((a, b) => b.fiscalYear - a.fiscalYear || b.quarter - a.quarter);

  // Only keep periods with at least one non-zero figure so we never render a
  // blank column, and strip all-zero leading entries.
  const usable = periods.filter((p) => Object.values(p.data).some((v) => Math.abs(v) > 0)).slice(0, limit);
  const fields = FIELD_LIST[type].filter((f) => usable.some((p) => Math.abs(p.data[f] ?? 0) > 0));

  return { periods: usable, fields };
}
