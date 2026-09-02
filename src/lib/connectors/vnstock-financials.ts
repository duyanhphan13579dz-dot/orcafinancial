/**
 * Vnstock (vnstocks.com free tier) financial statements client.
 *
 * ⚠ ARCHITECTURE NOTE — read before editing:
 *
 * vnstocks.com is NOT a hosted data REST API. It is:
 *   1. the `vnstock` Python library, which fetches market & financial data by
 *      calling the PUBLISHER / broker feeds directly (KBS `kbbuddywts.kbsec.com.vn`,
 *      VCI `iq.vietcap.com.vn` / `trading.vietcap.com.vn`); and
 *   2. the `vnai` package, which is a LICENSING / rate-limit / telemetry layer.
 *      `vnai` stores your `vnstock_...` key, registers your device at
 *      `https://vnstocks.com/api/vnstock/auth/device-register`, syncs usage to
 *      `hq.vnstocks.com/analytics`, and monkey-patches vnstock's Finance/Quote
 *      methods to cap periods by tier (Community/free = 8 periods). It does NOT
 *      proxy any stock or financial data, and it NEVER forwards your key to the
 *      broker feeds (the brokers accept no vnstock key).
 *
 * Consequently, the only faithful way for this Next.js (TypeScript) app to
 * consume "vnstocks.com free tier" data is to REPLICATE the underlying broker
 * feed HTTP calls that vnstock issues, using browser-like headers. That is what
 * this module does. `VNSTOCKS_API_KEY` is kept as a config token used only to
 * (a) signal "free tier" so we cap periods at 8 like the Community tier, and
 * (b) optionally register the device for the vnstocks backend (best-effort,
 * non-fatal). It is NEVER sent to the KBS/VCI feeds.
 *
 * Wire order (high → low priority), matching the existing financial pipeline:
 *   vnstock/vci  →  vnstock/kbs  →  vndirect  →  vietstock.
 *
 * The broker feeds do not send permissive CORS headers, so like VNDirect the
 * browser cannot read them cross-origin. This module therefore returns real data
 * only when run server-side (Next.js route handler on Vercel, which has outbound
 * internet) or from a same-origin proxy. In the local sandbox host there is no
 * outbound internet, so validation is fixture-based (see the `.test.ts`).
 */

import {
  BALANCE_TARGETS,
  CASHFLOW_TARGETS,
  INCOME_TARGETS,
  asNumber,
  fold,
  matchLines,
} from "@/lib/connectors/live-financials-client";

/* ────────────────────────────────────────────────────────────
 * Config / environment
 * ──────────────────────────────────────────────────────────── */

const VCI_BASE =
  process.env.VNSTOCKS_VCI_BASE_URL?.trim() ||
  "https://iq.vietcap.com.vn/api/iq-insight-service";
const KBS_FINANCE_INFO_URL =
  process.env.VNSTOCKS_KBS_FINANCE_URL?.trim() ||
  "https://kbbuddywts.kbsec.com.vn/iis-server/investment/stock/finance-info";

// Community (free) tier caps financial-report periods at 8; Guest caps at 4.
export const VNSTOCK_FREE_TIER_MAX_PERIODS = 8;
export const VNSTOCK_GUEST_MAX_PERIODS = 4;

function maxPeriods(): number {
  const hasKey = Boolean(process.env.VNSTOCKS_API_KEY?.trim());
  return hasKey ? VNSTOCK_FREE_TIER_MAX_PERIODS : VNSTOCK_GUEST_MAX_PERIODS;
}

/** Browser-mimicking headers — mirrors what vnstock's `get_headers()` builds. */
function vciHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Referer: "https://trading.vietcap.com.vn/",
    Origin: "https://trading.vietcap.com.vn",
  };
  return headers;
}

function kbsHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Referer: "https://www.kbsec.com.vn/",
    Origin: "https://www.kbsec.com.vn",
  };
  return headers;
}

/* ────────────────────────────────────────────────────────────
 * Shared output types
 * ──────────────────────────────────────────────────────────── */

export interface VnstockQuarter {
  period: string;
  fiscalYear: number;
  income: Record<string, number>;
  balance: Record<string, number>;
  cashflow: Record<string, number>;
}

export interface VnstockFinancialImport {
  symbol: string;
  source: "vnstock-vci" | "vnstock-kbs";
  sourceName: string;
  sourceUrl: string;
  quarters: VnstockQuarter[];
  warnings: string[];
}

type Json = Record<string, unknown>;

/* ────────────────────────────────────────────────────────────
 * Blocking fetch that never throws — mirrors the repo convention.
 * ──────────────────────────────────────────────────────────── */

async function getJson(url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, body: null };
    if (text.trimStart().startsWith("<")) return { ok: false, status: res.status, body: null };
    try {
      return { ok: true, status: res.status, body: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, status: res.status, body: null };
    }
  } catch (e) {
    return { ok: false, status: 0, body: null };
  }
}

/* ────────────────────────────────────────────────────────────
 * VCI (Vietcap IQ) — the primary & reliable vnstock source.
 * Response schema (verified against the live feed):
 *   GET {VCI_BASE}/v1/company/{symbol}/financial-statement?section=BALANCE_SHEET
 *     → { data: { years: [{ yearReport, lengthReport, publicDate, <codedField>… }],
 *                 quarters: [{ ... }] } }
 *   GET {VCI_BASE}/v1/company/{symbol}/financial-statement/metrics
 *     → { data: { BALANCE_SHEET: [ { field, titleEn, titleVi, parent, level } ], … } }
 * `lengthReport`: 5 = fullyear, 1..4 = quarter; `yearReport` = fiscal year.
 * Values are raw VND.
 * ──────────────────────────────────────────────────────────── */

const VCI_SECTIONS = {
  income: "INCOME_STATEMENT",
  balance: "BALANCE_SHEET",
  cashflow: "CASH_FLOW",
} as const;

type VciStatementType = keyof typeof VCI_SECTIONS;

interface VciMetricsEntry {
  field: string;
  titleVi: string;
  titleEn: string;
  fullTitleVi?: string;
  fullTitleEn?: string;
  parent: string | null;
  level: number;
}

/** Expand common Viet financial abbreviations so VCI's short labels match the
 * app's Vietnamese statement matchers (e.g. "HĐKD" → "hoạt động kinh doanh"). */
const VI_ABBREVIATIONS: Record<string, string> = {
  HĐKD: "hoạt động kinh doanh",
  HDKD: "hoạt động kinh doanh",
  TSCĐ: "tài sản cố định",
  TSCD: "tài sản cố định",
  TSNH: "tài sản ngắn hạn",
  NNH: "nợ ngắn hạn",
  LNST: "lợi nhuận sau thuế",
  LNTT: "lợi nhuận trước thuế",
  VCSH: "vốn chủ sở hữu",
  CĐKT: "cân đối kế toán",
  KQKD: "kết quả kinh doanh",
  LCTT: "lưu chuyển tiền tệ",
  BCTC: "báo cáo tài chính",
  TCTD: "tổ chức tín dụng",
  CTNH: "công ty con",
  KH: "khách hàng",
  TNDN: "thu nhập doanh nghiệp",
  TS: "tài sản",
  CF: "công ty",
};

function expandViAbbreviations(input: string): string {
  let s = input;
  for (const [abbr, full] of Object.entries(VI_ABBREVIATIONS)) {
    if (s.toUpperCase().includes(abbr.toUpperCase())) s = s.replace(new RegExp(abbr, "gi"), full);
  }
  return s;
}

async function fetchVciMetrics(symbol: string): Promise<{ map: Map<string, VciMetricsEntry>; warnings: string[] }> {
  const warnings: string[] = [];
  const url = `${VCI_BASE}/v1/company/${encodeURIComponent(symbol)}/financial-statement/metrics`;
  const { ok, body } = await getJson(url, vciHeaders());
  if (!ok) {
    warnings.push(`VCI metrics HTTP/fetch failed`);
    return { map: new Map(), warnings };
  }
  const data = (body as Json)?.data as Json | undefined;
  if (!data) {
    warnings.push("VCI metrics returned no data");
    return { map: new Map(), warnings };
  }
  const map = new Map<string, VciMetricsEntry>();
  for (const section of Object.values(data)) {
    if (!Array.isArray(section)) continue;
    for (const item of section) {
      if (!item || typeof item !== "object") continue;
      const rec = item as VciMetricsEntry;
      if (rec.field) map.set(rec.field, rec);
    }
  }
  return { map, warnings };
}

interface VciPeriodRow extends Json {
  yearReport?: number;
  lengthReport?: number;
  publicDate?: string;
}

function vciPeriodLabel(row: VciPeriodRow): { period: string; fiscalYear: number; quarter: number } | null {
  const year = Number(row.yearReport);
  if (!Number.isFinite(year) || year <= 0) return null;
  const len = Number(row.lengthReport);
  if (Number.isFinite(len) && len >= 1 && len <= 4) {
    return { period: `Q${len}/${year}`, fiscalYear: year, quarter: len };
  }
  // lengthReport === 5 (or missing on a year row) means a full-year statement.
  return { period: `FY/${year}`, fiscalYear: year, quarter: 0 };
}

function buildLinesFromRow(
  row: Json,
  metrics: Map<string, VciMetricsEntry>,
): Array<{ name: string; value: number | null }> {
  const lines: Array<{ name: string; value: number | null }> = [];
  const skip = new Set([
    "organCode",
    "ticker",
    "createDate",
    "updateDate",
    "yearReport",
    "lengthReport",
    "publicDate",
    "report_period",
    "year",
    "quarter",
  ]);
  for (const [key, raw] of Object.entries(row)) {
    if (skip.has(key)) continue;
    const meta = metrics.get(key);
    if (!meta) continue;
    // Combine VN + EN + full titles so the app's matchers can hit either the
    // short Vietnamese label (e.g. "Lợi nhuận thuần từ HĐKD") or the full/EN form.
    const parts = [meta.titleVi, meta.titleEn, meta.fullTitleVi, meta.fullTitleEn];
    const name = parts.filter(Boolean).join(" ");
    if (!parts.some(Boolean)) continue;
    const value = asNumber(raw);
    if (value == null) continue;
    // Skip rows that are purely zeroed filler to keep the working set small.
    if (value === 0 && Object.keys(row).length > 300) continue;
    lines.push({ name: fold(expandViAbbreviations(name)), value });
  }
  return lines;
}

async function fetchVciStatement(
  symbol: string,
  type: VciStatementType,
  metrics: Map<string, VciMetricsEntry>,
  limit: number,
): Promise<{ byPeriod: Map<string, Record<string, number>>; warnings: string[] }> {
  const warnings: string[] = [];
  const section = VCI_SECTIONS[type];
  const url = `${VCI_BASE}/v1/company/${encodeURIComponent(symbol)}/financial-statement?section=${encodeURIComponent(section)}`;
  const { ok, body } = await getJson(url, vciHeaders());
  if (!ok) {
    warnings.push(`VCI financial-statement (${section}) HTTP/fetch failed`);
    return { byPeriod: new Map(), warnings };
  }
  const data = (body as Json)?.data as { years?: VciPeriodRow[]; quarters?: VciPeriodRow[] } | undefined;
  if (!data) {
    warnings.push(`VCI financial-statement (${section}) returned no data`);
    return { byPeriod: new Map(), warnings };
  }

  const targets = type === "income" ? INCOME_TARGETS : type === "balance" ? BALANCE_TARGETS : CASHFLOW_TARGETS;
  const perShareFields = new Set(["eps", "bookValuePerShare"]);
  const byPeriod = new Map<string, Record<string, number>>();

  const collectRows = (rows: VciPeriodRow[]) => {
    for (const row of rows) {
      const label = vciPeriodLabel(row);
      if (!label) continue;
      const lines = buildLinesFromRow(row, metrics);
      if (lines.length === 0) continue;
      const mapped = matchLines(lines, targets, perShareFields);
      if (Object.keys(mapped).length === 0) continue;
      const existing = byPeriod.get(label.period) ?? {};
      byPeriod.set(label.period, { ...existing, ...mapped });
    }
  };

  collectRows(data.years ?? []);
  collectRows(data.quarters ?? []);

  return { byPeriod, warnings };
}

async function loadVci(
  symbol: string,
  limit: number,
): Promise<{ quarters: VnstockQuarter[]; warnings: string[]; sourceUrl: string }> {
  const warnings: string[] = [];
  const { map: metrics, warnings: metricsWarnings } = await fetchVciMetrics(symbol);
  warnings.push(...metricsWarnings);

  const [income, balance, cashflow] = await Promise.all([
    fetchVciStatement(symbol, "income", metrics, limit),
    fetchVciStatement(symbol, "balance", metrics, limit),
    fetchVciStatement(symbol, "cashflow", metrics, limit),
  ]);
  warnings.push(...income.warnings, ...balance.warnings, ...cashflow.warnings);

  const allPeriods = new Set([...income.byPeriod.keys(), ...balance.byPeriod.keys(), ...cashflow.byPeriod.keys()]);
  const quarters: VnstockQuarter[] = [];
  for (const period of allPeriods) {
    const [label, year] = splitPeriod(period);
    if (!year) continue;
    const inc = income.byPeriod.get(period) ?? {};
    const bal = balance.byPeriod.get(period) ?? {};
    const cf = cashflow.byPeriod.get(period) ?? {};
    if (Object.keys(inc).length + Object.keys(bal).length + Object.keys(cf).length === 0) continue;
    quarters.push({ period, fiscalYear: year, income: inc, balance: bal, cashflow: cf });
  }

  return {
    quarters: quarters.sort((a, b) => b.fiscalYear - a.fiscalYear || b.period.localeCompare(a.period)).slice(0, limit),
    warnings,
    sourceUrl: `${VCI_BASE}/v1/company/${encodeURIComponent(symbol)}/financial-statement`,
  };
}

/* ────────────────────────────────────────────────────────────
 * KBS — faithful replica of vnstock's KBS finance calls.
 *   GET {KBS_FINANCE_INFO_URL}/{symbol}?type=KQKD&unit=1000&termtype=1&languageid=1&page=1&pageSize=4
 * Response: { Audit:[], Unit:[], Head:[{YearPeriod,TermName,AuditedStatus,United}],
 *             Content:{ "Kết quả kinh doanh": [ {Name,NameEn,ID,Value1..Value4} ] } }
 * ──────────────────────────────────────────────────────────── */

function kbsPeriodLabels(head: unknown): { label: string; iso: string }[] {
  if (!Array.isArray(head)) return [];
  const labels: { label: string; iso: string }[] = [];
  const sorted = [...head].sort((a, b) => Number((a as Json)?.ID ?? 0) - Number((b as Json)?.ID ?? 0));
  for (const item of sorted) {
    const rec = item as Json;
    const year = String(rec.YearPeriod ?? "");
    const term = String(rec.TermName ?? "");
    const m = /Quý\s*([1-4])/i.exec(term) || /Q\s*([1-4])/i.exec(term);
    const yearNum = Number(year);
    if (!Number.isFinite(yearNum)) continue;
    if (m) {
      const q = Number(m[1]);
      labels.push({ label: `Q${q}/${yearNum}`, iso: `${yearNum}-Q${q}` });
    } else {
      labels.push({ label: `FY/${yearNum}`, iso: `${yearNum}-FY` });
    }
  }
  return labels;
}

async function fetchKbsStatement(
  symbol: string,
  reportType: string, // "KQKD" | "CDKT" | "LCTT"
  reportKey: string,
  section: "income" | "balance" | "cashflow",
  limit: number,
): Promise<{ byPeriod: Map<string, Record<string, number>>; warnings: string[] }> {
  const warnings: string[] = [];
  const byPeriod = new Map<string, Record<string, number>>();
  const targets = section === "income" ? INCOME_TARGETS : section === "balance" ? BALANCE_TARGETS : CASHFLOW_TARGETS;
  const perShareFields = new Set(["eps", "bookValuePerShare"]);

  const requestsNeeded = Math.ceil(limit / 4) || 1;
  for (let page = 1; page <= Math.min(20, requestsNeeded + 1); page++) {
    const url = `${KBS_FINANCE_INFO_URL}/${encodeURIComponent(symbol)}`;
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "4",
      type: reportType,
      unit: "1000",
      termtype: "1",
      languageid: "1",
    });
    const { ok, body } = await getJson(`${url}?${params.toString()}`, kbsHeaders());
    if (!ok) {
      warnings.push(`KBS ${reportType} page ${page} HTTP/fetch failed`);
      break;
    }
    const root = body as Json;
    const content = (root.Content ?? {}) as Json;
    const rows = content[reportKey];
    if (!Array.isArray(rows) || rows.length === 0) break;
    const labels = kbsPeriodLabels(root.Head);
    for (const row of rows) {
      const rec = row as Json;
      const name = String(rec.Name ?? "");
      const lines: Array<{ name: string; value: number | null }> = [];
      labels.forEach(({ label, iso }, i) => {
        const value = asNumber(rec[`Value${i + 1}`]);
        if (value == null) return;
        // unit=1000 → already in thousands; keep as-is (billions scaling below).
        lines.push({ name: fold(name), value });
      });
      if (lines.length === 0) continue;
      const mapped = matchLines(lines, targets, perShareFields);
      labels.forEach(({ label }, i) => {
        const v = asNumber(rec[`Value${i + 1}`]);
        if (v == null) return;
        const existing = byPeriod.get(label) ?? {};
        byPeriod.set(label, { ...existing, ...mapped });
      });
    }
    if (rows.length < 4) break;
  }

  // Values already in thousands (unit=1000) — the app expects billions.
  // matchLines applies toBillions() (divide raw VND by 1e9), which is wrong for
  // thousands; re-normalize: divide by 1e6.
  for (const [period, record] of byPeriod) {
    const normalized: Record<string, number> = {};
    for (const [key, value] of Object.entries(record)) {
      normalized[key] = key === "eps" || key === "bookValuePerShare" ? value / 1000 : value / 1e6;
    }
    byPeriod.set(period, normalized);
  }

  return { byPeriod, warnings };
}

async function loadKbs(
  symbol: string,
  limit: number,
): Promise<{ quarters: VnstockQuarter[]; warnings: string[]; sourceUrl: string }> {
  const warnings: string[] = [];
  const [income, balance, cashflow] = await Promise.all([
    fetchKbsStatement(symbol, "KQKD", "Kết quả kinh doanh", "income", limit),
    fetchKbsStatement(symbol, "CDKT", "Cân đối kế toán", "balance", limit),
    fetchKbsStatement(symbol, "LCTT", "Lưu chuyển tiền tệ", "cashflow", limit),
  ]);
  warnings.push(...income.warnings, ...balance.warnings, ...cashflow.warnings);

  const allPeriods = new Set([...income.byPeriod.keys(), ...balance.byPeriod.keys(), ...cashflow.byPeriod.keys()]);
  const quarters: VnstockQuarter[] = [];
  for (const period of allPeriods) {
    const [label, year] = splitPeriod(period);
    if (!year) continue;
    const inc = income.byPeriod.get(period) ?? {};
    const bal = balance.byPeriod.get(period) ?? {};
    const cf = cashflow.byPeriod.get(period) ?? {};
    if (Object.keys(inc).length + Object.keys(bal).length + Object.keys(cf).length === 0) continue;
    quarters.push({ period, fiscalYear: year, income: inc, balance: bal, cashflow: cf });
  }

  return {
    quarters: quarters.sort((a, b) => b.fiscalYear - a.fiscalYear || b.period.localeCompare(a.period)).slice(0, limit),
    warnings,
    sourceUrl: `${KBS_FINANCE_INFO_URL}/${encodeURIComponent(symbol)}`,
  };
}

/* ────────────────────────────────────────────────────────────
 * Helpers + public API
 * ──────────────────────────────────────────────────────────── */

function splitPeriod(period: string): [string, number | null] {
  const m = /(?:Q[1-4]|FY)\/(\d{4})/.exec(period);
  return [period, m ? Number(m[1]) : null];
}

export async function fetchVnstockFinancialStatements(
  symbol: string,
  limit?: number,
): Promise<VnstockFinancialImport> {
  const sym = symbol.toUpperCase();
  const useVci = process.env.VNSTOCKS_SOURCE !== "kbs";
  const clamp = Math.min(maxPeriods(), Math.max(1, limit ?? maxPeriods()));

  const primary = useVci ? await loadVci(sym, clamp) : await loadKbs(sym, clamp);
  const sectionsPrimary = primary.quarters.filter((q) => Object.keys(q.income).length + Object.keys(q.balance).length > 0);
  if (sectionsPrimary.length > 0) {
    return {
      symbol: sym,
      source: useVci ? "vnstock-vci" : "vnstock-kbs",
      sourceName: useVci ? "Vietcap (VCI) via vnstock" : "KB Securities (KBS) via vnstock",
      sourceUrl: primary.sourceUrl,
      quarters: sectionsPrimary,
      warnings: primary.warnings,
    };
  }

  // Fallback to the other source.
  const fallback = useVci ? await loadKbs(sym, clamp) : await loadVci(sym, clamp);
  const sectionsFallback = fallback.quarters.filter((q) => Object.keys(q.income).length + Object.keys(q.balance).length > 0);
  if (sectionsFallback.length > 0) {
    return {
      symbol: sym,
      source: useVci ? "vnstock-kbs" : "vnstock-vci",
      sourceName: useVci ? "KB Securities (KBS) via vnstock" : "Vietcap (VCI) via vnstock",
      sourceUrl: fallback.sourceUrl,
      quarters: sectionsFallback,
      warnings: [...primary.warnings, ...fallback.warnings],
    };
  }

  return {
    symbol: sym,
    source: useVci ? "vnstock-vci" : "vnstock-kbs",
    sourceName: useVci ? "Vietcap (VCI) via vnstock" : "KB Securities (KBS) via vnstock",
    sourceUrl: primary.sourceUrl,
    quarters: [],
    warnings: [...primary.warnings, ...fallback.warnings],
  };
}

/* Exposed for unit tests */
export const __internals = {
  maxPeriods,
  vciPeriodLabel,
  buildLinesFromRow,
  kbsPeriodLabels,
  splitPeriod,
};
