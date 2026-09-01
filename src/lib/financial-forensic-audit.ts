/**
 * Phase 1 — Financial Forensic Audit
 *
 * Traces a ticker through the full pipeline:
 *   SOURCE → RAW → NORMALIZED → DB → API SHAPE → KEY METRICS
 *
 * Goal: find the first mismatch; never "fix downstream" without knowing
 * where values start diverging from official filings.
 */

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  financialNormalizedFacts,
  financialSourceDocuments,
  financialStatements,
} from "@/db/schema";
import { ensureFinancialIngestionTables } from "@/db/ensure-financial-ingestion-tables";
import { getLatestCompletedQuarter } from "@/lib/financial-statements";
import {
  isSyntheticSource,
  sourcePriorityOf,
} from "@/lib/financial-source-priority";
import { toCanonicalVnd } from "@/lib/financial-canonical-unit";
import { validateAccountingIdentities } from "@/lib/financial-validation-engine";
import { GOLDEN_METRICS, type GoldenMetric } from "@/lib/golden-dataset";

export type PipelineLayer =
  | "source_document"
  | "normalized_fact"
  | "financial_statements_db"
  | "canonical_api"
  | "golden_expected";

export interface LayerSnapshot {
  layer: PipelineLayer;
  present: boolean;
  period?: string;
  fiscalYear?: number;
  source?: string;
  sourcePriority?: number;
  isSynthetic?: boolean;
  verificationStatus?: string;
  reportScope?: string;
  unit?: string;
  currency?: string;
  metrics: Record<string, number | null>;
  documentUrl?: string | null;
  rawSample?: unknown;
  notes: string[];
}

export interface MetricTrace {
  metric: string;
  valuesByLayer: Partial<Record<PipelineLayer, number | null>>;
  firstMismatchLayer: PipelineLayer | null;
  mismatchDetail: string | null;
  consistent: boolean;
}

export interface ForensicAuditResult {
  ok: boolean;
  symbol: string;
  checkedAt: string;
  expectedLatestPeriod: string;
  layers: LayerSnapshot[];
  metricTraces: MetricTrace[];
  accountingValidation: ReturnType<typeof validateAccountingIdentities>;
  goldenComparison: Array<{
    metric: string;
    period: string;
    expected: number | null;
    actual: number | null;
    tolerancePct: number;
    pass: boolean;
    note: string;
  }>;
  firstMismatch: {
    layer: PipelineLayer;
    metric?: string;
    detail: string;
  } | null;
  summary: {
    sourceDocumentCount: number;
    normalizedFactCount: number;
    verifiedFactCount: number;
    syntheticDbRowCount: number;
    nonSyntheticDbRowCount: number;
    hasVerifiedPipeline: boolean;
    recommendation: string;
  };
  warnings: string[];
}

const KEY_METRICS = [
  "revenue",
  "costOfGoodsSold",
  "grossProfit",
  "operatingIncome",
  "netIncome",
  "ebitda",
  "eps",
  "totalAssets",
  "totalLiabilities",
  "equity",
  "operatingCashFlow",
  "freeCashFlow",
] as const;

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickMetrics(data: Record<string, unknown> | null | undefined): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  if (!data) {
    for (const k of KEY_METRICS) out[k] = null;
    return out;
  }
  for (const k of KEY_METRICS) out[k] = num(data[k]);
  return out;
}

function relativeDiff(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / denom;
}

export async function runFinancialForensicAudit(symbolRaw: string): Promise<ForensicAuditResult> {
  const symbol = symbolRaw.trim().toUpperCase();
  const warnings: string[] = [];
  const layers: LayerSnapshot[] = [];
  await ensureFinancialIngestionTables();

  const latest = getLatestCompletedQuarter();
  const expectedLatestPeriod = `Q${latest.quarter}/${latest.fiscalYear}`;

  const documents = await db
    .select()
    .from(financialSourceDocuments)
    .where(eq(financialSourceDocuments.symbol, symbol))
    .orderBy(desc(financialSourceDocuments.retrievedAt))
    .limit(24);

  layers.push({
    layer: "source_document",
    present: documents.length > 0,
    source: documents[0]?.source,
    documentUrl: documents[0]?.documentUrl ?? null,
    metrics: {},
    rawSample: documents[0]
      ? {
          id: documents[0].id,
          source: documents[0].source,
          period: documents[0].period,
          fiscalYear: documents[0].fiscalYear,
          status: documents[0].status,
          parserVersion: documents[0].parserVersion,
          documentUrl: documents[0].documentUrl,
        }
      : null,
    notes:
      documents.length === 0
        ? ["Không có financial_source_documents cho mã này."]
        : [`${documents.length} document(s). Mới nhất: ${documents[0].source} period=${documents[0].period ?? "n/a"}.`],
  });

  const facts = await db
    .select()
    .from(financialNormalizedFacts)
    .where(eq(financialNormalizedFacts.symbol, symbol))
    .orderBy(desc(financialNormalizedFacts.fiscalYear), desc(financialNormalizedFacts.period))
    .limit(60);

  const verifiedFacts = facts.filter(
    (f) => f.qualityStatus === "accepted" && f.verificationStatus === "verified",
  );
  const latestIncome = verifiedFacts.find((f) => f.statementType === "income")
    ?? facts.find((f) => f.statementType === "income");
  const latestBalance = verifiedFacts.find((f) => f.statementType === "balance")
    ?? facts.find((f) => f.statementType === "balance");
  const latestCashflow = verifiedFacts.find((f) => f.statementType === "cashflow")
    ?? facts.find((f) => f.statementType === "cashflow");

  const mergedNormalized: Record<string, unknown> = {
    ...(typeof latestIncome?.data === "object" && latestIncome?.data ? (latestIncome.data as object) : {}),
    ...(typeof latestBalance?.data === "object" && latestBalance?.data ? (latestBalance.data as object) : {}),
    ...(typeof latestCashflow?.data === "object" && latestCashflow?.data ? (latestCashflow.data as object) : {}),
  };

  const normUnit = latestIncome?.unit ?? latestBalance?.unit ?? "reported";
  const normMetrics = pickMetrics(mergedNormalized);
  const canonicalNotes: string[] = [];
  for (const [k, v] of Object.entries(normMetrics)) {
    if (v == null) continue;
    const conv = toCanonicalVnd(v, normUnit);
    if (conv.multiplier !== 1) {
      canonicalNotes.push(`${k}: ${v} (${normUnit}) → ${conv.canonicalVnd} VND`);
    }
  }

  layers.push({
    layer: "normalized_fact",
    present: facts.length > 0,
    period: latestIncome?.period ?? latestBalance?.period,
    fiscalYear: latestIncome?.fiscalYear ?? latestBalance?.fiscalYear,
    source: latestIncome?.source ?? latestBalance?.source,
    sourcePriority: sourcePriorityOf(latestIncome?.source ?? latestBalance?.source ?? ""),
    isSynthetic: isSyntheticSource(latestIncome?.source ?? ""),
    verificationStatus: latestIncome?.verificationStatus ?? latestBalance?.verificationStatus,
    reportScope: latestIncome?.reportScope ?? latestBalance?.reportScope,
    unit: normUnit,
    currency: latestIncome?.currency ?? "VND",
    metrics: normMetrics,
    documentUrl: latestIncome?.sourceUrl ?? null,
    notes: [
      `${facts.length} fact row(s), ${verifiedFacts.length} verified.`,
      ...canonicalNotes.slice(0, 5),
      facts.length === 0 ? "Không có normalized facts — pipeline verified chưa có dữ liệu." : "",
    ].filter(Boolean),
  });

  const stmtRows = await db
    .select()
    .from(financialStatements)
    .where(eq(financialStatements.symbol, symbol))
    .orderBy(desc(financialStatements.fiscalYear), desc(financialStatements.period))
    .limit(40);

  const syntheticRows = stmtRows.filter((r) => isSyntheticSource(r.source));
  const nonSyntheticRows = stmtRows.filter((r) => !isSyntheticSource(r.source));

  const incomeRow = nonSyntheticRows.find((r) => r.type === "income")
    ?? stmtRows.find((r) => r.type === "income");
  const balanceRow = nonSyntheticRows.find((r) => r.type === "balance")
    ?? stmtRows.find((r) => r.type === "balance");
  const cashflowRow = nonSyntheticRows.find((r) => r.type === "cashflow")
    ?? stmtRows.find((r) => r.type === "cashflow");

  const mergedDb: Record<string, unknown> = {
    ...(typeof incomeRow?.data === "object" && incomeRow?.data ? (incomeRow.data as object) : {}),
    ...(typeof balanceRow?.data === "object" && balanceRow?.data ? (balanceRow.data as object) : {}),
    ...(typeof cashflowRow?.data === "object" && cashflowRow?.data ? (cashflowRow.data as object) : {}),
  };

  layers.push({
    layer: "financial_statements_db",
    present: stmtRows.length > 0,
    period: incomeRow ? `Q${String(incomeRow.period).replace(/^Q/i, "")}/${incomeRow.fiscalYear}` : undefined,
    fiscalYear: incomeRow?.fiscalYear,
    source: incomeRow?.source,
    sourcePriority: sourcePriorityOf(incomeRow?.source ?? ""),
    isSynthetic: isSyntheticSource(incomeRow?.source ?? ""),
    metrics: pickMetrics(mergedDb),
    notes: [
      `${stmtRows.length} row(s): ${nonSyntheticRows.length} non-synthetic, ${syntheticRows.length} synthetic.`,
      syntheticRows.length > 0
        ? "CẢNH BÁO: còn sector-synthetic-* trong financial_statements — nên cleanup."
        : "Không còn synthetic rows trong financial_statements.",
    ],
  });

  const apiMetrics = verifiedFacts.length > 0 ? normMetrics : pickMetrics({});
  layers.push({
    layer: "canonical_api",
    present: verifiedFacts.length > 0,
    period: latestIncome?.period,
    fiscalYear: latestIncome?.fiscalYear,
    source: latestIncome?.source,
    sourcePriority: sourcePriorityOf(latestIncome?.source ?? ""),
    isSynthetic: false,
    verificationStatus: verifiedFacts.length > 0 ? "verified" : "unavailable",
    metrics: apiMetrics,
    notes: [
      verifiedFacts.length > 0
        ? "Public API sẽ serve normalized verified facts."
        : "Public API trả unavailable (Phase 0 policy) — không synthetic.",
    ],
  });

  const metricTraces: MetricTrace[] = KEY_METRICS.map((metric) => {
    const valuesByLayer: Partial<Record<PipelineLayer, number | null>> = {
      normalized_fact: layers.find((l) => l.layer === "normalized_fact")?.metrics[metric] ?? null,
      financial_statements_db: layers.find((l) => l.layer === "financial_statements_db")?.metrics[metric] ?? null,
      canonical_api: layers.find((l) => l.layer === "canonical_api")?.metrics[metric] ?? null,
    };

    let firstMismatchLayer: PipelineLayer | null = null;
    let mismatchDetail: string | null = null;
    const sequence: Array<[PipelineLayer, number | null]> = [
      ["normalized_fact", valuesByLayer.normalized_fact ?? null],
      ["financial_statements_db", valuesByLayer.financial_statements_db ?? null],
      ["canonical_api", valuesByLayer.canonical_api ?? null],
    ];

    let prev: { layer: PipelineLayer; value: number } | null = null;
    for (const [layer, value] of sequence) {
      if (value == null) continue;
      if (prev && relativeDiff(prev.value, value) > 0.02) {
        firstMismatchLayer = layer;
        mismatchDetail = `${metric}: ${prev.layer}=${prev.value} → ${layer}=${value} (Δ>${(relativeDiff(prev.value, value) * 100).toFixed(1)}%)`;
        break;
      }
      prev = { layer, value };
    }

    const normV = valuesByLayer.normalized_fact;
    const dbV = valuesByLayer.financial_statements_db;
    const dbLayer = layers.find((l) => l.layer === "financial_statements_db");
    if (
      !firstMismatchLayer &&
      normV != null &&
      dbV != null &&
      dbLayer?.isSynthetic &&
      relativeDiff(normV, dbV) > 0.05
    ) {
      firstMismatchLayer = "financial_statements_db";
      mismatchDetail = `${metric}: normalized(verified)=${normV} vs DB(synthetic)=${dbV}`;
    }

    return {
      metric,
      valuesByLayer,
      firstMismatchLayer,
      mismatchDetail,
      consistent: firstMismatchLayer == null,
    };
  });

  const accountingValidation = validateAccountingIdentities({
    income: pickMetrics(
      (typeof latestIncome?.data === "object" && latestIncome?.data
        ? (latestIncome.data as Record<string, unknown>)
        : typeof incomeRow?.data === "object" && incomeRow?.data
          ? (incomeRow.data as Record<string, unknown>)
          : {}) as Record<string, unknown>,
    ),
    balance: pickMetrics(
      (typeof latestBalance?.data === "object" && latestBalance?.data
        ? (latestBalance.data as Record<string, unknown>)
        : typeof balanceRow?.data === "object" && balanceRow?.data
          ? (balanceRow.data as Record<string, unknown>)
          : {}) as Record<string, unknown>,
    ),
    cashflow: pickMetrics(
      (typeof latestCashflow?.data === "object" && latestCashflow?.data
        ? (latestCashflow.data as Record<string, unknown>)
        : typeof cashflowRow?.data === "object" && cashflowRow?.data
          ? (cashflowRow.data as Record<string, unknown>)
          : {}) as Record<string, unknown>,
    ),
  });

  const goldenForSymbol = GOLDEN_METRICS.filter((g) => g.symbol === symbol);
  const goldenComparison = goldenForSymbol.map((g: GoldenMetric) => {
    const actual =
      (verifiedFacts.find(
        (f) =>
          f.statementType === g.statementType &&
          (f.period === g.period || f.period === `Q${g.period.replace(/^Q/i, "")}`),
      )?.data as Record<string, unknown> | undefined)?.[g.metric];
    const actualNum = num(actual);
    const expected = g.expectedValue;
    const tolerancePct = g.tolerancePct ?? 0.02;
    let pass = false;
    if (expected == null && actualNum == null) pass = true;
    else if (expected != null && actualNum != null) pass = relativeDiff(expected, actualNum) <= tolerancePct;
    return {
      metric: g.metric,
      period: g.period,
      expected,
      actual: actualNum,
      tolerancePct,
      pass,
      note: g.note ?? (actualNum == null ? "Thiếu actual verified" : pass ? "OK" : "Sai lệch vượt tolerance"),
    };
  });

  let firstMismatch: ForensicAuditResult["firstMismatch"] = null;
  if (documents.length === 0 && facts.length === 0) {
    firstMismatch = {
      layer: "source_document",
      detail: "Không có source document / normalized fact — pipeline chưa ingest dữ liệu verified.",
    };
  } else if (verifiedFacts.length === 0 && facts.length > 0) {
    firstMismatch = {
      layer: "normalized_fact",
      detail: "Có facts nhưng chưa verificationStatus=verified / qualityStatus=accepted.",
    };
  } else {
    const badTrace = metricTraces.find((t) => t.firstMismatchLayer);
    if (badTrace) {
      firstMismatch = {
        layer: badTrace.firstMismatchLayer!,
        metric: badTrace.metric,
        detail: badTrace.mismatchDetail ?? "Metric mismatch across layers.",
      };
    }
  }

  const hasVerifiedPipeline = verifiedFacts.length > 0;
  const recommendation = !hasVerifiedPipeline
    ? "Ingest từ VnDirect/Vietstock/CafeF + chạy quality gate. Không serve synthetic."
    : syntheticRows.length > 0
      ? "Có verified facts nhưng DB còn synthetic rows — chạy financial-data-cleanup."
      : firstMismatch
        ? `Điều tra mismatch tại layer ${firstMismatch.layer}: ${firstMismatch.detail}`
        : "Pipeline verified ổn định cho mã này; tiếp tục regression golden dataset.";

  if (syntheticRows.length > 0) {
    warnings.push(`Phát hiện ${syntheticRows.length} synthetic row(s) trong financial_statements.`);
  }
  if (!hasVerifiedPipeline) {
    warnings.push("Chưa có verified normalized facts — public API sẽ trả unavailable.");
  }

  return {
    ok: hasVerifiedPipeline && firstMismatch == null && accountingValidation.ok,
    symbol,
    checkedAt: new Date().toISOString(),
    expectedLatestPeriod,
    layers,
    metricTraces,
    accountingValidation,
    goldenComparison,
    firstMismatch,
    summary: {
      sourceDocumentCount: documents.length,
      normalizedFactCount: facts.length,
      verifiedFactCount: verifiedFacts.length,
      syntheticDbRowCount: syntheticRows.length,
      nonSyntheticDbRowCount: nonSyntheticRows.length,
      hasVerifiedPipeline,
      recommendation,
    },
    warnings,
  };
}
