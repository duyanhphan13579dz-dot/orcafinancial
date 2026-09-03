/**
 * Live preferred financials when DB has no verified facts.
 * Priority: official filing → VnDirect → Vietstock → CafeF.
 *
 * ROADMAP G1: INGESTION TÁCH KHỎI REQUEST NGƯỜI DÙNG.
 * - DB trống → request chỉ ĐỌC DB + ingest NỀN (fire-and-forget, in-flight
 *   guard chống spam); bảng BCTC xuất hiện ở lần poll kế tiếp của client.
 * - DB CÓ dữ liệu nhưng do PARSER CŨ nạp (vd. raw-v1 = lợi nhuận công ty mẹ)
 *   → request CHỜ ingest lại (tối đa STALE_REINGEST_TIMEOUT_MS) rồi đọc lại
 *   DB, để lần tải đó đã là số hợp nhất; nếu quá hạn thì trả số cũ kèm cờ
 *   parserStale để client tự thử lại.
 * - Kết quả accepted/rejected của lần ingest gần nhất phơi qua
 *   getIngestionStats() để route/admin quan sát dữ liệu mất ở bước nào.
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

/** Quá hạn chờ ingest lại khi DB chứa dữ liệu parser cũ. */
export const STALE_REINGEST_TIMEOUT_MS = 12_000;

const inFlight = new Map<string, Promise<void>>();
const lastStats = new Map<string, IngestionStats>();

/** Thống kê accepted/rejected của lần ingest nền gần nhất cho mã. */
export function getIngestionStats(symbol: string): IngestionStats | null {
  return lastStats.get(symbol.toUpperCase()) ?? null;
}

export function isBackgroundIngestRunning(symbol: string): boolean {
  return inFlight.has(symbol.toUpperCase());
}

/** Bắt đầu (hoặc lấy lại) promise ingest của mã — không trùng lặp song song. */
export function getOrStartIngest(symbol: string, limit = 8): Promise<void> {
  const key = symbol.toUpperCase();
  const existing = inFlight.get(key);
  if (existing) return existing;
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
      // Ingest xong → xóa cache BCTC để lần đọc kế tiếp nhận số mới ngay
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
  return p;
}

export function triggerBackgroundIngest(symbol: string, limit = 8): void {
  void getOrStartIngest(symbol, limit);
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
  /** DB vẫn còn dữ liệu parser cũ sau khi đã thử nạp lại → client nên thử lại. */
  parserStale: boolean;
  warnings: string[];
}> {
  const existing = await loadPreferredFinancialRecords(symbol, statementType, limit);
  if (existing.providerBacked && existing.records.length > 0) {
    // DB có dữ liệu nhưng có thể do parser cũ nạp (vd. "raw-v1" = lợi nhuận
    // công ty mẹ). Khi đó CHỜ ingest lại theo parser hiện hành rồi đọc lại.
    let stale = !(await hasCurrentParserVersion(symbol));
    if (stale) {
      await Promise.race([
        getOrStartIngest(symbol, limit),
        new Promise<void>((resolve) => {
          setTimeout(resolve, STALE_REINGEST_TIMEOUT_MS);
        }),
      ]);
      stale = !(await hasCurrentParserVersion(symbol));
    }
    const records = stale
      ? existing
      : await loadPreferredFinancialRecords(symbol, statementType, limit);
    const served = records.providerBacked && records.records.length > 0 ? records : existing;
    return {
      ...served,
      records: served.records.map((r) => ({ ...r, kind: "actual" as const })),
      ingested: false,
      parserStale: stale,
      warnings: stale
        ? [
            `DB đang chứa BCTC do parser cũ nạp — đã thử nạp lại theo ${FINANCIAL_PARSER_VERSION} (BCTC hợp nhất) nhưng chưa xong; bảng sẽ tự thử lại.`,
          ]
        : [],
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
    parserStale: false,
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
