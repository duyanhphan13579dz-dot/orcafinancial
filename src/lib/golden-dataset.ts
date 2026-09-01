/**
 * Phase 1 / Master Plan §XII — Golden dataset seeds
 *
 * Expected values should be filled from official filings (hand-verified).
 * null expectedValue = placeholder awaiting manual fill; audit still runs structure checks.
 *
 * Units: document the unit explicitly. Prefer absolute VND once Phase 2 canonical path is live.
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
  { symbol: "HPG", period: "Q1/2025", statementType: "income", metric: "revenue", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.02, note: "Điền từ BCTC HPG Q1/2025 hợp nhất" },
  { symbol: "HPG", period: "Q1/2025", statementType: "income", metric: "netIncome", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.02 },
  { symbol: "HPG", period: "Q1/2025", statementType: "income", metric: "grossProfit", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.02 },
  { symbol: "HPG", period: "Q1/2025", statementType: "balance", metric: "totalAssets", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.02 },
  { symbol: "HPG", period: "Q1/2025", statementType: "balance", metric: "equity", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.02 },
  { symbol: "HPG", period: "Q4/2024", statementType: "income", metric: "revenue", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.02 },
  { symbol: "HPG", period: "Q4/2024", statementType: "income", metric: "netIncome", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.02 },
  { symbol: "HPG", period: "FY/2024", statementType: "income", metric: "revenue", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.02 },
  { symbol: "HPG", period: "FY/2024", statementType: "income", metric: "netIncome", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.02 },
  { symbol: "HPG", period: "Q1/2025", statementType: "cashflow", metric: "operatingCashFlow", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.05 },
  { symbol: "VCB", period: "Q1/2025", statementType: "income", metric: "revenue", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.02 },
  { symbol: "VCB", period: "Q1/2025", statementType: "income", metric: "netIncome", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.02 },
  { symbol: "FPT", period: "Q1/2025", statementType: "income", metric: "revenue", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.02 },
  { symbol: "FPT", period: "Q1/2025", statementType: "income", metric: "netIncome", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.02 },
  { symbol: "VNM", period: "Q1/2025", statementType: "income", metric: "revenue", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.02 },
  { symbol: "VNM", period: "Q1/2025", statementType: "income", metric: "netIncome", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.02 },
  { symbol: "SSI", period: "Q1/2025", statementType: "income", metric: "revenue", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.02 },
  { symbol: "VIC", period: "Q1/2025", statementType: "income", metric: "revenue", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.02 },
  { symbol: "MWG", period: "Q1/2025", statementType: "income", metric: "revenue", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.02 },
  { symbol: "GAS", period: "Q1/2025", statementType: "income", metric: "revenue", expectedValue: null, expectedUnit: "VND", reportScope: "consolidated", source: "official_filing", tolerancePct: 0.02 },
];

export const GOLDEN_SYMBOLS = ["HPG", "VCB", "FPT", "VNM", "SSI", "VIC", "MWG", "GAS"] as const;
