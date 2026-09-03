import { describe, expect, it, vi } from "vitest";
import { fetchVndirectFinfoFinancialStatements } from "@/lib/connectors/vndirect-financials";
import { injectSharesOutstanding, toFinancialQuarters } from "@/lib/finfo-ratios";
import {
  computeFundamentalAnalytics,
  type FundamentalInputs,
} from "@/lib/fundamental-analytics-service";

/**
 * E2E thuần: nguồn sống bị chặn (403) → snapshot BCTC VIC lấp đầy →
 * engine "Cơ bản" phải tính được EPS/định giá/sức khoẻ từ chính snapshot.
 */
describe("tab Cơ bản tính từ snapshot BCTC khi nguồn sống bị chặn", () => {
  it("VIC: hiệu suất + sức khỏe + định giá không còn UNAVAILABLE", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-03T00:00:00Z"));
    const fetchMock = vi.fn(async () => new Response("blocked", { status: 403 }));
    const finfo = await fetchVndirectFinfoFinancialStatements("VIC", 12, fetchMock as unknown as typeof fetch);
    const mapped = toFinancialQuarters(finfo.quarters);
    const withShares = injectSharesOutstanding(mapped.quarters, null);
    expect(withShares.via).toBe("paidInCapital");

    const inputs: FundamentalInputs = {
      symbol: "VIC",
      quarters: withShares.quarters,
      source: "vndirect-finfo",
      providerBacked: true,
      basis: "standalone",
      price: 120, // nghìn VND/CP (giá thị trường thật do route nạp)
      beta: null,
      priceSource: "test",
      loadWarnings: [...finfo.warnings, ...mapped.warnings],
      loadedAt: new Date().toISOString(),
    };
    const analytics = computeFundamentalAnalytics(inputs);

    expect(analytics.available).toBe(true);
    // Sức khỏe tài chính: có điểm, không UNAVAILABLE
    expect(analytics.healthDetail).not.toBeNull();
    expect(analytics.healthDetail!.overall).toBeGreaterThan(0);
    expect(analytics.healthDetail!.rating).not.toBe("E");
    // Hiệu suất: ROS/ROE tính từ LNST + doanh thu snapshot
    expect(analytics.performance).not.toBeNull();
    // Định giá: EPS = LTM ÷ số CP suy từ 14110 → P/E hữu hạn
    expect(analytics.valuation).not.toBeNull();
    expect(analytics.valuation!.sharesOutstandingMillions).toBeCloseTo(7733.49, 1);
    expect(analytics.valuation!.epsLtm).toBeGreaterThan(0);
    const peRow = analytics.valuation!.multiples.find((m) => m.key === "pe" || m.label.includes("P/E"));
    expect(peRow?.value).toBeGreaterThan(0);
    vi.useRealTimers();
  });
});
