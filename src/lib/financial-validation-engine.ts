/**
 * Phase 2 / Master Plan §X — Financial Validation Engine
 * Accounting identities, period sanity, unit presence.
 */

export interface StatementMetrics {
  [key: string]: number | null | undefined;
}

export interface ValidationIssue {
  code:
    | "balance_sheet_identity"
    | "gross_profit_identity"
    | "missing_metric"
    | "sign_anomaly"
    | "cashflow_identity";
  severity: "error" | "warning";
  message: string;
  metrics?: string[];
}

export interface AccountingValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  checked: string[];
}

function n(m: StatementMetrics, key: string): number | null {
  const v = m[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function close(a: number, b: number, tol = 0.03): boolean {
  const denom = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / denom <= tol;
}

export function validateAccountingIdentities(input: {
  income?: StatementMetrics;
  balance?: StatementMetrics;
  cashflow?: StatementMetrics;
}): AccountingValidationResult {
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
