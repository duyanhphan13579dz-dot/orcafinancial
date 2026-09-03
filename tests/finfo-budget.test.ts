import { describe, expect, it, vi } from "vitest";

// NGÂN SÁCH CỨNG của khối finfo trong loadQuarters: route serverless
// (/fundamental-analytics, /fundamental…) không được treo chờ upstream.
// Nếu fetchBCTC finfo treo, analytics phải về available:false trong ~6s
// thay vì giữ function đến khi platform kill (504 → trang không tải được).

vi.mock("../db/pool", () => ({
  getPool: vi.fn(() => ({
    query: vi.fn().mockResolvedValue({ rows: [] }),
  })),
}));

vi.mock("@/lib/market", () => ({
  getQuote: vi.fn(async () => ({ close: 120_000, source: "test" })),
  getHistory: vi.fn(async () => ({ bars: [], source: "test" })),
}));

vi.mock("@/lib/company-service", () => ({
  ensureQuarterlyFinancials: vi.fn(async () => []),
  getProfile: vi.fn(async () => null),
}));

vi.mock("@/lib/connectors/vndirect-financials", () => ({
  // Treo 8s — lâu hơn ngân sách 6s, như khi egress bị drop gói.
  fetchVndirectFinfoFinancialStatements: vi.fn(
    () =>
      new Promise<never>((resolve) => {
        setTimeout(() => resolve(undefined as never), 8_000);
      }),
  ),
}));

import { getFundamentalAnalytics } from "@/lib/fundamental-analytics-service";

describe("loadQuarters finio stage budget", () => {
  it(
    "returns unavailable instead of hanging when finio is slow",
    async () => {
      const startedAt = Date.now();
      const analytics = await getFundamentalAnalytics("HANGTEST");
      const elapsed = Date.now() - startedAt;
      expect(analytics.available).toBe(false);
      // Cắt ở ngân sách ~6s, KHÔNG chờ đủ 8s của upstream.
      expect(elapsed).toBeGreaterThanOrEqual(5_900);
      expect(elapsed).toBeLessThan(7_500);
      expect(analytics.warnings.some((w) => w.includes("ngân sách 6s"))).toBe(true);
    },
    15_000,
  );
});
