"use client";

import type { OrcaDecision } from "@/lib/stock-intelligence/decision-engine";

interface SummaryData {
  decision: OrcaDecision;
  dataConfidence: number;
  financialPeriod: { latestQuarter: { label: string } } | null;
  dataAsOf: { price: { source: string; retrievedAt: string; status: string }; financial: { period: string | null; status: string; kind: string }; targetPrice: { period: string | null; status: string } };
}

const displayLabel = (value: string) => ({ BULLISH: "Tăng", BEARISH: "Giảm", NEUTRAL: "Trung tính", BUY: "Mua", SELL: "Bán", HOLD: "Giữ", "Strong Buy": "Mua mạnh", "Strong Sell": "Bán mạnh", ATTRACTIVE: "Hấp dẫn", FAIR: "Hợp lý", EXPENSIVE: "Đắt", LOW: "Thấp", MEDIUM: "Trung bình", HIGH: "Cao", INSUFFICIENT_DATA: "Chưa đủ dữ liệu" })[value] ?? value;
const tone = (value: string) => value === "BULLISH" || value.includes("Buy") || value === "ATTRACTIVE" ? "text-emerald-400" : value === "BEARISH" || value.includes("Sell") || value === "EXPENSIVE" ? "text-rose-400" : "text-amber-300";
const ago = (value: string) => { const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000)); return seconds < 60 ? `${seconds}s trước` : `${Math.floor(seconds / 60)}m trước`; };

export function StockExecutiveSummary({ data }: { data: SummaryData | null }) {
  if (!data) return <div className="panel mb-4 animate-pulse h-48 bg-slate-900/50" />;
  const { decision } = data;
  return (
    <section className="panel mb-4 border-cyan-900/60 bg-gradient-to-br from-slate-900 to-slate-950 p-4 md:p-5" aria-label="Tóm tắt điều hành ORCA">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-400">TÓM TẮT ĐIỀU HÀNH ORCA</div><div className="mt-1 text-xs text-slate-500">{decision.modelVersion}</div></div>
        <div className={`rounded-md border border-current/30 bg-current/10 px-3 py-1 text-sm font-bold ${tone(decision.verdict)}`}>{displayLabel(decision.verdict)}</div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="Điểm ORCA" value={`${decision.score}/100`} tone="text-cyan-300" />
        <Metric label="Độ tin cậy dự báo" value={`${Math.round(decision.predictionConfidence * 100)}%`} tone="text-slate-200" />
        <Metric label="Rủi ro" value={displayLabel(decision.risk)} tone={tone(decision.risk)} />
        <Metric label="Xu hướng" value={displayLabel(decision.trend)} tone={tone(decision.trend)} />
        <Metric label="Định giá" value={displayLabel(decision.valuation)} tone={tone(decision.valuation)} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div><div className="mb-2 text-xs font-semibold text-slate-300">Lý do</div><div className="space-y-1 text-xs text-slate-400">{decision.why.length ? decision.why.map((item) => <div key={item} className="border-l-2 border-emerald-500/50 pl-2">{item}</div>) : <div>Chưa có đủ dữ liệu để kết luận.</div>}</div></div>
        <div><div className="mb-2 text-xs font-semibold text-slate-300">Nhiều khung thời gian</div><div className="grid grid-cols-3 gap-2 text-xs">{[["1–5D", decision.horizons.shortTerm], ["1–4W", decision.horizons.mediumTerm], ["3–12M", decision.horizons.longTerm]].map(([label, value]) => <div key={label} className="rounded border border-slate-800 bg-slate-950/60 p-2"><div className="text-[10px] text-slate-500">{label}</div><div className={`mt-1 font-semibold ${tone(String(value))}`}>{value}</div></div>)}</div></div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-800 pt-3 text-[10px] text-slate-500 md:grid-cols-4"><span>Giá: {ago(data.dataAsOf.price.retrievedAt)} · {data.dataAsOf.price.status}</span><span>Tài chính: {data.dataAsOf.financial.period ?? data.financialPeriod?.latestQuarter.label ?? "Chưa có"} · {data.dataAsOf.financial.kind}</span><span>Độ tin cậy dữ liệu: {Math.round(data.dataConfidence * 100)}%</span><span>Mục tiêu: {data.dataAsOf.targetPrice.period ?? "Chưa có"}</span></div>
    </section>
  );
}
function Metric({ label, value, tone: color }: { label: string; value: string; tone: string }) { return <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3"><div className="text-[10px] text-slate-500">{label}</div><div className={`mt-1 text-sm font-bold ${color}`}>{value}</div></div>; }
