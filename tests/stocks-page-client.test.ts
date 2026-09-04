// @vitest-environment jsdom
/**
 * Regression test cho vụ "This page couldn't load" trên /stocks/[symbol]:
 * render TOÀN BỘ trang ở phía client (jsdom) với dữ liệu THẬT do pipeline
 * analytics sinh ra từ snapshot BCTC, đi qua JSON round-trip y hệt fetch thật
 * (JSON.stringify(NaN) = null — chính là cái từng làm IndustryCompareBars
 * gọi null.toFixed(2) và sập cả trang). Sau đó click tab Cơ bản và yêu cầu
 * các panel hiệu suất / sức khoẻ / định giá render ra, không throw.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../db/pool", () => ({
  getPool: vi.fn(() => ({ query: vi.fn().mockResolvedValue({ rows: [] }) })),
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
  fetchVndirectFinfoFinancialStatements: vi.fn(async () => {
    const { FINFO_STATEMENTS_SNAPSHOT } = await import("@/lib/finfo-snapshot");
    const ratios = await import("@/lib/finfo-ratios");
    const vic = FINFO_STATEMENTS_SNAPSHOT.VIC;
    const quarters = Object.keys(vic).map((fiscalDate) => {
      const rows = vic[fiscalDate].map(([modelType, itemCode, numericValue]) => ({ modelType, itemCode, numericValue }));
      const parsed = ratios.periodFromReportDate(fiscalDate)!;
      return {
        period: parsed.period,
        fiscalYear: parsed.fiscalYear,
        income: ratios.incomeFromStatementRows(rows as never),
        balance: ratios.balanceFromStatementRows(rows as never),
        cashflow: ratios.cashflowFromStatementRows(rows as never),
      };
    });
    return { symbol: "VIC", source: "vndirect" as const, sourceUrl: "u", quarters, urls: [], warnings: [] };
  }),
}));

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as Record<string, unknown>).ResizeObserver = RO;
(globalThis as unknown as Record<string, unknown>).IntersectionObserver = RO;
window.matchMedia =
  window.matchMedia ??
  (((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
    onchange: null,
  })) as never);

import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { getFundamentalAnalytics } from "@/lib/fundamental-analytics-service";
import { buildFundamentalReportFromAnalytics } from "@/lib/fundamental";
import StockPage from "@/app/stocks/[symbol]/page";
import { AuthProvider } from "@/lib/auth/context";

describe("toàn trang /stocks/VIC client render + tab Cơ bản", () => {
  it("render trang và tab Cơ bản không throw (kể cả khi EBITDA thiếu → null)", async () => {
    const analytics = await getFundamentalAnalytics("VIC");
    expect(analytics.available).toBe(true);
    // VIC snapshot không có EBITDA → chart comparisons phải mang null tường
    // minh (không NaN) sau JSON round-trip.
    expect(analytics.chart?.comparisons.some((c) => c.company === null)).toBe(true);

    const report = buildFundamentalReportFromAnalytics(analytics, 120_000);
    const quote = {
      symbol: "VIC",
      time: Date.now(),
      open: 119_000,
      high: 121_000,
      low: 118_000,
      close: 120_000,
      volume: 10_000_000,
      prevClose: 119_000,
      changePct: 0.84,
      source: "test",
      confidence: 1,
    };

    const routes: Array<[string, unknown]> = [
      ["/auth/me", { data: { user: { id: "u1", email: "t@t.vn", name: "T", avatarUrl: null, provider: "password" } }, meta: {} }],
      ["/stocks/VIC/fundamental-analytics", { data: analytics, meta: {} }],
      ["/stocks/VIC/fundamental", { data: report, meta: {} }],
      ["/stocks/VIC/history", { data: { bars: [], source: "test" }, meta: {} }],
      ["/stocks/VIC", { data: { quote, company: null }, meta: {} }],
      ["/news", { data: { items: [] }, meta: {} }],
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = new URL(String(input), "http://local");
        const path = url.pathname.replace(/^\/api\/v1/, "");
        const hit = routes.find(([p]) => path === p);
        const body = hit ? hit[1] : { data: null, meta: {} };
        // JSON round-trip THẬT — đúng thứ browser nhận từ API.
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(
          AuthProvider,
          null,
          createElement(StockPage, { params: Promise.resolve({ symbol: "VIC" }) }),
        ),
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    const btn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.toLowerCase().includes("cơ bản"),
    );
    expect(btn, "nút tab Cơ bản phải tồn tại").toBeTruthy();
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Chờ các panel mount (dynamic import + polling) tối đa 5s.
    let html = "";
    const markers = ["hiệu suất kinh doanh", "altman z", "p/e", "so sánh với trung bình ngành"];
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 150));
      });
      html = host.innerHTML;
      const lower = html.toLowerCase();
      if (markers.every((m) => lower.includes(m))) break;
    }

    // Tab Cơ bản render đủ 3 khối + bảng nguồn BCTC, và ô thiếu số liệu
    // hiển thị "—" thay vì làm sập trang (regression: null.toFixed).
    const lower = html.toLowerCase();
    for (const m of markers) {
      expect(lower, `thiếu khối "${m}"`).toContain(m);
    }

    root.unmount();
    vi.unstubAllGlobals();
  }, 60_000);
});
