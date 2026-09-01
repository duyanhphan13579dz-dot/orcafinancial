/**
 * Vietstock public financial statements client.
 * Priority tier: VERIFIED_PROVIDER (after official filing / TCBS when configured).
 *
 * Uses finance.vietstock.vn session + antiforgery cookie to call report endpoints.
 * When endpoints require paid DataFeed, set VIETSTOCK_DATAFEED_URL + TOKEN instead.
 */

export interface VietstockQuarter {
  period: string;
  fiscalYear: number;
  income: Record<string, number>;
  balance: Record<string, number>;
  cashflow: Record<string, number>;
}

export interface VietstockFinancialImport {
  symbol: string;
  source: "vietstock";
  sourceUrl: string;
  quarters: VietstockQuarter[];
  warnings: string[];
}

type Json = Record<string, unknown>;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const INCOME_ALIASES: Record<string, string[]> = {
  revenue: ["Revenue", "NetRevenue", "DoanhThuThuan", "NetSales", "Sales"],
  costOfGoodsSold: ["COGS", "CostOfGoodsSold", "GiaVon"],
  grossProfit: ["GrossProfit", "LoiNhuanGop"],
  operatingExpenses: ["OperatingExpense", "OperatingExpenses", "ChiPhiHoatDong"],
  operatingIncome: ["OperatingProfit", "EBIT", "LoiNhuanTuHDKD"],
  interestExpense: ["InterestExpense", "ChiPhiLaiVay"],
  pretaxIncome: ["ProfitBeforeTax", "PretaxIncome", "LNTT"],
  incomeTax: ["IncomeTax", "CorporateIncomeTax", "ThueTNDN"],
  netIncome: ["NetProfit", "NetIncome", "LoiNhuanSauThue", "PAT"],
  ebitda: ["EBITDA"],
  eps: ["EPS", "BasicEPS"],
};

const BALANCE_ALIASES: Record<string, string[]> = {
  cashAndEquivalents: ["Cash", "CashAndCashEquivalents", "TienVaTuongDuongTien"],
  totalAssets: ["TotalAssets", "TongTaiSan", "Assets"],
  totalLiabilities: ["TotalLiabilities", "TongNo", "Liabilities"],
  equity: ["Equity", "OwnerEquity", "VonChuSoHuu"],
  currentAssets: ["CurrentAssets", "TaiSanNganHan"],
  currentLiabilities: ["CurrentLiabilities", "NoNganHan"],
  longTermDebt: ["LongTermDebt", "NoDaiHan"],
  retainedEarnings: ["RetainedEarnings", "LoiNhuanGiuLai"],
  bookValuePerShare: ["BookValuePerShare", "BVPS"],
};

const CASHFLOW_ALIASES: Record<string, string[]> = {
  operatingCashFlow: ["OperatingCashFlow", "CFO", "LuuChuyenTienTuHDKD"],
  investingCashFlow: ["InvestingCashFlow", "CFI"],
  financingCashFlow: ["FinancingCashFlow", "CFF"],
  freeCashFlow: ["FreeCashFlow", "FCF"],
  capex: ["Capex", "CapitalExpenditure"],
  netChangeCash: ["NetChangeInCash", "BienDongTienThuan"],
};

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(/,/g, "")))) {
    return Number(v.replace(/,/g, ""));
  }
  return undefined;
}

function pick(row: Json, aliases: string[]): number | undefined {
  for (const key of aliases) {
    if (key in row) {
      const v = num(row[key]);
      if (v != null) return v;
    }
  }
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
  const year = num(row.Year ?? row.year ?? row.FiscalYear ?? row.fiscalYear);
  const quarter = num(row.Quarter ?? row.quarter ?? row.Q ?? row.TermCode);
  if (year != null && quarter != null && quarter >= 1 && quarter <= 4) {
    return { period: `Q${quarter}/${year}`, fiscalYear: year };
  }
  if (year != null && (row.IsYear === true || row.PeriodType === "Y" || row.ReportType === "Year")) {
    return { period: `FY/${year}`, fiscalYear: year };
  }
  const label = String(row.PeriodName ?? row.Period ?? row.period ?? "");
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

async function openSession(symbol: string): Promise<{ cookie: string; token: string }> {
  const res = await fetch(`https://finance.vietstock.vn/${encodeURIComponent(symbol)}/tai-chinh.htm?tab=BCTT`, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    cache: "no-store",
    redirect: "follow",
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const raw = res.headers.get("set-cookie") ?? "";
  const cookieParts: string[] = setCookie.length
    ? setCookie.map((c) => c.split(";")[0])
    : raw
        .split(/,(?=[^;]+?=)/)
        .map((c) => c.split(";")[0].trim())
        .filter(Boolean);
  const cookie = cookieParts.join("; ");
  const tokenMatch = cookie.match(/__RequestVerificationToken=([^;]+)/);
  const token = tokenMatch?.[1] ?? "";
  return { cookie, token };
}

async function postForm(
  path: string,
  form: Record<string, string>,
  session: { cookie: string; token: string },
): Promise<unknown> {
  const body = new URLSearchParams({ ...form });
  if (session.token) body.set("__RequestVerificationToken", session.token);
  const res = await fetch(`https://finance.vietstock.vn${path}`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      RequestVerificationToken: session.token,
      Origin: "https://finance.vietstock.vn",
      Referer: "https://finance.vietstock.vn/",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Cookie: session.cookie,
    },
    body,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vietstock HTTP ${res.status}`);
  if (text.trimStart().startsWith("<") || text.includes("<!DOCTYPE")) {
    throw new Error("Vietstock returned HTML (session/permission blocked)");
  }
  return JSON.parse(text) as unknown;
}

function rowsFrom(payload: unknown): Json[] {
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === "object") as Json[];
  if (payload && typeof payload === "object") {
    const obj = payload as Json;
    for (const key of ["data", "Data", "items", "Items", "list", "List", "result", "Result"]) {
      const v = obj[key];
      if (Array.isArray(v)) return v.filter((x) => x && typeof x === "object") as Json[];
    }
  }
  return [];
}

async function fetchViaDatafeed(symbol: string, limit: number): Promise<VietstockFinancialImport | null> {
  const endpoint = process.env.VIETSTOCK_DATAFEED_URL?.trim();
  if (!endpoint) return null;
  const url = new URL(endpoint);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("limit", String(limit));
  const headers: Record<string, string> = { accept: "application/json" };
  const token = process.env.VIETSTOCK_DATAFEED_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`Vietstock datafeed HTTP ${res.status}`);
  const payload = (await res.json()) as unknown;
  const rows = rowsFrom(payload);
  const quarters = rows
    .map((row) => {
      const p = parsePeriod(row);
      if (!p) return null;
      return {
        period: p.period,
        fiscalYear: p.fiscalYear,
        income: mapSection(row, INCOME_ALIASES),
        balance: mapSection(row, BALANCE_ALIASES),
        cashflow: mapSection(row, CASHFLOW_ALIASES),
      } satisfies VietstockQuarter;
    })
    .filter(Boolean) as VietstockQuarter[];
  return {
    symbol: symbol.toUpperCase(),
    source: "vietstock",
    sourceUrl: url.toString(),
    quarters: quarters.slice(0, limit),
    warnings: quarters.length ? [] : ["Vietstock datafeed returned no parseable quarters"],
  };
}

export async function fetchVietstockFinancialStatements(
  symbol: string,
  limit = 8,
): Promise<VietstockFinancialImport> {
  const sym = symbol.toUpperCase();
  const warnings: string[] = [];

  try {
    const viaFeed = await fetchViaDatafeed(sym, limit);
    if (viaFeed && viaFeed.quarters.length > 0) return viaFeed;
    if (viaFeed) warnings.push(...viaFeed.warnings);
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : "datafeed failed");
  }

  try {
    const session = await openSession(sym);
    const paths = [
      "/data/GetListReportNorm_KQKD_ByStockCode",
      "/data/KQKD_GetListReportData",
      "/data/GetListReportNorm_CDKT_ByStockCode",
      "/data/GetListReportNorm_LCTT_ByStockCode",
    ];
    const collected: Json[] = [];
    for (const path of paths) {
      try {
        const payload = await postForm(path, { stockCode: sym, code: sym, StockCode: sym }, session);
        collected.push(...rowsFrom(payload));
      } catch (e) {
        warnings.push(`${path}: ${e instanceof Error ? e.message : "fail"}`);
      }
    }

    const byPeriod = new Map<string, VietstockQuarter>();
    for (const row of collected) {
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
    const quarters = [...byPeriod.values()]
      .filter((q) => Object.keys(q.income).length + Object.keys(q.balance).length > 0)
      .sort((a, b) => b.fiscalYear - a.fiscalYear || b.period.localeCompare(a.period))
      .slice(0, limit);

    return {
      symbol: sym,
      source: "vietstock",
      sourceUrl: `https://finance.vietstock.vn/${sym}/tai-chinh.htm`,
      quarters,
      warnings,
    };
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : "vietstock session failed");
    return {
      symbol: sym,
      source: "vietstock",
      sourceUrl: `https://finance.vietstock.vn/${sym}/tai-chinh.htm`,
      quarters: [],
      warnings,
    };
  }
}
