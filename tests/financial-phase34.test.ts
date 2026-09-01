import { describe, expect, it } from "vitest";
import {
  validateAccountingIdentities,
  validatePeriod,
  validatePeriodChronology,
  validateUnit,
  validateSourceProvenance,
  validateFinancialRecord,
} from "@/lib/financial-validation-engine";
import { checkProvenanceCompleteness, buildTransformationChain } from "@/lib/financial-provenance";
import {
  GOLDEN_METRICS,
  GOLDEN_SYMBOLS,
  compareGoldenMetric,
  compareGoldenBatch,
  goldenRegressionSummary,
} from "@/lib/golden-dataset";
import { SOURCE_PRIORITY, isSyntheticSource, pickPreferredRecord } from "@/lib/financial-source-priority";
import { toCanonicalVnd } from "@/lib/financial-canonical-unit";

describe("Phase 3 provenance", () => {
  it("requires full provenance for verified label", () => {
    const incomplete = checkProvenanceCompleteness({ symbol: "HPG" });
    expect(incomplete.ok).toBe(false);

    const complete = checkProvenanceCompleteness({
      symbol: "HPG",
      statementType: "income",
      period: "Q1/2025",
      fiscalYear: 2025,
      reportScope: "consolidated",
      sourceProvider: "vietstock",
      sourcePriority: 80,
      sourceDocumentId: 1,
      sourceUrl: "https://example.com/hpg",
      sourcePublishedAt: "2025-04-20",
      rawUnit: "BILLION_VND",
      canonicalUnit: "VND",
      dataVersion: "v1",
      verificationStatus: "verified",
      qualityStatus: "accepted",
      isSynthetic: false,
      transformationChain: [],
    });
    expect(complete.ok).toBe(true);
    expect(complete.completeness).toBe(1);
  });

  it("blocks synthetic in provenance", () => {
    const r = checkProvenanceCompleteness({
      symbol: "HPG",
      statementType: "income",
      period: "Q1/2025",
      fiscalYear: 2025,
      reportScope: "consolidated",
      sourceProvider: "sector-synthetic",
      sourceDocumentId: 1,
      sourceUrl: "x",
      rawUnit: "VND",
      canonicalUnit: "VND",
      isSynthetic: true,
    });
    expect(r.ok).toBe(false);
  });

  it("builds transformation chain", () => {
    const chain = buildTransformationChain({
      rawUnit: "BILLION_VND",
      canonicalUnit: "VND",
      multiplier: 1_000_000_000,
      validated: true,
    });
    expect(chain).toContain("validation_pass");
    expect(chain).toContain("verified_store");
  });
});

describe("Phase 4 validation suite", () => {
  it("validates period format and year consistency", () => {
    expect(validatePeriod("Q1/2025", 2025).ok).toBe(true);
    expect(validatePeriod("Q1/2025", 2024).ok).toBe(false);
    expect(validatePeriod("bad", 2025).ok).toBe(false);
  });

  it("detects duplicate periods", () => {
    expect(validatePeriodChronology(["Q1/2025", "Q1/2025"]).ok).toBe(false);
  });

  it("validates unit conversion", () => {
    expect(validateUnit(38500, "BILLION_VND").ok).toBe(true);
    expect(toCanonicalVnd(38500, "BILLION_VND").canonicalVnd).toBe(38500 * 1_000_000_000);
  });

  it("rejects synthetic provenance", () => {
    expect(validateSourceProvenance({ symbol: "HPG", isSynthetic: true, sourceProvider: "synthetic" }).ok).toBe(false);
  });

  it("full record validation passes clean data", () => {
    const r = validateFinancialRecord({
      income: { revenue: 100, costOfGoodsSold: 40, grossProfit: 60 },
      balance: { totalAssets: 200, totalLiabilities: 80, equity: 120 },
      period: "Q1/2025",
      fiscalYear: 2025,
      unitLabel: "VND",
      sampleValue: 100,
      reportScope: "consolidated",
      provenance: {
        symbol: "HPG",
        statementType: "income",
        period: "Q1/2025",
        fiscalYear: 2025,
        reportScope: "consolidated",
        sourceProvider: "vietstock",
        sourceDocumentId: 1,
        sourceUrl: "https://x",
        rawUnit: "VND",
        canonicalUnit: "VND",
        isSynthetic: false,
      },
    });
    expect(r.ok).toBe(true);
  });
});

describe("Phase 4 golden regression", () => {
  it("has golden symbols including HPG", () => {
    expect(GOLDEN_SYMBOLS).toContain("HPG");
    expect(GOLDEN_METRICS.length).toBeGreaterThan(5);
  });

  it("skips when expected not filled", () => {
    expect(compareGoldenMetric(GOLDEN_METRICS[0], 123).status).toBe("skip_no_expected");
  });

  it("passes within tolerance", () => {
    const row = compareGoldenMetric(
      {
        symbol: "HPG",
        period: "Q1/2025",
        statementType: "income",
        metric: "revenue",
        expectedValue: 100,
        expectedUnit: "VND",
        reportScope: "consolidated",
        source: "official_filing",
        tolerancePct: 0.02,
      },
      101,
      "VND",
    );
    expect(row.status).toBe("pass");
  });

  it("fails when delta exceeds tolerance", () => {
    const row = compareGoldenMetric(
      {
        symbol: "HPG",
        period: "Q1/2025",
        statementType: "income",
        metric: "revenue",
        expectedValue: 100,
        expectedUnit: "VND",
        reportScope: "consolidated",
        source: "official_filing",
        tolerancePct: 0.02,
      },
      150,
      "VND",
    );
    expect(row.status).toBe("fail");
  });

  it("batch summary has no fails for unfilled golden", () => {
    const results = compareGoldenBatch([
      { symbol: "HPG", period: "Q1/2025", statementType: "income", metric: "revenue", actualValue: null },
    ]);
    expect(goldenRegressionSummary(results).fail).toBe(0);
  });
});

describe("Phase 3/4 priority", () => {
  it("synthetic never wins", () => {
    const w = pickPreferredRecord([
      { source: "sector-synthetic-v2", verificationStatus: "verified", qualityStatus: "accepted" },
      { source: "tcbs", verificationStatus: "unverified", qualityStatus: "pending" },
    ]);
    expect(w?.source).toBe("tcbs");
    expect(SOURCE_PRIORITY.VERIFIED_PROVIDER).toBeGreaterThan(SOURCE_PRIORITY.SYNTHETIC);
    expect(isSyntheticSource("synthetic-fallback")).toBe(true);
  });
});
