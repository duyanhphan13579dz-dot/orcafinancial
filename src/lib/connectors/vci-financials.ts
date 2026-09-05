/**
 * VCI financial statements client.
 *
 * Unlike vndirect-financials.ts / cafef-financials.ts (which point at a raw
 * vendor feed and have to guess field-name aliases), this connector talks to
 * our OWN bridge service (see python-bridge/vci_financials.py). That bridge
 * wraps the `vnstock` library's VCI source and already maps VCI's dynamic
 * `item_en` labels into the canonical field names used across this repo
 * (revenue, netIncome, totalAssets, ...). So this file only needs to
 * validate/coerce types, not re-implement alias matching.
 *
 * Configure with VCI_DATAFEED_URL pointing at the bridge, e.g.
 *   https://your-python-service.example.com/internal/financials
 * Optional VCI_DATAFEED_TOKEN is sent as `x-internal-token`.
 */

export interface VciQuarter {
  period: string; // "Q1/2025" or "FY/2024"
  fiscalYear: number;
  income: Record<string, number>;
  balance: Record<string, number>;
  cashflow: Record<string, number>;
}

export interface VciFinancialImport {
  symbol: string;
  source: "vci";
  sourceUrl: string;
  quarters: VciQuarter[];
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

function numericSection(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Json)) {
    const n = num(raw);
    if (n != null) out[key] = n;
  }
  return out;
}

function isValidPeriod(period: unknown): period is string {
  return typeof period === "string" && /^(Q[1-4]|FY)\/\d{4}$/i.test(period.trim());
}

function quartersFromPayload(payload: unknown, limit: number): VciQuarter[] {
  const root = payload && typeof payload === "object" ? (payload as Json) : {};
  const rawQuarters = Array.isArray(root.quarters) ? root.quarters : [];
  const quarters: VciQuarter[] = [];
  for (const item of rawQuarters) {
    if (!item || typeof item !== "object") continue;
    const row = item as Json;
    if (!isValidPeriod(row.period)) continue;
    const fiscalYear = num(row.fiscalYear) ?? Number(String(row.period).slice(-4));
    if (!Number.isFinite(fiscalYear)) continue;
    const income = numericSection(row.income);
    const balance = numericSection(row.balance);
    const cashflow = numericSection(row.cashflow);
    if (Object.keys(income).length + Object.keys(balance).length + Object.keys(cashflow).length === 0) continue;
    quarters.push({ period: String(row.period), fiscalYear, income, balance, cashflow });
  }
  return quarters
    .sort((a, b) => b.fiscalYear - a.fiscalYear || b.period.localeCompare(a.period))
    .slice(0, limit);
}

export async function fetchVciFinancialStatements(
  symbol: string,
  limit = 8,
): Promise<VciFinancialImport> {
  const sym = symbol.toUpperCase();
  const warnings: string[] = [];

  const endpoint = process.env.VCI_DATAFEED_URL?.trim();
  if (endpoint) {
    try {
      const url = new URL(endpoint.replace(/\/$/, "") + "/" + encodeURIComponent(sym));
      url.searchParams.set("limit", String(limit));
      const headers: Record<string, string> = { accept: "application/json" };
      const token = process.env.VCI_DATAFEED_TOKEN?.trim();
      if (token) headers["x-internal-token"] = token;
      const res = await fetch(url, { headers, cache: "no-store" });
      if (!res.ok) throw new Error(`VCI bridge HTTP ${res.status}`);
      const payload = (await res.json()) as unknown;
      const bridgeWarnings = Array.isArray((payload as Json)?.warnings)
        ? ((payload as Json).warnings as unknown[]).map(String)
        : [];
      const quarters = quartersFromPayload(payload, limit);
      return {
        symbol: sym,
        source: "vci",
        sourceUrl: url.toString(),
        quarters,
        warnings: quarters.length ? bridgeWarnings : [...bridgeWarnings, "VCI bridge returned no parseable quarters"],
      };
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : "vci bridge failed");
    }
  } else {
    warnings.push("VCI: chưa cấu hình VCI_DATAFEED_URL");
  }

  return {
    symbol: sym,
    source: "vci",
    sourceUrl: `https://mickey.vietcap.com.vn/company/${sym}`,
    quarters: [],
    warnings,
  };
}
