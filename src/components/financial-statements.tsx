"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type StatementType = "income" | "balance" | "cashflow";
type PeriodType = "quarterly" | "yearly";

interface FinancialsResponse {
  symbol: string;
  type: StatementType;
  periods: Array<{ period: string; fiscalYear: number; data: Record<string, number> }>;
  fields: string[];
}

const FIELD_LABELS: Record<StatementType, Record<string, { label: string; unit: string; highlight?: boolean; indent?: boolean; subtotal?: boolean }>> = {
  income: {
    revenue: { label: "Doanh thu", unit: " tỷ", highlight: true, subtotal: true },
    costOfGoodsSold: { label: "Giá vốn hàng bán", unit: " tỷ", indent: true },
    grossProfit: { label: "Lợi nhuận gộp", unit: " tỷ", subtotal: true },
    operatingExpenses: { label: "Chi phí hoạt động", unit: " tỷ", indent: true },
    operatingIncome: { label: "Lợi nhuận từ HĐKD", unit: " tỷ", subtotal: true },
    interestExpense: { label: "Chi phí lãi vay", unit: " tỷ", indent: true },
    otherIncome: { label: "Thu nhập khác", unit: " tỷ", indent: true },
    pretaxIncome: { label: "Lợi nhuận trước thuế", unit: " tỷ", subtotal: true },
    incomeTax: { label: "Thuế TNDN", unit: " tỷ", indent: true },
    netIncome: { label: "Lợi nhuận sau thuế", unit: " tỷ", highlight: true, subtotal: true },
    depreciation: { label: "Khấu hao", unit: " tỷ", indent: true },
    ebitda: { label: "EBITDA", unit: " tỷ", highlight: true },
    eps: { label: "EPS (nghìn VND)", unit: "", highlight: true },
  },
  balance: {
    cashAndEquivalents: { label: "Tiền & tương đương tiền", unit: " tỷ" },
    shortTermInvestments: { label: "Đầu tư ngắn hạn", unit: " tỷ", indent: true },
    receivables: { label: "Phải thu khách hàng", unit: " tỷ", indent: true },
    inventory: { label: "Hàng tồn kho", unit: " tỷ", indent: true },
    currentAssets: { label: "Tài sản ngắn hạn", unit: " tỷ", subtotal: true },
    fixedAssets: { label: "Tài sản cố định", unit: " tỷ" },
    longTermInvestments: { label: "Đầu tư dài hạn", unit: " tỷ", indent: true },
    totalAssets: { label: "TỔNG TÀI SẢN", unit: " tỷ", highlight: true, subtotal: true },
    currentLiabilities: { label: "Nợ ngắn hạn", unit: " tỷ" },
    longTermDebt: { label: "Nợ dài hạn", unit: " tỷ", indent: true },
    totalLiabilities: { label: "TỔNG NỢ PHẢI TRẢ", unit: " tỷ", subtotal: true },
    equity: { label: "Vốn chủ sở hữu", unit: " tỷ", subtotal: true },
    retainedEarnings: { label: "Lợi nhuận giữ lại", unit: " tỷ", indent: true },
    totalLiabilitiesEquity: { label: "TỔNG NGUỒN VỐN", unit: " tỷ", highlight: true, subtotal: true },
    bookValuePerShare: { label: "Giá trị sổ sách/CP (nghìn VND)", unit: "", highlight: true },
  },
  cashflow: {
    netIncome: { label: "Lợi nhuận sau thuế", unit: " tỷ" },
    depreciation: { label: "Khấu hao", unit: " tỷ", indent: true },
    changeWorkingCapital: { label: "Biến động vốn lưu động", unit: " tỷ", indent: true },
    operatingCashFlow: { label: "Dòng tiền từ HĐKD", unit: " tỷ", highlight: true, subtotal: true },
    capex: { label: "Chi đầu tư tài sản cố định", unit: " tỷ", indent: true },
    investingCashFlow: { label: "Dòng tiền từ HĐ ĐT", unit: " tỷ", subtotal: true },
    debtIssuance: { label: "Phát hành/hoàn trả nợ", unit: " tỷ", indent: true },
    dividendsPaid: { label: "Cổ tức đã trả", unit: " tỷ", indent: true },
    financingCashFlow: { label: "Dòng tiền từ HĐ TC", unit: " tỷ", subtotal: true },
    netChangeCash: { label: "Biến động tiền thuần", unit: " tỷ" },
    freeCashFlow: { label: "DÒNG TIỀN TỰ DO", unit: " tỷ", highlight: true, subtotal: true },
  },
};

const TYPE_LABELS: Record<StatementType, string> = {
  income: "Kết quả kinh doanh",
  balance: "Bảng cân đối kế toán",
  cashflow: "Báo cáo lưu chuyển tiền tệ",
};

function fmtValue(v: number, unit: string): string {
  if (unit === "") return v.toFixed(2);
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(2)}N`;
  return `${v.toFixed(0)}`;
}

export function FinancialStatements({ symbol }: { symbol: string }) {
  const [type, setType] = useState<StatementType>("income");
  const [period, setPeriod] = useState<PeriodType>("quarterly");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FinancialsResponse | null>(null);

  const load = async (t: StatementType, p: PeriodType) => {
    setLoading(true);
    setError(null);
    try {
      const limit = p === "yearly" ? 3 : 4;
      const res = await api<FinancialsResponse>(`/stocks/${symbol}/financials?type=${t}&period=${p}&limit=${limit}`);
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Load initial on type/period change
  useEffect(() => {
    void load(type, period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, period]);

  const labels = FIELD_LABELS[type];
  const fields = data?.fields.filter((f) => labels[f]) ?? [];

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="flex flex-wrap gap-2 mb-4 items-center">
          {(["income", "balance", "cashflow"] as StatementType[]).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`rounded px-3 py-1.5 text-xs ${type === t ? "bg-cyan-500/20 text-cyan-300 border border-cyan-700" : "bg-slate-800 text-slate-400 border border-slate-700 hover:text-slate-200"}`}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
          <div className="ml-auto flex gap-1">
            <button
              onClick={() => setPeriod("quarterly")}
              className={`rounded px-2 py-1 text-[11px] ${period === "quarterly" ? "text-cyan-300" : "text-slate-500"}`}
            >
              Quý
            </button>
            <button
              onClick={() => setPeriod("yearly")}
              className={`rounded px-2 py-1 text-[11px] ${period === "yearly" ? "text-cyan-300" : "text-slate-500"}`}
            >
              Năm
            </button>
          </div>
        </div>

        {error && <div className="text-sm text-rose-400 mb-3">{error}</div>}
        {loading && <div className="text-sm text-slate-500 mb-3">Đang tải báo cáo…</div>}

        {data && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-left">
                  <th className="py-2 text-slate-400 font-medium">Chỉ tiêu</th>
                  {data.periods.map((p) => {
                    const pAny = p as any;
                    const vi = pAny.displayPeriodVi ?? pAny.displayPeriod ?? p.period;
                    return (
                      <th key={p.period} className="py-2 text-right font-medium text-slate-400">
                        <div className="font-mono text-[11px] text-white tabular-nums">{pAny.displayPeriod ?? p.period}</div>
                        <div className="font-mono text-[9px] text-slate-500 italic normal-case">{vi}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {fields.map((field) => {
                  const meta = labels[field];
                  return (
                    <tr key={field} className={`border-b border-slate-800/50 ${meta.subtotal ? "bg-slate-800/30 font-semibold" : ""}`}>
                      <td className={`py-1.5 ${meta.indent ? "pl-4 text-slate-400" : meta.highlight ? "text-cyan-300" : "text-slate-200"}`}>
                        {meta.label}
                        <span className="text-[9px] text-slate-600 ml-1">{meta.unit}</span>
                      </td>
                      {data.periods.map((p, i) => {
                        const v = p.data[field] ?? 0;
                        const prev = i < data.periods.length - 1 ? data.periods[i + 1].data[field] : null;
                        const change = prev && Math.abs(prev) > 0.01 ? ((v - prev) / Math.abs(prev)) * 100 : null;
                        return (
                          <td key={p.period} className="py-1.5 text-right tabular-nums">
                            <div>{fmtValue(v, meta.unit)}</div>
                            {change !== null && (
                              <div className={`text-[9px] ${change >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 text-[10px] text-slate-600 leading-relaxed">
          Đơn vị: tỷ VND (trừ EPS và BVPS tính bằng nghìn VND/cp). Số liệu được mô hình hóa từ dữ liệu giá/khối lượng thực và benchmark ngành Việt Nam (sẽ được thay thế bằng báo cáo kiểm toán khi connector tài chính hoạt động). Dữ liệu đảm bảo nhất quán giữa 3 báo cáo.
        </div>
      </div>
    </div>
  );
}
