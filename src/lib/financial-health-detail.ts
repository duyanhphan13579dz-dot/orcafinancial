/**
 * Extended Financial Health scoring with richer indicators and per-group
 * textual evaluations in Vietnamese.
 *
 * Weights (sum = 1.00):
 *   Thanh khoản           10%
 *   Đòn bẩy               20%
 *   Hiệu quả hoạt động    15%   ← MỚI: EBITDA margin, asset turnover, inv turnover, DSO
 *   Sinh lời              25%
 *   Tăng trưởng           15%
 *   Dòng tiền             15%
 *
 * Each group returns 0..100 plus a Vietnamese narrative describing what is
 * working and what needs attention.
 */

import type { FinancialQuarter } from "@/lib/financial-statements";

export interface IndicatorDetail {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  /** Score 0..100 for this individual indicator; null means unavailable, never neutral 50. */
  score: number | null;
  /** Short Vietnamese note, e.g. "Tốt", "Cần cải thiện". */
  verdict: string;
}

export interface GroupDetail {
  key: string;
  label: string;
  weight: number;
  score: number;
  weighted: number;
  narrative: string;
  indicators: IndicatorDetail[];
}

export interface HealthDetail {
  symbol: string;
  overall: number;
  rating: string;
  groups: GroupDetail[];
  summary: string;
  asOfPeriod: string;
  dataQuality: { currentStateOnly: true; periodsUsed: number; debtMaturityDisclosed: boolean };
}

const WEIGHTS = {
  liquidity: 0.1,
  leverage: 0.2,
  efficiency: 0.15,
  profitability: 0.25,
  growth: 0.15,
  cashflow: 0.15,
} as const;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function ramp(value: number, bad: number, good: number, higherIsBetter = true): number {
  if (!Number.isFinite(value)) return 0;
  const v = higherIsBetter ? value : -value;
  const b = higherIsBetter ? bad : -bad;
  const g = higherIsBetter ? good : -good;
  return clamp01((v - b) / (g - b));
}

function verdictOf(score: number): string {
  if (score >= 80) return "Rất tốt";
  if (score >= 65) return "Tốt";
  if (score >= 45) return "Trung bình";
  if (score >= 25) return "Yếu";
  return "Rất yếu";
}

function ind(key: string, label: string, value: number | null, unit: string, score01: number | null): IndicatorDetail {
  const validValue = value !== null && Number.isFinite(value) ? value : null;
  const score = validValue === null || score01 == null || !Number.isFinite(score01) ? null : Math.round(clamp01(score01) * 100);
  return { key, label, value: validValue === null ? null : Number(validValue.toFixed(2)), unit, score, verdict: score == null ? "Chưa có dữ liệu" : verdictOf(score) };
}

function scoreAvg(indicators: IndicatorDetail[]): number {
  const scores = indicators.flatMap((indicator) => indicator.score == null ? [] : [indicator.score]);
  return Math.round(avg(scores));
}

export function evaluateHealthDetail(symbol: string, qs: FinancialQuarter[]): HealthDetail {
  const latest = qs[0];
  const prev = qs[1];
  const yearAgo = qs.find((quarter) => quarter.quarter === latest?.quarter && quarter.fiscalYear === (latest?.fiscalYear ?? 0) - 1);
  const ytd = qs.filter((quarter) => quarter.fiscalYear === latest?.fiscalYear && quarter.quarter <= (latest?.quarter ?? 0));
  if (!latest) {
    return { symbol, overall: 0, rating: "E", groups: [], summary: "Không đủ dữ liệu để đánh giá.", asOfPeriod: "—", dataQuality: { currentStateOnly: true, periodsUsed: 0, debtMaturityDisclosed: false } };
  }
  const inc = latest.income;
  const bal = latest.balance;
  const cf = latest.cashflow;
  const averageEquity = prev ? (bal.equity + prev.balance.equity) / 2 : bal.equity;
  const averageAssets = prev ? (bal.totalAssets + prev.balance.totalAssets) / 2 : bal.totalAssets;

  // Derived indicators
  const currentRatio = bal.currentLiabilities > 0 ? bal.currentAssets / bal.currentLiabilities : null;
  const quickRatio = bal.currentLiabilities > 0 ? (bal.currentAssets - bal.inventory) / bal.currentLiabilities : null;
  const cashRatio = bal.currentLiabilities > 0 ? bal.cashAndEquivalents / bal.currentLiabilities : null;

  const debtEquity = bal.equity > 0 ? bal.totalLiabilities / bal.equity : null;
  const debtToAssets = bal.totalAssets > 0 ? bal.totalLiabilities / bal.totalAssets : null;
  const interestCoverage = inc.interestExpense > 0 ? inc.operatingIncome / inc.interestExpense : null;

  const ebitdaMargin = inc.revenue > 0 ? inc.ebitda / inc.revenue : null;
  const assetTurnover = bal.totalAssets > 0 ? (inc.revenue * 4) / bal.totalAssets : null; // annualised
  const inventoryTurnover = bal.inventory > 0 && inc.revenue > 0 ? (inc.costOfGoodsSold * 4) / bal.inventory : null;
  const dso = inc.revenue > 0 && bal.receivables > 0 ? (bal.receivables / (inc.revenue * 4)) * 365 : null;

  const roe = averageEquity > 0 ? (inc.netIncome * 4) / averageEquity * 100 : null; // annualised %
  const roa = averageAssets > 0 ? (inc.netIncome * 4) / averageAssets * 100 : null;
  const netMargin = inc.revenue > 0 ? inc.netIncome / inc.revenue * 100 : null;
  const grossMargin = inc.revenue > 0 ? inc.grossProfit / inc.revenue * 100 : null;

  const revGrowth = prev && prev.income.revenue > 0 ? (inc.revenue / prev.income.revenue - 1) * 100 : null;
  const niGrowth = prev && Math.abs(prev.income.netIncome) > 0 ? (inc.netIncome / prev.income.netIncome - 1) * 100 : null;
  const ebitdaGrowth = prev && prev.income.ebitda > 0 ? (inc.ebitda / prev.income.ebitda - 1) * 100 : null;

  const fcfMargin = inc.revenue > 0 ? cf.freeCashFlow / inc.revenue * 100 : null;
  const cfoToNi = Math.abs(inc.netIncome) > 0 ? cf.operatingCashFlow / inc.netIncome : null;
  const dividendPayout = Math.abs(inc.netIncome) > 0 ? cf.dividendsPaid / inc.netIncome : null;
  const fcfConversion = Math.abs(inc.netIncome) > 0 ? cf.freeCashFlow / inc.netIncome : null;
  const netDebt = bal.totalLiabilities - bal.cashAndEquivalents - bal.shortTermInvestments;
  const netDebtToEbitda = inc.ebitda > 0 ? netDebt / (inc.ebitda * 4) : null;
  const investedCapital = bal.equity + bal.longTermDebt - bal.cashAndEquivalents - bal.shortTermInvestments;
  const roic = investedCapital > 0 ? (inc.operatingIncome * 4 * (1 - 0.2)) / investedCapital * 100 : null;
  const workingCapitalIntensity = inc.revenue > 0 ? (bal.receivables + bal.inventory - bal.currentLiabilities) / inc.revenue * 100 : null;
  const debtDueWithin12m = bal.debtDueWithin12m ?? bal.shortTermDebt ?? null;
  const debtMaturityCoverage = debtDueWithin12m !== null ? (bal.cashAndEquivalents + cf.operatingCashFlow) / Math.max(debtDueWithin12m, 1) : null;
  const revGrowthYoY = yearAgo && yearAgo.income.revenue > 0 ? (inc.revenue / yearAgo.income.revenue - 1) * 100 : null;
  const niGrowthYoY = yearAgo && Math.abs(yearAgo.income.netIncome) > 0 ? (inc.netIncome / yearAgo.income.netIncome - 1) * 100 : null;
  const ytdRevenue = ytd.length > 0 ? ytd.reduce((sum, quarter) => sum + quarter.income.revenue, 0) : null;
  const ytdNetIncome = ytd.length > 0 ? ytd.reduce((sum, quarter) => sum + quarter.income.netIncome, 0) : null;

  // ── Liquidity ──
  const liqInds: IndicatorDetail[] = [
    ind("currentRatio", "Tỷ số thanh toán hiện hành", currentRatio, "lần", currentRatio !== null ? ramp(currentRatio, 0.8, 2.0) : null),
    ind("quickRatio", "Tỷ số thanh toán nhanh", quickRatio, "lần", quickRatio !== null ? ramp(quickRatio, 0.5, 1.5) : null),
    ind("cashRatio", "Tỷ số tiền / nợ ngắn hạn", cashRatio, "lần", cashRatio !== null ? ramp(cashRatio, 0.05, 0.4) : null),
  ];
  const liqScore = scoreAvg(liqInds);
  const liqNarrative = liqScore >= 70
    ? "Khả năng thanh toán ngắn hạn vững chắc; quỹ tiền mặt đủ che nợ đến hạn trong nhiều tháng."
    : liqScore >= 45
      ? "Thanh khoản ở mức chấp nhận được; cần theo dõi hàng tồn kho và khoản phải thu để tránh áp lực dòng tiền."
      : "Thanh khoản mỏng; tỷ số tiền mặt trên nợ ngắn hạn thấp — rủi ro khi thị trường tín dụng thắt chặt.";

  // ── Leverage ──
  const levInds: IndicatorDetail[] = [
    ind("debtEquity", "Nợ / Vốn chủ sở hữu", debtEquity, "lần", debtEquity !== null ? ramp(debtEquity, 2.0, 0.4, false) : null),
    ind("debtToAssets", "Nợ / Tổng tài sản", debtToAssets, "%", debtToAssets !== null ? ramp(debtToAssets * 100, 80, 30, false) : null),
    ind("interestCoverage", "EBIT / Lãi vay", interestCoverage, "lần", interestCoverage !== null ? ramp(interestCoverage, 1.5, 8) : null),
    ind("netDebtToEbitda", "Nợ ròng / EBITDA năm hóa", netDebtToEbitda, "lần", netDebtToEbitda !== null ? ramp(netDebtToEbitda, 4, 0.5, false) : null),
    ind("debtMaturityCoverage", "Tiền + OCF / nợ đáo hạn 12 tháng", debtMaturityCoverage, "lần", debtMaturityCoverage !== null ? ramp(debtMaturityCoverage, 0.8, 2.5) : null),
  ];
  const levScore = scoreAvg(levInds);
  const levNarrative = levScore >= 70
    ? "Đòn bẩy tài chính thấp, chi phí lãi vay được che phủ nhiều lần bởi lợi nhuận hoạt động — dư địa vay thêm để mở rộng vẫn lớn."
    : levScore >= 45
      ? "Đòn bẩy ở mức trung bình ngành; cần duy trì EBIT ổn định để đảm bảo nghĩa vụ trả lãi."
      : "Đòn bẩy cao, khả năng trả lãi mỏng — rủi ro lớn nếu lãi suất thị trường tăng hoặc EBIT suy giảm.";

  // ── Efficiency (MỚI) ──
  const effInds: IndicatorDetail[] = [
    ind("ebitdaMargin", "Biên EBITDA", ebitdaMargin !== null ? ebitdaMargin * 100 : null, "%", ebitdaMargin !== null ? ramp(ebitdaMargin, 0.05, 0.30) : null),
    ind("assetTurnover", "Vòng quay tổng tài sản", assetTurnover, "vòng/năm", assetTurnover !== null ? ramp(assetTurnover, 0.3, 1.5) : null),
    ind("inventoryTurnover", "Vòng quay hàng tồn kho", inventoryTurnover, "vòng/năm", inventoryTurnover !== null ? ramp(inventoryTurnover, 2, 10) : null),
    ind("dso", "Ngày phải thu bình quân", dso, "ngày", dso !== null ? ramp(dso, 120, 30, false) : null),
  ];
  const effScore = scoreAvg(effInds);
  const effNarrative = effScore >= 70
    ? "Hiệu quả vận hành nổi bật: biên EBITDA cao, tài sản quay vòng nhanh, tồn kho và công nợ được quản lý chặt."
    : effScore >= 45
      ? "Hiệu quả ở mức trung bình; một trong các chỉ số (tồn kho, phải thu hoặc biên EBITDA) cần được cải thiện để giải phóng vốn lưu động."
      : "Hiệu quả vận hành yếu: biên mỏng, tồn kho ứ đọng hoặc kỳ thu tiền kéo dài — ảnh hưởng trực tiếp tới dòng tiền.";

  // ── Profitability ──
  const profInds: IndicatorDetail[] = [
    ind("roe", "ROE (năm hoá)", roe, "%", roe !== null ? ramp(roe, 5, 22) : null),
    ind("roa", "ROA (năm hoá)", roa, "%", roa !== null ? ramp(roa, 2, 12) : null),
    ind("netMargin", "Biên lợi nhuận ròng", netMargin, "%", netMargin !== null ? ramp(netMargin, 3, 18) : null),
    ind("grossMargin", "Biên lợi nhuận gộp", grossMargin, "%", grossMargin !== null ? ramp(grossMargin, 10, 45) : null),
    ind("roic", "ROIC (năm hoá)", roic, "%", roic !== null ? ramp(roic, 4, 18) : null),
  ];
  const profScore = scoreAvg(profInds);
  const profNarrative = profScore >= 70
    ? "Sức sinh lời vượt trội: ROE ở nhóm dẫn đầu ngành, biên gộp và biên ròng ổn định qua nhiều quý."
    : profScore >= 45
      ? "Khả năng sinh lời chấp nhận được nhưng chưa bền vững; cần theo dõi biên gộp khi giá đầu vào biến động."
      : "Sinh lời yếu; ROE và biên ròng thấp hơn chi phí vốn — doanh nghiệp đang phá huỷ giá trị về mặt kinh tế.";

  // ── Growth ──
  const growthInds: IndicatorDetail[] = [
    ind("revGrowthQoQ", "Tăng trưởng doanh thu QoQ", revGrowth, "%", revGrowth !== null ? ramp(revGrowth, -5, 15) : null),
    ind("niGrowthQoQ", "Tăng trưởng LN ròng QoQ", niGrowth, "%", niGrowth !== null ? ramp(niGrowth, -10, 25) : null),
    ind("ebitdaGrowthQoQ", "Tăng trưởng EBITDA QoQ", ebitdaGrowth, "%", ebitdaGrowth !== null ? ramp(ebitdaGrowth, -5, 20) : null),
    ind("revGrowthYoY", "Tăng trưởng doanh thu YoY", revGrowthYoY, "%", revGrowthYoY !== null ? ramp(revGrowthYoY, -10, 20) : null),
    ind("niGrowthYoY", "Tăng trưởng LN ròng YoY", niGrowthYoY, "%", niGrowthYoY !== null ? ramp(niGrowthYoY, -20, 30) : null),
    ind("ytdRevenue", "Doanh thu YTD", ytdRevenue, "tỷ", ytdRevenue !== null ? ramp(ytdRevenue, 0, Math.max(1, inc.revenue * 4)) : null),
    ind("ytdNetIncome", "LN ròng YTD", ytdNetIncome, "tỷ", ytdNetIncome !== null ? ramp(ytdNetIncome, 0, Math.max(1, Math.abs(inc.netIncome) * 4)) : null),
  ];
  const growthScore = scoreAvg(growthInds);
  const growthNarrative = growthScore >= 70
    ? "Đà tăng trưởng mạnh và đồng đều ở cả doanh thu lẫn lợi nhuận — động lực chính cho định giá lại cổ phiếu."
    : growthScore >= 45
      ? "Tăng trưởng ở mức vừa phải; một số chỉ số đi ngang hoặc giảm nhẹ — cần quan sát thêm 1-2 quý."
      : "Tăng trưởng âm hoặc trì trệ; thị phần có thể đang bị bào mòn hoặc doanh nghiệp đang trong chu kỳ suy giảm.";

  // ── Cashflow ──
  const payoutScore = dividendPayout === null ? null : clamp01(1 - Math.abs(dividendPayout - 0.5) / 0.5);
  const cfInds: IndicatorDetail[] = [
    ind("fcfMargin", "Biên dòng tiền tự do", fcfMargin, "%", fcfMargin !== null ? ramp(fcfMargin, -5, 15) : null),
    ind("cfoToNi", "OCF / Lợi nhuận ròng", cfoToNi, "lần", cfoToNi !== null ? ramp(cfoToNi, 0.5, 1.3) : null),
    ind("dividendPayout", "Tỷ lệ chi trả cổ tức", dividendPayout, "%", payoutScore),
    ind("fcfConversion", "FCF / Lợi nhuận ròng", fcfConversion, "lần", fcfConversion !== null ? ramp(fcfConversion, 0.3, 1.1) : null),
    ind("workingCapitalIntensity", "Vốn lưu động / doanh thu", workingCapitalIntensity, "%", workingCapitalIntensity !== null ? ramp(workingCapitalIntensity, 35, 10, false) : null),
  ];
  const cfScore = scoreAvg(cfInds);
  const cfNarrative = cfScore >= 70
    ? "Dòng tiền tự do dồi dào, chất lượng lợi nhuận cao; chính sách cổ tức ổn định tạo sức hấp dẫn dài hạn."
    : cfScore >= 45
      ? "Dòng tiền ở mức trung bình; cần theo dõi chênh lệch giữa lợi nhuận kế toán và dòng tiền thực để đánh giá chất lượng LN."
      : "Dòng tiền yếu hoặc âm; lợi nhuận kế toán chưa chuyển hoá thành tiền mặt — rủi ro về tính bền vững của kết quả kinh doanh.";

  const groups: GroupDetail[] = [
    mkGroup("liquidity", "Thanh khoản", WEIGHTS.liquidity, liqScore, liqNarrative, liqInds),
    mkGroup("leverage", "Đòn bẩy", WEIGHTS.leverage, levScore, levNarrative, levInds),
    mkGroup("efficiency", "Hiệu quả hoạt động", WEIGHTS.efficiency, effScore, effNarrative, effInds),
    mkGroup("profitability", "Sinh lời", WEIGHTS.profitability, profScore, profNarrative, profInds),
    mkGroup("growth", "Tăng trưởng", WEIGHTS.growth, growthScore, growthNarrative, growthInds),
    mkGroup("cashflow", "Dòng tiền", WEIGHTS.cashflow, cfScore, cfNarrative, cfInds),
  ];

  const overall = Math.round(groups.reduce((s, g) => s + g.weighted, 0));
  const rating = overall >= 80 ? "A" : overall >= 65 ? "B" : overall >= 45 ? "C" : overall >= 25 ? "D" : "E";

  // Overall summary — picks top 2 strengths + top 1 weakness
  const sorted = [...groups].sort((a, b) => b.score - a.score);
  const strengths = sorted.slice(0, 2).map((g) => g.label.toLowerCase());
  const weakness = sorted[sorted.length - 1];
  const summary = `Đánh giá tổng thể ${rating} (${overall}/100). Điểm mạnh nổi bật ở ${strengths.join(" và ")}. ${
    weakness.score < 50
      ? `Nhóm ${weakness.label.toLowerCase()} cần được cải thiện (${weakness.score}/100) — ${weakness.narrative.slice(0, 120)}`
      : "Không có nhóm nào ở mức báo động; doanh nghiệp cân bằng trên cả 6 khía cạnh."
  }`;

  return { symbol, overall, rating, groups, summary, asOfPeriod: latest.period, dataQuality: { currentStateOnly: true, periodsUsed: qs.length, debtMaturityDisclosed: Boolean(debtDueWithin12m !== null || bal.debtMaturityBuckets) } };
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function mkGroup(
  key: string,
  label: string,
  weight: number,
  score: number,
  narrative: string,
  indicators: IndicatorDetail[],
): GroupDetail {
  return { key, label, weight, score, weighted: Number((score * weight).toFixed(2)), narrative, indicators };
}
