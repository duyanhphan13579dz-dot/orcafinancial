/**
 * CafeF financial statements client — authorized CAFEF_DATA_URL feed.
 */

export interface CafefQuarter {
  period: string;
  fiscalYear: number;
  income: Record<string, number>;
  balance: Record<string, number>;
  cashflow: Record<string, number>;
}

export interface CafefFinancialImport {
  symbol: string;
  source: "cafef";
  sourceUrl: string;
  quarters: CafefQuarter[];
  warnings: string[];
}

type Json = Record<string, unknown>;

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(/,/g, "")))) {
    return Number(v.replace(/,/g, ""));
  }
  return undefined;
}

function parsePeriod(row: Json): { period: string; fiscalYear: number } | null {
  const year = num(row.year ?? row.Year ?? row.fiscalYear);
  const quarter = num(row.quarter ?? row.Quarter);
  if (year != null && quarter != null && quarter >= 1 && quarter <= 4) {
    return { period: `Q${quarter}/${year}`, fiscalYear: year };
  }
  const label = String(row.period ?? row.Period ?? "");
  const qm = label.match(/Q\s*([1-4])[^\d]*(20\d{2})/i);
  if (qm) return { period: `Q${qm[1]}/${qm[2]}`, fiscalYear: Number(qm[2]) };
  const ym = label.match(/(20\d{2})/);
  if (ym) return { period: `FY/${ym[1]}`, fiscalYear: Number(ym[1]) };
  return null;
}

function rowsFrom(payload: unknown): Json[] {
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === "object") as Json[];
  if (payload && typeof payload === "object") {
    const obj = payload as Json;
    for (const key of ["data", "Data", "items", "list", "result"]) {
      const v = obj[key];
      if (Array.isArray(v)) return v.filter((x) => x && typeof x === "object") as Json[];
    }
  }
  return [];
}

const METRIC_MAP: Record<string, string> = {
  revenue: "revenue",
  netRevenue: "revenue",
  netIncome: "netIncome",
  netProfit: "netIncome",
  grossProfit: "grossProfit",
  totalAssets: "totalAssets",
  equity: "equity",
  totalLiabilities: "totalLiabilities",
  operatingCashFlow: "operatingCashFlow",
  freeCashFlow: "freeCashFlow",
  eps: "eps",
};

export async function fetchCafefFinancialStatements(
  symbol: string,
  limit = 8,
): Promise<CafefFinancialImport> {
  const sym = symbol.toUpperCase();
  const warnings: string[] = [];
  const endpoint = process.env.CAFEF_DATA_URL?.trim();
  if (!endpoint) {
    return {
      symbol: sym,
      source: "cafef",
      sourceUrl: `https://s.cafef.vn/hose/${sym}.chn`,
      quarters: [],
      warnings: ["CafeF: chưa cấu hình CAFEF_DATA_URL"],
    };
  }
  try {
    const url = new URL(endpoint);
    url.searchParams.set("symbol", sym);
    url.searchParams.set("limit", String(limit));
    const headers: Record<string, string> = { accept: "application/json" };
    const token = process.env.CAFEF_DATA_TOKEN?.trim();
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) throw new Error(`CafeF HTTP ${res.status}`);
    const payload = (await res.json()) as unknown;
    const byPeriod = new Map<string, CafefQuarter>();
    for (const row of rowsFrom(payload)) {
      const p = parsePeriod(row);
      if (!p) continue;
      const q = byPeriod.get(p.period) ?? {
        period: p.period,
        fiscalYear: p.fiscalYear,
        income: {},
        balance: {},
        cashflow: {},
      };
      for (const [src, dest] of Object.entries(METRIC_MAP)) {
        const v = num(row[src] ?? row[src.charAt(0).toUpperCase() + src.slice(1)]);
        if (v == null) continue;
        if (["totalAssets", "equity", "totalLiabilities"].includes(dest)) q.balance[dest] = v;
        else if (["operatingCashFlow", "freeCashFlow"].includes(dest)) q.cashflow[dest] = v;
        else q.income[dest] = v;
      }
      byPeriod.set(p.period, q);
    }
    const quarters = [...byPeriod.values()]
      .filter((q) => Object.keys(q.income).length + Object.keys(q.balance).length > 0)
      .sort((a, b) => b.fiscalYear - a.fiscalYear || b.period.localeCompare(a.period))
      .slice(0, limit);
    return {
      symbol: sym,
      source: "cafef",
      sourceUrl: url.toString(),
      quarters,
      warnings: quarters.length ? [] : ["CafeF returned no parseable quarters"],
    };
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : "cafef failed");
    return {
      symbol: sym,
      source: "cafef",
      sourceUrl: `https://s.cafef.vn/hose/${sym}.chn`,
      quarters: [],
      warnings,
    };
  }
}
