"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { loadLiveFinancialsResponse } from "@/lib/connectors/live-financials-client";

type StatementType = "income" | "balance" | "cashflow";
type PeriodType = "quarterly" | "yearly";

interface FinancialSourceEvidence {
  id: number;
  source: string;
  documentType: string;
  documentUrl: string;
  reportType?: string | null;
  period?: string | null;
  fiscalYear?: number | null;
  filingDate?: string | null;
  retrievedAt: string | Date;
  contentType?: string | null;
  parserVersion: string;
  status: string;
  factCount: number;
  acceptedFactCount: number;
  evidence: "document-url" | "metadata-only";
  verificationStatus: "verified" | "unverified";
}

interface FinancialsResponse {
  symbol: string;
  type: StatementType;
  periods: Array<{ period: string; fiscalYear: number; data: Record<string, number> }>;
  fields: string[];
  sourceEvidence?: FinancialSourceEvidence[];
}

// Response shape from the same-origin dstock server route.
interface DstockResponse {
  available: boolean;
  symbol: string;
  type: StatementType;
  periods: Array<{ period: string; fiscalYear: number; data: Record<string, number> }>;
  fields: string[];
  source: "vndirect";
  sourceName: string;
  sourceUrl: string;
  unit: string;
  warnings: string[];
}

// Per-statement dstock report URL (the exact 3 pages the user named).
const DSTOCK_REPORT: Record<StatementType, string> = {
  income: "bao-cao-ket-qua-kinh-doanh",
  balance: "bang-can-doi-ke-toan",
  cashflow: "bao-cao-luu-chuyen-tien-te",
};

function dstockReportUrl(symbol: string, type: StatementType): string {
  return `https://dstock.vndirect.com.vn/${DSTOCK_REPORT[type]}/${symbol}`;
}

function liveSourceName(source: string | null | undefined): string {
  if (source === "vndirect") return "VNDirect (doanh nghiệp)";
  if (source === "vietstock") return "Vietstock";
  return source ?? "";
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

function sourceName(source: string): string {
  if (source === "vndirect") return "VNDirect";
  if (source === "vietstock") return "Vietstock";
  if (source === "cafef") return "CafeF";
  return source;
}

function dateLabel(value: string | Date | null | undefined): string {
  if (!value) return "Chưa có";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("vi-VN");
}

export function FinancialStatements({ symbol }: { symbol: string }) {
  const [type, setType] = useState<StatementType>("income");
  const [period, setPeriod] = useState<PeriodType>("quarterly");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FinancialsResponse | null>(null);
  const [liveSource, setLiveSource] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);

  const load = async (t: StatementType, p: PeriodType) => {
    setLoading(true);
    setError(null);
    setLiveSource(null);
    setSourceUrl(null);
    try {
      const limit = p === "yearly" ? 3 : 4;
      const period = p === "yearly" ? "yearly" : "quarterly";

      // 1) Same-origin dstock route. The route handler fetches VNDirect's
      //    finfo-api feed (which backs the dstock report pages) on the server,
      //    avoiding the CORS that blocks a browser from reading VNDirect
      //    cross-origin. This is the primary path on production where the
      //    server has outbound internet.
      try {
        const d = await api<DstockResponse>(
          `/stocks/${symbol}/financials/dstock?type=${t}&period=${period}&limit=${limit}`,
        );
        if (d.data.available && d.data.periods.length > 0) {
          setLiveSource(d.data.source);
          setSourceUrl(d.data.sourceUrl);
          setData({
            symbol: d.data.symbol,
            type: t,
            periods: d.data.periods,
            fields: d.data.fields,
            sourceEvidence: [
              {
                id: 1,
                source: d.data.source,
                documentType: "Báo cáo tài chính (trực tiếp)",
                documentUrl: d.data.sourceUrl,
                period: d.data.periods[0]?.period ?? null,
                reportType: t,
                retrievedAt: new Date().toISOString(),
                contentType: "api",
                parserVersion: "dstock-v1",
                status: "accepted",
                factCount: d.data.fields.length,
                acceptedFactCount: d.data.fields.length,
                evidence: "document-url",
                verificationStatus: "unverified",
              },
            ],
          });
          return;
        }
      } catch {
        // The sandbox dev server has no outbound internet → the route returns
        // unavailable or errors. Fall through to the browser connector below.
      }

      // 2) Browser-side live extraction straight from VNDirect (doanh nghiệp)
      //    → Vietstock. Works when the host server cannot reach VNDirect.
      const live = await loadLiveFinancialsResponse(symbol, t, period, limit);
      if (live.liveSource && live.periods.length > 0) {
        setLiveSource(live.liveSource);
        setSourceUrl(live.liveSource === "vndirect" ? dstockReportUrl(symbol, t) : `https://finance.vietstock.vn/${symbol}/tai-chinh.htm`);
        setData({
          symbol: live.symbol,
          type: t,
          periods: live.periods,
          fields: live.fields,
          sourceEvidence: [
            {
              id: 1,
              source: live.liveSource,
              documentType: "Báo cáo tài chính (trực tiếp)",
              documentUrl: dstockReportUrl(symbol, t),
              period: live.periods[0]?.period ?? null,
              reportType: t,
              retrievedAt: new Date().toISOString(),
              contentType: "api",
              parserVersion: "live-extract-v1",
              status: "accepted",
              factCount: live.fields.length,
              acceptedFactCount: live.fields.length,
              evidence: "metadata-only",
              verificationStatus: "unverified",
            },
          ],
        });
        return;
      }

      // 3) Fall back to the verified ingestion pipeline API.
      const res = await api<FinancialsResponse>(`/stocks/${symbol}/financials?type=${t}&period=${p}&limit=${limit}`);
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => void load(type, period));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, period]);

  const labels = FIELD_LABELS[type];
  const fields = data?.fields.filter((f) => labels[f]) ?? [];

  return (
    <div className="space-y-4">
      <div className="panel p-4 stock-tab-panel">
        <div className="stock-section-heading flex-wrap items-center">
          {(["income", "balance", "cashflow"] as StatementType[]).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              type="button"
              aria-pressed={type === t}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${type === t ? "bg-cyan-500/15 text-cyan-200 border border-cyan-600/70" : "bg-slate-900/50 text-slate-400 border border-slate-700 hover:text-slate-200 hover:border-slate-600"}`}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
          <div className="ml-auto flex gap-1">
            <button
              onClick={() => setPeriod("quarterly")}
              type="button"
              aria-pressed={period === "quarterly"}
              className={`rounded-md px-3 py-1.5 text-[11px] ${period === "quarterly" ? "bg-cyan-500/10 text-cyan-300" : "text-slate-500 hover:text-slate-300"}`}
            >
              Quý
            </button>
            <button
              onClick={() => setPeriod("yearly")}
              type="button"
              aria-pressed={period === "yearly"}
              className={`rounded-md px-3 py-1.5 text-[11px] ${period === "yearly" ? "bg-cyan-500/10 text-cyan-300" : "text-slate-500 hover:text-slate-300"}`}
            >
              Năm
            </button>
          </div>
        </div>

        {error && <div className="text-sm text-rose-400 mb-3">{error}</div>}
        {loading && <div className="text-sm text-slate-500 mb-3">Đang tải báo cáo trực tiếp từ doanh nghiệp…</div>}

        {liveSource && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-cyan-800/50 bg-cyan-950/20 px-3 py-2 text-[11px]">
            <span className="flex items-center gap-1.5 font-medium text-cyan-200">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Nguồn: {liveSourceName(liveSource)}
            </span>
            <span className="text-slate-500">— số liệu trích xuất trực tiếp từ báo cáo của doanh nghiệp, không tự tạo / không làm giả.</span>
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-auto shrink-0 rounded border border-cyan-700/60 px-2 py-0.5 text-[10px] text-cyan-300 hover:bg-cyan-500/10"
              >
                Mở nguồn đối chiếu ↗
              </a>
            )}
          </div>
        )}

        {!loading && !error && data && data.periods.length === 0 && (
          <div className="rounded-lg border border-slate-800/80 bg-slate-950/30 px-4 py-3 text-[12px] text-slate-400 leading-relaxed">
            Chưa lấy được báo cáo tài chính từ nguồn doanh nghiệp (VNDirect) cho mã này.
            Orca <b className="text-slate-300">không tự tạo báo cáo</b> và không làm giả số liệu.
            {(() => {
              const url = dstockReportUrl(symbol, type);
              return (
                <>
                  {" "}
                  Bạn có thể{" "}
                  <a href={url} target="_blank" rel="noreferrer" className="text-cyan-300 underline">
                    mở báo cáo gốc trên VNDirect
                  </a>{" "}
                  để đối chiếu.
                </>
              );
            })()}
          </div>
        )}

        {data && data.periods.length > 0 && (
          <div className="stock-table-wrap">
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

        {data?.sourceEvidence && data.sourceEvidence.length > 0 && (
          <div className="mt-4 rounded-xl border border-cyan-900/60 bg-cyan-950/10 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-cyan-200">Nguồn báo cáo tài chính</div>
                <div className="mt-0.5 text-[10px] text-slate-500">Tài liệu được dùng để chuẩn hóa bảng số liệu hiện tại</div>
              </div>
              <span className="rounded-full border border-slate-700 bg-slate-950/40 px-2 py-1 text-[10px] text-slate-400">
                {data.sourceEvidence.length} tài liệu
              </span>
            </div>
            <div className="space-y-2">
              {data.sourceEvidence.map((source) => (
                <div key={source.id} className="rounded-lg border border-slate-800/80 bg-slate-950/30 px-3 py-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-200">
                        <span>{sourceName(source.source)}</span>
                        <span className="text-slate-500">•</span>
                        <span>{source.period ?? "Chưa xác định kỳ"}</span>
                        {source.reportType && <span className="text-slate-400">• {source.reportType}</span>}
                        <span className={source.verificationStatus === "verified" ? "text-emerald-300" : "text-amber-300"}>
                          • {source.verificationStatus === "verified" ? "Đã đối soát trực tiếp" : "Chưa đối soát"}
                        </span>
                      </div>
                      <div className="mt-1 grid gap-x-4 gap-y-0.5 text-[10px] text-slate-500 sm:grid-cols-2">
                        <span>Ngày công bố: <b className="font-normal text-slate-300">{dateLabel(source.filingDate)}</b></span>
                        <span>Ngày lấy dữ liệu: <b className="font-normal text-slate-300">{dateLabel(source.retrievedAt)}</b></span>
                        <span>Facts đã đối soát: <b className={`font-normal ${source.verificationStatus === "verified" ? "text-emerald-300" : "text-amber-300"}`}>{source.acceptedFactCount}/{source.factCount}</b></span>
                        <span>Parser: <b className="font-normal text-slate-300">{source.parserVersion}</b></span>
                      </div>
                    </div>
                    {source.documentUrl ? (
                      <a href={source.documentUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-md border border-cyan-700/60 px-2 py-1 text-[10px] text-cyan-300 hover:bg-cyan-500/10">
                        Mở tài liệu gốc ↗
                      </a>
                    ) : (
                      <span className="shrink-0 rounded-md border border-amber-800/60 px-2 py-1 text-[10px] text-amber-300">Thiếu liên kết gốc</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 rounded-lg border border-slate-800/80 bg-slate-950/20 px-3 py-2 text-[10px] text-slate-500 leading-relaxed">
          Đơn vị: tỷ VND (trừ EPS và BVPS tính bằng nghìn VND/cp). Số liệu được trích xuất trực tiếp từ nguồn doanh nghiệp (VNDirect — ưu tiên) hoặc Vietstock; nếu không có dữ liệu, bảng sẽ trống — Orca không dùng số liệu synthetic. Vẫn cần phân biệt hợp nhất/công ty mẹ, kiểm toán/soát xét và ngày công bố.
        </div>
      </div>
    </div>
  );
}
