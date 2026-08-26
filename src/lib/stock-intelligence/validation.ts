import type { FinancialQuarter } from "@/lib/financial-statements";

export type ValidationCode = "missing_value" | "duplicate_period" | "wrong_period" | "impossible_value" | "balance_mismatch" | "provider_conflict" | "kind_conflict" | "future_actual";

export interface ValidationIssue {
  code: ValidationCode;
  field: string;
  message: string;
  severity: "warning" | "error";
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  checkedAt: string;
}

export function validateFinancialQuarters(quarters: FinancialQuarter[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  const periodKinds = new Map<string, Set<string>>();
  for (const quarter of quarters) {
    if (seen.has(quarter.period)) issues.push({ code: "duplicate_period", field: "period", message: `Trùng kỳ báo cáo ${quarter.period}.`, severity: "error" });
    seen.add(quarter.period);
    const basePeriod = quarter.period.replace(/[AET]$/, "");
    const kind = quarter.period.endsWith("E") ? "estimate" : quarter.period.endsWith("T") ? "target" : "actual";
    const kinds = periodKinds.get(basePeriod) ?? new Set<string>();
    kinds.add(kind);
    periodKinds.set(basePeriod, kinds);
    const year = Number(/(\d{4})/.exec(quarter.period)?.[1] ?? 0);
    if (kind === "actual" && year > new Date().getFullYear()) issues.push({ code: "future_actual", field: "period", message: `Kỳ actual ${quarter.period} nằm trong tương lai.`, severity: "error" });
    const numericGroups = [
      ["income", quarter.income],
      ["balance", quarter.balance],
      ["cashflow", quarter.cashflow],
    ] as const;
    for (const [group, values] of numericGroups) {
      for (const [field, value] of Object.entries(values)) {
        if (typeof value !== "number" || !Number.isFinite(value)) issues.push({ code: "missing_value", field: `${group}.${field}`, message: `${group}.${field} thiếu hoặc không hợp lệ.`, severity: "error" });
      }
    }
    if (quarter.income.revenue < 0 || quarter.balance.totalAssets < 0) issues.push({ code: "impossible_value", field: quarter.period, message: "Doanh thu hoặc tổng tài sản không thể âm.", severity: "error" });
    const balanceGap = Math.abs(quarter.balance.totalAssets - quarter.balance.totalLiabilitiesEquity);
    const tolerance = Math.max(1, quarter.balance.totalAssets * 0.005);
    if (balanceGap > tolerance) issues.push({ code: "balance_mismatch", field: "balance", message: `Bảng cân đối lệch ${balanceGap.toFixed(2)} (ngưỡng ${tolerance.toFixed(2)}).`, severity: "warning" });
  }
  for (const [period, kinds] of periodKinds) {
    if (kinds.size > 1) issues.push({ code: "kind_conflict", field: period, message: `Một kỳ có nhiều loại dữ liệu: ${[...kinds].join(", ")}.`, severity: "warning" });
  }
  return { valid: !issues.some((issue) => issue.severity === "error"), issues, checkedAt: new Date().toISOString() };
}

export function validatePeriods(labels: string[], expectedLatest?: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  const normalized = labels.map((label) => label.trim()).filter(Boolean);
  if (normalized.length !== new Set(normalized).size) issues.push({ code: "duplicate_period", field: "period", message: "Có kỳ dữ liệu bị trùng.", severity: "error" });
  if (expectedLatest && normalized.length > 0 && normalized[0] !== expectedLatest) issues.push({ code: "wrong_period", field: "latestPeriod", message: `Kỳ mới nhất không khớp kỳ mong đợi ${expectedLatest}.`, severity: "warning" });
  return { valid: !issues.some((issue) => issue.severity === "error"), issues, checkedAt: new Date().toISOString() };
}

export function validateProviderValues(values: Array<{ provider: string; value: number | null }>): ValidationResult {
  const issues: ValidationIssue[] = [];
  const present = values.filter((entry) => typeof entry.value === "number" && Number.isFinite(entry.value));
  if (present.length === 0) issues.push({ code: "missing_value", field: "value", message: "Không có provider nào trả dữ liệu hợp lệ.", severity: "error" });
  if (present.length > 1) {
    const min = Math.min(...present.map((entry) => entry.value as number));
    const max = Math.max(...present.map((entry) => entry.value as number));
    if (min > 0 && (max - min) / min > 0.05) issues.push({ code: "provider_conflict", field: "value", message: "Provider trả về giá trị chênh lệch trên 5%.", severity: "warning" });
  }
  return { valid: !issues.some((issue) => issue.severity === "error"), issues, checkedAt: new Date().toISOString() };
}
