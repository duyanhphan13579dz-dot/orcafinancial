/**
 * Live preferred financials when DB has no verified facts.
 * Priority: official filing → VnDirect → Vietstock → CafeF.
 */
import {
  ingestFinancialSources,
  loadPreferredFinancialRecords,
  type StatementType,
} from "@/lib/financial-ingestion";

export async function ensureLivePreferredFinancials(
  symbol: string,
  statementType: StatementType,
  limit = 8,
): Promise<{
  records: import("@/lib/stock-intelligence/financial-source").RawFinancialRecord[];
  source: "filing" | "vndirect" | "vci" | "vietstock" | "cafef";
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

  const refreshed = await loadPreferredFinancialRecords(symbol, statementType, limit);
  return {
    ...refreshed,
    records: refreshed.records.map((r) => ({ ...r, kind: "actual" as const })),
    ingested: true,
    warnings: [
      ...warnings,
      ...(refreshed.providerBacked
        ? []
        : [
            "Live ingest completed but no accepted facts — configure OFFICIAL_FILING_DATAFEED_URL, VNDIRECT_DATAFEED_URL, VCI_DATAFEED_URL, VIETSTOCK_DATAFEED_URL, or CAFEF_DATA_URL.",
          ]),
    ],
  };
}
