/**
 * Phase 1 / 4 — Golden dataset & regression comparison
 * Master Plan §XII
 */

export interface GoldenMetric {
  symbol: string;
  period: string;
  statementType: "income" | "balance" | "cashflow";
  metric: string;
  expectedValue: number | null;
  expectedUnit: string;
  reportScope: "consolidated" | "parent";
  source: string;
  tolerancePct?: number;
  note?: string;
}

export const GOLDEN_METRICS: GoldenMetric[] = [
  {
    symbol: "HPG",
    period: "Q1/2025",
    statementType: "income",
    metric: "revenue",
    expectedValue: null,
    expectedUnit: "VND",
    reportScope: "consolidated",
    source: "official_filing",
    tolerancePct: 0.02,
    note: "Điền từ BCTC HPG Q1/2025 hợp nhất",
  },
  {
    symbol: "HPG",
    period: "Q1/2025",
    statementType: "income",
    metric: "netIncome",
    expectedValue: null,
    expectedUnit: "VND",
    reportScope: "consolidated",
    source: "official_filing",
    tolerancePct: 0.02,
  },
  {
    symbol: "HPG",
    period: "Q1/2025",
    statementType: "income",
    metric: "grossProfit",
    expectedValue: null,
    expectedUnit: "VND",
    reportScope: "consolidated",
    source: "official_filing",
    tolerancePct: 0.02,
  },
  {
    symbol: "HPG",
    period: "Q1/2025",
    statementType: "balance",
    metric: "totalAssets",
    expectedValue: null,
    expectedUnit: "VND",
    reportScope: "consolidated",
    source: "official_filing",
    tolerancePct: 0.02,
  },
  {
    symbol: "HPG",
    period: "Q1/2025",
    statementType: "balance",
    metric: "equity",
    expectedValue: null,
    expectedUnit: "VND",
    reportScope: "consolidated",
    source: "official_filing",
    tolerancePct: 0.02,
  },
  {
    symbol: "HPG",
    period: "Q4/2024",
    statementType: "income",
    metric: "revenue",
    expectedValue: null,
    expectedUnit: "VND",
    reportScope: "consolidated",
    source: "official_filing",
    tolerancePct: 0.02,
  },
  {
    symbol: "HPG",
    period: "Q4/2024",
    statementType: "income",
    metric: "netIncome",
    expectedValue: null,
    expectedUnit: "VND",
    reportScope: "consolidated",
    source: "official_filing",
    tolerancePct: 0.02,
  },
  {
    symbol: "HPG",
    period: "FY/2024",
    statementType: "income",
    metric: "revenue",
    expectedValue: null,
    expectedUnit: "VND",
    reportScope: "consolidated",
    source: "official_filing",
    tolerancePct: 0.02,
  },
  {
    symbol: "HPG",
    period: "FY/2024",
    statementType: "income",
    metric: "netIncome",
    expectedValue: null,
    expectedUnit: "VND",
    reportScope: "consolidated",
    source: "official_filing",
    tolerancePct: 0.02,
  },
  {
    symbol: "VNM",
    period: "Q1/2025",
    statementType: "income",
    metric: "revenue",
    expectedValue: null,
    expectedUnit: "VND",
    reportScope: "consolidated",
    source: "official_filing",
    tolerancePct: 0.02,
    note: "Điền từ BCTC VNM",
  },
  {
    symbol: "FPT",
    period: "Q1/2025",
    statementType: "income",
    metric: "revenue",
    expectedValue: null,
    expectedUnit: "VND",
    reportScope: "consolidated",
    source: "official_filing",
    tolerancePct: 0.02,
  },
  {
    symbol: "VCB",
    period: "Q1/2025",
    statementType: "income",
    metric: "netIncome",
    expectedValue: null,
    expectedUnit: "VND",
    reportScope: "consolidated",
    source: "official_filing",
    tolerancePct: 0.02,
  },
];

export const GOLDEN_SYMBOLS = [...new Set(GOLDEN_METRICS.map((m) => m.symbol))];

export interface GoldenCompareInput {
  symbol: string;
  period: string;
  statementType: string;
  metric: string;
  actualValue: number | null;
  actualUnit?: string;
  reportScope?: string;
}

export interface GoldenCompareRow {
  golden: GoldenMetric;
  actualValue: number | null;
  status: "pass" | "fail" | "skip_no_expected" | "skip_no_actual" | "unit_mismatch";
  deltaPct: number | null;
  message: string;
}

export function compareGoldenMetric(
  golden: GoldenMetric,
  actualValue: number | null,
  actualUnit?: string,
): GoldenCompareRow {
  if (golden.expectedValue == null) {
    return {
      golden,
      actualValue,
      status: "skip_no_expected",
      deltaPct: null,
      message: "Expected value chưa điền từ BCTC chính thức",
    };
  }
  if (actualValue == null || !Number.isFinite(actualValue)) {
    return {
      golden,
      actualValue,
      status: "skip_no_actual",
      deltaPct: null,
      message: "Không có actual value từ pipeline/API",
    };
  }
  if (actualUnit && golden.expectedUnit && actualUnit.toUpperCase() !== golden.expectedUnit.toUpperCase()) {
    if (actualUnit.toUpperCase() !== "VND" && golden.expectedUnit.toUpperCase() === "VND") {
      return {
        golden,
        actualValue,
        status: "unit_mismatch",
        deltaPct: null,
        message: `Unit mismatch: actual=${actualUnit} expected=${golden.expectedUnit}`,
      };
    }
  }
  const tol = golden.tolerancePct ?? 0.02;
  const scale = Math.max(Math.abs(golden.expectedValue), Math.abs(actualValue), 1);
  const deltaPct = Math.abs(actualValue - golden.expectedValue) / scale;
  if (deltaPct <= tol) {
    return {
      golden,
      actualValue,
      status: "pass",
      deltaPct,
      message: `Within tolerance ${(tol * 100).toFixed(1)}%`,
    };
  }
  return {
    golden,
    actualValue,
    status: "fail",
    deltaPct,
    message: `Delta ${(deltaPct * 100).toFixed(2)}% exceeds tolerance ${(tol * 100).toFixed(1)}% (expected=${golden.expectedValue}, actual=${actualValue})`,
  };
}

export function compareGoldenBatch(rows: GoldenCompareInput[]): GoldenCompareRow[] {
  return rows.map((row) => {
    const golden =
      GOLDEN_METRICS.find(
        (g) =>
          g.symbol === row.symbol.toUpperCase() &&
          g.period === row.period &&
          g.statementType === row.statementType &&
          g.metric === row.metric,
      ) ?? null;
    if (!golden) {
      return {
        golden: {
          symbol: row.symbol,
          period: row.period,
          statementType: row.statementType as GoldenMetric["statementType"],
          metric: row.metric,
          expectedValue: null,
          expectedUnit: "VND",
          reportScope: "consolidated",
          source: "unknown",
        },
        actualValue: row.actualValue,
        status: "skip_no_expected" as const,
        deltaPct: null,
        message: "No golden row defined for this key",
      };
    }
    return compareGoldenMetric(golden, row.actualValue, row.actualUnit);
  });
}

export function goldenRegressionSummary(results: GoldenCompareRow[]): {
  pass: number;
  fail: number;
  skip: number;
  ok: boolean;
  readyForGate: boolean;
} {
  const pass = results.filter((r) => r.status === "pass").length;
  const fail = results.filter((r) => r.status === "fail" || r.status === "unit_mismatch").length;
  const skip = results.filter((r) => r.status.startsWith("skip")).length;
  const hasFilledExpected = results.some((r) => r.golden.expectedValue != null);
  return {
    pass,
    fail,
    skip,
    ok: fail === 0 && pass > 0,
    readyForGate: hasFilledExpected && fail === 0,
  };
}
