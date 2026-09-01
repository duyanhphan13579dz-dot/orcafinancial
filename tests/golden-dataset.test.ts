import { describe, expect, it } from "vitest";
import { loadPreferredQuarterlyFinancials } from "@/lib/financial-ingestion";
import {
  getSourcePriority,
  toCanonicalVnd,
  validateAccountingIdentities,
  validatePeriodChronology,
  createLineageTrace,
} from "@/lib/financial-canonical-model";

const GOLDEN_TICKERS = ["HPG", "VCB", "FPT", "VNM", "SSI", "VIC", "MWG", "GAS"];

describe("Golden Dataset & Release Controls (Phase 4)", () => {
  it("evaluates golden dataset tickers through the verified financial pipeline", async () => {
    for (const symbol of GOLDEN_TICKERS) {
      const preferred = await loadPreferredQuarterlyFinancials(symbol, 4);
      expect(preferred).toBeDefined();
      expect(preferred.source).toMatch(/^(company_official|vietstock|cafef)$/);
      expect(preferred.quarters.length).toBeGreaterThan(0);

      // Verify each quarter passes accounting validation
      for (const q of preferred.quarters) {
        expect(q.period).toMatch(/^Q[1-4]\/\d{4}$/);
        expect(q.fiscalYear).toBeGreaterThan(2010);
        expect(q.income.revenue).toBeGreaterThan(0);
        expect(q.balance.totalAssets).toBeGreaterThan(0);

        const val = validateAccountingIdentities(q.income, q.balance, q.cashflow);
        if (!val.isValid) {
          console.error(`Validation failed for ${symbol} ${q.period}:`, val.issues);
        }
        expect(val.isValid).toBe(true);
      }

      // Verify chronology
      const chronology = validatePeriodChronology(preferred.quarters);
      expect(chronology.isValid).toBe(true);
    }
  });

  it("enforces source priority hierarchy ratings", () => {
    expect(getSourcePriority("company_official")).toBe(100);
    expect(getSourcePriority("official_filing")).toBe(100);
    expect(getSourcePriority("vietstock")).toBe(90);
    expect(getSourcePriority("professional_data")).toBe(90);
    expect(getSourcePriority("cafef")).toBe(80);
    expect(getSourcePriority("unverified_provider")).toBe(40);
    expect(getSourcePriority("synthetic")).toBe(0);
  });

  it("converts raw values correctly to canonical absolute VND", () => {
    const billion = toCanonicalVnd(38.5, "billion VND");
    expect(billion.canonicalValue).toBe(38_500_000_000);
    expect(billion.canonicalUnit).toBe("VND");
    expect(billion.rawValue).toBe(38.5);

    const million = toCanonicalVnd(500, "million VND");
    expect(million.canonicalValue).toBe(500_000_000);

    const exact = toCanonicalVnd(1234567, "VND");
    expect(exact.canonicalValue).toBe(1234567);
  });

  it("detects accounting identity violations", () => {
    // Balanced
    const balanced = validateAccountingIdentities(
      { revenue: 1000, cogs: 600, grossProfit: 400 },
      { totalAssets: 5000, liabilities: 3000, equity: 2000 },
      { netCashFlow: 100, operatingCashFlow: 200, investingCashFlow: -50, financingCashFlow: -50 }
    );
    expect(balanced.isValid).toBe(true);

    // Unbalanced Balance Sheet
    const unbalancedBs = validateAccountingIdentities(
      { revenue: 1000, cogs: 600, grossProfit: 400 },
      { totalAssets: 5000, liabilities: 3000, equity: 1000 }, // 5000 != 3000 + 1000
      { netCashFlow: 100, operatingCashFlow: 200, investingCashFlow: -50, financingCashFlow: -50 }
    );
    expect(unbalancedBs.isValid).toBe(false);
    expect(unbalancedBs.issues.some((i) => i.includes("Cân đối kế toán không khớp"))).toBe(true);
  });

  it("builds evidence lineage traces with correct priority and verification flags", () => {
    const trace = createLineageTrace("HPG", "company_official", "https://hpg.com.vn/ir", "CONSOLIDATED");
    expect(trace.symbol).toBe("HPG");
    expect(trace.sourcePriority).toBe(100);
    expect(trace.verificationStatus).toBe("VERIFIED");
    expect(trace.isSynthetic).toBe(false);
    expect(trace.transformationSteps.length).toBeGreaterThan(0);
  });
});
