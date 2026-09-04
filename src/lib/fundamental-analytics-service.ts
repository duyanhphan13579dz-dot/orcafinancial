/**
 * Fundamental Analytics Service
 *
 * Một lần gọi = một lượt đọc dữ liệu duy nhất, sau đó tính cả 3 khối:
 *   • Hiệu suất kinh doanh  (fundamental-performance)
 *   • Sức khỏe tài chính    (fundamental-health + financial-health-detail)
 *   • Định giá doanh nghiệp  (fundamental-valuation)
 *
 * Tối ưu tốc độ:
 *   1. `Promise.all` — đọc BCTC / giá / hồ sơ doanh nghiệp song song (không tuần tự).
 *   2. `cachedWithStaleFallback()` (Upstash hoặc in-memory + in-flight dedupe
 *      + stale-while-revalidate) — 3 endpoint
 *      `/fundamental`, `/fundamental-chart`, `/financial-health-detail` và
 *      `/fundamental-analytics` dùng CHUNG một kết quả đã tính.
 *   3. Engine thuần (không I/O) — chi phí tính lại gần như bằng 0.
 */

import { cachedWithStaleFallback, type Ohlcv } from "@/lib/connectors/core";
import { ensureQuarterlyFinancials } from "@/lib/company-service";
import { fetchVndirectFinfoFinancialStatements } from "@/lib/connectors/vndirect-financials";
import { injectSharesOutstanding, toFinancialQuarters } from "@/lib/finfo-ratios";
import { loadPreferredQuarterlyFinancials } from "@/lib/financial-ingestion";
import { buildDataQualitySnapshot, validateFinancialQuarters } from "@/lib/stock-intelligence/validation";
import { getBenchmarkForSymbol } from "@/lib/industry-benchmarks";
import { getHistory, getQuote } from "@/lib/market";
import { logger } from "@/lib/logger";
import { buildFundamentalContext, type FundamentalContext } from "@/lib/fundamental-engine";
import { buildStatementSource, type StatementSource } from "@/lib/fundamental-source";
import { computeBusinessPerformance, type BusinessPerformance } from "@/lib/fundamental-performance";
import { computeAdvancedHealth, type AdvancedHealth } from "@/lib/fundamental-health";
import {
  computeValuation,
  defaultMacroAssumptions,
  type MacroAssumptions,
  type ValuationResult,
} from "@/lib/fundamental-valuation";
import { evaluateHealthDetail, type HealthDetail } from "@/lib/financial-health-detail";
import { buildFundamentalChart, type FundamentalChart } from "@/lib/fundamental-chart";
import type { FinancialQuarter } from "@/lib/financial-statements";

export const ANALYTICS_CACHE_TTL_MS = 10 * 60_000;
export const ANALYTICS_QUARTERS = 12;

export interface FundamentalInputs {
  symbol: string;
  quarters: FinancialQuarter[];
  source: string;
  providerBacked: boolean;
  /** "standalone" khi quarters đến từ finfo (reportType QUARTER = riêng quý). */
  basis?: "standalone";
  price: number | null;
  beta: number | null;
  priceSource: string;
  loadWarnings: string[];
  loadedAt: string;
}

export interface FundamentalAnalytics {
  symbol: string;
  generatedAt: string;
  computedInMs: number;
  available: boolean;
  inputs: {
    quarters: number;
    source: string;
    providerBacked: boolean;
    price: number | null;
    beta: number | null;
    basis: string;
    ltmMethod: string;
    ltmPeriod: string;
  };
  /**
   * Số liệu BCTC NGUỒN đã chuẩn hoá (số riêng quý + LTM + số dư bình quân).
   * Đây chính là ngữ cảnh engine dùng để tính 3 khối dưới, nên bảng nguồn và
   * bảng phân tích luôn khớp nhau từng dòng.
   */
  statement: StatementSource | null;
  performance: BusinessPerformance | null;
  health: AdvancedHealth | null;
  healthDetail: HealthDetail | null;
  valuation: ValuationResult | null;
  chart: FundamentalChart | null;
  quality: ReturnType<typeof buildDataQualitySnapshot> | null;
  warnings: string[];
}

/* ────────────────────────────────────────────────────────────
 * Nạp dữ liệu đầu vào (song song, có cache)
 * ──────────────────────────────────────────────────────────── */

async function loadPrice(symbol: string): Promise<{ price: number | null; source: string }> {
  try {
    const quote = await getQuote(symbol, { persist: false, fast: true, allowStale: true });
    if (Number.isFinite(quote.close) && quote.close > 0) {
      return { price: quote.close, source: quote.source };
    }
  } catch (err) {
    logger.warn("analytics_quote_failed", { symbol, error: String(err) });
  }
  try {
    const to = Math.floor(Date.now() / 1000);
    const { bars, source } = await getHistory(symbol, to - 86400 * 45, to, "D");
    const last = bars[bars.length - 1];
    if (last && Number.isFinite(last.close) && last.close > 0) return { price: last.close, source };
  } catch (err) {
    logger.warn("analytics_history_fallback_failed", { symbol, error: String(err) });
  }
  return { price: null, source: "none" };
}

async function loadQuarters(
  symbol: string,
): Promise<{
  quarters: FinancialQuarter[];
  source: string;
  providerBacked: boolean;
  basis?: "standalone";
  warnings: string[];
}> {
  const warnings: string[] = [];
  try {
    const preferred = await loadPreferredQuarterlyFinancials(symbol, ANALYTICS_QUARTERS);
    if (preferred.quarters.length > 0) {
      return { quarters: preferred.quarters, source: preferred.source, providerBacked: preferred.providerBacked, warnings };
    }
    warnings.push(...preferred.warnings);
  } catch (err) {
    warnings.push(`loadPreferredQuarterlyFinancials: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    const fallback = await ensureQuarterlyFinancials(symbol, ANALYTICS_QUARTERS);
    if (fallback.length > 0) return { quarters: fallback, source: "financial_statements", providerBacked: true, warnings };
  } catch (err) {
    warnings.push(`ensureQuarterlyFinancials: ${err instanceof Error ? err.message : String(err)}`);
  }
  // BCTC verified (TCBS/Vietstock/CafeF) trống → dùng BCTC VNDirect finfo
  // (nguồn của tab Báo cáo tài chính, có snapshot nguyên văn khi nguồn sống
  // bị chặn). reportType QUARTER = số riêng quý → khai báo basis rõ, không để
  // heuristics đoán nhầm chuỗi tăng trưởng thành lũy kế.
  // NGÂN SÁCH CỨNG 6s: route serverless không được treo chờ upstream — quá
  // ngân sách thì bỏ qua (tab Cơ bản về trạng thái thiếu dữ liệu như trước).
  const finioStage = (async (): Promise<{
    quarters: FinancialQuarter[];
    source: string;
    providerBacked: boolean;
    basis?: "standalone";
    warnings: string[];
  } | null> => {
    try {
      const finfo = await fetchVndirectFinfoFinancialStatements(symbol, 8);
      warnings.push(...finfo.warnings);
      if (finfo.quarters.length > 0) {
        const mapped = toFinancialQuarters(finfo.quarters);
        warnings.push(...mapped.warnings);
        if (mapped.quarters.length > 0) {
          return {
            quarters: mapped.quarters,
            source: "vndirect-finfo",
            providerBacked: true,
            basis: "standalone",
            warnings,
          };
        }
      }
      return null;
    } catch (err) {
      warnings.push(`vndirect-finfo: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  })();
  const finioResult = await Promise.race([
    finioStage,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 6_000)),
  ]);
  if (finioResult) return finioResult;
  warnings.push("vndirect-finfo: vượt ngân sách 6s hoặc không có dữ liệu — bỏ qua.");
  return { quarters: [], source: "none", providerBacked: false, warnings };
}

export async function loadFundamentalInputs(symbol: string): Promise<FundamentalInputs> {
  const [quarterResult, priceResult, profile] = await Promise.all([
    loadQuarters(symbol),
    loadPrice(symbol),
    (async () => {
      try {
        const { getProfile } = await import("@/lib/company-service");
        return await getProfile(symbol);
      } catch {
        return null;
      }
    })(),
  ]);

  const profileShares =
    profile && Number.isFinite(profile.sharesOutstandingMillions) && profile.sharesOutstandingMillions > 0
      ? profile.sharesOutstandingMillions
      : null;
  const withShares = injectSharesOutstanding(quarterResult.quarters, profileShares);
  const shareWarnings =
    withShares.via === "paidInCapital"
      ? ["Số CP lưu hành suy từ vốn góp chủ sở hữu (mệnh giá 10.000đ) — dùng cho EPS/BVPS/vốn hoá."]
      : [];

  return {
    symbol,
    quarters: withShares.quarters,
    source: quarterResult.source,
    providerBacked: quarterResult.providerBacked,
    basis: quarterResult.basis,
    price: priceResult.price,
    beta: profile && Number.isFinite(profile.beta) && profile.beta > 0 ? profile.beta : null,
    priceSource: priceResult.source,
    loadWarnings: [...quarterResult.warnings, ...shareWarnings],
    loadedAt: new Date().toISOString(),
  };
}

/* ────────────────────────────────────────────────────────────
 * Tính toán (thuần, không I/O)
 * ──────────────────────────────────────────────────────────── */

export function computeFundamentalAnalytics(
  inputs: FundamentalInputs,
  options: { assumptions?: MacroAssumptions } = {},
): FundamentalAnalytics {
  const startedAt = Date.now();
  const assumptions = options.assumptions ?? defaultMacroAssumptions();
  const warnings = [...inputs.loadWarnings];

  if (inputs.quarters.length === 0) {
    return {
      symbol: inputs.symbol,
      generatedAt: new Date().toISOString(),
      computedInMs: Date.now() - startedAt,
      available: false,
      inputs: {
        quarters: 0,
        source: inputs.source,
        providerBacked: inputs.providerBacked,
        price: inputs.price,
        beta: inputs.beta,
        basis: "unknown",
        ltmMethod: "unavailable",
        ltmPeriod: "—",
      },
      statement: null,
      performance: null,
      health: null,
      healthDetail: null,
      valuation: null,
      chart: null,
      quality: null,
      warnings: [
        "Chưa có báo cáo tài chính đã xác minh cho mã này — hệ thống không hiển thị số liệu ước lượng/synthetic.",
        ...warnings,
      ],
    };
  }

  const ctx: FundamentalContext = buildFundamentalContext(inputs.symbol, inputs.quarters, {
    basis: inputs.basis,
  });
  const performance = computeBusinessPerformance(ctx);
  const health = computeAdvancedHealth(ctx);
  // computeValuation quy ước GIÁ theo NGHÌN VND (Vốn hoá tỷ = giá nghìn × CP triệu),
  // trong khi quote.close từ market connector là ĐỒNG (VD 120.000đ) — phải
  // chia 1000, nếu không mọi bội số (P/E, P/B, EV/…) và vốn hoá lệch ×1000.
  const priceNghin = inputs.price !== null ? inputs.price / 1000 : null;
  const valuation = computeValuation(ctx, {
    price: priceNghin,
    beta: inputs.beta,
    assumptions,
  });

  /**
   * Hệ số năm hoá đúng cho bộ tính cũ (radar 6 trụ cột + biểu đồ):
   * BCTC luỹ kế đến quý n chỉ chứa n tháng số liệu → phải nhân 4/n, không phải 4.
   */
  const annualizationFactor =
    ctx.basis === "cumulative-ytd" && ctx.latest && ctx.latest.quarter > 0 ? 4 / ctx.latest.quarter : 4;

  // Radar 6 trụ cột (tương thích UI cũ) — tính trên cùng bộ dữ liệu LTM.
  const healthDetail = evaluateHealthDetail(inputs.symbol, inputs.quarters, { annualizationFactor });
  const chart = buildFundamentalChart(inputs.symbol, inputs.quarters, healthDetail, { annualizationFactor });

  const validation = validateFinancialQuarters(inputs.quarters);
  const quality = buildDataQualitySnapshot(inputs.quarters, validation, {
    expectedPeriods: ANALYTICS_QUARTERS,
    staleAfterDays: 150,
  });

  const allWarnings = [
    ...new Set([...warnings, ...performance.warnings, ...health.warnings, ...valuation.warnings]),
  ];

  const statement = buildStatementSource(inputs.symbol, ctx, {
    source: inputs.source,
    providerBacked: inputs.providerBacked,
    loadedAt: inputs.loadedAt,
  });

  return {
    symbol: inputs.symbol,
    generatedAt: new Date().toISOString(),
    computedInMs: Date.now() - startedAt,
    available: true,
    inputs: {
      quarters: inputs.quarters.length,
      source: inputs.source,
      providerBacked: inputs.providerBacked,
      price: inputs.price,
      beta: inputs.beta ?? getBenchmarkForSymbol(inputs.symbol).beta,
      basis: ctx.basis,
      ltmMethod: ctx.ltm.method,
      ltmPeriod: ctx.ltm.periodEnd,
    },
    statement,
    performance,
    health,
    healthDetail,
    valuation,
    chart,
    quality,
    warnings: allWarnings,
  };
}

/* ────────────────────────────────────────────────────────────
 * API dùng chung (đã cache)
 * ──────────────────────────────────────────────────────────── */

/**
 * Kết quả được cache 10 phút theo symbol. Cùng một lượt mở tab "Cơ bản",
 * 4 endpoint khác nhau sẽ dùng chung một lần tính.
 */
export async function getFundamentalAnalytics(symbol: string): Promise<FundamentalAnalytics> {
  // Stale-while-revalidate: còn hạn → trả ngay; hết hạn → trả bản cũ ngay và
  // refresh nền (route không bao giờ chờ lại chuỗi tải BCTC ~vài giây).
  const { value } = await cachedWithStaleFallback(
    `fundamental-analytics:${symbol}`,
    ANALYTICS_CACHE_TTL_MS,
    async () => {
      const inputs = await loadFundamentalInputs(symbol);
      return computeFundamentalAnalytics(inputs);
    },
  );
  return value;
}

/** Chỉ nạp ngữ cảnh LTM — dùng cho các endpoint cần số thô. */
export async function getFundamentalContextCached(symbol: string): Promise<FundamentalContext> {
  const { value } = await cachedWithStaleFallback(
    `fundamental-context:${symbol}`,
    ANALYTICS_CACHE_TTL_MS,
    async () => {
      const inputs = await loadFundamentalInputs(symbol);
      return buildFundamentalContext(symbol, inputs.quarters);
    },
  );
  return value;
}

/** Số nến lịch sử dùng cho beta thực nghiệm (nếu cần mở rộng sau này). */
export async function getDailyBars(symbol: string, days = 400): Promise<Ohlcv[]> {
  const to = Math.floor(Date.now() / 1000);
  const { bars } = await getHistory(symbol, to - 86400 * days, to, "D");
  return bars;
}
