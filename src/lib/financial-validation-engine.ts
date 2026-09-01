/**
 * Phase 2+4 — Financial Validation Engine
 *
 * Accounting identities, period chronology, unit consistency, source/provenance checks.
 */

import type { ReportScope } from "@/lib/financial-provenance";
import { checkProvenanceCompleteness, type FinancialProvenance } from "@/lib/financial-provenance";
import { detectUnit, toCanonicalVnd } from "@/lib/financial-canonical-unit";

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
  metrics?: string[];
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  checked: string[];
}

function n(obj: Record<string, unknown> | undefined, key: string): number | null {
  if (!obj) return null;
  const v = obj[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function close(a: number, b: number, tolPct: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / scale <= tolPct;
}

export interface AccountingInput {
  income?: Record<string, unknown>;
  balance?: Record<string, unknown>;
  cashflow?: Record<string, unknown>;
}

/** Master plan §X.1 — accounting identities */
export function validateAccountingIdentities(input: AccountingInput): ValidationResult {
  const issues: ValidationIssue[] = [];
  const checked: string[] = [];

  const income = input.income ?? {};
  const balance = input.balance ?? {};
  const cashflow = input.cashflow ?? {};

  const revenue = n(income, "revenue");
  const cogs = n(income, "costOfGoodsSold");
  const gross = n(income, "grossProfit");
  if (revenue != null && cogs != null && gross != null) {
    checked.push("gross_profit_identity");
    const expected = revenue - cogs;
    if (!close(expected, gross, 0.05)) {
      issues.push({
        code: "gross_profit_identity",
        severity: "error",
        message: `Gross profit identity fail: revenue(${revenue}) - COGS(${cogs}) = ${expected}, reported gross=${gross}`,
        metrics: ["revenue", "costOfGoodsSold", "grossProfit"],
      });
    }
  } else if (revenue != null || gross != null) {
    issues.push({
      code: "missing_metric",
      severity: "warning",
      message: "Thiếu revenue/COGS/grossProfit để kiểm identity.",
      metrics: ["revenue", "costOfGoodsSold", "grossProfit"],
    });
  }

  const assets = n(balance, "totalAssets");
  const liab = n(balance, "totalLiabilities");
  const equity = n(balance, "equity");
  if (assets != null && liab != null && equity != null) {
    checked.push("balance_sheet_identity");
    const sum = liab + equity;
    if (!close(assets, sum, 0.05)) {
      issues.push({
        code: "balance_sheet_identity",
        severity: "error",
        message: `Balance sheet identity fail: assets(${assets}) vs liab+equity(${sum})`,
        metrics: ["totalAssets", "totalLiabilities", "equity"],
      });
    }
  }

  const ocf = n(cashflow, "operatingCashFlow");
  const capex = n(cashflow, "capex");
  const fcf = n(cashflow, "freeCashFlow");
  if (ocf != null && capex != null && fcf != null) {
    checked.push("cashflow_identity");
    const expected1 = ocf - Math.abs(capex);
    const expected2 = ocf + capex;
    if (!close(fcf, expected1, 0.15) && !close(fcf, expected2, 0.15)) {
      issues.push({
        code: "cashflow_identity",
        severity: "warning",
        message: `FCF identity soft-fail: OCF=${ocf}, capex=${capex}, FCF=${fcf}`,
        metrics: ["operatingCashFlow", "capex", "freeCashFlow"],
      });
    }
  }

  if (revenue != null && revenue < 0) {
    issues.push({
      code: "sign_anomaly",
      severity: "warning",
      message: `Revenue âm (${revenue}) — kiểm tra unit/sign.`,
      metrics: ["revenue"],
    });
  }

  const ok = issues.every((i) => i.severity !== "error");
  return { ok, issues, checked };
}

/** Master plan §X.2 — period chronology & format */
const PERIOD_RE = /^(Q[1-4]\/\d{4}|FY\/\d{4}|\d{4}-Q[1-4]|Y\d{4})$/i;

export function parsePeriodSortKey(period: string): number | null {
  const p = (period ?? "").trim();
  let m = p.match(/^Q([1-4])\/(\d{4})$/i);
  if (m) return Number(m[2]) * 10 + Number(m[1]);
  m = p.match(/^(\d{4})-Q([1-4])$/i);
  if (m) return Number(m[1]) * 10 + Number(m[2]);
  m = p.match(/^FY\/(\d{4})$/i);
  if (m) return Number(m[1]) * 10 + 9;
  m = p.match(/^Y(\d{4})$/i);
  if (m) return Number(m[1]) * 10 + 9;
  return null;
}

export function validatePeriod(period: string, fiscalYear?: number): ValidationResult {
  const issues: ValidationIssue[] = [];
  const checked: string[] = ["period_format"];
  if (!period || !PERIOD_RE.test(period.trim())) {
    issues.push({
      code: "period_format",
      severity: "error",
      message: `Period format invalid: "${period}" (expect Qn/YYYY or FY/YYYY)`,
    });
  }
  if (fiscalYear != null) {
    checked.push("period_year_consistency");
    const key = parsePeriodSortKey(period);
    if (key != null) {
      const yearFromPeriod = Math.floor(key / 10);
      if (yearFromPeriod !== fiscalYear) {
        issues.push({
          code: "period_year_mismatch",
          severity: "error",
          message: `Period ${period} does not match fiscalYear ${fiscalYear}`,
        });
      }
    }
  }
  return { ok: issues.every((i) => i.severity !== "error"), issues, checked };
}

export function validatePeriodChronology(periods: string[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  const checked = ["period_chronology"];
  const keys = periods.map((p) => ({ p, k: parsePeriodSortKey(p) }));
  for (const item of keys) {
    if (item.k == null) {
      issues.push({ code: "period_unsortable", severity: "warning", message: `Cannot sort period "${item.p}"` });
    }
  }
  const sorted = keys.filter((x) => x.k != null).map((x) => x.k as number);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) {
      issues.push({
        code: "period_duplicate",
        severity: "error",
        message: `Duplicate period sort key ${sorted[i]}`,
      });
    }
  }
  return { ok: issues.every((i) => i.severity !== "error"), issues, checked };
}

/** Master plan §X / Phase 4 — unit validation */
export function validateUnit(rawValue: number, unitLabel: string, expectedCanonical = "VND"): ValidationResult {
  const issues: ValidationIssue[] = [];
  const checked = ["unit_detect", "unit_canonical"];
  const unit = detectUnit(unitLabel);
  if (unit === "UNKNOWN" && unitLabel && unitLabel.toUpperCase() !== "VND") {
    issues.push({
      code: "unit_unknown",
      severity: "warning",
      message: `Unit không nhận diện được: "${unitLabel}"`,
    });
  }
  try {
    const { canonicalVnd, multiplier } = toCanonicalVnd(rawValue, unit);
    if (!Number.isFinite(canonicalVnd) || multiplier <= 0) {
      issues.push({
        code: "unit_conversion_fail",
        severity: "error",
        message: `Không chuyển được ${rawValue} (${unitLabel}) sang ${expectedCanonical}`,
      });
    }
  } catch (e) {
    issues.push({
      code: "unit_conversion_error",
      severity: "error",
      message: e instanceof Error ? e.message : "unit conversion error",
    });
  }
  return { ok: issues.every((i) => i.severity !== "error"), issues, checked };
}

/** Master plan §X.3 — source / provenance */
export function validateSourceProvenance(p: Partial<FinancialProvenance>): ValidationResult {
  const checked = ["provenance_completeness"];
  const result = checkProvenanceCompleteness(p);
  const issues: ValidationIssue[] = result.issues.map((message) => ({
    code: "provenance_incomplete",
    severity: message.includes("synthetic") ? ("error" as const) : ("warning" as const),
    message,
  }));
  if (p.isSynthetic) {
    issues.push({
      code: "synthetic_blocked",
      severity: "error",
      message: "Synthetic records must never enter verified pipeline output",
    });
  }
  return { ok: issues.every((i) => i.severity !== "error"), issues, checked };
}

export interface FullValidationInput {
  income?: Record<string, unknown>;
  balance?: Record<string, unknown>;
  cashflow?: Record<string, unknown>;
  period?: string;
  fiscalYear?: number;
  periods?: string[];
  unitLabel?: string;
  sampleValue?: number;
  provenance?: Partial<FinancialProvenance>;
  reportScope?: ReportScope;
}

/** Aggregate gate used by Phase 3 pipeline and Phase 4 release checks */
export function validateFinancialRecord(input: FullValidationInput): ValidationResult {
  const parts: ValidationResult[] = [];
  parts.push(validateAccountingIdentities(input));
  if (input.period) parts.push(validatePeriod(input.period, input.fiscalYear));
  if (input.periods?.length) parts.push(validatePeriodChronology(input.periods));
  if (input.unitLabel != null && input.sampleValue != null) {
    parts.push(validateUnit(input.sampleValue, input.unitLabel));
  }
  if (input.provenance) parts.push(validateSourceProvenance(input.provenance));
  if (input.reportScope === "unknown") {
    parts.push({
      ok: false,
      issues: [{ code: "report_scope_unknown", severity: "error", message: "reportScope must be consolidated or parent for verified data" }],
      checked: ["report_scope"],
    });
  }

  const issues = parts.flatMap((p) => p.issues);
  const checked = [...new Set(parts.flatMap((p) => p.checked))];
  return { ok: issues.every((i) => i.severity !== "error"), issues, checked };
}
