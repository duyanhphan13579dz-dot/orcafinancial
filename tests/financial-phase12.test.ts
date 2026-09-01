import { describe, expect, it } from "vitest";
import { toCanonicalVnd, detectUnit, formatVndDisplay } from "@/lib/financial-canonical-unit";
import {
  SOURCE_PRIORITY,
  isSyntheticSource,
  sourcePriorityOf,
  pickPreferredRecord,
} from "@/lib/financial-source-priority";
import { validateAccountingIdentities } from "@/lib/financial-validation-engine";
import { GOLDEN_METRICS, GOLDEN_SYMBOLS } from "@/lib/golden-dataset";

describe("Phase 2 canonical unit", () => {
  it("converts billion VND to absolute VND", () => {
    const r = toCanonicalVnd(38_500, "BILLION_VND");
    expect(r.canonicalVnd).toBe(38_500 * 1_000_000_000);
    expect(r.multiplier).toBe(1_000_000_000);
  });

  it("detects Vietnamese unit labels", () => {
    expect(detectUnit("tỷ VND")).toBe("BILLION_VND");
    expect(detectUnit("million")).toBe("MILLION_VND");
  });

  it("formats display without inventing conversion on frontend side", () => {
    const d = formatVndDisplay(38_500_000_000_000);
    expect(d.suffix).toMatch(/tỷ/);
  });
});

describe("Phase 2 source priority", () => {
  it("ranks official above synthetic", () => {
    expect(sourcePriorityOf("filing")).toBe(SOURCE_PRIORITY.OFFICIAL_FILING);
    expect(sourcePriorityOf("sector-synthetic-v2")).toBe(SOURCE_PRIORITY.SYNTHETIC);
    expect(sourcePriorityOf("vietstock")).toBe(SOURCE_PRIORITY.VERIFIED_PROVIDER);
  });

  it("detects synthetic sources", () => {
    expect(isSyntheticSource("sector-synthetic-v2")).toBe(true);
    expect(isSyntheticSource("vietstock")).toBe(false);
  });

  it("never lets synthetic win when non-synthetic exists", () => {
    const winner = pickPreferredRecord([
      { source: "sector-synthetic-v2", verificationStatus: "unverified", updatedAt: new Date().toISOString() },
      { source: "vietstock", verificationStatus: "verified", qualityStatus: "accepted", updatedAt: "2020-01-01" },
    ]);
    expect(winner?.source).toBe("vietstock");
  });
});

describe("Phase 2 validation engine", () => {
  it("passes balanced sheet identity", () => {
    const r = validateAccountingIdentities({
      balance: { totalAssets: 100, totalLiabilities: 40, equity: 60 },
      income: { revenue: 50, costOfGoodsSold: 30, grossProfit: 20 },
    });
    expect(r.ok).toBe(true);
  });

  it("flags gross profit identity errors", () => {
    const r = validateAccountingIdentities({
      income: { revenue: 100, costOfGoodsSold: 40, grossProfit: 10 },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "gross_profit_identity")).toBe(true);
  });
});

describe("Phase 1 golden dataset structure", () => {
  it("includes HPG and core symbols", () => {
    expect(GOLDEN_SYMBOLS).toContain("HPG");
    expect(GOLDEN_METRICS.some((g) => g.symbol === "HPG" && g.metric === "revenue")).toBe(true);
  });
});
