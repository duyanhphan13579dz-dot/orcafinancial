/**
 * Phase 3 — Verified Financial Data Pipeline
 * Official/provider → raw → normalize → validate → verified DB
 */
import { ingestFinancialSources, type IngestionResult, type IngestionSource } from "@/lib/financial-ingestion";
import { validateFinancialRecord, type ValidationIssue } from "@/lib/financial-validation-engine";
import { sourcePriorityOf, isSyntheticSource } from "@/lib/financial-source-priority";
import { buildTransformationChain, checkProvenanceCompleteness } from "@/lib/financial-provenance";
import { GOLDEN_SYMBOLS } from "@/lib/golden-dataset";
import { db } from "@/db";
import { ensureFinancialIngestionTables } from "@/db/ensure-financial-ingestion-tables";
import { financialNormalizedFacts, financialSourceDocuments } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";

export interface PipelineSymbolResult {
  symbol: string;
  ingestionOk: boolean;
  documentCount: number;
  factCount: number;
  acceptedCount: number;
  rejectedCount: number;
  validationIssues: ValidationIssue[];
  provenanceScore: number;
  warnings: string[];
}

export interface VerifiedPipelineResult {
  ok: boolean;
  phase: "phase3";
  checkedAt: string;
  symbols: string[];
  sources: IngestionSource[];
  results: PipelineSymbolResult[];
  summary: {
    symbolsOk: number;
    symbolsFailed: number;
    totalAcceptedFacts: number;
    totalRejectedFacts: number;
    syntheticBlocked: number;
    recommendation: string;
  };
  ingestion: IngestionResult;
  durationMs: number;
}

export interface RunVerifiedPipelineOptions {
  symbols?: string[];
  limit?: number;
  sources?: IngestionSource[];
  skipIngest?: boolean;
}

export async function runVerifiedPipeline(
  options: RunVerifiedPipelineOptions = {},
): Promise<VerifiedPipelineResult> {
  const started = Date.now();
  const symbols = (options.symbols?.length ? options.symbols : [...GOLDEN_SYMBOLS]).map((s) =>
    s.toUpperCase(),
  );
  const limit = Math.min(20, Math.max(1, options.limit ?? 8));

  let ingestion: IngestionResult;
  if (options.skipIngest) {
    ingestion = {
      ok: true,
      checkedAt: new Date().toISOString(),
      symbols,
      sources: options.sources ?? ["vndirect", "vietstock"],
      documentCount: 0,
      normalizedFactCount: 0,
      acceptedFactCount: 0,
      rejectedFactCount: 0,
      warnings: ["skipIngest=true — validation only on existing DB rows"],
      rejected: [],
    };
  } else {
    ingestion = await ingestFinancialSources(symbols, limit);
  }

  await ensureFinancialIngestionTables();

  const results: PipelineSymbolResult[] = [];
  let syntheticBlocked = 0;

  for (const symbol of symbols) {
    const validationIssues: ValidationIssue[] = [];
    const warnings: string[] = [];

    const docs = await db
      .select()
      .from(financialSourceDocuments)
      .where(eq(financialSourceDocuments.symbol, symbol))
      .orderBy(desc(financialSourceDocuments.retrievedAt))
      .limit(limit);

    const facts = await db
      .select()
      .from(financialNormalizedFacts)
      .where(eq(financialNormalizedFacts.symbol, symbol))
      .orderBy(desc(financialNormalizedFacts.normalizedAt))
      .limit(limit * 3);

    let accepted = 0;
    let rejected = 0;
    let provenanceScoreSum = 0;
    let provenanceN = 0;

    for (const fact of facts) {
      if (isSyntheticSource(fact.source) || (fact as { isSynthetic?: boolean }).isSynthetic) {
        syntheticBlocked += 1;
        rejected += 1;
        validationIssues.push({
          code: "synthetic_in_db",
          severity: "error",
          message: `Synthetic fact in normalized table: ${symbol} ${fact.period} ${fact.statementType} source=${fact.source}`,
        });
        continue;
      }

      const priority = (fact as { sourcePriority?: number }).sourcePriority ?? sourcePriorityOf(fact.source);
      const provenance = {
        symbol: fact.symbol,
        statementType: fact.statementType as "income" | "balance" | "cashflow",
        period: fact.period,
        fiscalYear: fact.fiscalYear,
        reportScope: (fact.reportScope as "consolidated" | "parent" | "unknown") ?? "unknown",
        sourceProvider: fact.source,
        sourcePriority: priority,
        sourceDocumentId: fact.documentId ?? null,
        sourceUrl: fact.sourceUrl ?? null,
        sourcePublishedAt: fact.filingDate ?? null,
        rawUnit: fact.unit ?? "reported",
        canonicalUnit: "VND" as const,
        dataVersion: (fact as { dataVersion?: string }).dataVersion ?? "v1",
        verificationStatus: (fact.verificationStatus as "verified" | "unverified" | "rejected") ?? "unverified",
        qualityStatus: (fact.qualityStatus as "accepted" | "pending" | "rejected") ?? "pending",
        isSynthetic: false,
        transformationChain: buildTransformationChain({
          rawUnit: fact.unit ?? "reported",
          canonicalUnit: "VND",
          validated: true,
        }),
      };

      const prov = checkProvenanceCompleteness(provenance);
      provenanceScoreSum += prov.completeness;
      provenanceN += 1;

      const data = (fact.data ?? {}) as Record<string, unknown>;
      const validation = validateFinancialRecord({
        income: fact.statementType === "income" ? data : undefined,
        balance: fact.statementType === "balance" ? data : undefined,
        cashflow: fact.statementType === "cashflow" ? data : undefined,
        period: fact.period,
        fiscalYear: fact.fiscalYear,
        unitLabel: fact.unit ?? "VND",
        sampleValue:
          typeof data.revenue === "number"
            ? data.revenue
            : typeof data.totalAssets === "number"
              ? data.totalAssets
              : 0,
        provenance,
        reportScope: provenance.reportScope,
      });

      if (validation.ok && fact.qualityStatus === "accepted") {
        accepted += 1;
      } else {
        rejected += 1;
        validationIssues.push(...validation.issues);
      }
      if (!prov.ok) {
        warnings.push(...prov.issues.map((i) => `${fact.period}: ${i}`));
      }
    }

    if (docs.length === 0) {
      warnings.push("No source documents in DB — run ingestion with provider credentials");
    }
    if (facts.length === 0) {
      warnings.push("No normalized facts — verified API will return empty for this symbol");
    }

    const symbolIngestRejected = ingestion.rejected.filter((r) => r.symbol === symbol).length;
    results.push({
      symbol,
      ingestionOk: symbolIngestRejected === 0 && (ingestion.ok || facts.length > 0),
      documentCount: docs.length,
      factCount: facts.length,
      acceptedCount: accepted,
      rejectedCount: rejected + symbolIngestRejected,
      validationIssues: validationIssues.slice(0, 50),
      provenanceScore: provenanceN ? provenanceScoreSum / provenanceN : 0,
      warnings,
    });
  }

  const symbolsOk = results.filter(
    (r) => r.acceptedCount > 0 && r.validationIssues.every((i) => i.severity !== "error"),
  ).length;
  const symbolsFailed = results.length - symbolsOk;
  const totalAcceptedFacts = results.reduce((a, r) => a + r.acceptedCount, 0);
  const totalRejectedFacts = results.reduce((a, r) => a + r.rejectedCount, 0);

  let recommendation: string;
  if (totalAcceptedFacts === 0) {
    recommendation =
      "Chưa có fact verified. Kiểm tra provider credentials, chạy lại pipeline, điền golden expected values.";
  } else if (syntheticBlocked > 0) {
    recommendation = `Phát hiện ${syntheticBlocked} synthetic trong DB — chạy financial-data-cleanup trước khi go-live.`;
  } else if (symbolsFailed > 0) {
    recommendation = `${symbolsFailed}/${results.length} mã chưa đạt validation — xem validationIssues từng symbol.`;
  } else {
    recommendation = "Pipeline đạt mức verified cơ bản. Tiếp tục Phase 4 release gate + golden fill.";
  }

  const ok = syntheticBlocked === 0 && totalAcceptedFacts > 0 && symbolsFailed === 0;

  return {
    ok,
    phase: "phase3",
    checkedAt: new Date().toISOString(),
    symbols,
    sources: ingestion.sources,
    results,
    summary: {
      symbolsOk,
      symbolsFailed,
      totalAcceptedFacts,
      totalRejectedFacts,
      syntheticBlocked,
      recommendation,
    },
    ingestion,
    durationMs: Date.now() - started,
  };
}

function rowCountOf(res: unknown): number {
  const r = res as { rowCount?: number | null } | null;
  return Number(r?.rowCount ?? 0);
}

export async function quarantineSyntheticFacts(symbol?: string): Promise<{ updated: number }> {
  await ensureFinancialIngestionTables();
  const pattern = "%synthetic%";
  if (symbol) {
    const res = await db.execute(sql`
      UPDATE financial_normalized_facts
      SET quality_status = 'rejected', verification_status = 'rejected'
      WHERE symbol = ${symbol.toUpperCase()}
        AND (source ILIKE ${pattern} OR COALESCE(is_synthetic, false) = true)
    `);
    return { updated: rowCountOf(res) };
  }
  const res = await db.execute(sql`
    UPDATE financial_normalized_facts
    SET quality_status = 'rejected', verification_status = 'rejected'
    WHERE source ILIKE ${pattern} OR COALESCE(is_synthetic, false) = true
  `);
  return { updated: rowCountOf(res) };
}

export async function countVerifiedFacts(symbol: string): Promise<number> {
  await ensureFinancialIngestionTables();
  const rows = await db
    .select({ id: financialNormalizedFacts.id })
    .from(financialNormalizedFacts)
    .where(
      and(
        eq(financialNormalizedFacts.symbol, symbol.toUpperCase()),
        eq(financialNormalizedFacts.qualityStatus, "accepted"),
      ),
    )
    .limit(500);
  return rows.length;
}
