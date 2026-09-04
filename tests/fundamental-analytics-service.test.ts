import { describe, expect, it } from "vitest";
import { computeFundamentalAnalytics } from "@/lib/fundamental-analytics-service";
import type { FundamentalInputs } from "@/lib/fundamental-analytics-service";
import type { FinancialQuarter } from "@/lib/financial-statements";

const SHARES = 200; // triệu cổ phiếu

function quarter(year: number, q: number, revenue: number): FinancialQuarter {
  const grossProfit = revenue * 0.36;
  const ebitda = revenue * 0.2;
  const depreciation = ebitda * 0.25;
  const operatingIncome = ebitda - depreciation;
  const interestExpense = operatingIncome * 0.08;
  const pretaxIncome = operatingIncome - interestExpense;
  const incomeTax = pretaxIncome * 0.2;
  const netIncome = pretaxIncome - incomeTax;
  const receivables = revenue * 0.18;
  const inventory = revenue * 0.12;
  const currentAssets = receivables + inventory + revenue * 0.08;
  const currentLiabilities = currentAssets / 1.6;
  const totalAssets = revenue * 3.2;
  const longTermDebt = totalAssets * 0.22;
  const equity = totalAssets * 0.55;
  const totalLiabilities = totalAssets - equity;
  const operatingCashFlow = netIncome + depreciation;
  const capex = revenue * 0.05;

  return {
    period: `Q${q}/${year}`,
    quarter: q,
    fiscalYear: year,
    income: {
      revenue,
      costOfGoodsSold: revenue - grossProfit,
      grossProfit,
      operatingExpenses: grossProfit - operatingIncome,
      operatingIncome,
      interestExpense,
      otherIncome: 0,
      pretaxIncome,
      incomeTax,
      netIncome,
      ebitda,
      depreciation,
      eps: Number((netIncome / SHARES).toFixed(3)),
      sharesOutstanding: SHARES,
    },
    balance: {
      cashAndEquivalents: revenue * 0.09,
      shortTermInvestments: revenue * 0.02,
      receivables,
      inventory,
      currentAssets,
      fixedAssets: totalAssets - currentAssets,
      longTermInvestments: 0,
      totalAssets,
      currentLiabilities,
      shortTermDebt: currentLiabilities * 0.25,
      debtDueWithin12m: currentLiabilities * 0.25,
      debtMaturityBuckets: {
        within12m: currentLiabilities * 0.25,
        oneToThreeYears: longTermDebt * 0.4,
        overThreeYears: longTermDebt * 0.6,
      },
      longTermDebt,
      totalLiabilities,
      equity,
      retainedEarnings: equity * 0.45,
      totalLiabilitiesEquity: totalAssets,
      bookValuePerShare: Number((equity / SHARES).toFixed(3)),
    },
    cashflow: {
      netIncome,
      depreciation,
      changeWorkingCapital: 0,
      operatingCashFlow,
      capex,
      investingCashFlow: -capex,
      debtIssuance: 0,
      dividendsPaid: netIncome * 0.35,
      financingCashFlow: -netIncome * 0.35,
      netChangeCash: operatingCashFlow - capex - netIncome * 0.35,
      freeCashFlow: operatingCashFlow - capex,
    },
  };
}

/** 8 quý có mùa vụ (Q4 cao điểm, Q3 chùng) → được nhận diện là số riêng từng quý. */
function quarters(): FinancialQuarter[] {
  const rows: Array<[number, number, number]> = [
    [2024, 1, 8200],
    [2024, 2, 9400],
    [2024, 3, 8600],
    [2024, 4, 11200],
    [2025, 1, 9000],
    [2025, 2, 10300],
    [2025, 3, 9500],
    [2025, 4, 12400],
  ];
  return rows
    .map(([year, q, revenue]) => quarter(year, q, revenue))
    .reverse();
}

function inputs(overrides: Partial<FundamentalInputs> = {}): FundamentalInputs {
  return {
    symbol: "VNM",
    quarters: quarters(),
    source: "vndirect",
    providerBacked: true,
    price: 62_500, // ĐỒNG/CP (quote.close) — service tự đổi sang nghìn VND
    beta: 0.8,
    priceSource: "tcbs",
    loadWarnings: [],
    loadedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("computeFundamentalAnalytics (đường đi thật của API route)", () => {
  it("trả về đủ 3 khối: hiệu suất kinh doanh, sức khỏe tài chính, định giá", () => {
    const result = computeFundamentalAnalytics(inputs());
    expect(result.available).toBe(true);
    expect(result.performance).not.toBeNull();
    expect(result.health).not.toBeNull();
    expect(result.valuation).not.toBeNull();
    expect(result.chart).not.toBeNull();
    expect(result.healthDetail).not.toBeNull();
    expect(result.inputs.ltmMethod).toBe("sum-4q");
    expect(result.inputs.basis).toBe("standalone");
    expect(result.computedInMs).toBeGreaterThanOrEqual(0);
  });

  it("hiệu suất kinh doanh: 5 trụ cột, trọng số 100%, chuỗi 8 quý", () => {
    const result = computeFundamentalAnalytics(inputs());
    const perf = result.performance!;
    expect(perf.groups).toHaveLength(5);
    expect(perf.groups.reduce((s, g) => s + g.weight, 0)).toBeCloseTo(1, 10);
    expect(perf.series).toHaveLength(8);
    // Nhãn kỳ phải đúng chuẩn: shortTag "4Q25", displayPeriod "Q4/2025"
    expect(perf.series[0].shortTag).toBe("4Q25");
    expect(perf.series[0].displayPeriod).toBe("Q4/2025");
    expect(perf.series[0].displayPeriodVi).toBe("Quý 4 / 2025");
    expect(perf.overall).toBeGreaterThan(0);
    expect(perf.overall).toBeLessThanOrEqual(100);
    // LTM 2025 = 9000+10300+9500+12400
    expect(perf.summary).toContain("Q4/2025");
  });

  it("sức khỏe tài chính có đủ Altman Z', Piotroski F, Beneish M", () => {
    const health = computeFundamentalAnalytics(inputs()).health!;
    expect(health.altman.zScore).not.toBeNull();
    expect(health.altman.components).toHaveLength(4);
    expect(health.piotroski.criteria).toHaveLength(9);
    expect(health.beneish.components).toHaveLength(8);
    expect(health.solvency.length).toBeGreaterThan(10);
    expect(["A", "B", "C", "D", "E"]).toContain(health.rating);
  });

  it("định giá khớp với giá và số CP đưa vào", () => {
    // Giá vào theo ĐỒNG (62.500đ) → valuation chuẩn hoá về nghìn (62,5).
    const v = computeFundamentalAnalytics(inputs({ price: 62_500 })).valuation!;
    expect(v.price).toBe(62.5);
    expect(v.sharesOutstandingMillions).toBeCloseTo(SHARES, 0);
    // 62.5 nghìn × 200 triệu = 12.500 tỷ
    expect(v.marketCapBillionVnd).toBe(12500);
    expect(v.multiples.length).toBeGreaterThan(6);
    expect(v.sensitivity.cells).toHaveLength(25);
    expect(v.methods.length).toBeGreaterThan(0);
    // EPS LTM = (9000+10300+9500+12400)*... kiểm tra P/E = giá / EPS
    const pe = v.multiples.find((m) => m.key === "pe")!;
    expect(pe.value).toBeCloseTo(62.5 / (v.epsLtm as number), 1);
  });

  it("không có BCTC → available=false và không bịa số liệu", () => {
    const result = computeFundamentalAnalytics(inputs({ quarters: [], source: "none", providerBacked: false }));
    expect(result.available).toBe(false);
    expect(result.performance).toBeNull();
    expect(result.health).toBeNull();
    expect(result.valuation).toBeNull();
    expect(result.chart).toBeNull();
    expect(result.warnings.join(" ")).toContain("Chưa có báo cáo tài chính");
  });

  it("không có giá thị trường → định giá vẫn chạy nhưng kết luận ghi rõ thiếu dữ liệu", () => {
    const result = computeFundamentalAnalytics(inputs({ price: null, priceSource: "none" }));
    expect(result.valuation!.price).toBeNull();
    expect(result.valuation!.rating).toBe("N/A");
    expect(result.valuation!.multiples.find((m) => m.key === "pe")!.value).toBeNull();
  });

  it("BCTC luỹ kế được tự động tách quý và cho LTM giống hệt số riêng quý", () => {
    const standalone = quarters();
    // Dựng bản luỹ kế từ chính bộ số riêng quý
    const cumulative = standalone
      .slice()
      .reverse()
      .map((q, index, all) => {
        const earlierSameYear = all.filter(
          (x) => x.fiscalYear === q.fiscalYear && x.quarter < q.quarter,
        );
        const sumIncome = (pick: (x: FinancialQuarter) => number) =>
          pick(q) + earlierSameYear.reduce((acc, x) => acc + pick(x), 0);
        return {
          ...q,
          income: {
            ...q.income,
            revenue: sumIncome((x) => x.income.revenue),
            grossProfit: sumIncome((x) => x.income.grossProfit),
            ebitda: sumIncome((x) => x.income.ebitda),
            netIncome: sumIncome((x) => x.income.netIncome),
          },
        };
      })
      .reverse();
    expect(index(cumulative)).toBeGreaterThan(0);

    const a = computeFundamentalAnalytics(inputs({ quarters: standalone }));
    const b = computeFundamentalAnalytics(inputs({ quarters: cumulative }));
    expect(b.inputs.basis).toBe("cumulative-ytd");
    expect(b.inputs.ltmMethod).toBe("sum-4q");

    const revA = a.performance!.series.find((s) => s.shortTag === "4Q25")?.revenue;
    const revB = b.performance!.series.find((s) => s.shortTag === "4Q25")?.revenue;
    expect(revA).toBeCloseTo(revB as number, 6);

    const roeA = a.performance!.groups.find((g) => g.key === "returns")!.metrics.find((m) => m.key === "roe")!.value;
    const roeB = b.performance!.groups.find((g) => g.key === "returns")!.metrics.find((m) => m.key === "roe")!.value;
    expect(roeA).toBeCloseTo(roeB as number, 6);
  });

  it("tính lại nhiều lần cho kết quả xác định (không phụ thuộc thời gian chạy)", () => {
    const a = computeFundamentalAnalytics(inputs());
    const b = computeFundamentalAnalytics(inputs());
    expect(a.performance!.overall).toBe(b.performance!.overall);
    expect(a.health!.altman.zScore).toBe(b.health!.altman.zScore);
    expect(a.valuation!.targetPrice.mid).toBe(b.valuation!.targetPrice.mid);
  });
});

function index(xs: unknown[]): number {
  return xs.length;
}
