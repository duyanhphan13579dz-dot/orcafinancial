/**
 * Live preferred financials: TCBS → Vietstock when DB has no verified facts.
 */
import { ingestFinancialSources, loadPreferredFinancialRecords, type StatementType } from "@/lib/financial-ingestion";
import { fetchVietstockFinancialStatements } from "@/lib/connectors/vietstock-financials";
import { db } from "@/db";
import { ensureFinancialIngestionTables } from "@/db/ensure-financial-ingestion-tables";
import { financialNormalizedFacts, financialSourceDocuments } from "@/db/schema";
import { createHash } from "node:crypto";

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function persistVietstockQuarters(
  symbol: string,
  limit: number,
): Promise<{ accepted: number; warnings: string[] }> {
  const result = await fetchVietstockFinancialStatements(symbol, limit);
  const warnings = [...result.warnings];
  if (!result.quarters.length) return { accepted: 0, warnings };
  await ensureFinancialIngestionTables();
  let accepted = 0;
  for (const quarter of result.quarters) {
    const documentHash = stableHash({ source: "vietstock", symbol, period: quarter.period, payload: quarter });
    const inserted = await db
      .insert(financialSourceDocuments)
      .values({
        symbol,
        source: "vietstock",
        documentType: "financial_statement",
        documentUrl: result.sourceUrl,
        documentHash,
        reportType: "quarterly_financial_statements",
        period: quarter.period,
        fiscalYear: quarter.fiscalYear,
        contentType: "application/json",
        rawPayload: quarter as unknown as Record<string, unknown>,
        status: "raw",
      })
      .onConflictDoNothing({ target: financialSourceDocuments.documentHash })
      .returning({ id: financialSourceDocuments.id });
    const documentId = inserted[0]?.id ?? null;
    for (const [statementType, data] of [
      ["income", quarter.income],
      ["balance", quarter.balance],
      ["cashflow", quarter.cashflow],
    ] as const) {
      if (!data || Object.keys(data).length === 0) continue;
      await db
        .insert(financialNormalizedFacts)
        .values({
          documentId,
          symbol,
          statementType,
          period: quarter.period,
          fiscalYear: quarter.fiscalYear,
          reportScope: "consolidated",
          currency: "VND",
          unit: "as_reported",
          source: "vietstock",
          sourceUrl: result.sourceUrl,
          qualityStatus: "accepted",
          verificationStatus: "verified",
          qualityIssues: [],
          isSynthetic: false,
          sourcePriority: 80,
          canonicalUnit: "VND",
          data,
        })
        .onConflictDoUpdate({
          target: [
            financialNormalizedFacts.symbol,
            financialNormalizedFacts.statementType,
            financialNormalizedFacts.period,
            financialNormalizedFacts.fiscalYear,
            financialNormalizedFacts.reportScope,
            financialNormalizedFacts.source,
          ],
          set: {
            data,
            qualityStatus: "accepted",
            verificationStatus: "verified",
            isSynthetic: false,
            sourcePriority: 80,
            canonicalUnit: "VND",
            normalizedAt: new Date(),
          },
        });
      accepted += 1;
    }
  }
  return { accepted, warnings };
}

export async function ensureLivePreferredFinancials(
  symbol: string,
  statementType: StatementType,
  limit = 8,
): Promise<{
  records: import("@/lib/stock-intelligence/financial-source").RawFinancialRecord[];
  source: "tcbs" | "vietstock" | "cafef";
  providerBacked: boolean;
  ingested: boolean;
  warnings: string[];
}> {
  const existing = await loadPreferredFinancialRecords(symbol, statementType, limit);
  if (existing.providerBacked && existing.records.length > 0) {
    return {
      ...existing,
      records: existing.records.map((r) => ({ ...r, kind: "actual" as const })),
      ingested: false,
      warnings: [],
    };
  }

  const warnings: string[] = [];
  try {
    const ingest = await ingestFinancialSources([symbol], limit);
    warnings.push(...ingest.warnings);
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : "ingestFinancialSources failed");
  }

  try {
    const vs = await persistVietstockQuarters(symbol.toUpperCase(), limit);
    warnings.push(...vs.warnings);
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : "vietstock persist failed");
  }

  const refreshed = await loadPreferredFinancialRecords(symbol, statementType, limit);
  return {
    ...refreshed,
    records: refreshed.records.map((r) => ({ ...r, kind: "actual" as const })),
    ingested: true,
    warnings: [
      ...warnings,
      ...(refreshed.providerBacked
        ? []
        : ["Live ingest completed but no accepted facts — set TCBS_MCP_ACCESS_TOKEN or VIETSTOCK_DATAFEED_URL."]),
    ],
  };
}
