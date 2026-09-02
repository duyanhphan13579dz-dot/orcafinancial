"use client";

/**
 * Live financial statement extractor — runs entirely in the browser.
 *
 * The sandbox/host Next.js server has no outbound internet, so we cannot rely
 * on the server-side ingestion pipeline (`/stocks/:symbol/financials`) to reach
 * VNDirect / Vietstock. Following the order-book pattern, this module fetches
 * directly from the public VNDirect finfo-api (the "doanh nghiệp" source, first
 * priority) and falls back to Vietstock, normalizing everything into the app's
 * canonical `FinancialQuarter` / statement shapes so both the "Tài chính" tab
 * and the financial-health scoring can use the same extracted figures.
 *
 * Priority: doanh nghiệp (VNDirect) → Vietstock.
 */

import type { FinancialQuarter } from "@/lib/financial-statements";

/* ────────────────────────────────────────────────────────────
 * Types shared by the consumer components
 * ──────────────────────────────────────────────────────────── */

export interface FinancialsResponseLike {
  symbol: string;
  type: "income" | "balance" | "cashflow";
  periods: Array<{ period: string; fiscalYear: number; data: Record<string, number> }>;
  fields: string[];
  liveSource: string | null; // "vndirect" | "vietstock" | null
  warnings: string[];
}

export interface LiveFinancialsData {
  symbol: string;
  quarters: FinancialQuarter[];
  source: "vndirect" | "vietstock" | null;
  warnings: string[];
}

/* ────────────────────────────────────────────────────────────
 * API endpoints (VNDirect public finfo-api)
 * ──────────────────────────────────────────────────────────── */

const VNDIRECT_FINFO = "https://finfo-api.vndirect.com.vn/v3/stocks/financialStatement";

// VNDirect modelTypes per statement (from the public finfo-api docs / vnquant):
//   balance  = 1,89,101,411   (Cân đối kế toán)
//   income   = 2,90,102,412   (Kết quả kinh doanh)
//   cashflow = 3,91,103,413   (Lưu chuyển tiền tệ)
const MODEL_TYPES: Record<FinancialsResponseLike["type"], string> = {
  income: "2,90,102,412",
  balance: "1,89,101,411",
  cashflow: "3,91,103,413",
};

type Json = Record<string, unknown>;

/* ────────────────────────────────────────────────────────────
 * Text normalization (Vietnamese → fold)
 * ──────────────────────────────────────────────────────────── */

export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const parsed = Number(v.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/* ────────────────────────────────────────────────────────────
 * Value unit handling
 * VNDirect filings report in raw VND for money amounts; the app renders in
 * billions of VND. EPS / book value are per-share thousands of VND.
 * ──────────────────────────────────────────────────────────── */

export function toBillions(v: number | null): number | null {
  if (v == null) return null;
  // Money amounts are almost always >= 1e6 VND; guard against an API that
  // already returns data in billions (magnitude < 1e4) so we don't crush it.
  const abs = Math.abs(v);
  if (abs >= 1e4) return v / 1e9;
  return v;
}

export function toPerShareThousands(v: number | null): number | null {
  if (v == null) return null;
  const abs = Math.abs(v);
  // Per-share values reported in raw VND are typically >= 1000. If the API
  // already returns thousands, the magnitude stays small and we leave it.
  if (abs >= 1e3) return v / 1000;
  return v;
}

/* ────────────────────────────────────────────────────────────
 * VNDirect item-name matching.
 * We fold accents/numbering and match on stable substrings of the official
 * VAS line-item labels (e.g. "3. Doanh thu thuần", "4. Giá vốn hàng bán").
 * ──────────────────────────────────────────────────────────── */

export type Matcher = [canonicalField: string, needles: string[], mode: "single" | "sum", exclude?: string[]];

export const INCOME_TARGETS: Matcher[] = [
  // Prefer NET revenue ("doanh thu thuần"). The gross line "Doanh thu bán hàng
  // và cung cấp dịch vụ" appears *before* the net line and would be picked first
  // if included, so we only match net.
  ["revenue", ["doanh thu thuan ve ban hang", "doanh thu thuan va cung cap dich vu", "doanh thu thuan"], "single"],
  ["costOfGoodsSold", ["gia von hang ban"], "single"],
  ["grossProfit", ["loi nhuan gop ve ban hang", "loi nhuan gop"], "single"],
  ["operatingExpenses", ["chi phi ban hang", "chi phi quan ly doanh nghiep", "chi phi hoat dong"], "sum"],
  ["operatingIncome", ["loi nhuan thuan tu hoat dong kinh doanh", "loi nhuan tu hoat dong kinh doanh"], "single"],
  ["interestExpense", ["chi phi lai vay", "chi phi di vay"], "single"],
  ["otherIncome", ["thu nhap khac"], "single"],
  ["pretaxIncome", ["tong loi nhuan ke toan truoc thue", "tong loi nhuan truoc thue"], "single"],
  ["incomeTax", ["chi phi thue thu nhap doanh nghiep", "chi phi thue tndn hien hanh"], "single", ["hoan lai"]],
  // "Lợi nhuận sau thuế thu nhập doanh nghiệp" is the headline net line.
  // Exclude only minority-interest / parent sub-lines.
  ["netIncome", ["loi nhuan sau thue"], "single", ["khong kiem soat", "cong ty me", "co dong thieu so"]],
  ["ebitda", ["ebitda"], "single"],
  ["depreciation", ["khau hao"], "single"],
  ["eps", ["lai co ban tren co phieu"], "single"],
];

const BALANCE_TARGETS: Matcher[] = [
  ["cashAndEquivalents", ["tien va cac khoan tuong duong tien", "tien va tuong duong tien"], "single"],
  ["shortTermInvestments", ["dau tu tai chinh ngan han", "dau tu ngan han"], "single"],
  ["receivables", ["cac khoan phai thu ngan han", "phai thu ngan han"], "sum"],
  ["inventory", ["hang ton kho"], "single"],
  ["currentAssets", ["tong tai san ngan han", "tai san ngan han"], "single"],
  ["fixedAssets", ["tai san co dinh"], "single"],
  ["longTermInvestments", ["dau tu tai chinh dai han", "dau tu dai han"], "single"],
  ["totalAssets", ["tong tai san"], "single"],
  ["currentLiabilities", ["no ngan han"], "single"],
  ["shortTermDebt", ["vay va no thue tai chinh ngan han", "no ngan han den han"], "single"],
  ["debtDueWithin12m", ["vay va no thue tai chinh ngan han", "no ngan han den han", "no den han trong 12 thang"], "single"],
  ["longTermDebt", ["vay va no thue tai chinh dai han", "no dai han"], "single"],
  ["totalLiabilities", ["tong no phai tra"], "single"],
  ["equity", ["tong von chu so huu", "von chu so huu"], "single"],
  ["retainedEarnings", ["loi nhuan sau thue chua phan phoi", "loi nhuan chua phan phoi"], "single"],
  ["totalLiabilitiesEquity", ["tong nguon von"], "single"],
  ["bookValuePerShare", ["gia tri so sach tren co phieu", "bvps"], "single"],
];

const CASHFLOW_TARGETS: Matcher[] = [
  ["operatingCashFlow", ["luu chuyen tien thuan tu hoat dong kinh doanh"], "single"],
  ["investingCashFlow", ["luu chuyen tien thuan tu hoat dong dau tu"], "single"],
  ["financingCashFlow", ["luu chuyen tien thuan tu hoat dong tai chinh"], "single"],
  ["netChangeCash", ["luu chuyen tien thuan trong ky"], "single"],
  ["capex", ["tien chi mua sam tai san co dinh", "mua sam tai san co dinh", "chi dau tu tai san co dinh"], "sum"],
  ["dividendsPaid", ["tien tra co tuc loi nhuan da tra cho chu so huu", "co tuc loi nhuan da tra"], "sum"],
  ["depreciation", ["khau hao"], "sum"],
  ["netIncome", ["loi nhuan sau thue"], "single", ["khong kiem soat", "cong ty me", "co dong thieu so"]],
];

export function matchLines(
  lines: Array<{ name: string; value: number | null }>,
  targets: Matcher[],
  perShareFields: Set<string>,
): Record<string, number> {
  const used = new Set<number>();
  const out: Record<string, number> = {};

  for (const [field, needles, mode, excludes] of targets) {
    let acc = 0;
    let found = false;
    let matchedIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue;
      if (lines[i].value == null) continue;
      const folded = fold(lines[i].name);
      if (excludes && excludes.some((x) => folded.includes(fold(x)))) continue;
      const hit = needles.some((n) => folded.includes(fold(n)));
      if (!hit) continue;
      found = true;
      if (mode === "sum") {
        acc += lines[i].value!;
        used.add(i);
      } else {
        matchedIndex = i;
        break;
      }
    }
    if (found) {
      let outVal: number | null;
      const rawSum = mode === "sum" ? acc : lines[matchedIndex]!.value;
      if (rawSum == null) continue;
      if (perShareFields.has(field)) outVal = toPerShareThousands(rawSum);
      else outVal = toBillions(rawSum);
      if (outVal != null) out[field] = outVal;
      if (mode === "single" && matchedIndex >= 0) used.add(matchedIndex);
    }
  }

  return out;
}

/* ────────────────────────────────────────────────────────────
 * VNDirect fetch + parse
 * ──────────────────────────────────────────────────────────── */

interface VndirectRow {
  fiscalDate: string;
  itemName: string;
  itemCode: string;
  numericValue: number | null;
}

function parseRows(payload: unknown): VndirectRow[] {
  const data = (payload as Json)?.data as Json | undefined;
  const hits = data?.hits;
  if (!Array.isArray(hits)) return [];
  const out: VndirectRow[] = [];
  for (const hit of hits) {
    if (!hit || typeof hit !== "object") continue;
    const src = (hit as Json)._source as Json | undefined;
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

export function fiscalPeriod(fiscalDate: string, period: "quarterly" | "yearly"): { period: string; fiscalYear: number; quarter: number } | null {
  const m = /^(\d{4})-(\d{2})/.exec(fiscalDate);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (period === "yearly") {
    if (month !== 12) return null;
    return { period: `FY/${year}`, fiscalYear: year, quarter: 0 };
  }
  const quarter = Math.max(1, Math.min(4, Math.ceil(month / 3)));
  return { period: `Q${quarter}/${year}`, fiscalYear: year, quarter };
}

async function fetchVndirectStatement(
  symbol: string,
  type: FinancialsResponseLike["type"],
  period: "quarterly" | "yearly",
  limit: number,
): Promise<{ byFiscalDate: Map<string, Record<string, number>>; warnings: string[] }> {
  const warnings: string[] = [];
  const modelTypes = MODEL_TYPES[type];
  // Always request QUARTER; for yearly views we keep only the year-end
  // (Dec) fiscal dates, which carry the full-year cumulative figures. This is
  // more reliable than a possibly-unsupported "YEAR" reportType value.
  const reportTypes = "QUARTER";

  const now = new Date();
  const fromYear = now.getFullYear() - (limit + 3);
  const toDate = now.toISOString().slice(0, 10);
  const fromDate = `${fromYear}-01-01`;

  const url = new URL(VNDIRECT_FINFO);
  url.searchParams.set("secCodes", symbol);
  url.searchParams.set("reportTypes", reportTypes);
  url.searchParams.set("modelTypes", modelTypes);
  url.searchParams.set("fromDate", fromDate);
  url.searchParams.set("toDate", toDate);

  const perShareFields = new Set(["eps", "bookValuePerShare"]);

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
      warnings.push(`VNDirect financialStatement HTTP ${res.status}`);
      return { byFiscalDate: new Map(), warnings };
    }
    const payload = await res.json();
    const rows = parseRows(payload);
    if (rows.length === 0) {
      warnings.push("VNDirect financialStatement returned no rows");
      return { byFiscalDate: new Map(), warnings };
    }

    const targets = type === "income" ? INCOME_TARGETS : type === "balance" ? BALANCE_TARGETS : CASHFLOW_TARGETS;
    const byFiscalDate = new Map<string, Record<string, number>>();

    // Group rows by fiscal date, then map fields per period.
    const byDate = new Map<string, Array<{ name: string; value: number | null }>>();
    for (const row of rows) {
      const arr = byDate.get(row.fiscalDate) ?? [];
      arr.push({ name: row.itemName, value: row.numericValue });
      byDate.set(row.fiscalDate, arr);
    }

    for (const [date, lines] of byDate) {
      const mapped = matchLines(lines, targets, perShareFields);
      if (Object.keys(mapped).length > 0) byFiscalDate.set(date, mapped);
    }
    return { byFiscalDate, warnings };
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : "VNDirect fetch failed");
    return { byFiscalDate: new Map(), warnings };
  }
}

/* ────────────────────────────────────────────────────────────
 * Assemble financial quarters from VNDirect data
 * ──────────────────────────────────────────────────────────── */

function buildQuartersFromVndirect(
  symbol: string,
  period: "quarterly" | "yearly",
  limit: number,
  income: Map<string, Record<string, number>>,
  balance: Map<string, Record<string, number>>,
  cashflow: Map<string, Record<string, number>>,
): FinancialQuarter[] {
  const allDates = new Set([...income.keys(), ...balance.keys(), ...cashflow.keys()]);
  const quarters: FinancialQuarter[] = [];

  for (const date of allDates) {
    const fp = fiscalPeriod(date, period);
    if (!fp) continue;
    const inc = income.get(date) ?? {};
    const bal = balance.get(date) ?? {};
    const cf = cashflow.get(date) ?? {};

    const operatingCashFlow = cf.operatingCashFlow ?? null;
    const investingCashFlow = cf.investingCashFlow ?? null;
    const capex = cf.capex ?? null;
    const freeCashFlow =
      operatingCashFlow != null && investingCashFlow != null
        ? operatingCashFlow + investingCashFlow
        : operatingCashFlow != null && capex != null
          ? operatingCashFlow - capex
          : null;

    quarters.push({
      period: fp.period,
      quarter: fp.quarter,
      fiscalYear: fp.fiscalYear,
      income: {
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
        sharesOutstanding: 0,
      },
      balance: {
        cashAndEquivalents: bal.cashAndEquivalents ?? 0,
        shortTermInvestments: bal.shortTermInvestments ?? 0,
        receivables: bal.receivables ?? 0,
        inventory: bal.inventory ?? 0,
        currentAssets: bal.currentAssets ?? 0,
        fixedAssets: bal.fixedAssets ?? 0,
        longTermInvestments: bal.longTermInvestments ?? 0,
        totalAssets: bal.totalAssets ?? 0,
        currentLiabilities: bal.currentLiabilities ?? 0,
        shortTermDebt: bal.shortTermDebt,
        debtDueWithin12m: bal.debtDueWithin12m,
        longTermDebt: bal.longTermDebt ?? 0,
        totalLiabilities: bal.totalLiabilities ?? 0,
        equity: bal.equity ?? 0,
        retainedEarnings: bal.retainedEarnings ?? 0,
        totalLiabilitiesEquity: bal.totalLiabilitiesEquity ?? 0,
        bookValuePerShare: bal.bookValuePerShare ?? 0,
      },
      cashflow: {
        netIncome: cf.netIncome ?? 0,
        depreciation: cf.depreciation ?? 0,
        changeWorkingCapital: 0,
        operatingCashFlow: operatingCashFlow ?? 0,
        capex: capex ?? 0,
        investingCashFlow: investingCashFlow ?? 0,
        debtIssuance: 0,
        dividendsPaid: cf.dividendsPaid ?? 0,
        financingCashFlow: cf.financingCashFlow ?? 0,
        netChangeCash: cf.netChangeCash ?? 0,
        freeCashFlow: freeCashFlow ?? 0,
      },
    });
  }

  return quarters
    .sort((a, b) => b.fiscalYear - a.fiscalYear || b.quarter - a.quarter)
    .slice(0, limit);
}

async function loadVndirect(symbol: string, period: "quarterly" | "yearly", limit: number): Promise<{ quarters: FinancialQuarter[]; warnings: string[] }> {
  const [income, balance, cashflow] = await Promise.all([
    fetchVndirectStatement(symbol, "income", period, limit),
    fetchVndirectStatement(symbol, "balance", period, limit),
    fetchVndirectStatement(symbol, "cashflow", period, limit),
  ]);
  const warnings = [...income.warnings, ...balance.warnings, ...cashflow.warnings];
  const quarters = buildQuartersFromVndirect(symbol, period, limit, income.byFiscalDate, balance.byFiscalDate, cashflow.byFiscalDate);
  // Require at least a meaningful income + balance row to count as usable.
  const usable = quarters.filter((q) => q.income.revenue > 0 || q.balance.totalAssets > 0);
  return { quarters: usable, warnings };
}

/* ────────────────────────────────────────────────────────────
 * Vietstock fallback (public session endpoints, browser-side)
 * ──────────────────────────────────────────────────────────── */

type VsJson = Record<string, unknown>;

const VS_INCOME_TARGETS: Matcher[] = [
  ["revenue", ["doanh thu thuan", "doanh thu"], "single"],
  ["costOfGoodsSold", ["gia von hang ban", "gia von"], "single"],
  ["grossProfit", ["loi nhuan gop"], "single"],
  ["operatingExpenses", ["chi phi ban hang", "chi phi quan ly doanh nghiep", "chi phi hoat dong"], "sum"],
  ["operatingIncome", ["loi nhuan thuan tu hoat dong kinh doanh", "loi nhuan tu hoat dong kinh doanh"], "single"],
  ["interestExpense", ["chi phi lai vay", "chi phi di vay"], "single"],
  ["pretaxIncome", ["tong loi nhuan ke toan truoc thue", "tong loi nhuan truoc thue"], "single"],
  ["incomeTax", ["chi phi thue thu nhap doanh nghiep", "chi phi thue tndn hien hanh"], "single", ["hoan lai"]],
  ["netIncome", ["loi nhuan sau thue"], "single", ["khong kiem soat", "cong ty me", "co dong thieu so"]],
  ["ebitda", ["ebitda"], "single"],
  ["eps", ["lai co ban tren co phieu"], "single"],
];

const VS_BALANCE_TARGETS: Matcher[] = [
  ["cashAndEquivalents", ["tien va cac khoan tuong duong tien", "tien va tuong duong tien"], "single"],
  ["shortTermInvestments", ["dau tu tai chinh ngan han", "dau tu ngan han"], "single"],
  ["receivables", ["cac khoan phai thu ngan han", "phai thu ngan han"], "sum"],
  ["inventory", ["hang ton kho"], "single"],
  ["currentAssets", ["tong tai san ngan han", "tai san ngan han"], "single"],
  ["fixedAssets", ["tai san co dinh"], "single"],
  ["totalAssets", ["tong tai san"], "single"],
  ["currentLiabilities", ["no ngan han"], "single"],
  ["shortTermDebt", ["vay va no thue tai chinh ngan han", "no ngan han den han"], "single"],
  ["debtDueWithin12m", ["vay va no thue tai chinh ngan han", "no ngan han den han"], "single"],
  ["longTermDebt", ["vay va no thue tai chinh dai han", "no dai han"], "single"],
  ["totalLiabilities", ["tong no phai tra"], "single"],
  ["equity", ["tong von chu so huu", "von chu so huu"], "single"],
  ["retainedEarnings", ["loi nhuan sau thue chua phan phoi"], "single"],
  ["totalLiabilitiesEquity", ["tong nguon von"], "single"],
  ["bookValuePerShare", ["gia tri so sach tren co phieu", "bvps"], "single"],
];

const VS_CASHFLOW_TARGETS: Matcher[] = [
  ["operatingCashFlow", ["luu chuyen tien thuan tu hoat dong kinh doanh"], "single"],
  ["investingCashFlow", ["luu chuyen tien thuan tu hoat dong dau tu"], "single"],
  ["financingCashFlow", ["luu chuyen tien thuan tu hoat dong tai chinh"], "single"],
  ["netChangeCash", ["luu chuyen tien thuan trong ky"], "single"],
  ["capex", ["tien chi mua sam tai san co dinh", "chi dau tu tai san co dinh"], "sum"],
  ["dividendsPaid", ["tien tra co tuc loi nhuan da tra cho chu so huu"], "sum"],
  ["depreciation", ["khau hao"], "sum"],
  ["netIncome", ["loi nhuan sau thue"], "single", ["khong kiem soat", "cong ty me", "co dong thieu so"]],
];

function vsRowsFrom(payload: unknown): VsJson[] {
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === "object") as VsJson[];
  if (payload && typeof payload === "object") {
    const obj = payload as VsJson;
    for (const key of ["data", "Data", "items", "Items", "list", "List", "result", "Result"]) {
      const v = obj[key];
      if (Array.isArray(v)) return v.filter((x) => x && typeof x === "object") as VsJson[];
    }
  }
  return [];
}

function vsPeriod(row: VsJson, period: "quarterly" | "yearly"): { fiscalDate: string; quarter: number; year: number } | null {
  const num = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const p = Number(v.replace(/,/g, ""));
      return Number.isFinite(p) ? p : null;
    }
    return null;
  };
  const year = num(row.Year ?? row.year ?? row.Nam ?? row.fiscalYear);
  const quarter = num(row.Quarter ?? row.quarter ?? row.Quy ?? row.TermCode);
  if (year != null && quarter != null && quarter >= 1 && quarter <= 4) {
    const month = quarter * 3;
    const day = month === 12 ? 31 : month === 9 ? 30 : month === 6 ? 30 : 31;
    return { fiscalDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, quarter, year };
  }
  if (year != null && period === "yearly") {
    return { fiscalDate: `${year}-12-31`, quarter: 0, year };
  }
  const label = String(row.PeriodName ?? row.Period ?? row.period ?? "");
  const qm = label.match(/Q\s*([1-4])[^0-9]*(20\d{2})/i) || label.match(/(20\d{2})[^0-9]*Q\s*([1-4])/i);
  if (qm) {
    const q = qm[1].length === 1 ? Number(qm[1]) : Number(qm[2]);
    const y = qm[1].length === 1 ? Number(qm[2]) : Number(qm[1]);
    const month = q * 3;
    const day = month === 12 ? 31 : month === 9 ? 30 : month === 6 ? 30 : 31;
    return { fiscalDate: `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, quarter: q, year: y };
  }
  return null;
}

async function loadVietstock(symbol: string, period: "quarterly" | "yearly", limit: number): Promise<{ quarters: FinancialQuarter[]; warnings: string[] }> {
  const warnings: string[] = [];
  const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  try {
    const base = `https://finance.vietstock.vn/${encodeURIComponent(symbol)}/tai-chinh.htm?tab=BCTT`;
    const sessionRes = await fetch(base, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      cache: "no-store",
      redirect: "follow",
      credentials: "include",
    });
    const setCookie = sessionRes.headers.getSetCookie?.() ?? [];
    const raw = sessionRes.headers.get("set-cookie") ?? "";
    const cookieParts: string[] = setCookie.length
      ? setCookie.map((c) => c.split(";")[0])
      : raw
          .split(/,(?=[^;]+?=)/)
          .map((c) => c.split(";")[0].trim())
          .filter(Boolean);
    const cookie = cookieParts.join("; ");
    const token = /__RequestVerificationToken=([^;]+)/.exec(cookie)?.[1] ?? "";

    const paths = [
      "/data/GetListReportNorm_KQKD_ByStockCode",
      "/data/GetListReportNorm_CDKT_ByStockCode",
      "/data/GetListReportNorm_LCTT_ByStockCode",
    ];
    const collected: VsJson[] = [];
    for (const path of paths) {
      const form = new URLSearchParams({ stockCode: symbol, code: symbol, StockCode: symbol });
      if (token) form.set("__RequestVerificationToken", token);
      try {
        const res = await fetch(`https://finance.vietstock.vn${path}`, {
          method: "POST",
          headers: {
            "User-Agent": UA,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            RequestVerificationToken: token,
            Origin: "https://finance.vietstock.vn",
            Referer: "https://finance.vietstock.vn/",
            Accept: "application/json, text/javascript, */*; q=0.01",
            Cookie: cookie,
          },
          body: form,
          cache: "no-store",
          credentials: "include",
          signal: AbortSignal.timeout(12000),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`Vietstock HTTP ${res.status}`);
        if (text.trimStart().startsWith("<") || text.includes("<!DOCTYPE")) throw new Error("Vietstock returned HTML");
        collected.push(...vsRowsFrom(JSON.parse(text)));
      } catch (e) {
        warnings.push(`${path}: ${e instanceof Error ? e.message : "fail"}`);
      }
    }

    const byFiscalDate = new Map<string, { income: Record<string, number>; balance: Record<string, number>; cashflow: Record<string, number> }>();
    const perShare = new Set(["eps", "bookValuePerShare"]);
    for (const row of collected) {
      const p = vsPeriod(row, period);
      if (!p) continue;
      const entry = byFiscalDate.get(p.fiscalDate) ?? { income: {}, balance: {}, cashflow: {} };
      const segment = row.Segment ?? row.ModelType;
      const isIncome = /kqkd|income|doanh thu|loi nhuan/i.test(String(segment));
      const isBalance = /cdkt|balance|cân đối/i.test(String(segment));
      const mapped = matchLines(
        Object.entries(row).map(([k, v]) => ({ name: k, value: asNumber(v) })),
        isIncome ? VS_INCOME_TARGETS : isBalance ? VS_BALANCE_TARGETS : VS_CASHFLOW_TARGETS,
        perShare,
      );
      if (Object.keys(mapped).length === 0) continue;
      if (isIncome) entry.income = { ...entry.income, ...mapped };
      else if (isBalance) entry.balance = { ...entry.balance, ...mapped };
      else entry.cashflow = { ...entry.cashflow, ...mapped };
      byFiscalDate.set(p.fiscalDate, entry);
    }

    const quarters: FinancialQuarter[] = [];
    for (const [date, e] of byFiscalDate) {
      const fp = fiscalPeriod(date, period);
      if (!fp) continue;
      const ocf = e.cashflow.operatingCashFlow ?? null;
      const inv = e.cashflow.investingCashFlow ?? null;
      const capex = e.cashflow.capex ?? null;
      quarters.push({
        period: fp.period,
        quarter: fp.quarter,
        fiscalYear: fp.fiscalYear,
        income: {
          revenue: e.income.revenue ?? 0,
          costOfGoodsSold: e.income.costOfGoodsSold ?? 0,
          grossProfit: e.income.grossProfit ?? 0,
          operatingExpenses: e.income.operatingExpenses ?? 0,
          operatingIncome: e.income.operatingIncome ?? 0,
          interestExpense: e.income.interestExpense ?? 0,
          otherIncome: e.income.otherIncome ?? 0,
          pretaxIncome: e.income.pretaxIncome ?? 0,
          incomeTax: e.income.incomeTax ?? 0,
          netIncome: e.income.netIncome ?? 0,
          ebitda: e.income.ebitda ?? 0,
          depreciation: e.income.depreciation ?? 0,
          eps: e.income.eps ?? 0,
          sharesOutstanding: 0,
        },
        balance: {
          cashAndEquivalents: e.balance.cashAndEquivalents ?? 0,
          shortTermInvestments: e.balance.shortTermInvestments ?? 0,
          receivables: e.balance.receivables ?? 0,
          inventory: e.balance.inventory ?? 0,
          currentAssets: e.balance.currentAssets ?? 0,
          fixedAssets: e.balance.fixedAssets ?? 0,
          longTermInvestments: e.balance.longTermInvestments ?? 0,
          totalAssets: e.balance.totalAssets ?? 0,
          currentLiabilities: e.balance.currentLiabilities ?? 0,
          shortTermDebt: e.balance.shortTermDebt,
          debtDueWithin12m: e.balance.debtDueWithin12m,
          longTermDebt: e.balance.longTermDebt ?? 0,
          totalLiabilities: e.balance.totalLiabilities ?? 0,
          equity: e.balance.equity ?? 0,
          retainedEarnings: e.balance.retainedEarnings ?? 0,
          totalLiabilitiesEquity: e.balance.totalLiabilitiesEquity ?? 0,
          bookValuePerShare: e.balance.bookValuePerShare ?? 0,
        },
        cashflow: {
          netIncome: e.cashflow.netIncome ?? 0,
          depreciation: e.cashflow.depreciation ?? 0,
          changeWorkingCapital: 0,
          operatingCashFlow: ocf ?? 0,
          capex: capex ?? 0,
          investingCashFlow: inv ?? 0,
          debtIssuance: 0,
          dividendsPaid: e.cashflow.dividendsPaid ?? 0,
          financingCashFlow: e.cashflow.financingCashFlow ?? 0,
          netChangeCash: e.cashflow.netChangeCash ?? 0,
          freeCashFlow:
            ocf != null && inv != null ? ocf + inv : ocf != null && capex != null ? ocf - capex : 0,
        },
      });
    }

    return {
      quarters: quarters.sort((a, b) => b.fiscalYear - a.fiscalYear || b.quarter - a.quarter).slice(0, limit),
      warnings,
    };
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : "Vietstock fetch failed");
    return { quarters: [], warnings };
  }
}

/* ────────────────────────────────────────────────────────────
 * Public API + module cache
 * ──────────────────────────────────────────────────────────── */

const cache = new Map<string, Promise<LiveFinancialsData>>();

export function loadLiveFinancialData(symbol: string, period: "quarterly" | "yearly", limit = 8): Promise<LiveFinancialsData> {
  const key = `${symbol}:${period}:${limit}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const vnd = await loadVndirect(symbol, period, limit);
    if (vnd.quarters.length > 0) {
      return { symbol, quarters: vnd.quarters, source: "vndirect" as const, warnings: vnd.warnings };
    }
    const vs = await loadVietstock(symbol, period, limit);
    if (vs.quarters.length > 0) {
      return { symbol, quarters: vs.quarters, source: "vietstock" as const, warnings: vs.warnings };
    }
    return { symbol, quarters: [], source: null, warnings: [...vnd.warnings, ...vs.warnings] };
  })();
  cache.set(key, promise);
  return promise;
}

const STATEMENT_FIELDS: Record<FinancialsResponseLike["type"], string[]> = {
  income: ["revenue", "costOfGoodsSold", "grossProfit", "operatingExpenses", "operatingIncome", "interestExpense", "otherIncome", "pretaxIncome", "incomeTax", "netIncome", "ebitda", "eps"],
  balance: ["cashAndEquivalents", "shortTermInvestments", "receivables", "inventory", "currentAssets", "fixedAssets", "longTermInvestments", "totalAssets", "currentLiabilities", "longTermDebt", "totalLiabilities", "equity", "retainedEarnings", "totalLiabilitiesEquity", "bookValuePerShare"],
  cashflow: ["netIncome", "depreciation", "changeWorkingCapital", "operatingCashFlow", "capex", "investingCashFlow", "debtIssuance", "dividendsPaid", "financingCashFlow", "netChangeCash", "freeCashFlow"],
};

export function quartersToResponse(
  symbol: string,
  type: FinancialsResponseLike["type"],
  quarters: FinancialQuarter[],
  source: "vndirect" | "vietstock" | null,
  warnings: string[],
): FinancialsResponseLike {
  const fields = STATEMENT_FIELDS[type];
  const periods = quarters.map((q) => ({
    period: q.period,
    fiscalYear: q.fiscalYear,
    data: q[type] as unknown as Record<string, number>,
  }));
  const present = fields.filter((f) => periods.some((p) => typeof p.data[f] === "number" && Math.abs(p.data[f]) > 0));
  return { symbol, type, periods, fields: present, liveSource: source, warnings };
}

export async function loadLiveFinancialsResponse(
  symbol: string,
  type: FinancialsResponseLike["type"],
  period: "quarterly" | "yearly",
  limit = 8,
): Promise<FinancialsResponseLike> {
  const data = await loadLiveFinancialData(symbol, period, limit);
  return quartersToResponse(symbol, type, data.quarters, data.source, data.warnings);
}
