import type { CorporateFinanceStatement } from "./schema";
import { getLatestCorporateStatements } from "./service";

function vnd(n: number): string {
  return `${n.toLocaleString("vi-VN")} VND`;
}

function pct(n: number, digits = 1): string {
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "n/a";
}

function safeDiv(a: number, b: number): number {
  return b !== 0 ? a / b : NaN;
}

/**
 * Builds a Vietnamese, number-grounded context block from the user's real
 * BCTC input — same role `buildSymbolContext` plays for stock tickers.
 * Computes standard ratios (margins, ROE/ROA, đòn bẩy, chất lượng lợi nhuận,
 * tăng trưởng YoY) so the LLM narrates real math instead of generic theory.
 * Returns null when unauthenticated or no statement saved yet.
 */
export async function buildCorporateFinanceContext(
  userId: string | null,
  companyName?: string,
): Promise<string | null> {
  if (!userId) return null;
  const result = await getLatestCorporateStatements(userId, companyName).catch(() => null);
  if (!result) return null;
  const { latest: s, prior } = result;

  const grossProfit = s.revenue - s.cogs;
  const grossMargin = safeDiv(grossProfit, s.revenue) * 100;
  const ebitdaMargin = safeDiv(s.ebitda, s.revenue) * 100;
  const netMargin = safeDiv(s.netIncome, s.revenue) * 100;
  const roe = safeDiv(s.netIncome, s.totalEquity) * 100;
  const roa = safeDiv(s.netIncome, s.totalAssets) * 100;
  const totalDebt = s.shortTermDebt + s.longTermDebt;
  const debtToEquity = safeDiv(totalDebt, s.totalEquity);
  const netDebt = totalDebt - s.cash;
  const ocfToNetIncome = safeDiv(s.operatingCashFlow, s.netIncome);

  const lines: string[] = [];
  lines.push(
    `HỒ SƠ TÀI CHÍNH DOANH NGHIỆP — ${s.companyName}${s.industry ? ` (ngành ${s.industry})` : ""}, kỳ ${s.period} năm ${s.fiscalYear} (số liệu thật do người dùng nhập — PHẢI dùng để tính toán cụ thể, không chỉ nêu nguyên tắc chung):`,
  );
  lines.push(
    `Doanh thu ${vnd(s.revenue)}, giá vốn ${vnd(s.cogs)} → lợi nhuận gộp ${vnd(grossProfit)} (biên gộp ${pct(grossMargin)}). EBITDA ${vnd(s.ebitda)} (biên EBITDA ${pct(ebitdaMargin)}). Lợi nhuận ròng ${vnd(s.netIncome)} (biên ròng ${pct(netMargin)}).`,
  );
  lines.push(
    `Tổng tài sản ${vnd(s.totalAssets)}, tổng nợ phải trả ${vnd(s.totalLiabilities)}, vốn chủ sở hữu ${vnd(s.totalEquity)} → ROE ${pct(roe)}, ROA ${pct(roa)}.`,
  );
  lines.push(
    `Nợ vay ngắn hạn ${vnd(s.shortTermDebt)} + dài hạn ${vnd(s.longTermDebt)} = tổng nợ vay ${vnd(totalDebt)}; tiền mặt ${vnd(s.cash)} → nợ ròng ${vnd(netDebt)}; đòn bẩy nợ vay/vốn chủ (D/E) ${Number.isFinite(debtToEquity) ? debtToEquity.toFixed(2) : "n/a"}x.`,
  );
  lines.push(
    `Dòng tiền: hoạt động kinh doanh ${vnd(s.operatingCashFlow)}, đầu tư ${vnd(s.investingCashFlow)}, tài chính ${vnd(s.financingCashFlow)}. Tỷ lệ dòng tiền HĐKD/lợi nhuận ròng ${Number.isFinite(ocfToNetIncome) ? ocfToNetIncome.toFixed(2) : "n/a"}x (chất lượng lợi nhuận: ${
      Number.isFinite(ocfToNetIncome) && ocfToNetIncome < 0.8
        ? "thấp hơn bình thường, cần lưu ý chênh lệch lợi nhuận sổ sách và tiền thật"
        : "ở mức hợp lý"
    }).`,
  );

  if (prior) {
    const revGrowth = safeDiv(s.revenue - prior.revenue, prior.revenue) * 100;
    const netIncomeGrowth = safeDiv(s.netIncome - prior.netIncome, Math.abs(prior.netIncome)) * 100;
    lines.push(
      `So với kỳ trước (${prior.period} ${prior.fiscalYear}): doanh thu ${vnd(prior.revenue)} → tăng trưởng ${pct(revGrowth)}; lợi nhuận ròng ${vnd(prior.netIncome)} → tăng trưởng ${pct(netIncomeGrowth)}.`,
    );
  } else {
    lines.push("Chưa có số liệu kỳ trước để so sánh tăng trưởng YoY.");
  }

  if (s.notes) lines.push(`Ghi chú thêm từ người dùng: ${s.notes}`);

  return lines.join("\n");
}

export type { CorporateFinanceStatement };
