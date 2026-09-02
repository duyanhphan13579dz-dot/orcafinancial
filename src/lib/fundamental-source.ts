/**
 * Nguồn dữ liệu báo cáo tài chính — lớp trình bày cho tab "Cơ bản".
 *
 * Mục đích: mọi con số tính ra (hiệu suất kinh doanh, sức khỏe tài chính,
 * định giá) đều phải truy vết được về đúng dòng trên báo cáo tài chính đã
 * công bố. Module này đóng gói các kỳ báo cáo ĐÃ CHUẨN HOÁ (số riêng quý),
 * cửa sổ LTM và số dư bình quân để UI hiển thị — nó KHÔNG tính thêm chỉ số
 * nào, nên không có rủi ro lệch giữa bảng nguồn và bảng phân tích.
 *
 * Đơn vị: số liệu BCTC ở **tỷ VND**; EPS/BVPS/giá ở **nghìn VND**.
 *
 * Nguyên tắc dữ liệu (Verified Financial Data policy): trường nào không có
 * trong BCTC thì trả `null` và UI hiển thị "—". Không bao giờ thay bằng 0,
 * vì 0 là một con số có nghĩa ("không phát sinh") còn thiếu là "chưa công bố".
 */

import { formatPeriodFromComposite } from "@/lib/format";
import {
  field,
  interestBearingDebt,
  payablesOf,
  round,
  type BalanceAverages,
  type FundamentalContext,
  type LtmWindow,
  type NormalizedQuarter,
  type Num,
  type StatementBasis,
} from "@/lib/fundamental-engine";

export const STATEMENT_UNIT = "tỷ VND";
export const PER_SHARE_UNIT = "nghìn VND";

export const BASIS_LABEL: Record<StatementBasis, string> = {
  standalone: "riêng từng quý",
  "cumulative-ytd": "luỹ kế (đã tách về riêng quý)",
  unknown: "chưa xác định",
};

export const LTM_METHOD_LABEL: Record<string, string> = {
  "sum-4q": "Tổng 4 quý liên tiếp",
  "ytd-plus-fy-minus-pytd": "Cả năm trước + LK năm nay − LK cùng kỳ",
  "full-year": "Cả năm tài chính",
  "annualized-ytd": "Luỹ kế năm hoá (nội suy)",
  unavailable: "Chưa đủ dữ liệu",
};

/** Một dòng = một kỳ báo cáo, số liệu đã đưa về RIÊNG quý. */
export interface StatementSourceRow {
  period: string;
  displayPeriodVi: string;
  shortTag: string;
  fiscalYear: number;
  quarter: number;

  /* ── Kết quả kinh doanh (riêng quý) ── */
  revenue: Num;
  costOfGoodsSold: Num;
  grossProfit: Num;
  ebitda: Num;
  operatingIncome: Num;
  netIncome: Num;
  eps: Num;

  /* ── Lưu chuyển tiền tệ (riêng quý) ── */
  operatingCashFlow: Num;
  capex: Num;
  freeCashFlow: Num;

  /* ── Bảng cân đối kế toán (số dư CUỐI kỳ) ── */
  totalAssets: Num;
  equity: Num;
  cashAndEquivalents: Num;
  interestBearingDebt: Num;
  inventory: Num;
  receivables: Num;

  /* ── Truy vết nguồn ── */
  /** Số doanh thu đúng như BCTC công bố (có thể là luỹ kế). */
  reportedRevenue: Num;
  /** true khi số riêng quý được TÁCH từ luỹ kế, không phải số công bố trực tiếp. */
  derivedFromCumulative: boolean;
}

export interface StatementLtmBlock {
  periodEnd: string;
  periodEndVi: string;
  method: string;
  methodLabel: string;
  quartersUsed: number;
  /** true ⇒ LTM là số nội suy (nhân hệ số), không phải đủ 12 tháng thực. */
  annualized: boolean;
  revenue: Num;
  grossProfit: Num;
  ebitda: Num;
  operatingIncome: Num;
  netIncome: Num;
  operatingCashFlow: Num;
  capex: Num;
  freeCashFlow: Num;
  eps: Num;
  previousRevenue: Num;
  previousNetIncome: Num;
  warnings: string[];
}

export interface StatementBalanceBlock {
  /** true ⇒ chỉ có số dư cuối kỳ, các chỉ số sinh lời không dùng được số bình quân. */
  closingOnly: boolean;
  equity: Num;
  totalAssets: Num;
  inventory: Num;
  receivables: Num;
  payables: Num;
  fixedAssets: Num;
  interestBearingDebt: Num;
  investedCapital: Num;
}

export interface StatementSource {
  symbol: string;
  unit: string;
  perShareUnit: string;
  basis: StatementBasis;
  basisLabel: string;
  source: string;
  providerBacked: boolean;
  loadedAt: string;
  periodCount: number;
  latestPeriod: string | null;
  rows: StatementSourceRow[];
  ltm: StatementLtmBlock | null;
  balances: StatementBalanceBlock;
  warnings: string[];
}

function capexOf(quarter: NormalizedQuarter): Num {
  const raw = field(quarter.cashflow, "capex");
  // BCTC trình bày capex là dòng tiền ra (âm); UI hiển thị độ lớn.
  return raw === null ? null : Math.abs(raw);
}

function freeCashFlowOf(quarter: NormalizedQuarter, capex: Num): Num {
  const reported = field(quarter.cashflow, "freeCashFlow");
  if (reported !== null) return reported;
  const ocf = field(quarter.cashflow, "operatingCashFlow");
  if (ocf === null || capex === null) return null;
  return ocf - capex;
}

function row(quarter: NormalizedQuarter, basis: StatementBasis): StatementSourceRow {
  const labels = formatPeriodFromComposite(quarter.period);
  const capex = capexOf(quarter);
  return {
    period: quarter.period,
    displayPeriodVi: labels.displayPeriodVi,
    shortTag: labels.shortTag,
    fiscalYear: quarter.fiscalYear,
    quarter: quarter.quarter,

    revenue: round(field(quarter.income, "revenue")),
    costOfGoodsSold: round(field(quarter.income, "costOfGoodsSold")),
    grossProfit: round(field(quarter.income, "grossProfit")),
    ebitda: round(field(quarter.income, "ebitda")),
    operatingIncome: round(field(quarter.income, "operatingIncome")),
    netIncome: round(field(quarter.income, "netIncome")),
    eps: round(field(quarter.income, "eps"), 3),

    operatingCashFlow: round(field(quarter.cashflow, "operatingCashFlow")),
    capex: round(capex),
    freeCashFlow: round(freeCashFlowOf(quarter, capex)),

    totalAssets: round(field(quarter.balance, "totalAssets")),
    equity: round(field(quarter.balance, "equity")),
    cashAndEquivalents: round(field(quarter.balance, "cashAndEquivalents")),
    interestBearingDebt: round(interestBearingDebt(quarter.balance)),
    inventory: round(field(quarter.balance, "inventory")),
    receivables: round(field(quarter.balance, "receivables")),

    reportedRevenue: round(field(quarter.raw.income as unknown as Record<string, unknown>, "revenue")),
    // Số riêng quý chỉ là suy ra khi BCTC gốc ở dạng luỹ kế.
    derivedFromCumulative: basis === "cumulative-ytd",
  };
}

function ltmBlock(ltm: LtmWindow): StatementLtmBlock {
  // BCTC trình bày capex là dòng tiền ra (âm); UI hiển thị độ lớn.
  const reportedCapex = field(ltm.cashflow, "capex");
  const capex = reportedCapex === null ? null : Math.abs(reportedCapex);
  const ocf = field(ltm.cashflow, "operatingCashFlow");
  const reportedFcf = field(ltm.cashflow, "freeCashFlow");
  const fcf = reportedFcf !== null ? reportedFcf : ocf !== null && capex !== null ? ocf - capex : null;

  return {
    periodEnd: ltm.periodEnd,
    periodEndVi: ltm.periodEndVi,
    method: ltm.method,
    methodLabel: LTM_METHOD_LABEL[ltm.method] ?? ltm.method,
    quartersUsed: ltm.quartersUsed,
    annualized: ltm.annualized,
    revenue: round(field(ltm.income, "revenue")),
    grossProfit: round(field(ltm.income, "grossProfit")),
    ebitda: round(field(ltm.income, "ebitda")),
    operatingIncome: round(field(ltm.income, "operatingIncome")),
    netIncome: round(field(ltm.income, "netIncome")),
    operatingCashFlow: round(ocf),
    capex: round(capex),
    freeCashFlow: round(fcf),
    eps: round(field(ltm.income, "eps"), 3),
    previousRevenue: round(field(ltm.previous?.income ?? {}, "revenue")),
    previousNetIncome: round(field(ltm.previous?.income ?? {}, "netIncome")),
    warnings: ltm.warnings,
  };
}

function balanceBlock(balances: BalanceAverages): StatementBalanceBlock {
  return {
    closingOnly: balances.closingOnly,
    equity: round(balances.equity),
    totalAssets: round(balances.totalAssets),
    inventory: round(balances.inventory),
    receivables: round(balances.receivables),
    payables: round(balances.payables),
    fixedAssets: round(balances.fixedAssets),
    interestBearingDebt: round(balances.interestBearingDebt),
    investedCapital: round(balances.investedCapital),
  };
}

/**
 * Đóng gói số liệu BCTC nguồn cho UI. `ctx` phải là kết quả của
 * `buildFundamentalContext` — chính là ngữ cảnh mà engine dùng để tính
 * hiệu suất / sức khỏe / định giá, nên bảng nguồn và bảng phân tích luôn khớp.
 */
export function buildStatementSource(
  symbol: string,
  ctx: FundamentalContext,
  meta: { source: string; providerBacked: boolean; loadedAt: string } = {
    source: "unknown",
    providerBacked: false,
    loadedAt: new Date().toISOString(),
  },
): StatementSource {
  const descending = [...ctx.normalized].sort(
    (a, b) => b.fiscalYear - a.fiscalYear || b.quarter - a.quarter,
  );
  const rows = descending.map((quarter) => row(quarter, ctx.basis));
  const latest = rows[0] ?? null;

  const warnings = [...ctx.warnings];
  if (ctx.balances.closingOnly) {
    warnings.push(
      "Chỉ có số dư cuối kỳ (thiếu kỳ cách 4 quý) nên ROE/ROA/vòng quay dùng số cuối kỳ thay vì bình quân.",
    );
  }
  if (ctx.ltm.annualized) {
    warnings.push("LTM đang được nội suy bằng hệ số năm hoá — không phải tổng 12 tháng thực tế.");
  }

  return {
    symbol,
    unit: STATEMENT_UNIT,
    perShareUnit: PER_SHARE_UNIT,
    basis: ctx.basis,
    basisLabel: BASIS_LABEL[ctx.basis] ?? String(ctx.basis),
    source: meta.source,
    providerBacked: meta.providerBacked,
    loadedAt: meta.loadedAt,
    periodCount: rows.length,
    latestPeriod: latest?.period ?? null,
    rows,
    ltm: ctx.ltm.method === "unavailable" ? null : ltmBlock(ctx.ltm),
    balances: balanceBlock(ctx.balances),
    warnings,
  };
}

/** Tổng nợ vay chịu lãi của kỳ mới nhất, dùng cho nhãn "nợ ròng" ở UI. */
export function latestClosingDebt(ctx: FundamentalContext): Num {
  return round(interestBearingDebt(ctx.closing));
}

/** Phải trả người bán kỳ mới nhất (để đối chiếu DPO). */
export function latestPayables(ctx: FundamentalContext): Num {
  return round(payablesOf(ctx.closing));
}
