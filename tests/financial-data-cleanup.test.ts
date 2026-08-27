import { describe, expect, it } from "vitest";
import { classifyFinancialRow } from "@/lib/financial-data-cleanup";

const expected: { fiscalYear: number; quarter: 1 | 2 | 3 | 4 } = { fiscalYear: 2026, quarter: 2 };
const base = {
  id: 1,
  symbol: "VND",
  type: "income",
  fiscalYear: 2026,
  confidence: 0.75,
  updatedAt: new Date("2026-08-27T00:00:00Z"),
};

describe("financial data cleanup classifier", () => {
  it("flags future synthetic rows as removable", () => {
    const issues = classifyFinancialRow({ ...base, period: "Q3", source: "sector-synthetic-v1" }, expected);
    expect(issues.some((issue) => issue.code === "future_period" && issue.removable)).toBe(true);
    expect(issues.some((issue) => issue.code === "legacy_synthetic" && issue.removable)).toBe(true);
  });

  it("does not mark missing filing provenance as safe to delete", () => {
    const issues = classifyFinancialRow({ ...base, period: "Q2", source: "sector-synthetic-v2" }, expected);
    expect(issues).toContainEqual(expect.objectContaining({ code: "missing_filing_source", removable: false }));
  });

  it("accepts filing and professional sources as actual provenance", () => {
    expect(classifyFinancialRow({ ...base, period: "Q2", source: "filing" }, expected)).toHaveLength(0);
    expect(classifyFinancialRow({ ...base, period: "Q2", source: "professional" }, expected)).toHaveLength(0);
  });

  it("flags malformed periods without deleting provider data", () => {
    const issues = classifyFinancialRow({ ...base, period: "FY2026", source: "filing" }, expected);
    expect(issues).toContainEqual(expect.objectContaining({ code: "invalid_period", removable: false }));
  });
});
