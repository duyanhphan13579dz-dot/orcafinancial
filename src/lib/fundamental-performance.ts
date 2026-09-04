/**
 * Hiệu suất kinh doanh (Business Performance Engine)
 *
 * Mọi chỉ số đều tính trên:
 *  - Tử số : số LTM (12 tháng gần nhất) đã chuẩn hoá từ BCTC
 *  - Mẫu số: BÌNH QUÂN số dư đầu kỳ / cuối kỳ LTM
 * Đây là cách tính chuẩn của phân tích tài chính (không dùng số cuối kỳ, không nhân quý ×4).
 *
 * 5 trụ cột:
 *   Tăng trưởng        20%
 *   Biên lợi nhuận     20%
 *   Sức sinh lời       25%
 *   Hiệu quả vận hành  20%
 *   Chất lượng lợi nhuận 15%
 */

import { formatPeriodFromComposite } from "@/lib/format";
import {
  cagrPct,
  coverageOf,
  field,
  growthPct,
  growthPctSigned,
  groupScore,
  makeGroup,
  metric,
  nonZero,
  overallOf,
  payablesOf,
  positive,
  ramp,
  ratingOf,
  ratio,
  round,
  strengthsOf,
  weakestOf,
  type EngineGroup,
  type FundamentalContext,
  type NormalizedQuarter,
  type Num,
} from "@/lib/fundamental-engine";

/* ── Trọng số 5 trụ cột (tổng = 1.00) ── */
export const PERFORMANCE_WEIGHTS = {
  growth: 0.2,
  margin: 0.2,
  returns: 0.25,
  efficiency: 0.2,
  quality: 0.15,
} as const;

export interface DupontStep {
  key: string;
  label: string;
  value: Num;
  unit: string;
  formula: string;
}

export interface DupontResult {
  netProfitMarginPct: Num;
  assetTurnover: Num;
  equityMultiplier: Num;
  roePct: Num;
  reconstructedPct: Num;
  description: string;
}

export interface Dupont5Result {
  taxBurden: Num;
  interestBurden: Num;
  ebitMarginPct: Num;
  assetTurnover: Num;
  equityMultiplier: Num;
  roePct: Num;
  steps: DupontStep[];
  description: string;
}

export interface PerformanceQuarterPoint {
  displayPeriod: string;
  displayPeriodVi: string;
  shortTag: string;
  fiscalYear: number;
  quarter: number;
  revenue: Num;
  grossProfit: Num;
  ebitda: Num;
  operatingIncome: Num;
  netIncome: Num;
  eps: Num;
  operatingCashFlow: Num;
  freeCashFlow: Num;
  capex: Num;
  grossMarginPct: Num;
  ebitdaMarginPct: Num;
  operatingMarginPct: Num;
  netMarginPct: Num;
  revenueYoYPct: Num;
  netIncomeYoYPct: Num;
  roePct: Num;
  roaPct: Num;
  dsoDays: Num;
  dioDays: Num;
  dpoDays: Num;
  cccDays: Num;
}

export interface BusinessPerformance {
  symbol: string;
  asOfPeriod: string;
  asOfPeriodVi: string;
  ltmMethod: string;
  ltmCoverage: number;
  basis: string;
  overall: number;
  rating: string;
  groups: EngineGroup[];
  dupont3: DupontResult;
  dupont5: Dupont5Result;
  series: PerformanceQuarterPoint[];
  summary: string;
  coverage: { computed: number; total: number; pct: number };
  warnings: string[];
}

/* ────────────────────────────────────────────────────────────
 * DuPont
 * ──────────────────────────────────────────────────────────── */

/**
 * DuPont 3 bước: ROE = Biên LN ròng × Vòng quay tài sản × Đòn bẩy VCSH
 */
export function dupont3(netProfitMarginPct: Num, assetTurnover: Num, equityMultiplier: Num): DupontResult {
  if (netProfitMarginPct === null || assetTurnover === null || equityMultiplier === null) {
    return {
      netProfitMarginPct,
      assetTurnover,
      equityMultiplier,
      roePct: null,
      reconstructedPct: null,
      description: "Chưa đủ dữ liệu để phân rã DuPont 3 bước.",
    };
  }
  const roe = netProfitMarginPct * assetTurnover * equityMultiplier;
  return {
    netProfitMarginPct: round(netProfitMarginPct),
    assetTurnover: round(assetTurnover),
    equityMultiplier: round(equityMultiplier),
    roePct: round(netProfitMarginPct),
    reconstructedPct: round(roe),
    description:
      `ROE = Biên LN ròng ${netProfitMarginPct.toFixed(1)}% × Vòng quay tài sản ${assetTurnover.toFixed(2)} × ` +
      `Đòn bẩy VCSH ${equityMultiplier.toFixed(2)} = ${roe.toFixed(1)}%. ` +
      driverDescription(netProfitMarginPct, assetTurnover, equityMultiplier),
  };
}

function driverDescription(marginPct: number, turnover: number, multiplier: number): string {
  const contributions = [
    { label: "biên lợi nhuận", weight: Math.abs(Math.log(Math.max(marginPct, 0.01))) },
    { label: "hiệu suất sử dụng tài sản", weight: Math.abs(Math.log(Math.max(turnover, 0.01))) },
    { label: "đòn bẩy tài chính", weight: Math.abs(Math.log(Math.max(multiplier, 0.01))) },
  ].sort((a, b) => b.weight - a.weight);
  return `Nguồn sinh lời chính đến từ ${contributions[0].label}.`;
}

/**
 * DuPont 5 bước:
 * ROE = (LNST/LNTT) × (LNTT/EBIT) × (EBIT/Doanh thu) × (Doanh thu/Tài sản BQ) × (Tài sản BQ/VCSH BQ)
 *      = Gánh nặng thuế × Gánh nặng lãi vay × Biên EBIT × Vòng quay TS × Đòn bẩy
 */
export function dupont5(inputs: {
  netIncome: Num;
  pretaxIncome: Num;
  ebit: Num;
  revenue: Num;
  averageAssets: Num;
  averageEquity: Num;
}): Dupont5Result {
  const taxBurden = ratio(inputs.netIncome, inputs.pretaxIncome);
  const interestBurden = ratio(inputs.pretaxIncome, inputs.ebit);
  const ebitMargin = ratio(inputs.ebit, inputs.revenue);
  const assetTurnover = ratio(inputs.revenue, inputs.averageAssets);
  const equityMultiplier = ratio(inputs.averageAssets, inputs.averageEquity);
  const roe =
    taxBurden !== null && interestBurden !== null && ebitMargin !== null && assetTurnover !== null && equityMultiplier !== null
      ? taxBurden * interestBurden * ebitMargin * assetTurnover * equityMultiplier * 100
      : null;

  const steps: DupontStep[] = [
    { key: "taxBurden", label: "Gánh nặng thuế (LNST/LNTT)", value: round(taxBurden, 3), unit: "lần", formula: "LNST ÷ LNTT" },
    { key: "interestBurden", label: "Gánh nặng lãi vay (LNTT/EBIT)", value: round(interestBurden, 3), unit: "lần", formula: "LNTT ÷ EBIT" },
    { key: "ebitMargin", label: "Biên EBIT", value: round(ebitMargin !== null ? ebitMargin * 100 : null), unit: "%", formula: "EBIT ÷ Doanh thu × 100" },
    { key: "assetTurnover", label: "Vòng quay tổng tài sản", value: round(assetTurnover), unit: "vòng", formula: "Doanh thu LTM ÷ Tổng tài sản bình quân" },
    { key: "equityMultiplier", label: "Đòn bẩy vốn chủ", value: round(equityMultiplier), unit: "lần", formula: "Tổng tài sản BQ ÷ VCSH bình quân" },
  ];

  return {
    taxBurden: round(taxBurden, 3),
    interestBurden: round(interestBurden, 3),
    ebitMarginPct: round(ebitMargin !== null ? ebitMargin * 100 : null),
    assetTurnover: round(assetTurnover),
    equityMultiplier: round(equityMultiplier),
    roePct: round(roe),
    steps,
    description:
      roe === null
        ? "Chưa đủ dữ liệu để phân rã DuPont 5 bước."
        : `ROE 5 bước = ${steps.map((s) => (s.value === null ? "—" : s.value.toFixed(2))).join(" × ")} = ${roe.toFixed(1)}%. ` +
          (interestBurden !== null && interestBurden < 0.8
            ? "Gánh nặng lãi vay lớn đang bào mòn lợi nhuận của cổ đông."
            : "Chi phí lãi vay không phải điểm nghẽn chính của ROE."),
  };
}

/* ────────────────────────────────────────────────────────────
 * Chuỗi thời gian theo quý (đầu vào cho biểu đồ)
 * ──────────────────────────────────────────────────────────── */

function quarterPoint(
  ctx: FundamentalContext,
  quarter: NormalizedQuarter,
): PerformanceQuarterPoint {
  // `quarter.period` đã ở dạng composite ("Q4/2025") → phải truyền dạng chuỗi,
  // nếu truyền dạng object thì formatPeriod sẽ nối thêm năm một lần nữa
  // ("Q4/2025/2025", shortTag "Q4/202525").
  const labels = formatPeriodFromComposite(quarter.period);
  const revenue = field(quarter.income, "revenue");
  const grossProfit = field(quarter.income, "grossProfit");
  const ebitda = field(quarter.income, "ebitda");
  const operatingIncome = field(quarter.income, "operatingIncome");
  const netIncome = field(quarter.income, "netIncome");
  const equity = field(quarter.balance, "equity");
  const totalAssets = field(quarter.balance, "totalAssets");
  const receivables = field(quarter.balance, "receivables");
  const inventory = field(quarter.balance, "inventory");
  const cogs = field(quarter.income, "costOfGoodsSold");
  const rawCapex = field(quarter.cashflow, "capex");
  const capex = rawCapex === null ? null : Math.abs(rawCapex);

  // Quý cùng kỳ năm trước nằm sau `index + 4` vị trí trong mảng giảm dần.
  const yoyBase = ctx.normalized
    .slice()
    .sort((a, b) => b.fiscalYear - a.fiscalYear || b.quarter - a.quarter)
    .find((q) => q.fiscalYear === quarter.fiscalYear - 1 && q.quarter === quarter.quarter);

  // Số dư × 4 để khớp với doanh thu/giá vốn đã năm hoá của riêng quý đó.
  const cogsAnnual = cogs !== null ? cogs * 4 : null;
  const revAnnual = revenue !== null ? revenue * 4 : null;
  const dso = ratio(receivables, revAnnual);
  const dio = ratio(inventory, cogsAnnual);
  const dpo = ratio(payablesOf(quarter.balance), cogsAnnual);

  return {
    ...labels,
    fiscalYear: quarter.fiscalYear,
    quarter: quarter.quarter,
    revenue,
    grossProfit,
    ebitda,
    operatingIncome,
    netIncome,
    eps: field(quarter.income, "eps"),
    operatingCashFlow: field(quarter.cashflow, "operatingCashFlow"),
    freeCashFlow: field(quarter.cashflow, "freeCashFlow"),
    capex,
    grossMarginPct: round(ratio(grossProfit, revenue) !== null ? (ratio(grossProfit, revenue) as number) * 100 : null),
    ebitdaMarginPct: round(ratio(ebitda, revenue) !== null ? (ratio(ebitda, revenue) as number) * 100 : null),
    operatingMarginPct: round(ratio(operatingIncome, revenue) !== null ? (ratio(operatingIncome, revenue) as number) * 100 : null),
    netMarginPct: round(ratio(netIncome, revenue) !== null ? (ratio(netIncome, revenue) as number) * 100 : null),
    revenueYoYPct: round(growthPct(revenue, yoyBase ? field(yoyBase.income, "revenue") : null)),
    netIncomeYoYPct: round(growthPctSigned(netIncome, yoyBase ? field(yoyBase.income, "netIncome") : null)),
    roePct: round(ratio(netIncome !== null ? netIncome * 4 : null, equity) !== null ? (ratio(netIncome !== null ? netIncome * 4 : null, equity) as number) * 100 : null),
    roaPct: round(ratio(netIncome !== null ? netIncome * 4 : null, totalAssets) !== null ? (ratio(netIncome !== null ? netIncome * 4 : null, totalAssets) as number) * 100 : null),
    dsoDays: round(dso !== null ? dso * 365 : null, 1),
    dioDays: round(dio !== null ? dio * 365 : null, 1),
    dpoDays: round(dpo !== null ? dpo * 365 : null, 1),
    cccDays:
      dso !== null && dio !== null
        ? round((dso + dio - (dpo ?? 0)) * 365, 1)
        : null,
  };
}

/** CCC (ngày) của một quý cụ thể — dùng để tính biến động chu kỳ tiền mặt. */
function cccOfQuarter(quarter: NormalizedQuarter): Num {
  const revenue = field(quarter.income, "revenue");
  const cogs = field(quarter.income, "costOfGoodsSold");
  const revAnnual = revenue !== null ? revenue * 4 : null;
  const cogsAnnual = cogs !== null ? cogs * 4 : null;
  const dso = ratio(field(quarter.balance, "receivables"), revAnnual);
  const dio = ratio(field(quarter.balance, "inventory"), cogsAnnual);
  const dpo = ratio(payablesOf(quarter.balance), cogsAnnual);
  if (dso === null && dio === null) return null;
  return ((dso ?? 0) + (dio ?? 0) - (dpo ?? 0)) * 365;
}

function buildSeries(ctx: FundamentalContext, limit = 12): PerformanceQuarterPoint[] {
  const descending = ctx.normalized
    .slice()
    .sort((a, b) => b.fiscalYear - a.fiscalYear || b.quarter - a.quarter)
    .slice(0, Math.max(4, limit));
  return descending.map((q) => quarterPoint(ctx, q));
}

/* ────────────────────────────────────────────────────────────
 * Bộ tính hiệu suất kinh doanh
 * ──────────────────────────────────────────────────────────── */

export function computeBusinessPerformance(ctx: FundamentalContext): BusinessPerformance {
  const { ltm, balances, closing, latest } = ctx;
  const warnings = [...ctx.warnings];

  const revenue = field(ltm.income, "revenue");
  const cogs = field(ltm.income, "costOfGoodsSold");
  const grossProfit = field(ltm.income, "grossProfit") ?? (revenue !== null && cogs !== null ? revenue - cogs : null);
  const operatingIncome = field(ltm.income, "operatingIncome");
  const ebitda = field(ltm.income, "ebitda") ?? (operatingIncome !== null ? operatingIncome + (field(ltm.income, "depreciation") ?? 0) : null);
  const depreciation = field(ltm.income, "depreciation");
  const ebit = operatingIncome ?? (ebitda !== null && depreciation !== null ? ebitda - depreciation : null);
  const interestExpense = field(ltm.income, "interestExpense");
  const pretaxIncome = field(ltm.income, "pretaxIncome");
  const netIncome = field(ltm.income, "netIncome");
  // Thuế TNDN: ưu tiên dòng riêng trên BCTC; khi nguồn (finfo statements)
  // không tách dòng thuế, suy ra = LNTT − LNST (23800 − 23003) — đúng đẳng
  // thức kế toán, không phải số ước đoán.
  const incomeTax =
    field(ltm.income, "incomeTax") ??
    (pretaxIncome !== null && netIncome !== null ? pretaxIncome - netIncome : null);
  const operatingCashFlow = field(ltm.cashflow, "operatingCashFlow");
  const rawLtmCapex = field(ltm.cashflow, "capex");
  const capexValue = rawLtmCapex === null ? null : Math.abs(rawLtmCapex);
  const freeCashFlow = field(ltm.cashflow, "freeCashFlow") ?? (operatingCashFlow !== null && capexValue !== null ? operatingCashFlow - capexValue : null);
  const dividendsPaid = field(ltm.cashflow, "dividendsPaid");

  const prevLtm = ctx.ltmPrevious;
  const prevRevenue = prevLtm ? field(prevLtm.income, "revenue") : null;
  const prevNetIncome = prevLtm ? field(prevLtm.income, "netIncome") : null;
  const prevEbitda = prevLtm ? field(prevLtm.income, "ebitda") : null;
  const prevGrossProfit = prevLtm ? field(prevLtm.income, "grossProfit") : null;

  const prevQuarterRevenue = ctx.prevQuarter ? field(ctx.prevQuarter.income, "revenue") : null;
  const prevQuarterEbit = ctx.prevQuarter ? field(ctx.prevQuarter.income, "operatingIncome") : null;
  const yoyQuarterRevenue = ctx.yearAgo ? field(ctx.yearAgo.income, "revenue") : null;
  const yoyQuarterNetIncome = ctx.yearAgo ? field(ctx.yearAgo.income, "netIncome") : null;

  const estimated = ltm.annualized;

  /* ── CAGR dài hạn theo năm tài chính (chỉ dùng năm có đủ 4 quý) ── */
  const fyRevenue = new Map<number, Num>();
  const byYear = new Map<number, NormalizedQuarter[]>();
  for (const q of ctx.normalized) {
    const list = byYear.get(q.fiscalYear) ?? [];
    list.push(q);
    byYear.set(q.fiscalYear, list);
  }
  for (const [year, list] of byYear) {
    const distinct = new Set(list.map((q) => q.quarter));
    if (distinct.size !== 4) continue;
    const revenues = list.map((q) => field(q.income, "revenue"));
    if (revenues.some((v) => v === null)) continue;
    fyRevenue.set(year, revenues.reduce<number>((sum, v) => sum + (v ?? 0), 0));
  }
  const years = [...fyRevenue.keys()].sort((a, b) => a - b);
  let revenueCagr: Num = null;
  let cagrYears = 0;
  if (years.length >= 2) {
    const first = years[0];
    const last = years[years.length - 1];
    revenueCagr = cagrPct(fyRevenue.get(first) ?? null, fyRevenue.get(last) ?? null, last - first);
    cagrYears = last - first;
  }

  /* ─────────── 1. TĂNG TRƯỞNG ─────────── */
  const growthMetrics = [
    metric("revenueGrowthLtmYoY", "Tăng trưởng doanh thu LTM (YoY)", growthPct(revenue, prevRevenue), "%",
      "(Doanh thu LTM ÷ Doanh thu LTM kỳ trước − 1) × 100",
      { score: ramp(growthPct(revenue, prevRevenue), -10, 25), estimated }),
    metric("revenueGrowthQoQ", "Tăng trưởng doanh thu QoQ", growthPct(revenue, prevQuarterRevenue), "%",
      "(Doanh thu quý này ÷ Doanh thu quý trước − 1) × 100",
      { score: ramp(growthPct(revenue, prevQuarterRevenue), -8, 12) }),
    metric("revenueGrowthYoY", "Tăng trưởng doanh thu cùng kỳ (YoY)", growthPct(latest ? field(latest.income, "revenue") : null, yoyQuarterRevenue), "%",
      "(Doanh thu quý này ÷ Doanh thu cùng quý năm trước − 1) × 100",
      { score: ramp(growthPct(latest ? field(latest.income, "revenue") : null, yoyQuarterRevenue), -10, 20) }),
    metric("revenueCagr", `CAGR doanh thu ${cagrYears || 3} năm`, revenueCagr, "%/năm",
      "((Doanh thu năm cuối ÷ Doanh thu năm đầu)^(1/số năm) − 1) × 100",
      { score: ramp(revenueCagr, 0, 20) }),
    metric("netIncomeGrowthLtmYoY", "Tăng trưởng LN ròng LTM (YoY)", growthPctSigned(netIncome, prevNetIncome), "%",
      "(LN ròng LTM − LN ròng LTM kỳ trước) ÷ |LN ròng LTM kỳ trước| × 100",
      { score: ramp(growthPctSigned(netIncome, prevNetIncome), -20, 30), estimated }),
    metric("netIncomeGrowthYoY", "Tăng trưởng LN ròng cùng kỳ (YoY)", growthPctSigned(latest ? field(latest.income, "netIncome") : null, yoyQuarterNetIncome), "%",
      "(LN ròng quý này − LN ròng cùng quý năm trước) ÷ |LN ròng cùng quý năm trước| × 100",
      { score: ramp(growthPctSigned(latest ? field(latest.income, "netIncome") : null, yoyQuarterNetIncome), -25, 35) }),
    metric("ebitdaGrowthLtmYoY", "Tăng trưởng EBITDA LTM (YoY)", growthPct(ebitda, prevEbitda), "%",
      "(EBITDA LTM ÷ EBITDA LTM kỳ trước − 1) × 100",
      { score: ramp(growthPct(ebitda, prevEbitda), -10, 25), estimated }),
    metric("epsGrowthLtmYoY", "Tăng trưởng EPS LTM (YoY)", epsGrowth(ctx), "%",
      "(EPS LTM ÷ EPS LTM kỳ trước − 1) × 100; EPS = LN ròng ÷ số CP lưu hành",
      { score: ramp(epsGrowth(ctx), -20, 30), estimated }),
  ];

  /* ─────────── 2. BIÊN LỢI NHUẬN ─────────── */
  const grossMargin = ratio(grossProfit, revenue);
  const ebitdaMargin = ratio(ebitda, revenue);
  const operatingMargin = ratio(ebit, revenue);
  const netMargin = ratio(netIncome, revenue);
  const prevNetMargin = ratio(prevNetIncome, prevRevenue);
  const prevGrossMargin = ratio(prevGrossProfit, prevRevenue);
  const effectiveTaxRate = ratio(incomeTax, pretaxIncome);
  const interestToRevenue = ratio(interestExpense, revenue);

  const marginMetrics = [
    metric("grossMargin", "Biên lợi nhuận gộp", grossMargin !== null ? grossMargin * 100 : null, "%",
      "Lợi nhuận gộp ÷ Doanh thu thuần × 100",
      { score: ramp(grossMargin, 0.1, 0.45), estimated }),
    metric("ebitdaMargin", "Biên EBITDA", ebitdaMargin !== null ? ebitdaMargin * 100 : null, "%",
      "EBITDA ÷ Doanh thu thuần × 100",
      { score: ramp(ebitdaMargin, 0.05, 0.32), estimated }),
    metric("operatingMargin", "Biên lợi nhuận hoạt động (EBIT)", operatingMargin !== null ? operatingMargin * 100 : null, "%",
      "EBIT ÷ Doanh thu thuần × 100",
      { score: ramp(operatingMargin, 0.02, 0.25), estimated }),
    metric("netMargin", "Biên lợi nhuận ròng", netMargin !== null ? netMargin * 100 : null, "%",
      "LN ròng ÷ Doanh thu thuần × 100",
      { score: ramp(netMargin, 0.02, 0.2), estimated }),
    metric("grossMarginDelta", "Biến động biên gộp (YoY LTM)",
      grossMargin !== null && prevGrossMargin !== null ? (grossMargin - prevGrossMargin) * 100 : null, "điểm %",
      "Biên gộp LTM − Biên gộp LTM kỳ trước",
      { score: ramp(grossMargin !== null && prevGrossMargin !== null ? (grossMargin - prevGrossMargin) * 100 : null, -4, 4), estimated }),
    metric("netMarginDelta", "Biến động biên ròng (YoY LTM)",
      netMargin !== null && prevNetMargin !== null ? (netMargin - prevNetMargin) * 100 : null, "điểm %",
      "Biên ròng LTM − Biên ròng LTM kỳ trước",
      { score: ramp(netMargin !== null && prevNetMargin !== null ? (netMargin - prevNetMargin) * 100 : null, -4, 4), estimated }),
    metric("effectiveTaxRate", "Thuế suất hiệu dụng", effectiveTaxRate !== null ? effectiveTaxRate * 100 : null, "%",
      "Thuế TNDN ÷ Lợi nhuận trước thuế × 100",
      { score: effectiveTaxRate === null ? null : ramp(Math.abs(effectiveTaxRate - 0.2) * -1, -0.15, 0), estimated }),
    metric("interestToRevenue", "Chi phí lãi vay / Doanh thu", interestToRevenue !== null ? interestToRevenue * 100 : null, "%",
      "Chi phí lãi vay ÷ Doanh thu thuần × 100",
      { score: ramp(interestToRevenue !== null ? interestToRevenue * 100 : null, 8, 0.5, false), estimated }),
  ];

  /* ─────────── 3. SỨC SINH LỜI ─────────── */
  const roe = ratio(netIncome, positive(balances.equity));
  const roa = ratio(netIncome, positive(balances.totalAssets));
  const taxRateForNopat = effectiveTaxRate !== null && effectiveTaxRate >= 0 && effectiveTaxRate <= 0.5 ? effectiveTaxRate : 0.2;
  const nopat = ebit !== null ? ebit * (1 - taxRateForNopat) : null;
  const roic = ratio(nopat, positive(balances.investedCapital));
  const workingCapitalBase =
    balances.totalAssets !== null && field(closing, "currentLiabilities") !== null
      ? balances.totalAssets - (field(closing, "currentLiabilities") as number)
      : null;
  const roce = ratio(ebit, positive(workingCapitalBase));
  const assetTurnover = ratio(revenue, positive(balances.totalAssets));
  const equityMultiplier = ratio(balances.totalAssets, positive(balances.equity));
  const roeLeverageGap = roe !== null && roa !== null ? roe - roa : null;
  // Đơn vị: ĐIỂM % — roic là phân số (0.07 = 7%) nên phải ×100 trước khi trừ
  // 12 điểm % chi phí vốn ước tính (trước đây trừ thẳng 12 vào phân số → −1193).
  const economicSpread = roic !== null ? roic * 100 - 12 : null;

  const returnsMetrics = [
    metric("roe", "ROE (LTM, VCSH bình quân)", roe !== null ? roe * 100 : null, "%",
      "LN ròng LTM ÷ VCSH bình quân × 100",
      { score: ramp(roe, 0.05, 0.22), estimated }),
    metric("roa", "ROA (LTM, tài sản bình quân)", roa !== null ? roa * 100 : null, "%",
      "LN ròng LTM ÷ Tổng tài sản bình quân × 100",
      { score: ramp(roa, 0.02, 0.12), estimated }),
    metric("roic", "ROIC (LTM)", roic !== null ? roic * 100 : null, "%",
      "NOPAT ÷ Vốn đầu tư bình quân × 100; NOPAT = EBIT × (1 − thuế suất); Vốn đầu tư = VCSH + Nợ vay − Tiền",
      { score: ramp(roic, 0.05, 0.2), estimated }),
    metric("roce", "ROCE", roce !== null ? roce * 100 : null, "%",
      "EBIT ÷ (Tổng tài sản − Nợ ngắn hạn) × 100",
      { score: ramp(roce, 0.06, 0.25), estimated }),
    metric("roeRoaGap", "Chênh ROE − ROA (đòn bẩy sinh lời)", roeLeverageGap !== null ? roeLeverageGap * 100 : null, "điểm %",
      "ROE − ROA; khoảng cách càng lớn thì lợi nhuận càng phụ thuộc vào nợ vay",
      { score: ramp(roeLeverageGap !== null ? roeLeverageGap * 100 : null, 40, 2, false) }),
    metric("economicSpread", "Chênh lệch ROIC − chi phí vốn (12%)", economicSpread, "điểm %",
      "ROIC − 12%; dương = doanh nghiệp tạo ra giá trị kinh tế (EVA > 0)",
      { score: ramp(economicSpread, -6, 8), estimated }),
    metric("assetTurnover", "Vòng quay tổng tài sản", assetTurnover, "vòng/năm",
      "Doanh thu LTM ÷ Tổng tài sản bình quân",
      { score: ramp(assetTurnover, 0.3, 1.5), estimated }),
    metric("equityMultiplier", "Đòn bẩy vốn chủ", equityMultiplier, "lần",
      "Tổng tài sản bình quân ÷ VCSH bình quân",
      { score: ramp(equityMultiplier, 5, 1.3, false) }),
  ];

  /* ─────────── 4. HIỆU QUẢ VẬN HÀNH ─────────── */
  const inventoryTurnover = ratio(cogs, positive(balances.inventory));
  const receivableTurnover = ratio(revenue, positive(balances.receivables));
  const payableTurnover = ratio(cogs, positive(balances.payables));
  const dio = inventoryTurnover !== null && inventoryTurnover > 0 ? 365 / inventoryTurnover : null;
  const dso = receivableTurnover !== null && receivableTurnover > 0 ? 365 / receivableTurnover : null;
  const dpo = payableTurnover !== null && payableTurnover > 0 ? 365 / payableTurnover : null;
  const ccc = dio !== null && dso !== null ? dio + dso - (dpo ?? 0) : null;
  const fixedAssetTurnover = ratio(revenue, positive(balances.fixedAssets));
  const capexIntensity = ratio(capexValue, revenue);
  const operatingLeverage =
    growthPct(revenue, prevRevenue) !== null && growthPct(ebit, prevLtm ? field(prevLtm.income, "operatingIncome") : null) !== null
      ? (growthPct(ebit, prevLtm ? field(prevLtm.income, "operatingIncome") : null) as number) /
        (growthPct(revenue, prevRevenue) as number)
      : null;
  // So sánh chu kỳ tiền mặt với cùng quý năm trước (loại bỏ yếu tố mùa vụ).
  const cccYearAgo = ctx.yearAgo ? cccOfQuarter(ctx.yearAgo) : null;
  const cccLatest = ctx.latest ? cccOfQuarter(ctx.latest) : null;
  const cccDelta = cccLatest !== null && cccYearAgo !== null ? cccLatest - cccYearAgo : null;

  const efficiencyMetrics = [
    metric("inventoryTurnover", "Vòng quay hàng tồn kho", inventoryTurnover, "vòng/năm",
      "Giá vốn hàng bán LTM ÷ Hàng tồn kho bình quân",
      { score: ramp(inventoryTurnover, 2, 10), estimated }),
    metric("dio", "Số ngày tồn kho (DIO)", dio, "ngày", "365 ÷ Vòng quay hàng tồn kho",
      { score: ramp(dio, 180, 30, false), estimated }),
    metric("dso", "Kỳ thu tiền bình quân (DSO)", dso, "ngày",
      "Khoản phải thu bình quân ÷ Doanh thu LTM × 365",
      { score: ramp(dso, 150, 25, false), estimated }),
    metric("dpo", "Kỳ thanh toán bình quân (DPO)", dpo, "ngày",
      "Phải trả người bán bình quân ÷ Giá vốn LTM × 365",
      { score: ramp(dpo, 15, 90), estimated }),
    metric("ccc", "Chu kỳ chuyển đổi tiền mặt (CCC)", ccc, "ngày", "DIO + DSO − DPO",
      { score: ramp(ccc, 150, 10, false), estimated }),
    metric("cccDelta", "Biến động CCC so với cùng quý năm trước", cccDelta, "ngày",
      "CCC quý này − CCC cùng quý năm trước; dương = vốn lưu động bị ứ đọng thêm",
      { score: ramp(cccDelta, 45, -15, false), digits: 1 }),
    metric("fixedAssetTurnover", "Vòng quay tài sản cố định", fixedAssetTurnover, "vòng/năm",
      "Doanh thu LTM ÷ TSCĐ bình quân",
      { score: ramp(fixedAssetTurnover, 0.5, 3), estimated }),
    metric("capexIntensity", "Cường độ đầu tư (Capex/Doanh thu)", capexIntensity !== null ? capexIntensity * 100 : null, "%",
      "Chi đầu tư TSCĐ LTM ÷ Doanh thu LTM × 100",
      { score: ramp(capexIntensity !== null ? capexIntensity * 100 : null, 35, 4, false), estimated }),
    metric("operatingLeverage", "Đòn bẩy hoạt động (DOL)", operatingLeverage, "lần",
      "% thay đổi EBIT ÷ % thay đổi doanh thu (LTM so với LTM kỳ trước)",
      { score: ramp(operatingLeverage, 0, 3), estimated }),
  ];
  const efficiencyClean = efficiencyMetrics;

  /* ─────────── 5. CHẤT LƯỢNG LỢI NHUẬN ─────────── */
  const cashConversion = ratio(operatingCashFlow, nonZero(netIncome));
  const fcfConversion = ratio(freeCashFlow, nonZero(netIncome));
  const fcfMargin = ratio(freeCashFlow, revenue);
  const accruals =
    operatingCashFlow !== null && netIncome !== null && balances.totalAssets !== null && balances.totalAssets > 0
      ? (netIncome - operatingCashFlow) / balances.totalAssets
      : null;
  const dividendPayout = ratio(Math.abs(dividendsPaid ?? NaN) || null, nonZero(netIncome));
  const revenueQuality =
    revenue !== null && operatingCashFlow !== null ? operatingCashFlow / revenue : null;
  const capexToDepreciation = ratio(capexValue, nonZero(depreciation));

  const qualityMetrics = [
    metric("cashConversion", "Hệ số chuyển đổi tiền (OCF/LN ròng)", cashConversion, "lần",
      "Dòng tiền hoạt động LTM ÷ LN ròng LTM",
      { score: ramp(cashConversion, 0.5, 1.3), estimated }),
    metric("fcfConversion", "Hệ số chuyển đổi FCF (FCF/LN ròng)", fcfConversion, "lần",
      "FCF LTM ÷ LN ròng LTM; FCF = OCF − Capex",
      { score: ramp(fcfConversion, 0.3, 1.1), estimated }),
    metric("fcfMargin", "Biên dòng tiền tự do", fcfMargin !== null ? fcfMargin * 100 : null, "%",
      "FCF LTM ÷ Doanh thu LTM × 100",
      { score: ramp(fcfMargin, -0.05, 0.15), estimated }),
    metric("accrualsRatio", "Tỷ lệ dồn tích (Accruals)", accruals !== null ? accruals * 100 : null, "%",
      "(LN ròng − OCF) ÷ Tổng tài sản bình quân × 100; càng thấp chất lượng LN càng cao",
      { score: ramp(accruals !== null ? accruals * 100 : null, 15, -2, false), estimated }),
    metric("cashToRevenue", "OCF / Doanh thu", revenueQuality !== null ? revenueQuality * 100 : null, "%",
      "Dòng tiền hoạt động LTM ÷ Doanh thu LTM × 100",
      { score: ramp(revenueQuality, 0.02, 0.2), estimated }),
    metric("capexToDepreciation", "Capex / Khấu hao", capexToDepreciation, "lần",
      "Chi đầu tư TSCĐ ÷ Chi phí khấu hao; >1 = đang mở rộng năng lực sản xuất",
      { score: ramp(capexToDepreciation, 0.5, 1.6), estimated }),
    metric("dividendPayout", "Tỷ lệ chi trả cổ tức", dividendPayout !== null ? dividendPayout * 100 : null, "%",
      "Cổ tức đã trả LTM ÷ LN ròng LTM × 100",
      { score: dividendPayout === null ? null : ramp(1 - Math.abs(dividendPayout - 0.45) / 0.45, 0, 1), estimated }),
  ];

  /* ─────────── Nhóm & điểm ─────────── */
  const growthScore = groupScore(growthMetrics);
  const marginScore = groupScore(marginMetrics);
  const returnsScore = groupScore(returnsMetrics);
  const efficiencyScore = groupScore(efficiencyClean);
  const qualityScore = groupScore(qualityMetrics);

  const groups: EngineGroup[] = [
    makeGroup("growth", "Tăng trưởng", PERFORMANCE_WEIGHTS.growth,
      growthScore === null ? "Chưa đủ dữ liệu tăng trưởng."
      : growthScore >= 70 ? "Doanh thu và lợi nhuận tăng trưởng mạnh, đồng đều cả QoQ lẫn YoY — động lực tái định giá cổ phiếu."
      : growthScore >= 45 ? "Tăng trưởng ở mức vừa phải; cần theo dõi thêm 1–2 quý để xác nhận xu hướng."
      : "Tăng trưởng âm hoặc trì trệ — dấu hiệu mất thị phần hoặc đang ở đáy chu kỳ ngành.",
      growthMetrics),
    makeGroup("margin", "Biên lợi nhuận", PERFORMANCE_WEIGHTS.margin,
      marginScore === null ? "Chưa đủ dữ liệu biên lợi nhuận."
      : marginScore >= 70 ? "Biên lợi nhuận cao và ổn định — lợi thế cạnh tranh về giá/cost được duy trì tốt."
      : marginScore >= 45 ? "Biên lợi nhuận ở mức trung bình ngành; dễ bị tổn thương khi giá đầu vào biến động."
      : "Biên lợi nhuận mỏng và đang bị bào mòn — áp lực cạnh tranh hoặc chi phí đầu vào tăng.",
      marginMetrics),
    makeGroup("returns", "Sức sinh lời", PERFORMANCE_WEIGHTS.returns,
      returnsScore === null ? "Chưa đủ dữ liệu sinh lời."
      : returnsScore >= 70 ? "ROE/ROIC ở nhóm dẫn đầu; doanh nghiệp tạo ra giá trị kinh tế rõ rệt trên vốn đầu tư."
      : returnsScore >= 45 ? "Sức sinh lời chấp nhận được nhưng chưa bền vững; một phần ROE đến từ đòn bẩy nợ."
      : "Sức sinh lời thấp hơn chi phí vốn — doanh nghiệp đang phá huỷ giá trị cổ đông.",
      returnsMetrics),
    makeGroup("efficiency", "Hiệu quả vận hành", PERFORMANCE_WEIGHTS.efficiency,
      efficiencyScore === null ? "Chưa đủ dữ liệu hiệu quả vận hành."
      : efficiencyScore >= 70 ? "Vòng quay vốn lưu động nhanh, chu kỳ tiền mặt ngắn — ít bị ứ đọng vốn."
      : efficiencyScore >= 45 ? "Hiệu quả vận hành trung bình; tồn kho hoặc công nợ đang chiếm dụng vốn lưu động."
      : "Hiệu quả vận hành yếu: chu kỳ tiền mặt dài, vốn bị ứ đọng trong tồn kho và phải thu.",
      efficiencyClean),
    makeGroup("quality", "Chất lượng lợi nhuận", PERFORMANCE_WEIGHTS.quality,
      qualityScore === null ? "Chưa đủ dữ liệu dòng tiền."
      : qualityScore >= 70 ? "Lợi nhuận kế toán chuyển hoá tốt thành tiền mặt — chất lượng lợi nhuận cao."
      : qualityScore >= 45 ? "Chênh lệch giữa LN kế toán và dòng tiền ở mức cần theo dõi."
      : "Lợi nhuận kế toán không đi kèm dòng tiền — rủi ro về tính bền vững của kết quả kinh doanh.",
      qualityMetrics),
  ];

  const overall = overallOf(groups);
  const rating = ratingOf(overall);
  const strengths = strengthsOf(groups, 2);
  const weakest = weakestOf(groups);
  const series = buildSeries(ctx, 12);

  const d3 = dupont3(
    netMargin !== null ? netMargin * 100 : null,
    assetTurnover,
    equityMultiplier,
  );
  const d5 = dupont5({
    netIncome,
    pretaxIncome,
    ebit,
    revenue,
    averageAssets: balances.totalAssets,
    averageEquity: balances.equity,
  });

  if (balances.closingOnly && latest) {
    warnings.push("Thiếu số dư đầu kỳ LTM — các chỉ số ROE/ROA dùng số dư cuối kỳ thay vì bình quân.");
  }

  const summary =
    `Hiệu suất kinh doanh hạng ${rating} (${overall}/100) tính trên LTM kết thúc ${ltm.periodEnd} ` +
    `(${methodLabel(ltm.method)}). ` +
    (strengths.length ? `Điểm mạnh: ${strengths.map((g) => g.label.toLowerCase()).join(" và ")}. ` : "") +
    (weakest && weakest.score !== null && weakest.score < 50
      ? `Điểm yếu: ${weakest.label.toLowerCase()} (${weakest.score}/100) — ${weakest.narrative.slice(0, 140)}`
      : "Không có trụ cột nào ở mức báo động.");

  return {
    symbol: ctx.symbol,
    asOfPeriod: ltm.periodEnd,
    asOfPeriodVi: ltm.periodEndVi,
    ltmMethod: ltm.method,
    ltmCoverage: ltm.coverage,
    basis: ctx.basis,
    overall,
    rating,
    groups,
    dupont3: d3,
    dupont5: d5,
    series,
    summary,
    coverage: coverageOf(groups),
    warnings,
  };
}

function methodLabel(method: string): string {
  switch (method) {
    case "sum-4q": return "tổng 4 quý riêng lẻ";
    case "ytd-plus-fy-minus-pytd": return "FY năm trước + YTD năm nay − YTD cùng kỳ năm trước";
    case "annualized-ytd": return "YTD nội suy về 12 tháng";
    case "full-year": return "số cả năm";
    default: return "chưa đủ dữ liệu";
  }
}

/** Tăng trưởng EPS LTM — tính từ LN ròng LTM và số CP lưu hành suy ra từ EPS báo cáo. */
function epsGrowth(ctx: FundamentalContext): Num {
  const current = ltmEps(ctx.ltm.income);
  const previous = ctx.ltmPrevious ? ltmEps(ctx.ltmPrevious.income) : null;
  return growthPct(current, previous);
}

/** EPS (nghìn VND) = LN ròng (tỷ VND) ÷ số CP (triệu). */
export function ltmEps(income: Partial<import("@/lib/financial-statements").IncomeData>): Num {
  const reported = field(income, "eps");
  if (reported !== null && reported !== 0) return reported;
  const netIncome = field(income, "netIncome");
  const shares = field(income, "sharesOutstanding");
  if (netIncome !== null && shares !== null && shares > 0) return netIncome / shares;
  return null;
}

/** Số CP lưu hành (triệu) suy ra từ LN ròng và EPS khi BCTC không khai báo. */
export function sharesOutstandingMillions(income: Partial<import("@/lib/financial-statements").IncomeData>): Num {
  const declared = positive(field(income, "sharesOutstanding"));
  if (declared !== null) return declared;
  const netIncome = field(income, "netIncome");
  const eps = field(income, "eps");
  if (netIncome !== null && eps !== null && eps !== 0) {
    const derived = netIncome / eps; // tỷ VND ÷ nghìn VND = triệu CP
    return derived > 0 ? derived : null;
  }
  return null;
}

export function ltmDps(ctx: FundamentalContext): Num {
  const dividends = Math.abs(field(ctx.ltm.cashflow, "dividendsPaid") ?? NaN);
  if (!Number.isFinite(dividends) || dividends <= 0) return null;
  const shares = sharesOutstandingMillions(ctx.ltm.income);
  if (shares === null || shares <= 0) return null;
  return dividends / shares; // tỷ VND ÷ triệu CP = nghìn VND/CP
}

export function ltmFreeCashFlow(ctx: FundamentalContext): Num {
  const direct = field(ctx.ltm.cashflow, "freeCashFlow");
  if (direct !== null) return direct;
  const ocf = field(ctx.ltm.cashflow, "operatingCashFlow");
  const capex = field(ctx.ltm.cashflow, "capex");
  if (ocf === null || capex === null) return null;
  return ocf - Math.abs(capex);
}

export function ltmRevenueGrowth(ctx: FundamentalContext): Num {
  const current = field(ctx.ltm.income, "revenue");
  const previous = ctx.ltmPrevious ? field(ctx.ltmPrevious.income, "revenue") : null;
  return growthPct(current, previous);
}

export function effectiveTaxRateOf(ctx: FundamentalContext): number {
  const pretax = field(ctx.ltm.income, "pretaxIncome");
  const net = field(ctx.ltm.income, "netIncome");
  // Như computeBusinessPerformance: thiếu dòng thuế riêng thì suy từ LNTT − LNST.
  const tax =
    field(ctx.ltm.income, "incomeTax") ??
    (pretax !== null && net !== null ? pretax - net : null);
  const rate = ratio(tax, pretax);
  if (rate === null || rate < 0 || rate > 0.5) return 0.2;
  return rate;
}

/** Nợ ròng = Tổng nợ vay − Tiền & tương đương − Đầu tư tài chính ngắn hạn. */
export function netDebtOf(ctx: FundamentalContext): Num {
  const debt = ctx.balances.interestBearingDebt;
  if (debt === null) return null;
  const cash = field(ctx.closing, "cashAndEquivalents") ?? 0;
  const shortTermInvestments = field(ctx.closing, "shortTermInvestments") ?? 0;
  return debt - cash - shortTermInvestments;
}
