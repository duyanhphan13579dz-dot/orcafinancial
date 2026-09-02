/**
 * Kiểm chứng bảng "Báo cáo tài chính nguồn".
 *
 * Điểm mấu chốt: bảng nguồn phải là CHÍNH dữ liệu engine dùng để tính hiệu
 * suất / sức khỏe / định giá — nếu hai bên lệch nhau thì người dùng không thể
 * đối chiếu con số, và cả mục đích truy vết mất tác dụng.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildFundamentalContext } from "@/lib/fundamental-engine";
import { buildStatementSource } from "@/lib/fundamental-source";
import { computeFundamentalAnalytics } from "@/lib/fundamental-analytics-service";
import type { FundamentalInputs } from "@/lib/fundamental-analytics-service";
import type { FinancialQuarter } from "@/lib/financial-statements";
import { StatementSourceCard } from "@/components/statement-source";
import { fixtureQuarter, fixtureQuarters } from "./helpers/financial-quarters";

function inputs(overrides: Partial<FundamentalInputs> = {}): FundamentalInputs {
  return {
    symbol: "HPG",
    quarters: fixtureQuarters(),
    source: "vndirect",
    providerBacked: true,
    price: 27.4,
    beta: 1.1,
    priceSource: "tcbs",
    loadWarnings: [],
    loadedAt: new Date().toISOString(),
    ...overrides,
  };
}

function source(overrides: Partial<FundamentalInputs> = {}) {
  const data = inputs(overrides);
  const ctx = buildFundamentalContext(data.symbol, data.quarters);
  return buildStatementSource(data.symbol, ctx, {
    source: data.source,
    providerBacked: data.providerBacked,
    loadedAt: data.loadedAt,
  });
}

describe("buildStatementSource — bảng BCTC nguồn", () => {
  it("sắp xếp kỳ newest-first với nhãn chuẩn, không nối năm hai lần", () => {
    const result = source();
    expect(result.periodCount).toBe(8);
    expect(result.rows.map((r) => r.period)).toEqual([
      "Q4/2025",
      "Q3/2025",
      "Q2/2025",
      "Q1/2025",
      "Q4/2024",
      "Q3/2024",
      "Q2/2024",
      "Q1/2024",
    ]);
    expect(result.latestPeriod).toBe("Q4/2025");
    expect(result.rows[0].shortTag).toBe("4Q25");
    expect(result.rows[0].displayPeriodVi).toBe("Quý 4 / 2025");
    expect(result.rows[0].period).not.toContain("2025/2025");
  });

  it("giữ đúng số BCTC công bố: doanh thu Q4/2025 = 21.500 tỷ", () => {
    const result = source();
    const latest = result.rows[0];
    expect(latest.revenue).toBe(21500);
    expect(latest.reportedRevenue).toBe(21500);
    expect(latest.derivedFromCumulative).toBe(false);
    // biên gộp 33% theo fixture
    expect(latest.grossProfit).toBeCloseTo(21500 * 0.33, 2);
    // capex hiển thị độ lớn dù BCTC ghi âm
    expect(latest.capex).toBeCloseTo(21500 * 0.055, 2);
    expect(latest.capex).toBeGreaterThan(0);
  });

  it("cửa sổ LTM đúng bằng tổng 4 quý mới nhất (không phải quý × 4)", () => {
    const result = source();
    const last4 = result.rows.slice(0, 4);
    const expectedRevenue = last4.reduce((sum, r) => sum + (r.revenue ?? 0), 0);
    expect(result.ltm?.method).toBe("sum-4q");
    expect(result.ltm?.annualized).toBe(false);
    expect(result.ltm?.quartersUsed).toBe(4);
    expect(result.ltm?.revenue).toBeCloseTo(expectedRevenue, 1);
    // 21500 + 17600 + 19100 + 16800
    expect(result.ltm?.revenue).toBeCloseTo(75000, 1);
    // LTM kỳ trước = 4 quý của 2024
    expect(result.ltm?.previousRevenue).toBeCloseTo(15200 + 17400 + 16100 + 19800, 1);
  });

  it("khớp từng dòng với ngữ cảnh engine dùng để tính 3 khối phân tích", () => {
    const data = inputs();
    const ctx = buildFundamentalContext(data.symbol, data.quarters);
    const statement = buildStatementSource(data.symbol, ctx, {
      source: data.source,
      providerBacked: data.providerBacked,
      loadedAt: data.loadedAt,
    });
    const analytics = computeFundamentalAnalytics(data);

    // Cùng một cửa sổ LTM
    expect(statement.ltm?.periodEnd).toBe(analytics.inputs.ltmPeriod);
    expect(statement.ltm?.method).toBe(analytics.inputs.ltmMethod);
    expect(statement.basis).toBe(analytics.inputs.basis);
    expect(statement.periodCount).toBe(analytics.inputs.quarters);

    // Cùng một bộ số dư bình quân → ROE ở bảng phân tích tái lập được từ bảng nguồn
    const roeFromSource =
      (statement.ltm!.netIncome! / statement.balances.equity!) * 100;
    const roeMetric = analytics.performance!.groups
      .find((g) => g.key === "returns")!
      .metrics.find((m) => m.key.startsWith("roe"))!;
    expect(Math.abs(roeFromSource - roeMetric.value!)).toBeLessThan(0.5);
  });

  it("BCTC luỹ kế: tách về riêng quý và đánh dấu derivedFromCumulative", () => {
    // Luỹ kế 2025: 16800 → 35900 → 53500 → 75000 (riêng quý: 16800/19100/17600/21500)
    const cumulative: Array<[number, number, number]> = [
      [2024, 1, 15200],
      [2024, 2, 32600],
      [2024, 3, 48700],
      [2024, 4, 68500],
      [2025, 1, 16800],
      [2025, 2, 35900],
      [2025, 3, 53500],
      [2025, 4, 75000],
    ];
    const quarters = cumulative.map(([y, q, r]) => fixtureQuarter(y, q, r)).reverse();
    const result = source({ quarters });

    expect(result.basis).toBe("cumulative-ytd");
    expect(result.basisLabel).toContain("luỹ kế");

    const q2 = result.rows.find((r) => r.period === "Q2/2025")!;
    // số công bố là luỹ kế 35.900, số riêng quý phải là 19.100
    expect(q2.reportedRevenue).toBe(35900);
    expect(q2.revenue).toBeCloseTo(19100, 1);
    expect(q2.derivedFromCumulative).toBe(true);

    const q1 = result.rows.find((r) => r.period === "Q1/2025")!;
    expect(q1.revenue).toBeCloseTo(16800, 1);

    expect(result.ltm?.revenue).toBeCloseTo(75000, 1);
  });

  it("thiếu trường → null, không bao giờ thành 0", () => {
    const sparse = fixtureQuarters().map((q) => ({
      ...q,
      income: { ...q.income, ebitda: undefined, grossProfit: undefined, costOfGoodsSold: undefined },
      balance: { ...q.balance, inventory: undefined, cashAndEquivalents: undefined },
      cashflow: { ...q.cashflow, capex: undefined, freeCashFlow: undefined },
    })) as unknown as FinancialQuarter[];
    const result = source({ quarters: sparse });
    const latest = result.rows[0];

    expect(latest.ebitda).toBeNull();
    expect(latest.grossProfit).toBeNull();
    expect(latest.inventory).toBeNull();
    expect(latest.cashAndEquivalents).toBeNull();
    expect(latest.capex).toBeNull();
    expect(latest.freeCashFlow).toBeNull();
    // trường vẫn có thì giữ nguyên
    expect(latest.revenue).toBe(21500);
    expect(latest.netIncome).not.toBeNull();
  });

  it("không có BCTC → periodCount 0, không sinh số", () => {
    const result = source({ quarters: [] });
    expect(result.rows).toEqual([]);
    expect(result.periodCount).toBe(0);
    expect(result.latestPeriod).toBeNull();
    expect(result.ltm).toBeNull();
  });
});

describe("StatementSourceCard — render", () => {
  it("hiển thị đủ 3 nhóm chỉ tiêu, cột LTM và số dư bình quân", () => {
    const analytics = computeFundamentalAnalytics(inputs());
    const html = renderToStaticMarkup(
      createElement(StatementSourceCard, { statement: analytics.statement! }),
    );

    expect(html).toContain("Báo cáo tài chính nguồn");
    expect(html).toContain("Kết quả kinh doanh");
    expect(html).toContain("Lưu chuyển tiền tệ");
    expect(html).toContain("Bảng cân đối kế toán");
    expect(html).toContain("Doanh thu thuần");
    expect(html).toContain("Dòng tiền tự do (FCF)");
    expect(html).toContain("Nợ vay chịu lãi");
    expect(html).toContain("Cửa sổ LTM");
    expect(html).toContain("Số dư bình quân dùng làm mẫu số");
    expect(html).toContain("tỷ VND");
    // nhãn kỳ chuẩn
    expect(html).toContain("4Q25");
    expect(html).toContain("Q4/2025");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
  });

  it("hiển thị “—” cho trường thiếu, không in ra 0 giả", () => {
    const sparse = fixtureQuarters().map((q) => ({
      ...q,
      income: { ...q.income, ebitda: undefined },
    })) as unknown as FinancialQuarter[];
    const analytics = computeFundamentalAnalytics(inputs({ quarters: sparse }));
    const html = renderToStaticMarkup(
      createElement(StatementSourceCard, { statement: analytics.statement! }),
    );
    expect(html).toContain("—");
    expect(html).not.toContain("NaN");
  });

  it("không có BCTC thì báo rõ, không render bảng trống", () => {
    const analytics = computeFundamentalAnalytics(inputs({ quarters: [] }));
    const html = renderToStaticMarkup(
      createElement(StatementSourceCard, { statement: analytics.statement! }),
    );
    expect(html).toContain("Chưa có báo cáo tài chính đã xác minh");
    expect(html).not.toContain("Kết quả kinh doanh");
  });
});
