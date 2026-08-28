export type FinancialLlmOutputType = "basic" | "financials";

export interface FinancialLlmFactLike {
  period: string;
  fiscalYear: number;
  statementType: "income" | "balance" | "cashflow" | string;
  data: Record<string, unknown>;
}

export type FinancialQualitySeverity = "error" | "warning";

export interface FinancialQualityIssue {
  code: string;
  message: string;
  severity: FinancialQualitySeverity;
  path?: string;
}

export interface FinancialQualityResult {
  valid: boolean;
  score: number;
  issues: FinancialQualityIssue[];
}

const EPSILON = 1e-6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function sameNumber(a: unknown, b: unknown): boolean {
  const left = asFiniteNumber(a);
  const right = asFiniteNumber(b);
  if (left == null || right == null) return false;
  const tolerance = Math.max(0.5, Math.max(Math.abs(left), Math.abs(right)) * EPSILON);
  return Math.abs(left - right) <= tolerance;
}

function issue(issues: FinancialQualityIssue[], code: string, message: string, path?: string, severity: FinancialQualitySeverity = "error") {
  issues.push({ code, message, path, severity });
}

function factsByPeriod(facts: FinancialLlmFactLike[], statementType: string): Map<string, FinancialLlmFactLike> {
  return new Map(
    facts
      .filter((fact) => fact.statementType === statementType)
      .map((fact) => [fact.period, fact]),
  );
}

function validateStringArray(output: Record<string, unknown>, key: string, issues: FinancialQualityIssue[]) {
  if (!Array.isArray(output[key]) || !(output[key] as unknown[]).every((item) => typeof item === "string")) {
    issue(issues, "invalid_array", `${key} phải là mảng chuỗi.`, key);
  }
}

function validateChart(output: Record<string, unknown>, key: string, sourceKey: string, facts: Map<string, FinancialLlmFactLike>, issues: FinancialQualityIssue[]) {
  const chart = output.charts;
  if (!isRecord(chart) || !Array.isArray(chart[key])) {
    issue(issues, "missing_chart", `charts.${key} phải là mảng dữ liệu.`, `charts.${key}`);
    return;
  }
  for (const [index, item] of (chart[key] as unknown[]).entries()) {
    if (!isRecord(item) || typeof item.period !== "string" || asFiniteNumber(item.value) == null) {
      issue(issues, "invalid_chart_row", `charts.${key}[${index}] thiếu period/value hợp lệ.`, `charts.${key}[${index}]`);
      continue;
    }
    const fact = facts.get(item.period);
    if (!fact) {
      issue(issues, "unknown_period", `charts.${key}[${index}] dùng kỳ không có trong normalized facts: ${item.period}.`, `charts.${key}[${index}].period`);
      continue;
    }
    const expected = fact.data[sourceKey];
    if (!sameNumber(item.value, expected)) {
      issue(issues, "ungrounded_number", `charts.${key}[${index}] không khớp ${sourceKey} của normalized facts.`, `charts.${key}[${index}].value`);
    }
  }
}

function validateTable(output: Record<string, unknown>, key: string, statementType: string, fields: string[], facts: Map<string, FinancialLlmFactLike>, issues: FinancialQualityIssue[]) {
  if (!Array.isArray(output[key])) {
    issue(issues, "missing_statement", `${key} phải là mảng.`, key);
    return;
  }
  for (const [index, item] of (output[key] as unknown[]).entries()) {
    if (!isRecord(item) || typeof item.period !== "string") {
      issue(issues, "invalid_statement_row", `${key}[${index}] thiếu period hợp lệ.`, `${key}[${index}]`);
      continue;
    }
    const fact = facts.get(item.period);
    if (!fact) {
      issue(issues, "unknown_period", `${key}[${index}] dùng kỳ không có trong normalized facts: ${item.period}.`, `${key}[${index}].period`);
      continue;
    }
    for (const field of fields) {
      if (asFiniteNumber(item[field]) == null) {
        issue(issues, "invalid_statement_value", `${key}[${index}].${field} phải là số hữu hạn.`, `${key}[${index}].${field}`);
      } else if (!sameNumber(item[field], fact.data[field])) {
        issue(issues, "ungrounded_number", `${key}[${index}].${field} không khớp normalized facts.`, `${key}[${index}].${field}`);
      }
    }
  }
}

export function validateFinancialLlmOutput(type: FinancialLlmOutputType, output: unknown, facts: FinancialLlmFactLike[]): FinancialQualityResult {
  const issues: FinancialQualityIssue[] = [];
  if (!isRecord(output)) {
    return { valid: false, score: 0, issues: [{ code: "invalid_object", message: "Output LLM phải là object JSON.", severity: "error" }] };
  }

  if (type === "basic") {
    for (const key of ["overview", "positives", "risks"]) {
      if (typeof output[key] !== "string" && key === "overview") issue(issues, "missing_text", "overview phải là chuỗi.", key);
      if (key !== "overview") validateStringArray(output, key, issues);
    }
    if (!isRecord(output.charts)) issue(issues, "missing_charts", "basic phải có charts.", "charts");
    const income = factsByPeriod(facts, "income");
    validateChart(output, "revenue", "revenue", income, issues);
    validateChart(output, "ebitda", "ebitda", income, issues);
    validateChart(output, "netIncome", "netIncome", income, issues);
  } else {
    validateTable(output, "incomeStatement", "income", ["revenue", "grossProfit", "ebitda", "netIncome"], factsByPeriod(facts, "income"), issues);
    validateTable(output, "balanceSheet", "balance", ["totalAssets", "totalLiabilities", "equity", "cash"], factsByPeriod(facts, "balance"), issues);
    validateTable(output, "cashFlowStatement", "cashflow", ["operatingCashFlow", "investingCashFlow", "financingCashFlow", "freeCashFlow"], factsByPeriod(facts, "cashflow"), issues);
    validateStringArray(output, "notes", issues);

    const balanceRows = Array.isArray(output.balanceSheet) ? output.balanceSheet : [];
    for (const [index, row] of balanceRows.entries()) {
      if (!isRecord(row)) continue;
      const assets = asFiniteNumber(row.totalAssets);
      const liabilities = asFiniteNumber(row.totalLiabilities);
      const equity = asFiniteNumber(row.equity);
      if (assets != null && liabilities != null && equity != null && !sameNumber(assets, liabilities + equity)) {
        issue(issues, "balance_mismatch", `balanceSheet[${index}] không thỏa tổng tài sản = nợ phải trả + vốn chủ sở hữu.`, `balanceSheet[${index}]`);
      }
    }
  }

  const errors = issues.filter((item) => item.severity === "error");
  const score = Math.max(0, Math.round(100 - errors.length * 18 - (issues.length - errors.length) * 4));
  return { valid: errors.length === 0, score, issues };
}

export function formatFinancialQualityIssues(result: FinancialQualityResult): string {
  return result.issues.map((item) => `${item.code}${item.path ? ` @ ${item.path}` : ""}: ${item.message}`).join("; ");
}

export const FINANCIAL_LLM_QUALITY_VERSION = "financial-grounding-v1";
