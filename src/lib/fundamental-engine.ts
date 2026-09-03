/**
 * Fundamental Engine — lõi chuẩn hoá kỳ báo cáo & khung số liệu tài chính.
 *
 * Vấn đề mà module này giải quyết:
 *  1. BCTC quý của doanh nghiệp VN có thể được trình bày **luỹ kế (YTD)** hoặc
 *     **riêng từng quý (standalone)**. Nhân quý mới nhất với 4 (cách làm cũ) sẽ
 *     sai hoàn toàn khi dữ liệu là luỹ kế (Q3 luỹ kế ×4 ≈ 3 lần doanh thu năm).
 *  2. Nhiều chỉ số cần mẫu số là **bình quân số dư** (equity, total assets...) của
 *     đầu kỳ / cuối kỳ LTM chứ không phải số dư quý gần nhất.
 *  3. Toàn bộ chỉ số phải phân biệt được "thiếu dữ liệu" (null) với "giá trị 0".
 *
 * Module này **thuần tuý** (không I/O, không DB) → test được, cache được, nhanh.
 *
 * Quy ước đơn vị (nhất quán toàn bộ engine):
 *  - Số tiền trên BCTC : tỷ VND
 *  - Giá / EPS / BVPS  : nghìn VND
 *  - Khối lượng CP     : triệu cổ phiếu
 *  ⇒ Vốn hoá (tỷ VND) = giá (nghìn VND) × số CP (triệu)
 *  ⇒ EPS (nghìn VND)  = LN ròng (tỷ VND) / số CP (triệu)
 */

import type { BalanceData, CashflowData, FinancialQuarter, IncomeData } from "@/lib/financial-statements";

/* ────────────────────────────────────────────────────────────
 * 1. Số học an toàn (null-safe)
 * ──────────────────────────────────────────────────────────── */

export type Num = number | null;

/** Trả về số hợp lệ, ngược lại null (không bao giờ trả 0 thay cho "thiếu"). */
export function n(value: unknown): Num {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Lấy một trường số từ object dữ liệu thô; thiếu/NaN → null. */
export function field(source: unknown, key: string): Num {
  if (!source || typeof source !== "object") return null;
  return n((source as Record<string, unknown>)[key]);
}

/** Số dương (>0) hoặc null. */
export function positive(value: Num): Num {
  return value !== null && value > 0 ? value : null;
}

/** Số khác 0 hoặc null. */
export function nonZero(value: Num): Num {
  return value !== null && value !== 0 ? value : null;
}

/** a / b, null khi thiếu dữ liệu hoặc mẫu ≤ 0. */
export function ratio(a: Num, b: Num): Num {
  if (a === null || b === null || b === 0) return null;
  const value = a / b;
  return Number.isFinite(value) ? value : null;
}

/** a / b nhưng chỉ yêu cầu b ≠ 0 (cho phép mẫu âm, ví dụ VCSH âm). */
export function ratioSigned(a: Num, b: Num): Num {
  return ratio(a, b);
}

/** Tăng trưởng % = (cur/prev − 1) × 100; null khi prev ≤ 0 (không có ý nghĩa). */
export function growthPct(current: Num, previous: Num): Num {
  if (current === null || previous === null || previous <= 0) return null;
  return (current / previous - 1) * 100;
}

/** Tăng trưởng % chấp nhận gốc âm (dùng cho LN ròng lỗ → lãi). */
export function growthPctSigned(current: Num, previous: Num): Num {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** CAGR % = ((end/start)^(1/years) − 1) × 100. */
export function cagrPct(start: Num, end: Num, years: number): Num {
  if (start === null || end === null || years <= 0) return null;
  if (start <= 0 || end <= 0) return null;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

/** Bình quân 2 giá trị; null khi cả hai đều thiếu. */
export function average(a: Num, b: Num): Num {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return (a + b) / 2;
}

/** Bình quân nhiều giá trị, bỏ qua null. */
export function averageAll(values: Num[]): Num {
  const valid = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

export function round(value: Num, digits = 2): Num {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

export function clamp(value: Num, min: number, max: number): Num {
  if (value === null) return null;
  return Math.max(min, Math.min(max, value));
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Thang điểm tuyến tính 0..1 giữa ngưỡng "xấu" và "tốt".
 * higherIsBetter=false dùng cho chỉ số càng thấp càng tốt (D/E, DSO...).
 */
export function ramp(value: Num, bad: number, good: number, higherIsBetter = true): Num {
  if (value === null || !Number.isFinite(value)) return null;
  const v = higherIsBetter ? value : -value;
  const b = higherIsBetter ? bad : -bad;
  const g = higherIsBetter ? good : -good;
  if (g === b) return null;
  return clamp01((v - b) / (g - b));
}

export function scoreOf(value: Num): number | null {
  if (value === null) return null;
  return Math.round(clamp01(value) * 100);
}

export function verdictOf(score: number | null): string {
  if (score === null) return "Chưa có dữ liệu";
  if (score >= 80) return "Rất tốt";
  if (score >= 65) return "Tốt";
  if (score >= 45) return "Trung bình";
  if (score >= 25) return "Yếu";
  return "Rất yếu";
}

export function ratingOf(overall: number): string {
  if (overall >= 80) return "A";
  if (overall >= 65) return "B";
  if (overall >= 45) return "C";
  if (overall >= 25) return "D";
  return "E";
}

/* ────────────────────────────────────────────────────────────
 * 2. Chuẩn hoá kỳ báo cáo: luỹ kế (YTD) vs riêng quý
 * ──────────────────────────────────────────────────────────── */

export type StatementBasis = "standalone" | "cumulative-ytd" | "unknown";

export interface QuarterKey {
  fiscalYear: number;
  quarter: number;
}

export interface NormalizedQuarter extends QuarterKey {
  period: string; // "Q1/2026"
  /** Số liệu dòng (income/cashflow) của RIÊNG quý này. */
  income: Partial<IncomeData>;
  cashflow: Partial<CashflowData>;
  /** Số dư cuối kỳ (không cộng dồn). */
  balance: Partial<BalanceData>;
  raw: FinancialQuarter;
}

export function periodIndex(year: number, quarter: number): number {
  return year * 4 + (quarter - 1);
}

export function sortQuartersNewestFirst(quarters: FinancialQuarter[]): FinancialQuarter[] {
  return [...quarters].sort(
    (a, b) => periodIndex(b.fiscalYear, b.quarter) - periodIndex(a.fiscalYear, a.quarter),
  );
}

export function sortQuartersOldestFirst(quarters: FinancialQuarter[]): FinancialQuarter[] {
  return [...quarters].sort(
    (a, b) => periodIndex(a.fiscalYear, a.quarter) - periodIndex(b.fiscalYear, b.quarter),
  );
}

/**
 * Phát hiện cơ sở trình bày của BCTC.
 *
 * Logic: trong cùng một năm tài chính, nếu dòng tiền/doanh thu của quý sau luôn
 * ≥ quý trước (và có ít nhất 2 cặp so sánh, trong đó có cặp tăng rõ rệt) thì đó
 * là số **luỹ kế** — vì một quý riêng lẻ không thể luôn tăng đều như vậy.
 *
 * Có thể ép bằng biến môi trường FINANCIAL_STATEMENT_BASIS.
 */
export function detectStatementBasis(
  quarters: FinancialQuarter[],
  override?: StatementBasis,
): StatementBasis {
  if (override === "standalone" || override === "cumulative-ytd") return override;
  const forced = (process.env.FINANCIAL_STATEMENT_BASIS ?? "").trim().toLowerCase();
  if (forced === "standalone" || forced === "cumulative-ytd" || forced === "cumulative") {
    return forced === "cumulative" ? "cumulative-ytd" : (forced as StatementBasis);
  }

  const ascending = sortQuartersOldestFirst(quarters);
  if (ascending.length < 3) return "unknown";

  let pairs = 0;
  let nonDecreasing = 0;
  let strictlyIncreasing = 0;
  let decreasing = 0;

  for (let i = 1; i < ascending.length; i++) {
    const prev = ascending[i - 1];
    const curr = ascending[i];
    // Chỉ so sánh 2 quý liền kề trong CÙNG một năm tài chính.
    if (prev.fiscalYear !== curr.fiscalYear) continue;
    if (curr.quarter !== prev.quarter + 1) continue;
    const prevRevenue = field(prev.income, "revenue");
    const currRevenue = field(curr.income, "revenue");
    if (prevRevenue === null || currRevenue === null || prevRevenue <= 0) continue;
    pairs += 1;
    if (currRevenue >= prevRevenue) nonDecreasing += 1;
    if (currRevenue > prevRevenue * 1.05) strictlyIncreasing += 1;
    if (currRevenue < prevRevenue * 0.95) decreasing += 1;
  }

  if (pairs < 2) return "unknown";
  if (nonDecreasing === pairs && strictlyIncreasing >= Math.max(1, Math.floor(pairs / 2))) {
    return "cumulative-ytd";
  }
  if (decreasing > 0) return "standalone";
  return "unknown";
}

function subtractFlow<T extends Record<string, unknown>>(
  current: Partial<T>,
  previous: Partial<T>,
  keys: readonly string[],
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const a = n(current[key]);
    const b = n(previous[key]);
    if (a === null) continue;
    out[key] = b === null ? a : a - b;
  }
  return out as Partial<T>;
}

const INCOME_FLOW_KEYS = [
  "revenue",
  "costOfGoodsSold",
  "grossProfit",
  "operatingExpenses",
  "operatingIncome",
  "interestExpense",
  "otherIncome",
  "pretaxIncome",
  "incomeTax",
  "netIncome",
  "ebitda",
  "depreciation",
  "eps",
] as const;

const CASHFLOW_FLOW_KEYS = [
  "netIncome",
  "depreciation",
  "changeWorkingCapital",
  "operatingCashFlow",
  "capex",
  "investingCashFlow",
  "debtIssuance",
  "dividendsPaid",
  "financingCashFlow",
  "netChangeCash",
  "freeCashFlow",
] as const;

/**
 * Chuyển BCTC luỹ kế về số riêng từng quý.
 * Công thức: Riêng(Qn) = Luỹ kế(Qn) − Luỹ kế(Qn−1); Riêng(Q1) = Luỹ kế(Q1).
 * Bảng cân đối kế toán là số dư thời điểm nên giữ nguyên.
 */
export function toStandaloneQuarters(
  quarters: FinancialQuarter[],
  basis: StatementBasis,
): NormalizedQuarter[] {
  const ascending = sortQuartersOldestFirst(quarters);
  const byIndex = new Map<number, FinancialQuarter>();
  for (const q of ascending) byIndex.set(periodIndex(q.fiscalYear, q.quarter), q);

  return ascending.map((q) => {
    const idx = periodIndex(q.fiscalYear, q.quarter);
    const previous = byIndex.get(idx - 1);
    const needUnwind =
      basis === "cumulative-ytd" && q.quarter > 1 && previous && previous.fiscalYear === q.fiscalYear;

    const income = needUnwind
      ? subtractFlow(q.income as unknown as Record<string, unknown>, previous.income as unknown as Record<string, unknown>, INCOME_FLOW_KEYS)
      : (q.income as Partial<IncomeData>);
    const cashflow = needUnwind
      ? subtractFlow(q.cashflow as unknown as Record<string, unknown>, previous.cashflow as unknown as Record<string, unknown>, CASHFLOW_FLOW_KEYS)
      : (q.cashflow as Partial<CashflowData>);

    return {
      fiscalYear: q.fiscalYear,
      quarter: q.quarter,
      period: q.period ?? `Q${q.quarter}/${q.fiscalYear}`,
      income,
      cashflow,
      balance: q.balance as Partial<BalanceData>,
      raw: q,
    } satisfies NormalizedQuarter;
  });
}

/* ────────────────────────────────────────────────────────────
 * 3. Cửa sổ LTM (Last Twelve Months)
 * ──────────────────────────────────────────────────────────── */

export type LtmMethod = "sum-4q" | "ytd-plus-fy-minus-pytd" | "annualized-ytd" | "full-year" | "unavailable";

export interface LtmWindow {
  periodEnd: string;
  periodEndVi: string;
  method: LtmMethod;
  /** Số quý thực sự đóng góp vào LTM. */
  quartersUsed: number;
  coverage: number; // quartersUsed / 4
  /** true khi LTM được nội suy (nhân hệ số), không phải số thực đủ 12 tháng. */
  annualized: boolean;
  scale: number;
  income: Partial<IncomeData>;
  cashflow: Partial<CashflowData>;
  /** Kỳ LTM liền trước (để tính tăng trưởng LTM YoY). */
  previous: { periodEnd: string; income: Partial<IncomeData>; cashflow: Partial<CashflowData> } | null;
  warnings: string[];
}

function sumFlows<T extends Record<string, unknown>>(items: Array<Partial<T>>, keys: readonly string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    let sum = 0;
    let seen = false;
    for (const item of items) {
      const value = n(item[key]);
      if (value !== null) {
        sum += value;
        seen = true;
      }
    }
    if (seen) out[key] = sum;
  }
  return out as Partial<T>;
}

function flowDelta<T extends Record<string, unknown>>(
  a: Partial<T>,
  b: Partial<T>,
  keys: readonly string[],
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const av = n(a[key]);
    const bv = n(b[key]);
    if (av === null || bv === null) continue;
    out[key] = av - bv;
  }
  return out as Partial<T>;
}

function flowCombine<T extends Record<string, unknown>>(
  parts: Array<Partial<T>>,
  keys: readonly string[],
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    let total: Num = null;
    for (const part of parts) {
      const value = n(part[key]);
      if (value === null) continue;
      total = (total ?? 0) + value;
    }
    if (total !== null) out[key] = total;
  }
  return out as Partial<T>;
}

function periodVi(year: number, quarter: number): string {
  return `Quý ${quarter} / ${year} (LTM)`;
}

/**
 * Xây dựng cửa sổ LTM — 12 tháng gần nhất kết thúc tại kỳ mới nhất.
 *
 * Ưu tiên:
 *  1. `sum-4q`                 : tổng 4 quý riêng lẻ liên tiếp   → chính xác nhất
 *  2. `ytd-plus-fy-minus-pytd` : LTM = FY(năm trước) + YTD(năm nay) − YTD(cùng kỳ năm trước)
 *  3. `annualized-ytd`         : YTD × 4/số quý đã qua           → nội suy, có cảnh báo
 *  4. `full-year`              : kỳ mới nhất là Q4 → chính là cả năm
 */
export function buildLtmWindow(
  normalized: NormalizedQuarter[],
  options: { maxQuarters?: number } = {},
): LtmWindow {
  const warnings: string[] = [];
  const descending = [...normalized].sort(
    (a, b) => periodIndex(b.fiscalYear, b.quarter) - periodIndex(a.fiscalYear, a.quarter),
  );
  const latest = descending[0];
  if (!latest) {
    return {
      periodEnd: "—",
      periodEndVi: "—",
      method: "unavailable",
      quartersUsed: 0,
      coverage: 0,
      annualized: false,
      scale: 1,
      income: {},
      cashflow: {},
      previous: null,
      warnings: ["Không có kỳ báo cáo nào để dựng cửa sổ LTM."],
    };
  }

  const byIndex = new Map<number, NormalizedQuarter>();
  for (const q of descending) byIndex.set(periodIndex(q.fiscalYear, q.quarter), q);

  const latestIdx = periodIndex(latest.fiscalYear, latest.quarter);
  const periodEnd = latest.period;
  const periodEndVi = periodVi(latest.fiscalYear, latest.quarter);

  const slice = (fromIdx: number, count: number): NormalizedQuarter[] => {
    const out: NormalizedQuarter[] = [];
    for (let i = 0; i < count; i++) {
      const q = byIndex.get(fromIdx - i);
      if (q) out.push(q);
    }
    return out;
  };

  // (1) 4 quý riêng lẻ liên tiếp
  const last4 = slice(latestIdx, 4);
  const contiguous4 = last4.length === 4 && last4.every((q, i) => periodIndex(q.fiscalYear, q.quarter) === latestIdx - i);
  const previous4 = slice(latestIdx - 4, 4);
  const contiguousPrev4 = previous4.length === 4 && previous4.every((q, i) => periodIndex(q.fiscalYear, q.quarter) === latestIdx - 4 - i);

  if (contiguous4) {
    return {
      periodEnd,
      periodEndVi,
      method: "sum-4q",
      quartersUsed: 4,
      coverage: 1,
      annualized: false,
      scale: 1,
      income: sumFlows(last4.map((q) => q.income), INCOME_FLOW_KEYS),
      cashflow: sumFlows(last4.map((q) => q.cashflow), CASHFLOW_FLOW_KEYS),
      previous: contiguousPrev4
        ? {
            periodEnd: previous4[0].period,
            income: sumFlows(previous4.map((q) => q.income), INCOME_FLOW_KEYS),
            cashflow: sumFlows(previous4.map((q) => q.cashflow), CASHFLOW_FLOW_KEYS),
          }
        : null,
      warnings,
    };
  }

  // (2) LTM = FY(n−1) + YTD(n) − YTD(n−1)
  const year = latest.fiscalYear;
  const qn = latest.quarter;
  const ytdNow = slice(latestIdx, qn).filter((q) => q.fiscalYear === year && q.quarter <= qn);
  const ytdNowComplete = ytdNow.length === qn;
  const fyPrev = slice(periodIndex(year - 1, 4), 4).filter((q) => q.fiscalYear === year - 1);
  const fyPrevComplete = fyPrev.length === 4;
  const ytdPrev = slice(periodIndex(year - 1, qn), qn).filter((q) => q.fiscalYear === year - 1 && q.quarter <= qn);
  const ytdPrevComplete = ytdPrev.length === qn;

  if (ytdNowComplete && fyPrevComplete && ytdPrevComplete && qn < 4) {
    const income = flowCombine(
      [
        sumFlows(fyPrev.map((q) => q.income), INCOME_FLOW_KEYS),
        sumFlows(ytdNow.map((q) => q.income), INCOME_FLOW_KEYS),
        flowDelta(
          {} as Partial<IncomeData>,
          sumFlows(ytdPrev.map((q) => q.income), INCOME_FLOW_KEYS),
          INCOME_FLOW_KEYS,
        ),
      ],
      INCOME_FLOW_KEYS,
    );
    const cashflow = flowCombine(
      [
        sumFlows(fyPrev.map((q) => q.cashflow), CASHFLOW_FLOW_KEYS),
        sumFlows(ytdNow.map((q) => q.cashflow), CASHFLOW_FLOW_KEYS),
        flowDelta(
          {} as Partial<CashflowData>,
          sumFlows(ytdPrev.map((q) => q.cashflow), CASHFLOW_FLOW_KEYS),
          CASHFLOW_FLOW_KEYS,
        ),
      ],
      CASHFLOW_FLOW_KEYS,
    );
    return {
      periodEnd,
      periodEndVi,
      method: "ytd-plus-fy-minus-pytd",
      quartersUsed: 4,
      coverage: 1,
      annualized: false,
      scale: 1,
      income,
      cashflow,
      previous: null,
      warnings,
    };
  }

  // (4) Kỳ mới nhất là Q4 → chính là số cả năm
  if (ytdNowComplete && qn === 4) {
    const priorYear = slice(periodIndex(year - 1, 4), 4).filter((q) => q.fiscalYear === year - 1);
    const priorComplete = priorYear.length === 4;
    return {
      periodEnd,
      periodEndVi,
      method: "full-year",
      quartersUsed: 4,
      coverage: 1,
      annualized: false,
      scale: 1,
      income: sumFlows(ytdNow.map((q) => q.income), INCOME_FLOW_KEYS),
      cashflow: sumFlows(ytdNow.map((q) => q.cashflow), CASHFLOW_FLOW_KEYS),
      previous: priorComplete
        ? {
            periodEnd: priorYear[0].period,
            income: sumFlows(priorYear.map((q) => q.income), INCOME_FLOW_KEYS),
            cashflow: sumFlows(priorYear.map((q) => q.cashflow), CASHFLOW_FLOW_KEYS),
          }
        : null,
      warnings,
    };
  }

  // (3) Nội suy YTD về 12 tháng
  if (ytdNowComplete && qn > 0 && qn < 4) {
    const scale = 4 / qn;
    warnings.push(
      `Chỉ có ${qn} quý của năm ${year}; LTM được nội suy bằng YTD × ${scale.toFixed(2)} — chưa phản ánh yếu tố mùa vụ.`,
    );
    const ytdIncome = sumFlows(ytdNow.map((q) => q.income), INCOME_FLOW_KEYS);
    const ytdCashflow = sumFlows(ytdNow.map((q) => q.cashflow), CASHFLOW_FLOW_KEYS);
    const scaledIncome: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ytdIncome)) scaledIncome[key] = (value as number) * scale;
    const scaledCashflow: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ytdCashflow)) scaledCashflow[key] = (value as number) * scale;
    return {
      periodEnd,
      periodEndVi,
      method: "annualized-ytd",
      quartersUsed: qn,
      coverage: qn / 4,
      annualized: true,
      scale,
      income: scaledIncome as Partial<IncomeData>,
      cashflow: scaledCashflow as Partial<CashflowData>,
      previous: null,
      warnings,
    };
  }

  warnings.push("Không đủ 4 quý liên tiếp để dựng LTM chuẩn; nhiều chỉ số năm hoá sẽ bị bỏ trống.");
  return {
    periodEnd,
    periodEndVi,
    method: "unavailable",
    quartersUsed: last4.length,
    coverage: last4.length / 4,
    annualized: false,
    scale: 1,
    income: sumFlows(last4.map((q) => q.income), INCOME_FLOW_KEYS),
    cashflow: sumFlows(last4.map((q) => q.cashflow), CASHFLOW_FLOW_KEYS),
    previous: null,
    warnings,
  };
}

/* ────────────────────────────────────────────────────────────
 * 4. Số dư bình quân (mẫu số chuẩn cho ROE / ROA / ROIC)
 * ──────────────────────────────────────────────────────────── */

export interface BalanceAverages {
  equity: Num;
  totalAssets: Num;
  inventory: Num;
  receivables: Num;
  payables: Num;
  fixedAssets: Num;
  investedCapital: Num;
  interestBearingDebt: Num;
  /** true khi chỉ dùng số dư cuối kỳ (không có đầu kỳ). */
  closingOnly: boolean;
}

/** Tổng nợ vay chịu lãi = nợ ngắn hạn + nợ dài hạn. */
export function interestBearingDebt(balance: Partial<BalanceData>): Num {
  const longTerm = field(balance, "longTermDebt");
  const shortTerm = field(balance, "shortTermDebt");
  const dueWithin = field(balance, "debtDueWithin12m");
  const shortSide = shortTerm ?? dueWithin;
  if (longTerm === null && shortSide === null) return null;
  return (longTerm ?? 0) + (shortSide ?? 0);
}

/** Nợ phải trả người bán: ước từ nợ ngắn hạn − nợ vay ngắn hạn khi không được tách riêng. */
export function payablesOf(balance: Partial<BalanceData>): Num {
  const explicit = field(balance, "payables");
  if (explicit !== null) return explicit;
  const currentLiabilities = field(balance, "currentLiabilities");
  const shortTerm = field(balance, "shortTermDebt") ?? field(balance, "debtDueWithin12m");
  if (currentLiabilities === null) return null;
  return Math.max(0, currentLiabilities - (shortTerm ?? 0));
}

/**
 * Bình quân số dư đầu kỳ / cuối kỳ.
 * Với LTM, "đầu kỳ" là số dư cách đúng 4 quý (12 tháng) — không phải quý liền trước.
 */
export function balanceAverages(
  normalized: NormalizedQuarter[],
  latestIndex: number,
  lookback = 4,
): BalanceAverages {
  const byIndex = new Map<number, NormalizedQuarter>();
  for (const q of normalized) byIndex.set(periodIndex(q.fiscalYear, q.quarter), q);
  const latest = byIndex.get(latestIndex);
  const opening = byIndex.get(latestIndex - lookback) ?? byIndex.get(latestIndex - 1);
  const closingOnly = !opening;

  const pick = (key: keyof BalanceData): Num => {
    const end = latest ? field(latest.balance, key as string) : null;
    const start = opening ? field(opening.balance, key as string) : null;
    return average(end, start);
  };

  const equity = pick("equity");
  const totalAssets = pick("totalAssets");
  const cash = latest ? field(latest.balance, "cashAndEquivalents") : null;
  const shortTermInvestments = latest ? field(latest.balance, "shortTermInvestments") : null;
  const debt = latest ? interestBearingDebt(latest.balance) : null;

  // Vốn đầu tư = VCSH + Nợ vay − Tiền & tương đương − Đầu tư ngắn hạn
  let investedCapital: Num = null;
  if (equity !== null) {
    investedCapital =
      equity + (debt ?? 0) - (cash ?? 0) - (shortTermInvestments ?? 0);
  }

  return {
    equity,
    totalAssets,
    inventory: pick("inventory"),
    receivables: pick("receivables"),
    payables: latest && opening ? average(payablesOf(latest.balance), payablesOf(opening.balance)) : latest ? payablesOf(latest.balance) : null,
    fixedAssets: pick("fixedAssets"),
    investedCapital,
    interestBearingDebt: debt,
    closingOnly,
  };
}

/* ────────────────────────────────────────────────────────────
 * 5. Khối ngữ cảnh dùng chung cho performance / health / valuation
 * ──────────────────────────────────────────────────────────── */

export interface FundamentalContext {
  symbol: string;
  basis: StatementBasis;
  normalized: NormalizedQuarter[];
  latest: NormalizedQuarter | null;
  /** Cùng quý, năm trước (để tính YoY theo quý). */
  yearAgo: NormalizedQuarter | null;
  /** Quý liền trước (QoQ). */
  prevQuarter: NormalizedQuarter | null;
  ltm: LtmWindow;
  ltmPrevious: LtmWindow | null;
  balances: BalanceAverages;
  /** Số dư cuối kỳ mới nhất. */
  closing: Partial<BalanceData>;
  warnings: string[];
}

export function buildFundamentalContext(
  symbol: string,
  quarters: FinancialQuarter[],
  options?: { basis?: StatementBasis },
): FundamentalContext {
  const basis = detectStatementBasis(quarters, options?.basis);
  const normalized = toStandaloneQuarters(quarters, basis);
  const descending = [...normalized].sort(
    (a, b) => periodIndex(b.fiscalYear, b.quarter) - periodIndex(a.fiscalYear, a.quarter),
  );
  const latest = descending[0] ?? null;
  const prevQuarter = descending[1] ?? null;
  const yearAgo =
    latest
      ? descending.find((q) => q.fiscalYear === latest.fiscalYear - 1 && q.quarter === latest.quarter) ?? null
      : null;

  const ltm = buildLtmWindow(normalized);
  // sharesOutstanding là số DƯ (không phải dòng tiền) nên không nằm trong
  // tổng LTM — chuyển tiếp từ quý mới nhất để EPS/BVPS/vốn hoá tính được.
  if (ltm.income.sharesOutstanding == null && latest?.income.sharesOutstanding != null) {
    ltm.income = { ...ltm.income, sharesOutstanding: latest.income.sharesOutstanding };
  }
  const latestIdx = latest ? periodIndex(latest.fiscalYear, latest.quarter) : 0;

  // LTM liền trước: dịch cửa sổ lùi 4 quý.
  let ltmPrevious: LtmWindow | null = null;
  if (latest) {
    const shifted: NormalizedQuarter[] = normalized.filter(
      (q) => periodIndex(q.fiscalYear, q.quarter) <= latestIdx - 4,
    );
    if (shifted.length > 0) {
      const candidate = buildLtmWindow(shifted);
      if (candidate.method !== "unavailable") ltmPrevious = candidate;
    }
  }
  if (!ltmPrevious && ltm.previous) {
    ltmPrevious = { ...ltm, income: ltm.previous.income, cashflow: ltm.previous.cashflow, previous: null };
  }

  const warnings = [...ltm.warnings];
  if (basis === "cumulative-ytd") {
    warnings.push("BCTC nguồn ở dạng luỹ kế — engine đã tách về số riêng từng quý trước khi tính.");
  } else if (basis === "unknown") {
    warnings.push("Không xác định được BCTC ở dạng luỹ kế hay riêng quý — mặc định coi là số riêng từng quý.");
  }

  return {
    symbol,
    basis,
    normalized,
    latest,
    yearAgo,
    prevQuarter,
    ltm,
    ltmPrevious,
    balances: latest ? balanceAverages(normalized, latestIdx) : {
      equity: null,
      totalAssets: null,
      inventory: null,
      receivables: null,
      payables: null,
      fixedAssets: null,
      investedCapital: null,
      interestBearingDebt: null,
      closingOnly: true,
    },
    closing: (latest?.balance ?? {}) as Partial<BalanceData>,
    warnings,
  };
}

/* ────────────────────────────────────────────────────────────
 * 6. Cấu trúc chỉ số dùng chung (kèm công thức để hiển thị)
 * ──────────────────────────────────────────────────────────── */

export interface EngineMetric {
  key: string;
  label: string;
  value: Num;
  unit: string;
  /** Công thức bằng tiếng Việt — hiển thị ngay trên UI. */
  formula: string;
  benchmark: Num;
  score: number | null;
  verdict: string;
  /** true khi giá trị bị nội suy/năm hoá thay vì lấy trực tiếp 12 tháng. */
  estimated?: boolean;
}

export interface EngineGroup {
  key: string;
  label: string;
  weight: number;
  score: number | null;
  weighted: number;
  narrative: string;
  metrics: EngineMetric[];
}

export function metric(
  key: string,
  label: string,
  value: Num,
  unit: string,
  formula: string,
  options: { benchmark?: Num; score?: Num; digits?: number; estimated?: boolean } = {},
): EngineMetric {
  const digits = options.digits ?? 2;
  const score = scoreOf(options.score ?? null);
  return {
    key,
    label,
    value: round(value, digits),
    unit,
    formula,
    benchmark: round(options.benchmark ?? null, digits),
    score,
    verdict: verdictOf(score),
    estimated: options.estimated,
  };
}

export function groupScore(metrics: EngineMetric[]): number | null {
  const scores = metrics.map((m) => m.score).filter((s): s is number => s !== null);
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
}

export function makeGroup(
  key: string,
  label: string,
  weight: number,
  narrative: string,
  metrics: EngineMetric[],
): EngineGroup {
  const score = groupScore(metrics);
  return {
    key,
    label,
    weight,
    score,
    weighted: score === null ? 0 : Number((score * weight).toFixed(2)),
    narrative,
    metrics,
  };
}

export function overallOf(groups: EngineGroup[]): number {
  const active = groups.filter((g) => g.score !== null);
  if (active.length === 0) return 0;
  const totalWeight = active.reduce((sum, g) => sum + g.weight, 0);
  if (totalWeight <= 0) return 0;
  // Chuẩn hoá lại trọng số theo các nhóm có dữ liệu để điểm không bị "phạt oan".
  const raw = active.reduce((sum, g) => sum + (g.score as number) * g.weight, 0);
  return Math.round(raw / totalWeight);
}

export function coverageOf(groups: EngineGroup[]): { computed: number; total: number; pct: number } {
  const metrics = groups.flatMap((g) => g.metrics);
  const computed = metrics.filter((m) => m.value !== null).length;
  return {
    computed,
    total: metrics.length,
    pct: metrics.length === 0 ? 0 : Number(((computed / metrics.length) * 100).toFixed(1)),
  };
}

export function strengthsOf(groups: EngineGroup[], count = 2): EngineGroup[] {
  return [...groups]
    .filter((g) => g.score !== null)
    .sort((a, b) => (b.score as number) - (a.score as number))
    .slice(0, count);
}

export function weakestOf(groups: EngineGroup[]): EngineGroup | null {
  const active = [...groups].filter((g) => g.score !== null);
  if (active.length === 0) return null;
  return active.sort((a, b) => (a.score as number) - (b.score as number))[0];
}
