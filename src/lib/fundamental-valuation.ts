/**
 * Định giá doanh nghiệp (Valuation Engine)
 *
 * Toàn bộ đầu vào là số LTM chuẩn hoá từ BCTC + giá thị trường thực:
 *   Vốn hoá (tỷ VND) = Giá (nghìn VND) × Số CP lưu hành (triệu)
 *   EV (tỷ VND)      = Vốn hoá + Nợ vay − Tiền − Đầu tư tài chính ngắn hạn
 *
 * Các mô hình định giá:
 *   1. So sánh bội số (P/E, P/B, EV/EBITDA, EV/Sales, P/FCF) với bội số NGÀNH
 *      suy ra từ mô hình Gordon trên chính benchmark ngành — không hard-code.
 *   2. WACC theo CAPM:  Ke = Rf + β × ERP
 *   3. DCF 2 giai đoạn trên FCFF  → giá trị doanh nghiệp → trừ nợ ròng → /số CP
 *   4. DCF trên FCFE chiết khấu bằng Ke
 *   5. DDM Gordon: P = DPS × (1+g) / (Ke − g)
 *   6. Graham Number: √(22.5 × EPS × BVPS)
 *   7. Reverse DCF: tăng trưởng ngầm định mà thị trường đang định giá
 *   8. Lưới độ nhạy WACC × g
 */

import { getBenchmarkForSymbol, type SectorBenchmark } from "@/lib/industry-benchmarks";
import {
  clamp,
  field,
  growthPct,
  positive,
  ratio,
  round,
  type FundamentalContext,
  type Num,
} from "@/lib/fundamental-engine";
import {
  effectiveTaxRateOf,
  ltmDps,
  ltmEps,
  ltmFreeCashFlow,
  ltmRevenueGrowth,
  netDebtOf,
  sharesOutstandingMillions,
} from "@/lib/fundamental-performance";

/* ────────────────────────────────────────────────────────────
 * Giả định vĩ mô (có thể ghi đè bằng biến môi trường)
 * ──────────────────────────────────────────────────────────── */

export interface MacroAssumptions {
  /** Lãi suất phi rủi ro — lợi suất TPCP VN 10 năm. */
  riskFreeRate: number;
  /** Phần bù rủi ro cổ phiếu thị trường VN. */
  equityRiskPremium: number;
  /** Tăng trưởng vĩnh cửu (giai đoạn 2 của DCF). */
  terminalGrowth: number;
  /** Số năm giai đoạn tăng trưởng cao. */
  stageOneYears: number;
  /** Trần tăng trưởng giai đoạn 1 (tránh ngoại suy vô lý). */
  maxStageOneGrowth: number;
  /** Sàn tăng trưởng giai đoạn 1. */
  minStageOneGrowth: number;
}

function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function defaultMacroAssumptions(): MacroAssumptions {
  return {
    riskFreeRate: envNum("VALUATION_RISK_FREE_RATE", 0.045),
    equityRiskPremium: envNum("VALUATION_EQUITY_RISK_PREMIUM", 0.095),
    terminalGrowth: envNum("VALUATION_TERMINAL_GROWTH", 0.03),
    stageOneYears: envNum("VALUATION_STAGE_ONE_YEARS", 5),
    maxStageOneGrowth: envNum("VALUATION_MAX_STAGE_ONE_GROWTH", 0.25),
    minStageOneGrowth: envNum("VALUATION_MIN_STAGE_ONE_GROWTH", 0.02),
  };
}

/* ────────────────────────────────────────────────────────────
 * Cấu trúc trả về
 * ──────────────────────────────────────────────────────────── */

export interface MultipleRow {
  key: string;
  label: string;
  value: Num;
  unit: string;
  formula: string;
  industry: Num;
  vsIndustry: Num;
  /** Cao hơn ngành là đắt (true cho P/E, P/B, EV/EBITDA...). */
  lowerIsBetter: boolean;
  verdict: string;
}

export interface WaccBreakdown {
  costOfEquity: Num;
  costOfDebt: Num;
  costOfDebtAfterTax: Num;
  taxRate: number;
  equityWeight: Num;
  debtWeight: Num;
  beta: Num;
  riskFreeRate: number;
  equityRiskPremium: number;
  value: Num;
  formula: string[];
}

export interface DcfResult {
  available: boolean;
  stageOneGrowth: Num;
  terminalGrowth: number;
  wacc: Num;
  baseFcf: Num;
  enterpriseValue: Num;
  netDebt: Num;
  equityValue: Num;
  valuePerShare: Num;
  terminalValueSharePct: Num;
  scenarios: { pessimistic: Num; base: Num; optimistic: Num };
  stageOne: Array<{ year: number; fcf: Num; discountFactor: Num; presentValue: Num }>;
  note: string;
}

export interface ValuationMethod {
  key: string;
  label: string;
  valuePerShare: Num;
  low: Num;
  high: Num;
  weight: number;
  formula: string;
  note: string;
}

export interface SensitivityCell {
  wacc: number;
  terminalGrowth: number;
  valuePerShare: Num;
}

export interface ValuationResult {
  symbol: string;
  asOfPeriod: string;
  price: Num;
  sharesOutstandingMillions: Num;
  marketCapBillionVnd: Num;
  enterpriseValueBillionVnd: Num;
  netDebtBillionVnd: Num;
  /** EPS LTM (nghìn VND/CP) = LN ròng LTM ÷ số CP lưu hành. */
  epsLtm: Num;
  /** Giá trị sổ sách mỗi CP (nghìn VND/CP) = VCSH ÷ số CP lưu hành. */
  bvps: Num;
  /** Cổ tức mỗi CP LTM (nghìn VND/CP). */
  dpsLtm: Num;
  /** FCF mỗi CP LTM (nghìn VND/CP). */
  fcfPerShare: Num;
  priceUnit: "nghìn VND";
  multiples: MultipleRow[];
  industryMultiples: { pe: Num; pb: Num; evEbitda: Num; evSales: Num; source: string };
  wacc: WaccBreakdown;
  dcf: DcfResult;
  fcfe: DcfResult;
  ddm: { available: boolean; dps: Num; valuePerShare: Num; requiredReturn: Num; growth: Num; formula: string; note: string };
  grahamNumber: Num;
  reverseDcf: { impliedGrowthPct: Num; formula: string; verdictVi: string };
  methods: ValuationMethod[];
  targetPrice: { low: Num; mid: Num; high: Num };
  upsidePct: Num;
  marginOfSafetyPct: Num;
  rating: string;
  verdictVi: string;
  sensitivity: { waccSteps: number[]; growthSteps: number[]; cells: SensitivityCell[] };
  assumptions: Record<string, number | string>;
  methodology: string[];
  warnings: string[];
}

/* ────────────────────────────────────────────────────────────
 * Bội số ngành suy ra từ benchmark (mô hình Gordon trên giá trị sổ sách)
 * ──────────────────────────────────────────────────────────── */

export interface IndustryMultiples {
  pe: Num;
  pb: Num;
  evEbitda: Num;
  evSales: Num;
  roe: Num;
  source: string;
}

/**
 * Suy ra bội số hợp lý của ngành:
 *   ROE_ngành = Biên ròng × Vòng quay TS × Đòn bẩy VCSH
 *   P/B       = (ROE − g) / (Ke − g)                (Gordon trên giá trị sổ sách)
 *   P/E       = P/B ÷ ROE
 *   Nợ ròng/EBITDA = (Đòn bẩy − Tiền/TS) / (Biên EBITDA × Vòng quay TS)
 *   EV/EBITDA = P/E × (LN ròng/EBITDA) + Nợ ròng/EBITDA
 *   EV/Sales  = EV/EBITDA × Biên EBITDA
 */
export function deriveIndustryMultiples(benchmark: SectorBenchmark, costOfEquity: number, terminalGrowth: number): IndustryMultiples {
  const equityMultiplier = 1 / Math.max(0.05, 1 - benchmark.leverage);
  const roe = benchmark.netMargin * benchmark.assetTurnover * equityMultiplier;
  const ebitdaMargin = benchmark.operatingMargin + benchmark.depreciationPctFA * 0.55;

  let pb: Num = null;
  let pe: Num = null;
  if (costOfEquity > terminalGrowth && roe > 0) {
    pb = (roe - terminalGrowth) / (costOfEquity - terminalGrowth);
    pb = clamp(pb, 0.2, 12);
    pe = pb !== null && roe > 0 ? pb / roe : null;
  }

  const netDebtToAssets = Math.max(0, benchmark.leverage - benchmark.cashPctAssets);
  const netDebtToEbitda = ebitdaMargin > 0 ? netDebtToAssets / (ebitdaMargin * benchmark.assetTurnover) : null;
  const netIncomeToEbitda = ebitdaMargin > 0 ? benchmark.netMargin / ebitdaMargin : null;

  let evEbitda: Num = null;
  if (pe !== null && netIncomeToEbitda !== null && netDebtToEbitda !== null) {
    evEbitda = pe * netIncomeToEbitda + netDebtToEbitda;
    evEbitda = clamp(evEbitda, 1, 60);
  }
  const evSales: Num = evEbitda !== null ? evEbitda * ebitdaMargin : null;

  return {
    pe: round(pe, 2),
    pb: round(pb, 2),
    evEbitda: round(evEbitda, 2),
    evSales: round(evSales, 2),
    roe: round(roe * 100, 2),
    source: `${benchmark.industry} (${benchmark.sector})`,
  };
}

/* ────────────────────────────────────────────────────────────
 * WACC theo CAPM
 * ──────────────────────────────────────────────────────────── */

export function computeWacc(ctx: FundamentalContext, inputs: {
  beta: Num;
  marketCap: Num;
  price: Num;
  assumptions: MacroAssumptions;
}): WaccBreakdown {
  const benchmark = getBenchmarkForSymbol(ctx.symbol);
  const beta = inputs.beta ?? benchmark.beta;
  const ke = inputs.assumptions.riskFreeRate + beta * inputs.assumptions.equityRiskPremium;

  const debt = ctx.balances.interestBearingDebt;
  const interestExpense = field(ctx.ltm.income, "interestExpense");
  const taxRate = effectiveTaxRateOf(ctx);
  const costOfDebt =
    interestExpense !== null && debt !== null && debt > 0
      ? interestExpense / debt
      : null;
  const costOfDebtAfterTax = costOfDebt === null ? null : costOfDebt * (1 - taxRate);

  const marketCap = positive(inputs.marketCap);
  const equityWeight = marketCap !== null && debt !== null && marketCap + debt > 0 ? marketCap / (marketCap + debt) : 1;
  const debtWeight = marketCap !== null && debt !== null && marketCap + debt > 0 ? debt / (marketCap + debt) : 0;

  const effectiveKd = costOfDebtAfterTax ?? 0.09 * (1 - taxRate);
  const wacc = ke * equityWeight + effectiveKd * debtWeight;

  return {
    costOfEquity: round(ke, 4),
    costOfDebt: round(costOfDebt, 4),
    costOfDebtAfterTax: round(costOfDebtAfterTax, 4),
    taxRate,
    equityWeight: round(equityWeight, 4),
    debtWeight: round(debtWeight, 4),
    beta: round(beta, 2),
    riskFreeRate: inputs.assumptions.riskFreeRate,
    equityRiskPremium: inputs.assumptions.equityRiskPremium,
    value: round(wacc, 4),
    formula: [
      `Ke = Rf + β × ERP = ${(inputs.assumptions.riskFreeRate * 100).toFixed(2)}% + ${beta.toFixed(2)} × ${(inputs.assumptions.equityRiskPremium * 100).toFixed(2)}% = ${(ke * 100).toFixed(2)}%`,
      costOfDebt === null
        ? `Kd = 9.00% (mặc định, BCTC không tách chi phí lãi vay) → sau thuế ${(effectiveKd * 100).toFixed(2)}%`
        : `Kd = Chi phí lãi vay LTM ÷ Nợ vay = ${(costOfDebt * 100).toFixed(2)}% → sau thuế ${(effectiveKd * 100).toFixed(2)}%`,
      `WACC = Ke × E/(D+E) + Kd(1−t) × D/(D+E) = ${(ke * 100).toFixed(2)}% × ${(equityWeight * 100).toFixed(1)}% + ${(effectiveKd * 100).toFixed(2)}% × ${(debtWeight * 100).toFixed(1)}% = ${(wacc * 100).toFixed(2)}%`,
    ],
  };
}

/* ────────────────────────────────────────────────────────────
 * DCF 2 giai đoạn
 * ──────────────────────────────────────────────────────────── */

function dcfTwoStage(
  baseFcf: number,
  stageOneGrowth: number,
  discountRate: number,
  terminalGrowth: number,
  years: number,
): { enterpriseValue: number; terminalValueSharePct: number; stageOne: DcfResult["stageOne"] } {
  if (discountRate <= terminalGrowth) {
    return { enterpriseValue: Number.NaN, terminalValueSharePct: Number.NaN, stageOne: [] };
  }
  let presentValueSum = 0;
  const stageOne: DcfResult["stageOne"] = [];
  let fcf = baseFcf;
  for (let year = 1; year <= years; year++) {
    fcf = fcf * (1 + stageOneGrowth);
    const discountFactor = 1 / Math.pow(1 + discountRate, year);
    const presentValue = fcf * discountFactor;
    presentValueSum += presentValue;
    stageOne.push({ year, fcf: round(fcf, 1), discountFactor: round(discountFactor, 4), presentValue: round(presentValue, 1) });
  }
  const terminalValue = (fcf * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
  const terminalPresent = terminalValue / Math.pow(1 + discountRate, years);
  const enterpriseValue = presentValueSum + terminalPresent;
  return {
    enterpriseValue,
    terminalValueSharePct: enterpriseValue > 0 ? (terminalPresent / enterpriseValue) * 100 : Number.NaN,
    stageOne,
  };
}

function scenarioRate(base: number, delta: number, floor = 0.05): number {
  return Math.max(floor, base + delta);
}

/* ────────────────────────────────────────────────────────────
 * Bộ định giá chính
 * ──────────────────────────────────────────────────────────── */

export function computeValuation(
  ctx: FundamentalContext,
  inputs: {
    /** Giá hiện tại, đơn vị nghìn VND. */
    price: Num;
    /** Beta; nếu null sẽ dùng beta benchmark ngành. */
    beta?: Num;
    assumptions?: MacroAssumptions;
  },
): ValuationResult {
  const assumptions = inputs.assumptions ?? defaultMacroAssumptions();
  const warnings: string[] = [...ctx.warnings];
  const benchmark = getBenchmarkForSymbol(ctx.symbol);

  const price = positive(inputs.price);
  const shares = sharesOutstandingMillions(ctx.ltm.income);
  const marketCap = price !== null && shares !== null ? price * shares : null; // tỷ VND
  const netDebt = netDebtOf(ctx);
  const enterpriseValue = marketCap !== null && netDebt !== null ? marketCap + netDebt : null;

  const eps = ltmEps(ctx.ltm.income);
  const equity = field(ctx.closing, "equity");
  const bvps = shares !== null && shares > 0 && equity !== null ? equity / shares : field(ctx.closing, "bookValuePerShare");
  const revenue = field(ctx.ltm.income, "revenue");
  const netIncome = field(ctx.ltm.income, "netIncome");
  const ebitda = field(ctx.ltm.income, "ebitda");
  const ebit = field(ctx.ltm.income, "operatingIncome");
  const fcf = ltmFreeCashFlow(ctx);
  const ocf = field(ctx.ltm.cashflow, "operatingCashFlow");
  const dps = ltmDps(ctx);

  const wacc = computeWacc(ctx, { beta: inputs.beta ?? null, marketCap, price, assumptions });
  const industry = deriveIndustryMultiples(benchmark, wacc.costOfEquity ?? 0.14, assumptions.terminalGrowth);

  /* ── Bội số ── */
  const pe = price !== null && eps !== null && eps > 0 ? price / eps : null;
  const pb = price !== null && bvps !== null && bvps > 0 ? price / bvps : null;
  const evEbitda = enterpriseValue !== null && ebitda !== null && ebitda > 0 ? enterpriseValue / ebitda : null;
  const evSales = enterpriseValue !== null && revenue !== null && revenue > 0 ? enterpriseValue / revenue : null;
  const evEbit = enterpriseValue !== null && ebit !== null && ebit > 0 ? enterpriseValue / ebit : null;
  const pFcf = marketCap !== null && fcf !== null && fcf > 0 ? marketCap / fcf : null;
  const pOcf = marketCap !== null && ocf !== null && ocf > 0 ? marketCap / ocf : null;
  const dividendYield = price !== null && dps !== null ? (dps / price) * 100 : null;
  const revenueGrowth = ltmRevenueGrowth(ctx);
  const peg = pe !== null && revenueGrowth !== null && revenueGrowth > 0 ? pe / revenueGrowth : null;

  const multipleRow = (
    key: string,
    label: string,
    value: Num,
    unit: string,
    formula: string,
    industryValue: Num,
    lowerIsBetter = true,
  ): MultipleRow => {
    const vs = value !== null && industryValue !== null && industryValue !== 0 ? ((value / industryValue) - 1) * 100 : null;
    let verdict = "Chưa có dữ liệu";
    if (value !== null && vs !== null) {
      const expensive = lowerIsBetter ? vs > 15 : vs < -15;
      const cheap = lowerIsBetter ? vs < -15 : vs > 15;
      verdict = expensive ? `Đắt hơn ngành ${vs.toFixed(0)}%` : cheap ? `Rẻ hơn ngành ${Math.abs(vs).toFixed(0)}%` : "Tương đương ngành";
    } else if (value === null) {
      verdict = "Không tính được (chỉ số âm hoặc thiếu dữ liệu)";
    }
    return { key, label, value: round(value, 2), unit, formula, industry: round(industryValue, 2), vsIndustry: round(vs, 1), lowerIsBetter, verdict };
  };

  const multiples: MultipleRow[] = [
    multipleRow("pe", "P/E", pe, "lần", "Giá ÷ EPS LTM; EPS = LN ròng LTM ÷ số CP", industry.pe),
    multipleRow("pb", "P/B", pb, "lần", "Giá ÷ Giá trị sổ sách mỗi CP; BVPS = VCSH ÷ số CP", industry.pb),
    multipleRow("evEbitda", "EV/EBITDA", evEbitda, "lần", "(Vốn hoá + Nợ ròng) ÷ EBITDA LTM", industry.evEbitda),
    multipleRow("evSales", "EV/Doanh thu", evSales, "lần", "(Vốn hoá + Nợ ròng) ÷ Doanh thu LTM", industry.evSales),
    multipleRow("evEbit", "EV/EBIT", evEbit, "lần", "(Vốn hoá + Nợ ròng) ÷ EBIT LTM", null),
    multipleRow("pFcf", "P/FCF", pFcf, "lần", "Vốn hoá ÷ FCF LTM; FCF = OCF − Capex", null),
    multipleRow("pOcf", "P/OCF", pOcf, "lần", "Vốn hoá ÷ Dòng tiền hoạt động LTM", null),
    multipleRow("peg", "PEG", peg, "lần", "P/E ÷ % tăng trưởng doanh thu LTM", 1.5),
    multipleRow("dividendYield", "Tỷ suất cổ tức", dividendYield, "%", "Cổ tức mỗi CP (LTM) ÷ Giá × 100", null, false),
  ];

  /* ── DCF trên FCFF ── */
  const baseGrowthRaw = revenueGrowth !== null ? revenueGrowth / 100 : 0.08;
  const stageOneGrowth = clamp(baseGrowthRaw, assumptions.minStageOneGrowth, assumptions.maxStageOneGrowth) as number;
  const dcf = buildDcf({
    baseFcf: fcf,
    growth: stageOneGrowth,
    discountRate: wacc.value ?? 0.12,
    terminalGrowth: assumptions.terminalGrowth,
    years: assumptions.stageOneYears,
    netDebt,
    shares,
    note:
      fcf === null || fcf <= 0
        ? "FCF LTM âm hoặc thiếu — DCF không áp dụng được cho doanh nghiệp đang đốt tiền."
        : `Chiết khấu FCFF ${assumptions.stageOneYears} năm với WACC ${((wacc.value ?? 0.12) * 100).toFixed(2)}%, tăng trưởng vĩnh cửu ${(assumptions.terminalGrowth * 100).toFixed(1)}%.`,
  });

  /* ── DCF trên FCFE (chiết khấu bằng Ke) ── */
  const fcfeBase =
    fcf !== null && netDebt !== null && ctx.balances.interestBearingDebt !== null
      ? fcf // xấp xỉ FCFE khi cơ cấu nợ ổn định
      : fcf;
  const fcfe = buildDcf({
    baseFcf: fcfeBase,
    growth: stageOneGrowth,
    discountRate: wacc.costOfEquity ?? 0.14,
    terminalGrowth: assumptions.terminalGrowth,
    years: assumptions.stageOneYears,
    netDebt: 0, // FCFE đã là dòng tiền thuộc về cổ đông
    shares,
    note: `Chiết khấu FCFE bằng chi phí vốn chủ sở hữu Ke = ${((wacc.costOfEquity ?? 0.14) * 100).toFixed(2)}%.`,
  });

  /* ── DDM Gordon ── */
  const ke = wacc.costOfEquity ?? 0.14;
  const ddmGrowth = clamp(assumptions.terminalGrowth, 0, Math.max(0, ke - 0.02)) as number;
  const ddmValue = dps !== null && dps > 0 && ke > ddmGrowth ? (dps * (1 + ddmGrowth)) / (ke - ddmGrowth) : null;
  const ddm = {
    available: ddmValue !== null,
    dps: round(dps, 3),
    valuePerShare: round(ddmValue, 2),
    requiredReturn: round(ke, 4),
    growth: round(ddmGrowth, 4),
    formula: "P = DPS × (1 + g) ÷ (Ke − g)",
    note:
      ddmValue === null
        ? "Chưa có cổ tức tiền mặt trong LTM hoặc Ke ≤ g — mô hình Gordon không áp dụng được."
        : `Ke = ${(ke * 100).toFixed(2)}%, g = ${(ddmGrowth * 100).toFixed(2)}%, DPS LTM = ${dps?.toFixed(2)} nghìn VND/CP.`,
  };

  /* ── Graham Number ── */
  const grahamNumber = eps !== null && eps > 0 && bvps !== null && bvps > 0 ? Math.sqrt(22.5 * eps * bvps) : null;

  /* ── Reverse DCF ── */
  const impliedGrowth = reverseDcfGrowth({
    price,
    baseFcf: fcf,
    discountRate: wacc.value ?? 0.12,
    terminalGrowth: assumptions.terminalGrowth,
    years: assumptions.stageOneYears,
    netDebt,
    shares,
  });
  const reverseDcf = {
    impliedGrowthPct: round(impliedGrowth !== null ? impliedGrowth * 100 : null, 2),
    formula: "Giải phương trình DCF(g) = Giá thị trường để tìm tốc độ tăng trưởng FCF mà thị trường đang kỳ vọng.",
    verdictVi:
      impliedGrowth === null
        ? "Chưa tính được tăng trưởng kỳ vọng (thiếu FCF dương hoặc số CP)."
        : impliedGrowth <= assumptions.terminalGrowth
          ? `Thị trường chỉ kỳ vọng FCF tăng ${(impliedGrowth * 100).toFixed(1)}%/năm — không cao hơn tăng trưởng vĩnh cửu, định giá đang bảo thủ.`
          : `Thị trường đang kỳ vọng FCF tăng ${(impliedGrowth * 100).toFixed(1)}%/năm trong ${assumptions.stageOneYears} năm tới — cần kiểm tra tính khả thi của mức tăng trưởng này.`,
  };

  /* ── Bảng phương pháp & giá mục tiêu ── */
  const peTarget = peTargetOf(eps, industry.pe);
  const pbTarget = pbTargetOf(bvps, industry.pb);
  const evEbitdaTarget = evEbitdaTargetOf(ebitda, industry.evEbitda, netDebt, shares);
  const evSalesTarget = evSalesTargetOf(revenue, industry.evSales, netDebt, shares);

  const methodCandidates: Array<ValuationMethod & { available: boolean }> = [
    {
      key: "dcf", label: "DCF (FCFF, WACC)", valuePerShare: dcf.valuePerShare,
      low: dcf.scenarios.pessimistic, high: dcf.scenarios.optimistic, weight: 0.35,
      formula: "PV(FCFF 5 năm) + PV(Giá trị cuối) − Nợ ròng, chia cho số CP",
      note: dcf.note, available: dcf.available,
    },
    {
      key: "pe", label: "Bội số P/E ngành", valuePerShare: peTarget?.mid ?? null,
      low: peTarget?.low ?? null, high: peTarget?.high ?? null, weight: 0.2,
      formula: "EPS LTM × P/E hợp lý của ngành",
      note: `P/E ngành ${industry.pe ?? "—"} suy ra từ mô hình Gordon trên benchmark ${benchmark.industry}.`,
      available: peTarget !== null,
    },
    {
      key: "evEbitda", label: "Bội số EV/EBITDA ngành", valuePerShare: evEbitdaTarget?.mid ?? null,
      low: evEbitdaTarget?.low ?? null, high: evEbitdaTarget?.high ?? null, weight: 0.2,
      formula: "(EV/EBITDA ngành × EBITDA LTM − Nợ ròng) ÷ số CP",
      note: `EV/EBITDA ngành ${industry.evEbitda ?? "—"}.`, available: evEbitdaTarget !== null,
    },
    {
      key: "pb", label: "Bội số P/B ngành", valuePerShare: pbTarget?.mid ?? null,
      low: pbTarget?.low ?? null, high: pbTarget?.high ?? null, weight: 0.1,
      formula: "BVPS × P/B hợp lý của ngành",
      note: `P/B ngành ${industry.pb ?? "—"}.`, available: pbTarget !== null,
    },
    {
      key: "evSales", label: "Bội số EV/Doanh thu ngành", valuePerShare: evSalesTarget?.mid ?? null,
      low: evSalesTarget?.low ?? null, high: evSalesTarget?.high ?? null, weight: 0.05,
      formula: "(EV/Sales ngành × Doanh thu LTM − Nợ ròng) ÷ số CP",
      note: `EV/Sales ngành ${industry.evSales ?? "—"}.`, available: evSalesTarget !== null,
    },
    {
      key: "graham", label: "Graham Number", valuePerShare: grahamNumber,
      low: grahamNumber !== null ? grahamNumber * 0.85 : null,
      high: grahamNumber !== null ? grahamNumber * 1.15 : null, weight: 0.1,
      formula: "√(22.5 × EPS × BVPS)",
      note: "Ngưỡng an toàn cổ điển của Benjamin Graham (P/E ≤ 15 và P/B ≤ 1.5).",
      available: grahamNumber !== null,
    },
    {
      key: "ddm", label: "DDM Gordon", valuePerShare: ddm.valuePerShare,
      low: ddm.valuePerShare !== null ? ddm.valuePerShare * 0.85 : null,
      high: ddm.valuePerShare !== null ? ddm.valuePerShare * 1.15 : null, weight: 0.1,
      formula: "DPS × (1 + g) ÷ (Ke − g)",
      note: ddm.note, available: ddm.available,
    },
  ];

  const methods = methodCandidates.filter((m) => m.available && m.valuePerShare !== null && (m.valuePerShare as number) > 0);
  const totalWeight = methods.reduce((sum, m) => sum + m.weight, 0);
  const normalized: ValuationMethod[] = methods.map((m) => ({
    key: m.key,
    label: m.label,
    valuePerShare: round(m.valuePerShare, 2),
    low: round(m.low, 2),
    high: round(m.high, 2),
    weight: totalWeight > 0 ? Number((m.weight / totalWeight).toFixed(3)) : 0,
    formula: m.formula,
    note: m.note,
  }));

  const weighted = (pick: (m: ValuationMethod) => Num): Num => {
    if (normalized.length === 0) return null;
    let sum = 0;
    let weightSum = 0;
    for (const m of normalized) {
      const v = pick(m);
      if (v === null) continue;
      sum += v * m.weight;
      weightSum += m.weight;
    }
    return weightSum > 0 ? sum / weightSum : null;
  };

  const targetLow = weighted((m) => m.low ?? m.valuePerShare);
  const targetMid = weighted((m) => m.valuePerShare);
  const targetHigh = weighted((m) => m.high ?? m.valuePerShare);

  const upsidePct = price !== null && targetMid !== null && price > 0 ? ((targetMid - price) / price) * 100 : null;
  const marginOfSafetyPct = targetMid !== null && targetMid > 0 && price !== null ? ((targetMid - price) / targetMid) * 100 : null;

  const rating =
    upsidePct === null ? "N/A"
    : upsidePct >= 30 ? "HẤP DẪN"
    : upsidePct >= 10 ? "TÍCH LŨY"
    : upsidePct >= -10 ? "HỢP LÝ"
    : upsidePct >= -30 ? "ĐẮT"
    : "RẤT ĐẮT";

  const verdictVi =
    price === null || targetMid === null
      ? "Chưa đủ dữ liệu (giá thị trường, số CP lưu hành hoặc BCTC) để kết luận định giá."
      : `Giá hiện tại ${price.toLocaleString("vi-VN")} nghìn VND so với giá trị hợp lý ước tính ${targetMid.toFixed(0)} nghìn VND ` +
        `(${rating}, ${upsidePct !== null && upsidePct >= 0 ? "+" : ""}${upsidePct?.toFixed(1)}%). ` +
        `Khoảng tin cậy ${targetLow?.toFixed(0) ?? "—"} – ${targetHigh?.toFixed(0) ?? "—"} nghìn VND dựa trên ${normalized.length} phương pháp: ` +
        normalized.map((m) => m.label).join(", ") + ". " +
        (marginOfSafetyPct !== null && marginOfSafetyPct < 15 && marginOfSafetyPct > -100
          ? "Biên an toàn mỏng (<15%) — nên chờ nhịp điều chỉnh hoặc giải ngân theo tỷ trọng nhỏ."
          : marginOfSafetyPct !== null && marginOfSafetyPct >= 15
            ? "Biên an toàn đủ dày để hấp thụ sai số trong giả định."
            : "Giá đang cao hơn giá trị ước tính — rủi ro giảm giá nếu tăng trưởng không đạt kỳ vọng.");

  /* ── Lưới độ nhạy ── */
  const sensitivity = buildSensitivity({
    baseFcf: fcf,
    growth: stageOneGrowth,
    wacc: wacc.value ?? 0.12,
    terminalGrowth: assumptions.terminalGrowth,
    years: assumptions.stageOneYears,
    netDebt,
    shares,
  });

  if (price === null) warnings.push("Không có giá thị trường — toàn bộ bội số và giá mục tiêu bị bỏ trống.");
  if (shares === null) warnings.push("Không suy ra được số CP lưu hành (BCTC thiếu cả EPS lẫn số CP) — không tính được vốn hoá.");
  if (fcf === null || fcf <= 0) warnings.push("FCF LTM không dương — mô hình DCF/FCFE bị loại khỏi giá mục tiêu hỗn hợp.");
  if (dcf.terminalValueSharePct !== null && dcf.terminalValueSharePct > 80) {
    warnings.push(`Giá trị cuối chiếm ${dcf.terminalValueSharePct.toFixed(0)}% giá trị DCF — kết quả rất nhạy với giả định tăng trưởng vĩnh cửu.`);
  }
  if (ctx.ltm.annualized) warnings.push("LTM được nội suy từ YTD — các bội số có thể lệch do yếu tố mùa vụ.");

  return {
    symbol: ctx.symbol,
    asOfPeriod: ctx.ltm.periodEnd,
    price: round(price, 3),
    sharesOutstandingMillions: round(shares, 2),
    marketCapBillionVnd: round(marketCap, 0),
    enterpriseValueBillionVnd: round(enterpriseValue, 0),
    netDebtBillionVnd: round(netDebt, 0),
    epsLtm: round(eps, 3),
    bvps: round(bvps, 3),
    dpsLtm: round(dps, 3),
    fcfPerShare: round(fcf !== null && shares !== null && shares > 0 ? fcf / shares : null, 3),
    priceUnit: "nghìn VND",
    multiples,
    industryMultiples: {
      pe: industry.pe,
      pb: industry.pb,
      evEbitda: industry.evEbitda,
      evSales: industry.evSales,
      source: industry.source,
    },
    wacc,
    dcf,
    fcfe,
    ddm,
    grahamNumber: round(grahamNumber, 2),
    reverseDcf,
    methods: normalized,
    targetPrice: { low: round(targetLow, 2), mid: round(targetMid, 2), high: round(targetHigh, 2) },
    upsidePct: round(upsidePct, 2),
    marginOfSafetyPct: round(marginOfSafetyPct, 2),
    rating,
    verdictVi,
    sensitivity,
    assumptions: {
      riskFreeRatePct: assumptions.riskFreeRate * 100,
      equityRiskPremiumPct: assumptions.equityRiskPremium * 100,
      terminalGrowthPct: assumptions.terminalGrowth * 100,
      stageOneYears: assumptions.stageOneYears,
      stageOneGrowthPct: Number((stageOneGrowth * 100).toFixed(2)),
      taxRatePct: Number((wacc.taxRate * 100).toFixed(2)),
      beta: wacc.beta ?? benchmark.beta,
      sector: benchmark.sector,
      industry: benchmark.industry,
    },
    methodology: [
      "Mọi tử số đều là số LTM (12 tháng gần nhất) đã tách luỹ kế; mẫu số là số dư bình quân đầu/cuối kỳ.",
      "Bội số ngành không hard-code: suy ra từ benchmark ngành bằng mô hình Gordon (P/B = (ROE − g)/(Ke − g)).",
      "WACC dùng trọng số thị trường cho vốn chủ và giá trị sổ sách cho nợ vay.",
      "Giá mục tiêu là trung bình có trọng số của các phương pháp khả dụng (trọng số đã chuẩn hoá về 100%).",
      "Không dùng số liệu synthetic: thiếu dữ liệu thì bỏ trống chỉ số, không nội suy.",
    ],
    warnings,
  };
}

/* ────────────────────────────────────────────────────────────
 * Helpers định giá
 * ──────────────────────────────────────────────────────────── */

const EMPTY_DCF: DcfResult = {
  available: false,
  stageOneGrowth: null,
  terminalGrowth: 0,
  wacc: null,
  baseFcf: null,
  enterpriseValue: null,
  netDebt: null,
  equityValue: null,
  valuePerShare: null,
  terminalValueSharePct: null,
  scenarios: { pessimistic: null, base: null, optimistic: null },
  stageOne: [],
  note: "",
};

function buildDcf(args: {
  baseFcf: Num;
  growth: number;
  discountRate: number;
  terminalGrowth: number;
  years: number;
  netDebt: Num;
  shares: Num;
  note: string;
}): DcfResult {
  const { baseFcf, growth, discountRate, terminalGrowth, years, netDebt, shares, note } = args;
  if (baseFcf === null || baseFcf <= 0 || shares === null || shares <= 0 || discountRate <= terminalGrowth) {
    return { ...EMPTY_DCF, note, terminalGrowth, wacc: round(discountRate, 4), stageOneGrowth: round(growth, 4), baseFcf: round(baseFcf, 1), netDebt: round(netDebt, 0) };
  }
  const base = dcfTwoStage(baseFcf, growth, discountRate, terminalGrowth, years);
  const pessimistic = dcfTwoStage(baseFcf, Math.max(0, growth - 0.05), scenarioRate(discountRate, 0.02), Math.max(0, terminalGrowth - 0.005), years);
  const optimistic = dcfTwoStage(baseFcf, growth + 0.05, scenarioRate(discountRate, -0.01), terminalGrowth + 0.005, years);

  const toPerShare = (ev: number): Num => {
    const equityValue = ev - (netDebt ?? 0);
    return equityValue / shares;
  };

  return {
    available: true,
    stageOneGrowth: round(growth, 4),
    terminalGrowth,
    wacc: round(discountRate, 4),
    baseFcf: round(baseFcf, 1),
    enterpriseValue: round(base.enterpriseValue, 0),
    netDebt: round(netDebt, 0),
    equityValue: round(base.enterpriseValue - (netDebt ?? 0), 0),
    valuePerShare: round(toPerShare(base.enterpriseValue), 2),
    terminalValueSharePct: Number.isFinite(base.terminalValueSharePct) ? round(base.terminalValueSharePct, 1) : null,
    scenarios: {
      pessimistic: round(toPerShare(pessimistic.enterpriseValue), 2),
      base: round(toPerShare(base.enterpriseValue), 2),
      optimistic: round(toPerShare(optimistic.enterpriseValue), 2),
    },
    stageOne: base.stageOne,
    note,
  };
}

function reverseDcfGrowth(args: {
  price: Num;
  baseFcf: Num;
  discountRate: number;
  terminalGrowth: number;
  years: number;
  netDebt: Num;
  shares: Num;
}): number | null {
  const { price, baseFcf, discountRate, terminalGrowth, years, netDebt, shares } = args;
  if (price === null || baseFcf === null || baseFcf <= 0 || shares === null || shares <= 0) return null;
  if (discountRate <= terminalGrowth) return null;
  const targetEquity = price * shares;
  const targetEv = targetEquity + (netDebt ?? 0);

  let lo = -0.2;
  let hi = 0.6;
  const valueAt = (g: number) => dcfTwoStage(baseFcf, g, discountRate, terminalGrowth, years).enterpriseValue;
  if (valueAt(hi) < targetEv) return hi; // thị trường kỳ vọng cao hơn cả cận trên
  if (valueAt(lo) > targetEv) return lo;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (valueAt(mid) < targetEv) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function peTargetOf(eps: Num, industryPe: Num): { mid: Num; low: Num; high: Num } | null {
  if (eps === null || eps <= 0 || industryPe === null) return null;
  return { mid: eps * industryPe, low: eps * industryPe * 0.85, high: eps * industryPe * 1.15 };
}

function pbTargetOf(bvps: Num, industryPb: Num): { mid: Num; low: Num; high: Num } | null {
  if (bvps === null || bvps <= 0 || industryPb === null) return null;
  return { mid: bvps * industryPb, low: bvps * industryPb * 0.85, high: bvps * industryPb * 1.15 };
}

function evEbitdaTargetOf(ebitda: Num, multiple: Num, netDebt: Num, shares: Num): { mid: Num; low: Num; high: Num } | null {
  if (ebitda === null || ebitda <= 0 || multiple === null || shares === null || shares <= 0) return null;
  const toPrice = (m: number) => (multiple * m * ebitda - (netDebt ?? 0)) / shares;
  return { mid: toPrice(1), low: toPrice(0.85), high: toPrice(1.15) };
}

function evSalesTargetOf(revenue: Num, multiple: Num, netDebt: Num, shares: Num): { mid: Num; low: Num; high: Num } | null {
  if (revenue === null || revenue <= 0 || multiple === null || shares === null || shares <= 0) return null;
  const toPrice = (m: number) => (multiple * m * revenue - (netDebt ?? 0)) / shares;
  return { mid: toPrice(1), low: toPrice(0.85), high: toPrice(1.15) };
}

function buildSensitivity(args: {
  baseFcf: Num;
  growth: number;
  wacc: number;
  terminalGrowth: number;
  years: number;
  netDebt: Num;
  shares: Num;
}): { waccSteps: number[]; growthSteps: number[]; cells: SensitivityCell[] } {
  const { baseFcf, growth, wacc, terminalGrowth, years, netDebt, shares } = args;
  const waccSteps = [-0.02, -0.01, 0, 0.01, 0.02].map((d) => Number((wacc + d).toFixed(4)));
  const growthSteps = [-0.01, -0.005, 0, 0.005, 0.01].map((d) => Number((terminalGrowth + d).toFixed(4)));
  const cells: SensitivityCell[] = [];
  for (const w of waccSteps) {
    for (const g of growthSteps) {
      let valuePerShare: Num = null;
      if (baseFcf !== null && baseFcf > 0 && shares !== null && shares > 0 && w > g) {
        const ev = dcfTwoStage(baseFcf, growth, w, g, years).enterpriseValue;
        if (Number.isFinite(ev)) valuePerShare = round((ev - (netDebt ?? 0)) / shares, 2);
      }
      cells.push({ wacc: w, terminalGrowth: g, valuePerShare });
    }
  }
  return { waccSteps, growthSteps, cells };
}
