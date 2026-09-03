/**
 * Live preferred financials when DB has no verified facts.
 * Priority: official filing → VnDirect → Vietstock → CafeF.
 *
 * ROADMAP G1: INGESTION TÁCH KHỎI REQUEST NGƯỜI DÙNG.
 * - Request chỉ ĐỌC DB (loadPreferredFinancialRecords) — không bao giờ chờ upstream.
 * - Khi DB trống, ingest chạy NỀN (fire-and-forget, có in-flight guard chống spam);
 *   bảng BCTC sẽ xuất hiện ở lần poll kế tiếp của client.
 * - Kết quả accepted/rejected của lần ingest gần nhất lưu trong bộ nhớ và phơi
 *   qua getIngestionStats() để route/admin quan sát dữ liệu mất ở bước nào.
 */
import {
  ingestFinancialSources,
  loadPreferredFinancialRecords,
  hasCurrentParserVersion,
  FINANCIAL_PARSER_VERSION,
  type StatementType,
} from "@/lib/financial-ingestion";

export interface IngestionStats {
  documentCount: number;
  normalizedFactCount: number;
  acceptedFactCount: number;
  rejectedFactCount: number;
  rejected: Array<{ symbol: string; source: string; period: string; statementType: string; reason: string }>;
  warnings: string[];
  finishedAt: string;
}

const inFlight = new Map<string, Promise<void>>();
const lastStats = new Map<string, IngestionStats>();

/** Thống kê accepted/rejected của lần ingest nền gần nhất cho mã. */
export function getIngestionStats(symbol: string): IngestionStats | null {
  return lastStats.get(symbol.toUpperCase()) ?? null;
}

export function isBackgroundIngestRunning(symbol: string): boolean {
  return inFlight.has(symbol.toUpperCase());
}

export function triggerBackgroundIngest(symbol: string, limit = 8): void {
  const key = symbol.toUpperCase();
  if (inFlight.has(key)) return;
  const p = ingestFinancialSources([key], limit)
    .then(async (r) => {
      lastStats.set(key, {
        documentCount: r.documentCount,
        normalizedFactCount: r.normalizedFactCount,
        acceptedFactCount: r.acceptedFactCount,
        rejectedFactCount: r.rejectedFactCount,
        rejected: r.rejected.slice(0, 20),
        warnings: r.warnings,
        finishedAt: new Date().toISOString(),
      });
      // Ingest xong → xóa cache BCTC để lần poll kế tiếp đọc số mới ngay
      // (không phải chờ TTL 10 phút của statements cache).
      if (r.acceptedFactCount > 0) {
        const { invalidateStatementsCache } = await import("@/lib/company-service");
        await invalidateStatementsCache(key);
      }
    })
    .catch(() => {
      // giữ stats cũ; warnings của route sẽ cho người dùng biết trạng thái
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, p);
}

export async function ensureLivePreferredFinancials(
  symbol: string,
  statementType: StatementType,
  limit = 8,
): Promise<{
  records: import("@/lib/stock-intelligence/financial-source").RawFinancialRecord[];
  source: "filing" | "vndirect" | "vietstock" | "cafef";
  providerBacked: boolean;
  ingested: boolean;
  warnings: string[];
}> {
  const existing = await loadPreferredFinancialRecords(symbol, statementType, limit);
  if (existing.providerBacked && existing.records.length > 0) {
    // DB có dữ liệu nhưng do parser cũ nạp (vd. "raw-v1" = lợi nhuận công ty
    // mẹ) → ingest lại NỀN theo parser hiện hành (consol-v2 = hợp nhất).
    // Request này vẫn trả dữ liệu cũ; lần poll kế tiếp sẽ có số hợp nhất.
    let staleWarnings: string[] = [];
    if (!(await hasCurrentParserVersion(symbol))) {
      triggerBackgroundIngest(symbol, limit);
      staleWarnings = [
        `DB đang chứa BCTC do parser cũ nạp — đang nạp lại theo ${FINANCIAL_PARSER_VERSION} (BCTC hợp nhất). Lần tải sau sẽ hiển thị số hợp nhất.`,
      ];
    }
    return {
      ...existing,
      records: existing.records.map((r) => ({ ...r, kind: "actual" as const })),
      ingested: false,
      warnings: staleWarnings,
    };
  }

  // ROADMAP G1: không chặn request — ingest chạy nền.
  triggerBackgroundIngest(symbol, limit);

  const refreshed = await loadPreferredFinancialRecords(symbol, statementType, limit);
  const stats = getIngestionStats(symbol);
  return {
    ...refreshed,
    records: refreshed.records.map((r) => ({ ...r, kind: "actual" as const })),
    ingested: false,
    warnings: refreshed.providerBacked
      ? []
      : [
          `Chưa có BCTC verified trong DB — ingest đang chạy NỀN (request không chờ upstream).${
            isBackgroundIngestRunning(symbol) ? " Lần poll sau sẽ có dữ liệu nếu nguồn trả về." : ""
          }${
            stats
              ? ` Kết quả ingest gần nhất: ${stats.acceptedFactCount} accepted / ${stats.rejectedFactCount} rejected.`
              : " Cấu hình VNDIRECT_DATAFEED_URL / VIETSTOCK_DATAFEED_URL / CAFEF_DATA_URL để có nguồn thật."
          }`,
        ],
  };
}
