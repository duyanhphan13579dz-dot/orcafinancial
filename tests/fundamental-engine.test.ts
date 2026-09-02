import { describe, expect, it } from "vitest";
import {
  buildFundamentalContext,
  buildLtmWindow,
  cagrPct,
  detectStatementBasis,
  growthPct,
  ramp,
  ratio,
  toStandaloneQuarters,
} from "@/lib/fundamental-engine";
import {
  computeBusinessPerformance,
  dupont3,
  dupont5,
  effectiveTaxRateOf,
  ltmEps,
  sharesOutstandingMillions,
} from "@/lib/fundamental-performance";
import { computeAltmanZ, computeAdvancedHealth, computeBeneishM, computePiotroskiF, computeSolvencyMetrics } from "@/lib/fundamental-health";
import {
  computeValuation,
  deriveIndustryMultiples,
  computeWacc,
  defaultMacroAssumptions,
} from "@/lib/fundamental-valuation";
import { evaluateHealthDetail } from "@/lib/financial-health-detail";
import type { FinancialQuarter } from "@/lib/financial-statements";

/* ────────────────────────────────────────────────────────────
 * Bộ dữ liệu kiểm thử: 8 quý RIÊNG TỪNG QUÝ (standalone)
 * Đơn vị: tỷ VND; EPS/BVPS: nghìn VND; số CP: 100 triệu
 * ──────────────────────────────────────────────────────────── */

interface Seed {
  year: number;
  quarter: number;
  revenue: number;
  grossProfit: number;
  ebitda: number;
  netIncome: number;
  equity: number;
  totalAssets: number;
}

/**
 * Doanh thu PHẢI có tính mùa vụ (không đơn điệu trong cùng năm) — nếu không,
 * bộ phát hiện sẽ nhầm số riêng quý thành số luỹ kế.
 */
const SEEDS: Seed[] = [
  { year: 2024, quarter: 1, revenue: 900, grossProfit: 315, ebitda: 180, netIncome: 108, equity: 1900, totalAssets: 4000 },
  { year: 2024, quarter: 2, revenue: 1050, grossProfit: 378, ebitda: 220, netIncome: 132, equity: 2010, totalAssets: 4120 },
  { year: 2024, quarter: 3, revenue: 950, grossProfit: 333, ebitda: 195, netIncome: 117, equity: 2100, totalAssets: 4210 },
  { year: 2024, quarter: 4, revenue: 1250, grossProfit: 463, ebitda: 268, netIncome: 160, equity: 2230, totalAssets: 4360 },
  { year: 2025, quarter: 1, revenue: 1000, grossProfit: 380, ebitda: 205, netIncome: 123, equity: 2330, totalAssets: 4460 },
  { year: 2025, quarter: 2, revenue: 1200, grossProfit: 468, ebitda: 258, netIncome: 155, equity: 2460, totalAssets: 4600 },
  { year: 2025, quarter: 3, revenue: 1050, grossProfit: 400, ebitda: 221, netIncome: 133, equity: 2570, totalAssets: 4700 },
  { year: 2025, quarter: 4, revenue: 1450, grossProfit: 595, ebitda: 319, netIncome: 191, equity: 2730, totalAssets: 4900 },
];

const SHARES = 100; // triệu cổ phiếu

function buildQuarter(seed: Seed, overrides: Partial<FinancialQuarter> = {}): FinancialQuarter {
  const { revenue, grossProfit, ebitda, netIncome, equity, totalAssets } = seed;
  const cogs = revenue - grossProfit;
  const depreciation = ebitda * 0.25;
  const operatingIncome = ebitda - depreciation;
  const interestExpense = operatingIncome * 0.1;
  const pretaxIncome = operatingIncome - interestExpense;
  const incomeTax = pretaxIncome * 0.2;
  const receivables = revenue * 0.2;
  const inventory = revenue * 0.15;
  const currentAssets = receivables + inventory + revenue * 0.1;
  const currentLiabilities = currentAssets / 1.5;
  const longTermDebt = totalAssets * 0.25;
  const totalLiabilities = totalAssets - equity;
  const operatingCashFlow = netIncome + depreciation + netIncome * 0.05;
  const capex = revenue * 0.06;

  return {
    period: `Q${seed.quarter}/${seed.year}`,
    quarter: seed.quarter,
    fiscalYear: seed.year,
    income: {
      revenue,
      costOfGoodsSold: cogs,
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
      cashAndEquivalents: revenue * 0.1,
      shortTermInvestments: revenue * 0.02,
      receivables,
      inventory,
      currentAssets,
      fixedAssets: totalAssets - currentAssets,
      longTermInvestments: 0,
      totalAssets,
      currentLiabilities,
      shortTermDebt: currentLiabilities * 0.3,
      debtDueWithin12m: currentLiabilities * 0.3,
      debtMaturityBuckets: {
        within12m: currentLiabilities * 0.3,
        oneToThreeYears: longTermDebt * 0.4,
        overThreeYears: longTermDebt * 0.6,
      },
      longTermDebt,
      totalLiabilities,
      equity,
      retainedEarnings: equity * 0.4,
      totalLiabilitiesEquity: totalAssets,
      bookValuePerShare: Number((equity / SHARES).toFixed(3)),
    },
    cashflow: {
      netIncome,
      depreciation,
      changeWorkingCapital: -netIncome * 0.05,
      operatingCashFlow,
      capex,
      investingCashFlow: -capex,
      debtIssuance: 0,
      dividendsPaid: netIncome * 0.3,
      financingCashFlow: -netIncome * 0.3,
      netChangeCash: operatingCashFlow - capex - netIncome * 0.3,
      freeCashFlow: operatingCashFlow - capex,
    },
    ...overrides,
  } as FinancialQuarter;
}

/** 8 quý, sắp xếp mới nhất trước (đúng thứ tự API trả về). */
function standaloneQuarters(): FinancialQuarter[] {
  return [...SEEDS].reverse().map((seed) => buildQuarter(seed));
}

/** Cùng dữ liệu nhưng trình bày LUỸ KẾ (YTD) trong cùng năm tài chính. */
function cumulativeQuarters(): FinancialQuarter[] {
  const cumulative: FinancialQuarter[] = [];
  for (const seed of SEEDS) {
    const sameYearEarlier = SEEDS.filter(
      (s) => s.year === seed.year && s.quarter < seed.quarter,
    );
    const sum = (pick: (s: Seed) => number) =>
      pick(seed) + sameYearEarlier.reduce((acc, s) => acc + pick(s), 0);
    const base = buildQuarter(seed);
    cumulative.push({
      ...base,
      income: {
        ...base.income,
        revenue: sum((s) => s.revenue),
        grossProfit: sum((s) => s.grossProfit),
        ebitda: sum((s) => s.ebitda),
        netIncome: sum((s) => s.netIncome),
        costOfGoodsSold: sum((s) => s.revenue - s.grossProfit),
      },
      cashflow: {
        ...base.cashflow,
        netIncome: sum((s) => s.netIncome),
        operatingCashFlow: sum((s) => s.netIncome + s.ebitda * 0.25 + s.netIncome * 0.05),
        freeCashFlow: sum((s) => s.netIncome + s.ebitda * 0.25 + s.netIncome * 0.05 - s.revenue * 0.06),
        capex: sum((s) => s.revenue * 0.06),
      },
    } as FinancialQuarter);
  }
  return cumulative.reverse();
}

/* ════════════════════════════════════════════════════════════ */

describe("kỳ báo cáo: phát hiện luỹ kế và tách về số riêng quý", () => {
  it("nhận diện BCTC riêng từng quý", () => {
    expect(detectStatementBasis(standaloneQuarters())).toBe("standalone");
  });

  it("nhận diện BCTC luỹ kế (YTD) và tách đúng về số riêng quý", () => {
    const qs = cumulativeQuarters();
    expect(detectStatementBasis(qs)).toBe("cumulative-ytd");

    const standalone = toStandaloneQuarters(qs, "cumulative-ytd");
    const latest = standalone.find((q) => q.period === "Q4/2025");
    // Luỹ kế Q4/2025 = 4700 → riêng Q4 = 4700 − 3250 = 1450
    expect(latest?.income.revenue).toBeCloseTo(1450, 6);

    const q3 = standalone.find((q) => q.period === "Q3/2025");
    // Luỹ kế Q3/2025 = 3250; luỹ kế Q2/2025 = 2200 → riêng Q3 = 1050
    expect(q3?.income.revenue).toBeCloseTo(1050, 6);
  });

  it("LTM = tổng 4 quý gần nhất, không nhân quý ×4", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    expect(ctx.ltm.method).toBe("sum-4q");
    expect(ctx.ltm.coverage).toBe(1);
    // 1000 + 1200 + 1050 + 1450
    expect(ctx.ltm.income.revenue).toBeCloseTo(4700, 6);
    // 123 + 155 + 133 + 191
    expect(ctx.ltm.income.netIncome).toBeCloseTo(602, 6);
    // LTM kỳ trước: 900 + 1050 + 950 + 1250
    expect(ctx.ltmPrevious?.income.revenue).toBeCloseTo(4150, 6);
  });

  it("dùng số dư BÌNH QUÂN đầu/cuối kỳ LTM làm mẫu số", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    // Đầu kỳ LTM = số dư Q4/2024; cuối kỳ = Q4/2025
    expect(ctx.balances.equity).toBeCloseTo((2230 + 2730) / 2, 6);
    expect(ctx.balances.totalAssets).toBeCloseTo((4360 + 4900) / 2, 6);
    expect(ctx.balances.closingOnly).toBe(false);
  });
});

describe("công thức số học cơ bản", () => {
  it("tăng trưởng, CAGR, tỷ số và thang điểm", () => {
    expect(growthPct(110, 100)).toBeCloseTo(10, 6);
    expect(growthPct(110, -100)).toBeNull();
    expect(cagrPct(100, 121, 2)).toBeCloseTo(10, 6);
    expect(cagrPct(-100, 121, 2)).toBeNull();
    expect(ratio(10, 4)).toBeCloseTo(2.5, 6);
    expect(ratio(10, 0)).toBeNull();
    expect(ramp(1.5, 1, 2)).toBeCloseTo(0.5, 6);
    expect(ramp(3, 1, 2)).toBe(1);
    expect(ramp(0, 1, 2)).toBe(0);
    // chỉ số càng thấp càng tốt
    expect(ramp(0.5, 2, 0.5, false)).toBe(1);
  });
});

describe("DuPont", () => {
  it("DuPont 3 bước: ROE = biên ròng × vòng quay TS × đòn bẩy", () => {
    const result = dupont3(12, 1.5, 2.2);
    expect(result.reconstructedPct).toBeCloseTo(39.6, 6);
  });

  it("DuPont 5 bước tái tạo đúng ROE và khớp ROE tính trực tiếp", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const netIncome = ctx.ltm.income.netIncome as number;
    const pretax = ctx.ltm.income.pretaxIncome as number;
    const ebit = ctx.ltm.income.operatingIncome as number;
    const revenue = ctx.ltm.income.revenue as number;

    const d5 = dupont5({
      netIncome,
      pretaxIncome: pretax,
      ebit,
      revenue,
      averageAssets: ctx.balances.totalAssets,
      averageEquity: ctx.balances.equity,
    });

    const expectedRoe = (netIncome / (ctx.balances.equity as number)) * 100;
    // ROE 5 bước phải trùng khít ROE tính trực tiếp từ LN ròng LTM / VCSH bình quân
    expect(d5.roePct).toBeCloseTo(expectedRoe, 1);

    // Đồng nhất thức DuPont: 5 nhân tử triệt tiêu nhau còn đúng LNST / VCSH BQ
    const product =
      (netIncome / pretax) *
      (pretax / ebit) *
      (ebit / revenue) *
      (revenue / (ctx.balances.totalAssets as number)) *
      ((ctx.balances.totalAssets as number) / (ctx.balances.equity as number)) *
      100;
    expect(product).toBeCloseTo(expectedRoe, 8);

    // Các nhân tử hiển thị trên UI đã làm tròn → sai số cho phép dưới 1%
    const productRounded =
      (d5.taxBurden as number) *
      (d5.interestBurden as number) *
      ((d5.ebitMarginPct as number) / 100) *
      (d5.assetTurnover as number) *
      (d5.equityMultiplier as number) *
      100;
    expect(Math.abs(productRounded - expectedRoe) / expectedRoe).toBeLessThan(0.01);
    expect(d5.steps).toHaveLength(5);
  });
});

describe("hiệu suất kinh doanh", () => {
  it("tính ROE/ROA trên LTM và số dư bình quân", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const perf = computeBusinessPerformance(ctx);
    const roe = perf.groups.find((g) => g.key === "returns")?.metrics.find((m) => m.key === "roe");
    // 602 / ((2230+2730)/2) = 602/2480 = 24.2742%
    expect(roe?.value).toBeCloseTo((602 / 2480) * 100, 1);

    const roa = perf.groups.find((g) => g.key === "returns")?.metrics.find((m) => m.key === "roa");
    // 602 / ((4360+4900)/2) = 602/4630 = 13.0022%
    expect(roa?.value).toBeCloseTo((602 / 4630) * 100, 1);
  });

  it("tính tăng trưởng LTM YoY từ hai cửa sổ LTM liền nhau", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const perf = computeBusinessPerformance(ctx);
    const growth = perf.groups.find((g) => g.key === "growth")?.metrics.find((m) => m.key === "revenueGrowthLtmYoY");
    // 4700/4150 − 1 = 13.253%
    expect(growth?.value).toBeCloseTo((4700 / 4150 - 1) * 100, 1);
  });

  it("chu kỳ chuyển đổi tiền mặt CCC = DIO + DSO − DPO", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const perf = computeBusinessPerformance(ctx);
    const eff = perf.groups.find((g) => g.key === "efficiency")!;
    const dio = eff.metrics.find((m) => m.key === "dio")?.value as number;
    const dso = eff.metrics.find((m) => m.key === "dso")?.value as number;
    const dpo = eff.metrics.find((m) => m.key === "dpo")?.value as number;
    const ccc = eff.metrics.find((m) => m.key === "ccc")?.value as number;
    expect(ccc).toBeCloseTo(dio + dso - dpo, 0);
  });

  it("trọng số 5 trụ cột bằng 100% và điểm tổng khớp trung bình có trọng số", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const perf = computeBusinessPerformance(ctx);
    expect(perf.groups.map((g) => g.key)).toEqual([
      "growth",
      "margin",
      "returns",
      "efficiency",
      "quality",
    ]);
    const weightSum = perf.groups.reduce((s, g) => s + g.weight, 0);
    expect(weightSum).toBeCloseTo(1, 10);
    expect(perf.overall).toBeGreaterThanOrEqual(0);
    expect(perf.overall).toBeLessThanOrEqual(100);
    expect(perf.coverage.total).toBeGreaterThan(30);
  });

  it("mọi chỉ số đều kèm công thức tiếng Việt", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const perf = computeBusinessPerformance(ctx);
    const all = perf.groups.flatMap((g) => g.metrics);
    expect(all.length).toBeGreaterThan(0);
    for (const m of all) {
      expect(m.formula.length, `thiếu công thức cho ${m.key}`).toBeGreaterThan(3);
      expect(/[a-zA-ZÀ-ỹ]/.test(m.formula)).toBe(true);
    }
  });

  it("không bịa số liệu: thiếu dữ liệu thì trả null chứ không phải 0", () => {
    const partial: FinancialQuarter[] = standaloneQuarters().map((q) => ({
      ...q,
      income: { ...q.income, ebitda: undefined as unknown as number, operatingIncome: undefined as unknown as number },
    }));
    const ctx = buildFundamentalContext("TEST", partial);
    const perf = computeBusinessPerformance(ctx);
    const ebitdaMargin = perf.groups.find((g) => g.key === "margin")?.metrics.find((m) => m.key === "ebitdaMargin");
    expect(ebitdaMargin?.value).toBeNull();
    expect(ebitdaMargin?.score).toBeNull();
    expect(ebitdaMargin?.verdict).toBe("Chưa có dữ liệu");
  });

  it("EPS LTM và số CP suy ra từ LN ròng khi BCTC không khai báo", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    expect(ltmEps(ctx.ltm.income)).toBeCloseTo(6.02, 4); // 602 tỷ / 100 triệu
    const withoutShares = { ...ctx.ltm.income, sharesOutstanding: undefined as unknown as number };
    expect(sharesOutstandingMillions(withoutShares)).toBeCloseTo(100, 4);
  });
});

describe("sức khỏe tài chính nâng cao", () => {
  it("Altman Z' = 6.56·X1 + 3.26·X2 + 6.72·X3 + 1.05·X4", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const altman = computeAltmanZ(ctx);
    const manual = altman.components.reduce(
      (sum, c) => sum + (c.value as number) * c.weight,
      0,
    );
    expect(altman.zScore).toBeCloseTo(manual, 2);
    expect(altman.components).toHaveLength(4);
    expect(altman.components.map((c) => c.key)).toEqual(["x1", "x2", "x3", "x4"]);
    expect(altman.components.map((c) => c.weight)).toEqual([6.56, 3.26, 6.72, 1.05]);
    // X1 = vốn lưu động / tổng tài sản, kiểm tra trực tiếp từ số dư cuối kỳ
    const closing = ctx.closing;
    const x1Expected =
      ((closing.currentAssets as number) - (closing.currentLiabilities as number)) /
      (closing.totalAssets as number);
    expect(altman.components[0].value).toBeCloseTo(x1Expected, 4);
  });

  it("phân vùng Altman đúng ngưỡng 2.6 và 1.1", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const altman = computeAltmanZ(ctx);
    const zone =
      (altman.zScore as number) > 2.6 ? "safe" : (altman.zScore as number) >= 1.1 ? "grey" : "distress";
    expect(altman.zone).toBe(zone);
  });

  it("Piotroski F-Score chỉ đếm các tiêu chí đánh giá được", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const piotroski = computePiotroskiF(ctx);
    expect(piotroski.criteria).toHaveLength(9);
    const evaluated = piotroski.criteria.filter((c) => c.passed !== null);
    expect(piotroski.evaluated).toBe(evaluated.length);
    expect(piotroski.fScore).toBe(evaluated.filter((c) => c.passed).length);
    expect(piotroski.fScore as number).toBeLessThanOrEqual(piotroski.evaluated);
  });

  it("Beneish M-Score dùng 8 biến và hằng số −4.84", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const beneish = computeBeneishM(ctx);
    const manual =
      -4.84 +
      beneish.components.reduce((sum, c) => sum + (c.value as number) * c.weight, 0);
    expect(beneish.mScore).toBeCloseTo(manual, 2);
    expect(beneish.components).toHaveLength(8);
  });

  it("điểm sức khỏe tổng hợp nằm trong 0..100 và có hạng", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const health = computeAdvancedHealth(ctx);
    expect(health.overall).toBeGreaterThanOrEqual(0);
    expect(health.overall).toBeLessThanOrEqual(100);
    expect(["A", "B", "C", "D", "E"]).toContain(health.rating);
    expect(health.solvency.length).toBeGreaterThan(10);
  });

  it("hệ số năm hoá 4/n cho BCTC luỹ kế: Q3 luỹ kế phải nhân 4/3, không phải 4", () => {
    const qs = cumulativeQuarters();
    const naive = evaluateHealthDetail("TEST", qs); // mặc định ×4 (sai với số luỹ kế)
    const corrected = evaluateHealthDetail("TEST", qs, { annualizationFactor: 4 / 3 });
    const roeNaive = naive.groups
      .find((g) => g.key === "profitability")
      ?.indicators.find((i) => i.key === "roe")?.value as number;
    const roeCorrected = corrected.groups
      .find((g) => g.key === "profitability")
      ?.indicators.find((i) => i.key === "roe")?.value as number;
    expect(roeNaive).toBeCloseTo(roeCorrected * 3, 0);
  });
});

describe("định giá doanh nghiệp", () => {
  const price = 26.6; // nghìn VND/CP

  it("vốn hoá = giá × số CP; EV = vốn hoá + nợ ròng", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const v = computeValuation(ctx, { price, beta: 1 });
    // 26.6 nghìn × 100 triệu = 2660 tỷ
    expect(v.marketCapBillionVnd).toBeCloseTo(2660, 0);
    const closing = ctx.closing;
    const netDebt =
      (closing.longTermDebt as number) +
      (closing.shortTermDebt as number) -
      (closing.cashAndEquivalents as number) -
      (closing.shortTermInvestments as number);
    expect(Math.abs((v.netDebtBillionVnd as number) - netDebt)).toBeLessThanOrEqual(1);
    expect(Math.abs((v.enterpriseValueBillionVnd as number) - (2660 + netDebt))).toBeLessThanOrEqual(1);
  });

  it("P/E = giá / EPS LTM và P/B = giá / BVPS", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const v = computeValuation(ctx, { price, beta: 1 });
    const pe = v.multiples.find((m) => m.key === "pe")?.value as number;
    // EPS LTM = 602 tỷ / 100 triệu CP = 6.02 nghìn VND/CP
    expect(v.epsLtm).toBeCloseTo(6.02, 2);
    expect(pe).toBeCloseTo(26.6 / 6.02, 1);
    const pb = v.multiples.find((m) => m.key === "pb")?.value as number;
    // BVPS = 2730 tỷ / 100 triệu CP = 27.3 nghìn VND/CP
    expect(v.bvps).toBeCloseTo(27.3, 1);
    expect(pb).toBeCloseTo(26.6 / 27.3, 2);
  });

  it("Ke theo CAPM = Rf + β × ERP; WACC là trung bình trọng số Ke và Kd sau thuế", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const assumptions = defaultMacroAssumptions();
    const wacc = computeWacc(ctx, { beta: 1.2, marketCap: 2660, price, assumptions });
    const ke = assumptions.riskFreeRate + 1.2 * assumptions.equityRiskPremium;
    expect(wacc.costOfEquity).toBeCloseTo(ke, 4);
    const expected =
      ke * (wacc.equityWeight as number) + (wacc.costOfDebtAfterTax as number) * (wacc.debtWeight as number);
    expect(wacc.value).toBeCloseTo(expected, 4);
    expect((wacc.equityWeight as number) + (wacc.debtWeight as number)).toBeCloseTo(1, 6);
  });

  it("bội số ngành suy từ Gordon: P/B = (ROE − g) / (Ke − g) và P/E = P/B ÷ ROE", () => {
    const benchmark = {
      sector: "Test",
      industry: "Test",
      netMargin: 0.12,
      grossMargin: 0.35,
      operatingMargin: 0.18,
      assetTurnover: 1.0,
      leverage: 0.45,
      currentRatio: 1.5,
      inventoryDays: 60,
      receivableDays: 40,
      revenuePerEmployee: 3000,
      capexToRevenue: 0.05,
      dividendPayout: 0.4,
      effectiveTaxRate: 0.2,
      depreciationPctFA: 0.08,
      cashPctAssets: 0.1,
      beta: 1,
      description: "",
    };
    const ke = 0.14;
    const g = 0.03;
    const m = deriveIndustryMultiples(benchmark, ke, g);
    const roe = 0.12 * 1.0 * (1 / (1 - 0.45)); // 21.818%
    expect(m.roe).toBeCloseTo(roe * 100, 1);
    expect(m.pb).toBeCloseTo((roe - g) / (ke - g), 2);
    expect(m.pe).toBeCloseTo(((roe - g) / (ke - g)) / roe, 2);
  });

  it("Graham Number = √(22.5 × EPS × BVPS)", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const v = computeValuation(ctx, { price, beta: 1 });
    expect(v.grahamNumber).toBeCloseTo(Math.sqrt(22.5 * (v.epsLtm as number) * (v.bvps as number)), 1);
  });

  it("Reverse DCF trả về đúng tốc độ tăng trưởng làm DCF bằng giá thị trường", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const v = computeValuation(ctx, { price, beta: 1 });
    if (v.reverseDcf.impliedGrowthPct === null || !v.dcf.available) return;
    const g = (v.reverseDcf.impliedGrowthPct as number) / 100;
    // Tái tạo DCF với đúng g đó và so với giá
    const fcf0 = v.dcf.baseFcf as number;
    const w = v.dcf.wacc as number;
    const tg = v.dcf.terminalGrowth;
    const years = 5;
    let pv = 0;
    let f = fcf0;
    for (let i = 1; i <= years; i++) {
      f = f * (1 + g);
      pv += f / Math.pow(1 + w, i);
    }
    const tv = (f * (1 + tg)) / (w - tg);
    const ev = pv + tv / Math.pow(1 + w, years);
    const perShare = (ev - (v.netDebtBillionVnd as number)) / (v.sharesOutstandingMillions as number);
    expect(perShare).toBeCloseTo(price, 0);
  });

  it("giá mục tiêu là trung bình có trọng số (đã chuẩn hoá) của các phương pháp khả dụng", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const v = computeValuation(ctx, { price, beta: 1 });
    expect(v.methods.length).toBeGreaterThan(0);
    const weightSum = v.methods.reduce((s, m) => s + m.weight, 0);
    expect(weightSum).toBeCloseTo(1, 2);
    const expected = v.methods.reduce((s, m) => s + (m.valuePerShare as number) * m.weight, 0);
    expect(v.targetPrice.mid).toBeCloseTo(expected, 0);
    expect((v.targetPrice.low as number)).toBeLessThanOrEqual(v.targetPrice.high as number);
    // upside khớp công thức (mid − price)/price
    expect(v.upsidePct).toBeCloseTo(((v.targetPrice.mid as number) - price) / price * 100, 0);
  });

  it("lưới độ nhạy là ma trận 5×5 WACC × g", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const v = computeValuation(ctx, { price, beta: 1 });
    expect(v.sensitivity.waccSteps).toHaveLength(5);
    expect(v.sensitivity.growthSteps).toHaveLength(5);
    expect(v.sensitivity.cells).toHaveLength(25);
  });

  it("không có giá thị trường: bội số phụ thuộc giá bị bỏ trống, kết luận ghi rõ thiếu dữ liệu", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const v = computeValuation(ctx, { price: null, beta: 1 });
    expect(v.price).toBeNull();
    expect(v.marketCapBillionVnd).toBeNull();
    // P/E, P/B, EV/* đều cần giá → null, không được suy đoán
    expect(v.multiples.find((m) => m.key === "pe")?.value).toBeNull();
    expect(v.multiples.find((m) => m.key === "pb")?.value).toBeNull();
    expect(v.multiples.find((m) => m.key === "evEbitda")?.value).toBeNull();
    // Giá trị nội tại vẫn tính được từ BCTC (không phụ thuộc giá) nhưng không kết luận mua/bán
    expect(v.verdictVi).toContain("Chưa đủ dữ liệu");
    expect(v.rating).toBe("N/A");
  });

  it("FCF âm thì loại DCF khỏi giá mục tiêu và ghi cảnh báo", () => {
    const lossMaking = standaloneQuarters().map((q) => ({
      ...q,
      cashflow: { ...q.cashflow, freeCashFlow: -50, operatingCashFlow: -40 },
    })) as FinancialQuarter[];
    const ctx = buildFundamentalContext("TEST", lossMaking);
    const v = computeValuation(ctx, { price, beta: 1 });
    expect(v.dcf.available).toBe(false);
    expect(v.methods.find((m) => m.key === "dcf")).toBeUndefined();
    expect(v.warnings.some((w) => w.includes("FCF"))).toBe(true);
  });
});

describe("thuế suất hiệu dụng và bộ chỉ số đòn bẩy", () => {
  it("thuế suất = thuế TNDN / LNTT, giới hạn trong 0..50%", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const rate = effectiveTaxRateOf(ctx);
    expect(rate).toBeCloseTo(0.2, 2);
  });

  it("Interest coverage = EBIT / chi phí lãi vay (LTM)", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const { metrics } = computeSolvencyMetrics(ctx);
    const icr = metrics.find((m) => m.key === "interestCoverage");
    const expected = (ctx.ltm.income.operatingIncome as number) / (ctx.ltm.income.interestExpense as number);
    expect(icr?.value).toBeCloseTo(expected, 1);
  });

  it("Nợ ròng/EBITDA dùng EBITDA LTM, không nhân quý ×4", () => {
    const ctx = buildFundamentalContext("TEST", standaloneQuarters());
    const { metrics } = computeSolvencyMetrics(ctx);
    const ratioMetric = metrics.find((m) => m.key === "netDebtToEbitda");
    const closing = ctx.closing;
    const netDebt =
      (closing.longTermDebt as number) +
      (closing.shortTermDebt as number) -
      (closing.cashAndEquivalents as number) -
      (closing.shortTermInvestments as number);
    const ebitdaLtm = ctx.ltm.income.ebitda as number;
    expect(ratioMetric?.value).toBeCloseTo(netDebt / ebitdaLtm, 1);
    expect(ratio(1, 1)).toBe(1);
  });
});

describe("bối cảnh LTM từ BCTC luỹ kế cho cùng kết quả như BCTC riêng quý", () => {
  it("doanh thu LTM bằng nhau giữa hai cách trình bày", () => {
    const fromStandalone = buildFundamentalContext("TEST", standaloneQuarters());
    const fromCumulative = buildFundamentalContext("TEST", cumulativeQuarters());
    expect(fromCumulative.basis).toBe("cumulative-ytd");
    expect(fromCumulative.ltm.income.revenue).toBeCloseTo(fromStandalone.ltm.income.revenue as number, 4);
    expect(fromCumulative.ltm.income.netIncome).toBeCloseTo(fromStandalone.ltm.income.netIncome as number, 4);
    // LTM dựng từ 4 quý sau khi tách luỹ kế
    expect(fromCumulative.ltm.method).toBe("sum-4q");
    const window = buildLtmWindow(fromCumulative.normalized);
    expect(window.coverage).toBe(1);
  });
});
