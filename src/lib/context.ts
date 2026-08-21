import { getPersonalFinanceProfile } from "./service";

function vnd(n: number): string {
  return `${n.toLocaleString("vi-VN")} VND`;
}

/**
 * Builds a Vietnamese, number-grounded context block from the user's real
 * personal finance profile — the same role `buildSymbolContext` plays for
 * stock tickers. Returns null when unauthenticated or no profile saved yet,
 * so the caller can fall back to the generic educational framing.
 */
export async function buildPersonalFinanceContext(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const profile = await getPersonalFinanceProfile(userId).catch(() => null);
  if (!profile) return null;

  const income = profile.monthlyIncome;
  const expenses = profile.monthlyExpenses;
  const surplus = income - expenses;
  const savingsRate = income > 0 ? (surplus / income) * 100 : 0;

  const totalDebtBalance = profile.debts.reduce((s, d) => s + d.balance, 0);
  const totalMonthlyDebtPayment = profile.debts.reduce((s, d) => s + d.monthlyPayment, 0);
  const dti = income > 0 ? (totalMonthlyDebtPayment / income) * 100 : 0;
  const emergencyMonths = expenses > 0 ? profile.emergencyFundCurrent / expenses : 0;

  const lines: string[] = [];
  lines.push(
    "HỒ SƠ TÀI CHÍNH CÁ NHÂN (số liệu thật do người dùng khai báo — PHẢI dùng để tính toán cụ thể, không chỉ nêu nguyên tắc chung):",
  );
  lines.push(
    `Thu nhập ${vnd(income)}/tháng, chi tiêu ${vnd(expenses)}/tháng → chênh lệch ${vnd(surplus)}/tháng (tỷ lệ tiết kiệm ${savingsRate.toFixed(1)}%).`,
  );
  lines.push(
    `Quỹ khẩn cấp hiện có ${vnd(profile.emergencyFundCurrent)}, tương đương ${emergencyMonths.toFixed(1)} tháng chi tiêu (chuẩn khuyến nghị: 3-6 tháng).`,
  );

  if (profile.debts.length > 0) {
    const debtLines = profile.debts
      .map((d) => `${d.name}: dư nợ ${vnd(d.balance)}, lãi suất ${d.interestRatePct}%/năm, trả ${vnd(d.monthlyPayment)}/tháng`)
      .join("; ");
    lines.push(
      `Nợ hiện tại (${profile.debts.length} khoản, tổng dư nợ ${vnd(totalDebtBalance)}, tổng trả gốc+lãi ${vnd(totalMonthlyDebtPayment)}/tháng, tỷ lệ nợ/thu nhập DTI ${dti.toFixed(1)}%): ${debtLines}.`,
    );
  } else {
    lines.push("Không có khoản nợ nào được khai báo.");
  }

  lines.push(
    `Số người phụ thuộc: ${profile.dependents}. Khẩu vị rủi ro tự khai: ${profile.riskTolerance}. Chân trời đầu tư: ${profile.investmentHorizonYears} năm. Khả năng đầu tư thêm: ${vnd(profile.monthlyInvestmentCapacity)}/tháng.`,
  );

  if (profile.goals.length > 0) {
    const goalLines = profile.goals
      .map((g) => `${g.name} — cần ${vnd(g.targetAmount)} vào năm ${g.targetYear}`)
      .join("; ");
    lines.push(`Mục tiêu tài chính: ${goalLines}.`);
  }

  if (profile.notes) lines.push(`Ghi chú thêm từ người dùng: ${profile.notes}`);

  return lines.join("\n");
}
