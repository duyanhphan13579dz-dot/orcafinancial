/**
 * Sức khỏe tài chính nâng cao (Advanced Financial Health Engine)
 *
 * Bổ sung 3 mô hình chấm điểm học thuật chuẩn quốc tế mà bản
 * `financial-health-detail.ts` cũ chưa có:
 *
 *  1. Altman Z'-Score (phiên bản cho thị trường mới nổi / phi sản xuất)
 *     Z' = 6.56·X1 + 3.26·X2 + 6.72·X3 + 1.05·X4
 *       X1 = Vốn lưu động / Tổng tài sản
 *       X2 = Lợi nhuận giữ lại / Tổng tài sản
 *       X3 = EBIT (LTM) / Tổng tài sản
 *       X4 = Giá trị sổ sách VCSH / Tổng nợ phải trả
 *     Vùng: Z' > 2.6 an toàn · 1.1–2.6 vùng xám · < 1.1 nguy cơ phá sản
 *
 *  2. Piotroski F-Score (9 tiêu chí, 0–9 điểm) — chất lượng cải thiện tài chính
 *
 *  3. Beneish M-Score (8 biến) — khả năng số liệu bị "làm đẹp"
 *     M = −4.84 + 0.920·DSRI + 0.528·GMI + 0.404·AQI + 0.892·SGI
 *         + 0.115·DEPI − 0.172·SGAI + 4.679·TATA − 0.327·LVGI
 *     M > −1.78 → cảnh báo khả năng điều chỉnh lợi nhuận
 *
 * Toàn bộ số liệu đầu vào là LTM đã chuẩn hoá (không nhân quý ×4).
 */

import {
  field,
  growthPct,
  interestBearingDebt,
  positive,
  ramp,
  ratingOf,
  ratio,
  round,
  type FundamentalContext,
  type NormalizedQuarter,
  type Num,
} from "@/lib/fundamental-engine";
import { effectiveTaxRateOf, netDebtOf } from "@/lib/fundamental-performance";

/* ────────────────────────────────────────────────────────────
 * Cấu trúc trả về
 * ──────────────────────────────────────────────────────────── */

export interface AltmanComponent {
  key: string;
  label: string;
  value: Num;
  weight: number;
  contribution: Num;
  formula: string;
}

export interface AltmanResult {
  zScore: Num;
  zone: "safe" | "grey" | "distress" | "unavailable";
  zoneVi: string;
  verdictVi: string;
  score: number | null;
  components: AltmanComponent[];
}

export interface PiotroskiCriterion {
  key: string;
  label: string;
  passed: boolean | null;
  detail: string;
}

export interface PiotroskiResult {
  fScore: number | null;
  maxScore: number;
  evaluated: number;
  verdictVi: string;
  score: number | null;
  criteria: PiotroskiCriterion[];
}

export interface BeneishComponent {
  key: string;
  label: string;
  value: Num;
  weight: number;
  formula: string;
}

export interface BeneishResult {
  mScore: Num;
  manipulationRisk: "low" | "moderate" | "high" | "unavailable";
  verdictVi: string;
  score: number | null;
  components: BeneishComponent[];
}

export interface SolvencyMetric {
  key: string;
  label: string;
  value: Num;
  unit: string;
  formula: string;
  benchmark: Num;
  score: number | null;
  verdict: string;
}

export interface AdvancedHealth {
  symbol: string;
  asOfPeriod: string;
  overall: number;
  rating: string;
  altman: AltmanResult;
  piotroski: PiotroskiResult;
  beneish: BeneishResult;
  solvency: SolvencyMetric[];
  solvencyScore: number | null;
  distressFlags: string[];
  summary: string;
  warnings: string[];
}

/* ────────────────────────────────────────────────────────────
 * Công cụ nội bộ
 * ──────────────────────────────────────────────────────────── */

function solvencyMetric(
  key: string,
  label: string,
  value: Num,
  unit: string,
  formula: string,
  options: { benchmark?: Num; score?: Num; digits?: number } = {},
): SolvencyMetric {
  const score = options.score === null || options.score === undefined ? null : Math.round(Math.max(0, Math.min(1, options.score)) * 100);
  return {
    key,
    label,
    value: round(value, options.digits ?? 2),
    unit,
    formula,
    benchmark: round(options.benchmark ?? null, options.digits ?? 2),
    score,
    verdict:
      score === null ? "Chưa có dữ liệu"
      : score >= 80 ? "Rất tốt"
      : score >= 65 ? "Tốt"
      : score >= 45 ? "Trung bình"
      : score >= 25 ? "Yếu"
      : "Rất yếu",
  };
}

function workingCapitalOf(balance: Partial<Record<string, unknown>>): Num {
  const ca = field(balance, "currentAssets");
  const cl = field(balance, "currentLiabilities");
  if (ca === null || cl === null) return null;
  return ca - cl;
}

function totalRevenueOf(quarter: NormalizedQuarter): Num {
  return field(quarter.income, "revenue");
}

/* ────────────────────────────────────────────────────────────
 * 1. Altman Z'-Score
 * ──────────────────────────────────────────────────────────── */

export function computeAltmanZ(ctx: FundamentalContext): AltmanResult {
  const closing = ctx.closing;
  const totalAssets = positive(field(closing, "totalAssets"));
  const equity = field(closing, "equity");
  const retainedEarnings = field(closing, "retainedEarnings");
  const totalLiabilities = field(closing, "totalLiabilities");
  const ebit =
    field(ctx.ltm.income, "operatingIncome") ??
    (field(ctx.ltm.income, "ebitda") !== null && field(ctx.ltm.income, "depreciation") !== null
      ? (field(ctx.ltm.income, "ebitda") as number) - (field(ctx.ltm.income, "depreciation") as number)
      : null);

  const x1 = ratio(workingCapitalOf(closing as Partial<Record<string, unknown>>), totalAssets);
  const x2 = ratio(retainedEarnings, totalAssets);
  const x3 = ratio(ebit, totalAssets);
  const x4 = totalLiabilities !== null && totalLiabilities !== 0 && equity !== null ? equity / totalLiabilities : null;

  const weights = { x1: 6.56, x2: 3.26, x3: 6.72, x4: 1.05 };
  const components: AltmanComponent[] = [
    { key: "x1", label: "Vốn lưu động / Tổng tài sản", value: round(x1, 4), weight: weights.x1, contribution: round(x1 !== null ? x1 * weights.x1 : null, 3), formula: "(Tài sản ngắn hạn − Nợ ngắn hạn) ÷ Tổng tài sản" },
    { key: "x2", label: "LN giữ lại / Tổng tài sản", value: round(x2, 4), weight: weights.x2, contribution: round(x2 !== null ? x2 * weights.x2 : null, 3), formula: "Lợi nhuận chưa phân phối ÷ Tổng tài sản" },
    { key: "x3", label: "EBIT (LTM) / Tổng tài sản", value: round(x3, 4), weight: weights.x3, contribution: round(x3 !== null ? x3 * weights.x3 : null, 3), formula: "EBIT 12 tháng gần nhất ÷ Tổng tài sản" },
    { key: "x4", label: "VCSH sổ sách / Tổng nợ", value: round(x4, 4), weight: weights.x4, contribution: round(x4 !== null ? x4 * weights.x4 : null, 3), formula: "Vốn chủ sở hữu ÷ Tổng nợ phải trả" },
  ];

  const available = components.filter((c) => c.value !== null);
  if (available.length < 4) {
    return {
      zScore: null,
      zone: "unavailable",
      zoneVi: "Chưa đủ dữ liệu",
      verdictVi: `Altman Z' cần đủ 4 biến; hiện thiếu ${4 - available.length} biến (${components.filter((c) => c.value === null).map((c) => c.label).join(", ")}).`,
      score: null,
      components,
    };
  }

  const zScore = available.reduce((sum, c) => sum + (c.contribution ?? 0), 0);
  const zone: AltmanResult["zone"] = zScore > 2.6 ? "safe" : zScore >= 1.1 ? "grey" : "distress";
  const zoneVi = zone === "safe" ? "VÙNG AN TOÀN" : zone === "grey" ? "VÙNG XÁM (cảnh báo)" : "VÙNG NGUY HIỂM";
  const verdictVi =
    zone === "safe"
      ? `Z' = ${zScore.toFixed(2)} > 2.6 — cấu trúc tài chính lành mạnh, rủi ro mất khả năng thanh toán rất thấp trong 12–24 tháng tới.`
      : zone === "grey"
        ? `Z' = ${zScore.toFixed(2)} nằm trong vùng xám (1.1–2.6) — chưa nguy cấp nhưng cần theo dõi sát nợ đáo hạn và dòng tiền.`
        : `Z' = ${zScore.toFixed(2)} < 1.1 — mô hình Altman cảnh báo nguy cơ mất khả năng thanh toán cao.`;

  // Điểm 0..100: Z'=0 → 0 điểm; Z'=4 → ~95 điểm (giới hạn 100).
  const score = Math.max(0, Math.min(100, Math.round((zScore / 4.2) * 100)));

  return { zScore: round(zScore, 3), zone, zoneVi, verdictVi, score, components };
}

/* ────────────────────────────────────────────────────────────
 * 2. Piotroski F-Score
 * ──────────────────────────────────────────────────────────── */

export function computePiotroskiF(ctx: FundamentalContext): PiotroskiResult {
  const criteria: PiotroskiCriterion[] = [];
  const now = ctx.ltm;
  const prev = ctx.ltmPrevious;
  const closing = ctx.closing;
  const opening = ctx.normalized.find((q) => {
    if (!ctx.latest) return false;
    const latestIdx = ctx.latest.fiscalYear * 4 + ctx.latest.quarter;
    const idx = q.fiscalYear * 4 + q.quarter;
    return idx === latestIdx - 4;
  }) ?? ctx.normalized[1] ?? null;

  const ni = field(now.income, "netIncome");
  const ocf = field(now.cashflow, "operatingCashFlow");
  const totalAssets = positive(field(closing, "totalAssets"));
  const openingAssets = opening ? positive(field(opening.balance, "totalAssets")) : null;

  // 1. ROA dương
  const roaNow = ratio(ni, totalAssets);
  const roaPrev = prev && openingAssets ? ratio(field(prev.income, "netIncome"), openingAssets) : null;
  criteria.push({
    key: "positiveRoa",
    label: "ROA dương",
    passed: roaNow === null ? null : roaNow > 0,
    detail: roaNow === null ? "Thiếu LN ròng hoặc tổng tài sản." : `ROA LTM = ${(roaNow * 100).toFixed(2)}%`,
  });

  // 2. Dòng tiền hoạt động dương
  criteria.push({
    key: "positiveCfo",
    label: "Dòng tiền hoạt động dương",
    passed: ocf === null ? null : ocf > 0,
    detail: ocf === null ? "Thiếu dữ liệu dòng tiền hoạt động." : `OCF LTM = ${ocf.toFixed(0)} tỷ VND`,
  });

  // 3. ROA cải thiện
  criteria.push({
    key: "roaImproving",
    label: "ROA cải thiện so với kỳ trước",
    passed: roaNow === null || roaPrev === null ? null : roaNow > roaPrev,
    detail:
      roaNow === null || roaPrev === null
        ? "Thiếu dữ liệu kỳ trước để so sánh."
        : `ROA ${roaPrev === null ? "—" : (roaPrev * 100).toFixed(2)}% → ${(roaNow * 100).toFixed(2)}%`,
  });

  // 4. Chất lượng lợi nhuận: OCF > LN ròng
  criteria.push({
    key: "accruals",
    label: "OCF lớn hơn LN ròng (chất lượng LN)",
    passed: ocf === null || ni === null ? null : ocf > ni,
    detail: ocf === null || ni === null ? "Thiếu dữ liệu." : `OCF ${ocf.toFixed(0)} tỷ vs LN ròng ${ni.toFixed(0)} tỷ`,
  });

  // 5. Đòn bẩy giảm (nợ dài hạn / tổng tài sản)
  const levNow = ratio(field(closing, "longTermDebt"), totalAssets);
  const levPrev = opening ? ratio(field(opening.balance, "longTermDebt"), openingAssets) : null;
  criteria.push({
    key: "leverageDecreasing",
    label: "Đòn bẩy giảm (Nợ dài hạn / TS)",
    passed: levNow === null || levPrev === null ? null : levNow < levPrev,
    detail:
      levNow === null || levPrev === null
        ? "Thiếu dữ liệu nợ dài hạn."
        : `${(levPrev * 100).toFixed(1)}% → ${(levNow * 100).toFixed(1)}%`,
  });

  // 6. Thanh khoản cải thiện (current ratio)
  const crNow = ratio(field(closing, "currentAssets"), field(closing, "currentLiabilities"));
  const crPrev = opening ? ratio(field(opening.balance, "currentAssets"), field(opening.balance, "currentLiabilities")) : null;
  criteria.push({
    key: "liquidityImproving",
    label: "Thanh khoản hiện hành cải thiện",
    passed: crNow === null || crPrev === null ? null : crNow > crPrev,
    detail: crNow === null || crPrev === null ? "Thiếu dữ liệu tài sản/nợ ngắn hạn." : `${crPrev.toFixed(2)} → ${crNow.toFixed(2)} lần`,
  });

  // 7. Không phát hành thêm cổ phiếu
  const sharesNow = field(now.income, "sharesOutstanding");
  const sharesPrev = prev ? field(prev.income, "sharesOutstanding") : null;
  criteria.push({
    key: "noDilution",
    label: "Không phát hành thêm cổ phiếu",
    passed: sharesNow === null || sharesPrev === null ? null : sharesNow <= sharesPrev * 1.005,
    detail: sharesNow === null || sharesPrev === null ? "BCTC không khai báo số CP lưu hành." : `${sharesPrev.toFixed(0)} → ${sharesNow.toFixed(0)} triệu CP`,
  });

  // 8. Biên lợi nhuận gộp cải thiện
  const gmNow = ratio(field(now.income, "grossProfit"), field(now.income, "revenue"));
  const gmPrev = prev ? ratio(field(prev.income, "grossProfit"), field(prev.income, "revenue")) : null;
  criteria.push({
    key: "grossMarginImproving",
    label: "Biên lợi nhuận gộp cải thiện",
    passed: gmNow === null || gmPrev === null ? null : gmNow > gmPrev,
    detail: gmNow === null || gmPrev === null ? "Thiếu dữ liệu lợi nhuận gộp." : `${(gmPrev * 100).toFixed(1)}% → ${(gmNow * 100).toFixed(1)}%`,
  });

  // 9. Vòng quay tài sản cải thiện
  const atNow = ratio(field(now.income, "revenue"), totalAssets);
  const atPrev = prev && openingAssets ? ratio(field(prev.income, "revenue"), openingAssets) : null;
  criteria.push({
    key: "assetTurnoverImproving",
    label: "Vòng quay tổng tài sản cải thiện",
    passed: atNow === null || atPrev === null ? null : atNow > atPrev,
    detail: atNow === null || atPrev === null ? "Thiếu dữ liệu doanh thu/tài sản." : `${atPrev.toFixed(2)} → ${atNow.toFixed(2)} vòng`,
  });

  const evaluated = criteria.filter((c) => c.passed !== null);
  if (evaluated.length === 0) {
    return {
      fScore: null,
      maxScore: 9,
      evaluated: 0,
      verdictVi: "Chưa đủ dữ liệu để chấm Piotroski F-Score.",
      score: null,
      criteria,
    };
  }
  const fScore = evaluated.filter((c) => c.passed).length;
  const verdictVi =
    fScore >= 7
      ? `F-Score ${fScore}/9 (${evaluated.length} tiêu chí đánh giá được) — nền tảng tài chính đang cải thiện rõ rệt, nhóm cổ phiếu giá trị chất lượng cao.`
      : fScore >= 5
        ? `F-Score ${fScore}/9 — tín hiệu trung tính, một số chỉ tiêu cải thiện nhưng chưa đồng đều.`
        : fScore >= 3
          ? `F-Score ${fScore}/9 — nhiều chỉ tiêu xấu đi; cần thận trọng khi giải ngân.`
          : `F-Score ${fScore}/9 — nền tảng tài chính đang suy yếu trên diện rộng.`;

  return {
    fScore,
    maxScore: 9,
    evaluated: evaluated.length,
    verdictVi,
    score: Math.round((fScore / evaluated.length) * 100),
    criteria,
  };
}

/* ────────────────────────────────────────────────────────────
 * 3. Beneish M-Score
 * ──────────────────────────────────────────────────────────── */

export function computeBeneishM(ctx: FundamentalContext): BeneishResult {
  const cur = ctx.latest;
  const base = ctx.yearAgo ?? ctx.prevQuarter;
  if (!cur || !base) {
    return {
      mScore: null,
      manipulationRisk: "unavailable",
      verdictVi: "Cần ít nhất 2 kỳ báo cáo để tính Beneish M-Score.",
      score: null,
      components: [],
    };
  }

  const revCur = totalRevenueOf(cur);
  const revBase = totalRevenueOf(base);
  const receivablesCur = field(cur.balance, "receivables");
  const receivablesBase = field(base.balance, "receivables");
  const gpCur = field(cur.income, "grossProfit");
  const gpBase = field(base.income, "grossProfit");
  const depCur = field(cur.income, "depreciation");
  const depBase = field(base.income, "depreciation");
  const opexCur = field(cur.income, "operatingExpenses");
  const opexBase = field(base.income, "operatingExpenses");
  const niCur = field(cur.income, "netIncome");
  const ocfCur = field(cur.cashflow, "operatingCashFlow");
  const taCur = positive(field(cur.balance, "totalAssets"));
  const taBase = positive(field(base.balance, "totalAssets"));
  const caCur = field(cur.balance, "currentAssets");
  const ppeCur = field(cur.balance, "fixedAssets");
  const caBase = field(base.balance, "currentAssets");
  const ppeBase = field(base.balance, "fixedAssets");
  const ltdCur = field(cur.balance, "longTermDebt");
  const clCur = field(cur.balance, "currentLiabilities");
  const ltdBase = field(base.balance, "longTermDebt");
  const clBase = field(base.balance, "currentLiabilities");

  // DSRI = (Phải thu_t / Doanh thu_t) / (Phải thu_{t-1} / Doanh thu_{t-1})
  const dsri =
    receivablesCur !== null && revCur !== null && revCur !== 0 && receivablesBase !== null && revBase !== null && revBase !== 0
      ? (receivablesCur / revCur) / (receivablesBase / revBase)
      : null;

  // GMI = Biên gộp_{t-1} / Biên gộp_t
  const gmCur = gpCur !== null && revCur !== null && revCur !== 0 ? gpCur / revCur : null;
  const gmBase = gpBase !== null && revBase !== null && revBase !== 0 ? gpBase / revBase : null;
  const gmi = gmCur !== null && gmBase !== null && gmCur !== 0 ? gmBase / gmCur : null;

  // AQI = (1 − (TSCĐ_t + TSNH_t) / TS_t) / (1 − (TSCĐ_{t-1} + TSNH_{t-1}) / TS_{t-1})
  const aqCur = taCur !== null && caCur !== null && ppeCur !== null ? 1 - (ppeCur + caCur) / taCur : null;
  const aqBase = taBase !== null && caBase !== null && ppeBase !== null ? 1 - (ppeBase + caBase) / taBase : null;
  const aqi = aqCur !== null && aqBase !== null && aqCur !== 0 ? aqBase / aqCur : null;

  // SGI = Doanh thu_t / Doanh thu_{t-1}
  const sgi = revCur !== null && revBase !== null && revBase !== 0 ? revCur / revBase : null;

  // DEPI = Tỷ lệ khấu hao_{t-1} / Tỷ lệ khấu hao_t
  const depRateCur = depCur !== null && ppeCur !== null && ppeCur > 0 ? depCur / (ppeCur + (depCur ?? 0)) : null;
  const depRateBase = depBase !== null && ppeBase !== null && ppeBase > 0 ? depBase / (ppeBase + (depBase ?? 0)) : null;
  const depi = depRateCur !== null && depRateBase !== null && depRateCur !== 0 ? depRateBase / depRateCur : null;

  // SGAI = (Chi phí QLDN_t / Doanh thu_t) / (Chi phí QLDN_{t-1} / Doanh thu_{t-1})
  const sgaiCur = opexCur !== null && revCur !== null && revCur !== 0 ? opexCur / revCur : null;
  const sgaiBase = opexBase !== null && revBase !== null && revBase !== 0 ? opexBase / revBase : null;
  const sgai = sgaiCur !== null && sgaiBase !== null && sgaiCur !== 0 ? sgaiBase / sgaiCur : null;

  // TATA = (LN ròng − OCF) / Tổng tài sản
  const tata = niCur !== null && ocfCur !== null && taCur !== null ? (niCur - ocfCur) / taCur : null;

  // LVGI = Đòn bẩy_t / Đòn bẩy_{t-1}
  const levCurVal = taCur !== null && ltdCur !== null && clCur !== null ? (ltdCur + clCur) / taCur : null;
  const levBaseVal = taBase !== null && ltdBase !== null && clBase !== null ? (ltdBase + clBase) / taBase : null;
  const lvgi = levCurVal !== null && levBaseVal !== null && levCurVal !== 0 ? levBaseVal / levCurVal : null;

  const weights = { dsri: 0.92, gmi: 0.528, aqi: 0.404, sgi: 0.892, depi: 0.115, sgai: -0.172, tata: 4.679, lvgi: -0.327 };
  const components: BeneishComponent[] = [
    { key: "dsri", label: "DSRI — Chỉ số phải thu / doanh thu", value: round(dsri, 3), weight: weights.dsri, formula: "(Phải thu_t / DT_t) ÷ (Phải thu_t-1 / DT_t-1)" },
    { key: "gmi", label: "GMI — Chỉ số biên gộp", value: round(gmi, 3), weight: weights.gmi, formula: "Biên gộp_t-1 ÷ Biên gộp_t" },
    { key: "aqi", label: "AQI — Chỉ số chất lượng tài sản", value: round(aqi, 3), weight: weights.aqi, formula: "(1 − (TSCĐ+TSNH)/TS)_t-1 ÷ (1 − (TSCĐ+TSNH)/TS)_t" },
    { key: "sgi", label: "SGI — Chỉ số tăng trưởng doanh thu", value: round(sgi, 3), weight: weights.sgi, formula: "Doanh thu_t ÷ Doanh thu_t-1" },
    { key: "depi", label: "DEPI — Chỉ số khấu hao", value: round(depi, 3), weight: weights.depi, formula: "Tỷ lệ khấu hao_t-1 ÷ Tỷ lệ khấu hao_t" },
    { key: "sgai", label: "SGAI — Chỉ số chi phí quản lý", value: round(sgai, 3), weight: weights.sgai, formula: "(CP QLDN/DT)_t-1 ÷ (CP QLDN/DT)_t" },
    { key: "tata", label: "TATA — Tổng dồn tích / tài sản", value: round(tata, 3), weight: weights.tata, formula: "(LN ròng − OCF) ÷ Tổng tài sản" },
    { key: "lvgi", label: "LVGI — Chỉ số đòn bẩy", value: round(lvgi, 3), weight: weights.lvgi, formula: "Đòn bẩy_t-1 ÷ Đòn bẩy_t" },
  ];

  const available = components.filter((c) => c.value !== null);
  if (available.length < 6) {
    return {
      mScore: null,
      manipulationRisk: "unavailable",
      verdictVi: `Beneish M-Score cần tối thiểu 6/8 biến; hiện chỉ có ${available.length}.`,
      score: null,
      components,
    };
  }

  const mScore = -4.84 + available.reduce((sum, c) => sum + (c.value as number) * c.weight, 0);
  const manipulationRisk: BeneishResult["manipulationRisk"] = mScore > -1.78 ? "high" : mScore > -2.22 ? "moderate" : "low";
  const verdictVi =
    manipulationRisk === "high"
      ? `M-Score = ${mScore.toFixed(2)} > −1.78 — mô hình Beneish cảnh báo khả năng lợi nhuận bị điều chỉnh; cần đối chiếu dòng tiền và phải thu.`
      : manipulationRisk === "moderate"
        ? `M-Score = ${mScore.toFixed(2)} nằm ở vùng trung tính (−2.22 đến −1.78) — chưa có dấu hiệu rõ ràng nhưng nên theo dõi.`
        : `M-Score = ${mScore.toFixed(2)} < −2.22 — ít dấu hiệu điều chỉnh số liệu; lợi nhuận có độ tin cậy cao.`;

  // M càng thấp (âm sâu) càng tốt.
  const score = Math.max(0, Math.min(100, Math.round(((mScore + 3.2) / 1.42) * -100 + 100)));

  return { mScore: round(mScore, 3), manipulationRisk, verdictVi, score, components };
}

/* ────────────────────────────────────────────────────────────
 * 4. Bộ chỉ số thanh toán & đòn bẩy (dùng LTM)
 * ──────────────────────────────────────────────────────────── */

export function computeSolvencyMetrics(ctx: FundamentalContext): { metrics: SolvencyMetric[]; score: number | null; flags: string[] } {
  const closing = ctx.closing;
  const balances = ctx.balances;
  const ebit =
    field(ctx.ltm.income, "operatingIncome") ??
    (field(ctx.ltm.income, "ebitda") !== null && field(ctx.ltm.income, "depreciation") !== null
      ? (field(ctx.ltm.income, "ebitda") as number) - (field(ctx.ltm.income, "depreciation") as number)
      : null);
  const ebitda = field(ctx.ltm.income, "ebitda");
  const interestExpense = field(ctx.ltm.income, "interestExpense");
  const cash = field(closing, "cashAndEquivalents") ?? 0;
  const shortTermInvestments = field(closing, "shortTermInvestments") ?? 0;
  const netDebt = netDebtOf(ctx);
  const debt = balances.interestBearingDebt;
  const taxRate = effectiveTaxRateOf(ctx);

  const currentRatio = ratio(field(closing, "currentAssets"), field(closing, "currentLiabilities"));
  const inventory = field(closing, "inventory");
  const quickRatio =
    field(closing, "currentAssets") !== null && field(closing, "currentLiabilities") !== null && inventory !== null
      ? ((field(closing, "currentAssets") as number) - inventory) / (field(closing, "currentLiabilities") as number)
      : null;
  const cashRatio = field(closing, "currentLiabilities") !== null ? cash / (field(closing, "currentLiabilities") as number) : null;
  const debtEquity = ratio(debt, positive(field(closing, "equity")));
  const debtToAssets = ratio(debt, positive(field(closing, "totalAssets")));
  const interestCoverage = interestExpense !== null && interestExpense > 0 && ebit !== null ? ebit / interestExpense : null;
  const ebitdaCoverage = interestExpense !== null && interestExpense > 0 && ebitda !== null ? ebitda / interestExpense : null;
  const netDebtToEbitda = netDebt !== null && ebitda !== null && ebitda > 0 ? netDebt / ebitda : null;
  const debtToEbitda = debt !== null && ebitda !== null && ebitda > 0 ? debt / ebitda : null;
  const debtDueWithin12m = field(closing, "debtDueWithin12m") ?? field(closing, "shortTermDebt");
  const ocf = field(ctx.ltm.cashflow, "operatingCashFlow");
  const liquidityRunwayMonths =
    debtDueWithin12m !== null && debtDueWithin12m > 0 && ocf !== null
      ? ((cash + Math.max(0, ocf)) / debtDueWithin12m) * 12
      : null;
  const ebitToTotalDebt = debt !== null && debt > 0 && ebit !== null ? ebit / debt : null;
  const afterTaxCostOfDebt =
    interestExpense !== null && debt !== null && debt > 0 ? (interestExpense / debt) * (1 - taxRate) : null;
  const equityRatio = ratio(positive(field(closing, "equity")), positive(field(closing, "totalAssets")));

  const metrics: SolvencyMetric[] = [
    solvencyMetric("currentRatio", "Tỷ số thanh toán hiện hành", currentRatio, "lần",
      "Tài sản ngắn hạn ÷ Nợ ngắn hạn", { benchmark: 1.5, score: ramp(currentRatio, 0.8, 2) }),
    solvencyMetric("quickRatio", "Tỷ số thanh toán nhanh", quickRatio, "lần",
      "(Tài sản ngắn hạn − Hàng tồn kho) ÷ Nợ ngắn hạn", { benchmark: 1, score: ramp(quickRatio, 0.5, 1.5) }),
    solvencyMetric("cashRatio", "Tỷ số tiền mặt / Nợ ngắn hạn", cashRatio, "lần",
      "(Tiền + Đầu tư ngắn hạn) ÷ Nợ ngắn hạn", { benchmark: 0.2, score: ramp(cashRatio, 0.05, 0.4) }),
    solvencyMetric("debtToEquity", "Nợ vay / VCSH", debtEquity, "lần",
      "Nợ vay chịu lãi ÷ Vốn chủ sở hữu", { benchmark: 1, score: ramp(debtEquity, 2, 0.4, false) }),
    solvencyMetric("debtToAssets", "Nợ vay / Tổng tài sản", debtToAssets !== null ? debtToAssets * 100 : null, "%",
      "Nợ vay chịu lãi ÷ Tổng tài sản × 100", { benchmark: 40, score: ramp(debtToAssets !== null ? debtToAssets * 100 : null, 70, 25, false) }),
    solvencyMetric("equityRatio", "Tỷ lệ tự chủ tài chính", equityRatio !== null ? equityRatio * 100 : null, "%",
      "VCSH ÷ Tổng tài sản × 100", { benchmark: 50, score: ramp(equityRatio, 0.2, 0.6) }),
    solvencyMetric("interestCoverage", "Khả năng trả lãi (EBIT/Lãi vay)", interestCoverage, "lần",
      "EBIT (LTM) ÷ Chi phí lãi vay (LTM)", { benchmark: 5, score: ramp(interestCoverage, 1.5, 8) }),
    solvencyMetric("ebitdaCoverage", "Khả năng trả lãi (EBITDA/Lãi vay)", ebitdaCoverage, "lần",
      "EBITDA (LTM) ÷ Chi phí lãi vay (LTM)", { benchmark: 6, score: ramp(ebitdaCoverage, 2, 10) }),
    solvencyMetric("netDebtToEbitda", "Nợ ròng / EBITDA (LTM)", netDebtToEbitda, "lần",
      "(Nợ vay − Tiền − Đầu tư ngắn hạn) ÷ EBITDA LTM", { benchmark: 1.5, score: ramp(netDebtToEbitda, 4, 0.5, false) }),
    solvencyMetric("debtToEbitda", "Tổng nợ vay / EBITDA (LTM)", debtToEbitda, "lần",
      "Tổng nợ vay ÷ EBITDA LTM", { benchmark: 2.5, score: ramp(debtToEbitda, 5, 1, false) }),
    solvencyMetric("liquidityRunway", "Thời gian phủ nợ đáo hạn 12 tháng", liquidityRunwayMonths, "tháng",
      "(Tiền + OCF LTM) ÷ Nợ đáo hạn trong 12 tháng × 12", { benchmark: 12, score: ramp(liquidityRunwayMonths, 3, 18) }),
    solvencyMetric("ebitToTotalDebt", "EBIT / Tổng nợ vay", ebitToTotalDebt !== null ? ebitToTotalDebt * 100 : null, "%",
      "EBIT (LTM) ÷ Tổng nợ vay × 100", { benchmark: 20, score: ramp(ebitToTotalDebt !== null ? ebitToTotalDebt * 100 : null, 2, 30) }),
    solvencyMetric("afterTaxCostOfDebt", "Chi phí nợ vay sau thuế", afterTaxCostOfDebt !== null ? afterTaxCostOfDebt * 100 : null, "%",
      "(Chi phí lãi vay ÷ Nợ vay bình quân) × (1 − thuế suất hiệu dụng) × 100", { benchmark: 8, score: ramp(afterTaxCostOfDebt !== null ? afterTaxCostOfDebt * 100 : null, 14, 4, false) }),
  ];

  const scores = metrics.map((m) => m.score).filter((s): s is number => s !== null);
  const score = scores.length === 0 ? null : Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);

  const flags: string[] = [];
  if (currentRatio !== null && currentRatio < 1) flags.push("Tài sản ngắn hạn nhỏ hơn nợ ngắn hạn — mất cân đối thanh khoản.");
  if (interestCoverage !== null && interestCoverage < 1.5) flags.push("EBIT không đủ bù đắp chi phí lãi vay (ICR < 1.5).");
  if (netDebtToEbitda !== null && netDebtToEbitda > 4) flags.push("Nợ ròng vượt 4 lần EBITDA — áp lực tái cấp vốn cao.");
  if (field(closing, "equity") !== null && (field(closing, "equity") as number) <= 0) flags.push("Vốn chủ sở hữu âm — tình trạng mất an toàn tài chính nghiêm trọng.");
  if (liquidityRunwayMonths !== null && liquidityRunwayMonths < 6) flags.push("Tiền + dòng tiền chỉ phủ được dưới 6 tháng nợ đáo hạn.");

  return { metrics, score, flags };
}

/* ────────────────────────────────────────────────────────────
 * 5. Tổng hợp
 * ──────────────────────────────────────────────────────────── */

/** Trọng số điểm sức khỏe tài chính nâng cao. */
export const HEALTH_WEIGHTS = {
  solvency: 0.35,
  altman: 0.25,
  piotroski: 0.2,
  beneish: 0.1,
  growthSafety: 0.1,
} as const;

export function computeAdvancedHealth(ctx: FundamentalContext): AdvancedHealth {
  const warnings = [...ctx.warnings];
  const altman = computeAltmanZ(ctx);
  const piotroski = computePiotroskiF(ctx);
  const beneish = computeBeneishM(ctx);
  const { metrics: solvency, score: solvencyScore, flags } = computeSolvencyMetrics(ctx);

  // Trụ "an toàn tăng trưởng": nợ không tăng nhanh hơn EBITDA.
  const ebitdaGrowth = growthPct(
    field(ctx.ltm.income, "ebitda"),
    ctx.ltmPrevious ? field(ctx.ltmPrevious.income, "ebitda") : null,
  );
  const debtNow = ctx.balances.interestBearingDebt;
  const opening = ctx.normalized.find((q) => {
    if (!ctx.latest) return false;
    return q.fiscalYear * 4 + q.quarter === ctx.latest.fiscalYear * 4 + ctx.latest.quarter - 4;
  }) ?? null;
  const debtOpening = opening ? interestBearingDebt(opening.balance) : null;
  const debtGrowth = growthPct(debtNow, debtOpening);
  const safetySpread =
    ebitdaGrowth !== null && debtGrowth !== null ? ebitdaGrowth - debtGrowth : null;
  const growthSafetyScore =
    safetySpread === null ? null : Math.round(Math.max(0, Math.min(1, ramp(safetySpread, -25, 15) as number)) * 100);

  const parts: Array<{ score: number | null; weight: number; label: string }> = [
    { score: solvencyScore, weight: HEALTH_WEIGHTS.solvency, label: "Thanh toán & đòn bẩy" },
    { score: altman.score, weight: HEALTH_WEIGHTS.altman, label: "Altman Z'" },
    { score: piotroski.score, weight: HEALTH_WEIGHTS.piotroski, label: "Piotroski F" },
    { score: beneish.score, weight: HEALTH_WEIGHTS.beneish, label: "Beneish M" },
    { score: growthSafetyScore, weight: HEALTH_WEIGHTS.growthSafety, label: "An toàn tăng trưởng" },
  ];
  const active = parts.filter((p) => p.score !== null);
  const totalWeight = active.reduce((sum, p) => sum + p.weight, 0);
  const overall =
    totalWeight === 0 ? 0 : Math.round(active.reduce((sum, p) => sum + (p.score as number) * p.weight, 0) / totalWeight);
  const rating = ratingOf(overall);

  if (altman.zone === "unavailable") warnings.push(altman.verdictVi);
  if (piotroski.evaluated < 9) warnings.push(`Piotroski F-Score chỉ đánh giá được ${piotroski.evaluated}/9 tiêu chí do thiếu dữ liệu.`);
  if (beneish.manipulationRisk === "unavailable") warnings.push(beneish.verdictVi);

  const summary =
    `Sức khỏe tài chính hạng ${rating} (${overall}/100). ` +
    (altman.zScore !== null ? `Altman Z' = ${altman.zScore} (${altman.zoneVi}). ` : "Altman Z' chưa tính được. ") +
    (piotroski.fScore !== null ? `Piotroski F = ${piotroski.fScore}/9. ` : "") +
    (beneish.mScore !== null ? `Beneish M = ${beneish.mScore} (rủi ro điều chỉnh số liệu: ${riskLabelVi(beneish.manipulationRisk)}). ` : "") +
    (flags.length > 0 ? `⚠ ${flags.length} cảnh báo: ${flags.slice(0, 2).join(" ")}` : "Không có cờ cảnh báo mất an toàn tài chính nào.");

  return {
    symbol: ctx.symbol,
    asOfPeriod: ctx.ltm.periodEnd,
    overall,
    rating,
    altman,
    piotroski,
    beneish,
    solvency,
    solvencyScore,
    distressFlags: flags,
    summary,
    warnings,
  };
}

function riskLabelVi(risk: BeneishResult["manipulationRisk"]): string {
  if (risk === "low") return "thấp";
  if (risk === "moderate") return "trung bình";
  if (risk === "high") return "cao";
  return "chưa xác định";
}
