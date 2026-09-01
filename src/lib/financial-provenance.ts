/**
 * Phase 3 — Financial data provenance model
 *
 * Every verified value must answer: which company, which period, which report
 * type, which scope, which source, what raw value, and which transformations.
 */

export type ReportScope = "consolidated" | "parent" | "unknown";
export type VerificationStatus = "verified" | "unverified" | "rejected";
export type QualityStatus = "accepted" | "pending" | "rejected";

export interface FinancialProvenance {
  symbol: string;
  statementType: "income" | "balance" | "cashflow";
  period: string;
  fiscalYear: number;
  reportScope: ReportScope;
  sourceProvider: string;
  sourcePriority: number;
  sourceDocumentId: number | null;
  sourceUrl: string | null;
  sourcePublishedAt: string | null;
  rawUnit: string;
  canonicalUnit: "VND";
  dataVersion: string;
  verificationStatus: VerificationStatus;
  qualityStatus: QualityStatus;
  isSynthetic: boolean;
  transformationChain: string[];
}

export interface ProvenanceCheckResult {
  ok: boolean;
  issues: string[];
  completeness: number;
}

/** Minimum fields required for a fact to be labeled Verified. */
export function checkProvenanceCompleteness(p: Partial<FinancialProvenance>): ProvenanceCheckResult {
  const issues: string[] = [];
  if (!p.symbol) issues.push("missing symbol");
  if (!p.statementType) issues.push("missing statementType");
  if (!p.period) issues.push("missing period");
  if (p.fiscalYear == null || !Number.isFinite(p.fiscalYear)) issues.push("missing fiscalYear");
  if (!p.reportScope || p.reportScope === "unknown") issues.push("reportScope unknown or missing");
  if (!p.sourceProvider) issues.push("missing sourceProvider");
  if (p.isSynthetic === true) issues.push("synthetic data cannot be verified");
  if (!p.rawUnit) issues.push("missing rawUnit");
  if (!p.canonicalUnit) issues.push("missing canonicalUnit");
  if (!p.sourceDocumentId && !p.sourceUrl) issues.push("missing source document link (id or url)");

  const required = 10;
  const failed = issues.length;
  const completeness = Math.max(0, Math.min(1, (required - failed) / required));
  return { ok: issues.length === 0, issues, completeness };
}

export function buildTransformationChain(opts: {
  rawUnit: string;
  canonicalUnit: string;
  multiplier?: number;
  validated?: boolean;
}): string[] {
  const chain = ["source_fetch", "raw_store"];
  if (opts.rawUnit !== opts.canonicalUnit || (opts.multiplier != null && opts.multiplier !== 1)) {
    chain.push(`normalize_unit:${opts.rawUnit}->${opts.canonicalUnit}${opts.multiplier != null ? `*${opts.multiplier}` : ""}`);
  } else {
    chain.push("normalize_unit:identity");
  }
  if (opts.validated) chain.push("validation_pass");
  chain.push("verified_store");
  return chain;
}
