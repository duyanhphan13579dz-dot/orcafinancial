"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, fmtNum, fmtPct, changeColor } from "@/lib/client";
import { ProtectedPage } from "@/components/ProtectedPage";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

interface HistoryPoint { date: string; priceVnd: number; price: number; source: string | null }

interface CommodityDetail {
  symbol: string;
  name: string;
  nameEn: string;
  group: string;
  unit: string;
  price: number;
  priceVnd: number;
  currency: string;
  date: string;
  source: string | null;
  dataAgeSeconds: number;
  freshness: "live" | "delayed" | "stale";
  prevClose: number | null;
  high52w: number | null;
  low52w: number | null;
  changeDayPct: number | null;
  changeWeekPct: number | null;
  changeMonthPct: number | null;
  changeYtdPct: number | null;
  changeYearPct: number | null;
  stockImpacts: Array<{
    symbol: string;
    impactType: "positive" | "negative" | "neutral";
    impactScore: number;
    reason: string | null;
  }>;
}

export default function CommodityDetailPage() {
  const params = useParams();
  const symbol = params.symbol as string;
  const [data, setData] = useState<CommodityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState("1M");
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    api<{ commodity: CommodityDetail }>(`/commodities/${symbol}`)
      .then((res) => {
        setData(res.data.commodity);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [symbol]);

  useEffect(() => {
    const days: Record<string, number> = { "1D": 1, "1W": 7, "1M": 31, "3M": 93, "6M": 186, "1Y": 366, "5Y": 1826 };
    const to = new Date();
    const from = new Date(to.getTime() - (days[range] ?? 31) * 86_400_000);
    api<{ history: HistoryPoint[] }>(`/commodities/${symbol}/history?from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`)
      .then((res) => setHistory(res.data.history))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [symbol, range]);

  if (loading) {
    return (
      <div className="panel p-12 text-center text-slate-500">
        <div className="inline-block h-6 w-6 border-2 border-[#00d4ff] border-t-transparent rounded-full animate-spin" />
        <div className="mt-3 text-sm">Đang tải...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="panel border-rose-700 bg-rose-950/30 p-4 text-sm text-rose-300">
        {error || "Không tìm thấy dữ liệu"}
      </div>
    );
  }

  const trend = (data.changeMonthPct ?? data.changeWeekPct ?? 0) >= 0 ? "Bullish" : "Bearish";
  const momentum = Math.abs(data.changeMonthPct ?? data.changeWeekPct ?? 0) >= 3 ? "Strong" : "Moderate";
  const rangePosition = data.high52w && data.low52w && data.high52w > data.low52w ? (data.priceVnd - data.low52w) / (data.high52w - data.low52w) : 0.5;
  const insight = trend === "Bullish"
    ? `Giá đang duy trì xu hướng tăng ${momentum === "Strong" ? "mạnh" : "tích cực"} trong khung quan sát hiện tại. Tuy nhiên, cần theo dõi vùng ${Math.round(rangePosition * 100)}% của biên độ 52 tuần để đánh giá rủi ro điều chỉnh ngắn hạn.`
    : "Giá đang chịu áp lực giảm trong khung quan sát hiện tại. Nên theo dõi khả năng tạo đáy và sự cải thiện của biến động trước khi kết luận xu hướng mới.";
  const chartData = history.map((p, i, arr) => ({ ...p, label: new Date(p.date).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }), ma20: arr.slice(Math.max(0, i - 19), i + 1).reduce((s, x) => s + x.priceVnd, 0) / Math.min(i + 1, 20), ma50: arr.slice(Math.max(0, i - 49), i + 1).reduce((s, x) => s + x.priceVnd, 0) / Math.min(i + 1, 50) }));

  return (
    <ProtectedPage featureName="chi tiết hàng hóa">
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link href="/commodities" className="text-xs text-[#00d4ff] hover:underline">
          ← Quay lại
        </Link>
        <h1 className="text-xl md:text-2xl font-bold text-white mt-3">{data.name}</h1>
        <p className="text-xs text-slate-400 mt-1">{data.nameEn} · {data.unit}</p>
      </div>

      {/* Price Card */}
      <div className="panel p-5 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-sm text-slate-400">Giá hiện tại</div>
            <div className="text-3xl md:text-4xl font-bold text-white mt-1 tabular-nums">
              {Math.round(data.priceVnd).toLocaleString("vi-VN")} <span className="text-sm text-slate-500">VND</span>
            </div>
            {data.currency !== "VND" && (
              <div className="text-sm text-slate-500 mt-1 font-mono">
                gốc: {fmtNum(data.price, 2)} {data.currency} · {data.unit}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-sm text-slate-400">Thay đổi trong ngày</div>
            <div className={`text-2xl font-bold mt-1 tabular-nums ${changeColor(data.changeDayPct)}`}>
              {data.changeDayPct !== null ? fmtPct(data.changeDayPct) : "—"}
            </div>
            <div className={`text-[10px] font-mono mt-1 ${data.freshness === "live" ? "text-emerald-400" : data.freshness === "delayed" ? "text-amber-400" : "text-rose-400"}`}>
              {data.freshness === "live" ? "● Live" : data.freshness === "delayed" ? "● Delayed" : "● Stale"} · {data.dataAgeSeconds < 60 ? `${data.dataAgeSeconds}s trước` : `${Math.round(data.dataAgeSeconds / 60)}m trước`} · {data.source ?? "không rõ nguồn"}
            </div>
          </div>
        </div>

        {/* Change grid */}
        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-2">
          {([
            ["7 ngày", data.changeWeekPct],
            ["30 ngày", data.changeMonthPct],
            ["Từ đầu năm", data.changeYtdPct],
            ["1 năm", data.changeYearPct],
          ] as Array<[string, number | null]>).map(([label, v]) => (
            <div key={label} className="rounded-lg border border-[#1a3558] bg-[#0a1d33]/50 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
              <div className={`font-mono tabular-nums text-base font-semibold mt-0.5 ${changeColor(v)}`}>
                {v !== null ? fmtPct(v) : "—"}
              </div>
            </div>
          ))}
        </div>

        {/* 52-week range */}
        {data.high52w !== null && data.low52w !== null && data.high52w > data.low52w && (
          <div className="mt-5">
            <div className="flex justify-between text-[11px] text-slate-500 mb-1.5">
              <span>Thấp nhất 52 tuần</span>
              <span>Cao nhất 52 tuần</span>
            </div>
            <div className="h-2 rounded-full bg-slate-700 relative overflow-hidden">
              <div
                className="absolute top-0 h-full w-1.5 rounded-full bg-[#00d4ff] shadow-[0_0_8px_#00d4ff]"
                style={{
                  left: `calc(${Math.max(0, Math.min(100, ((data.priceVnd - data.low52w) / (data.high52w - data.low52w)) * 100))}% - 3px)`,
                }}
              />
            </div>
            <div className="flex justify-between text-xs font-mono tabular-nums text-slate-400 mt-1.5">
              <span>{Math.round(data.low52w).toLocaleString("vi-VN")}</span>
              <span>{Math.round(data.high52w).toLocaleString("vi-VN")}</span>
            </div>
          </div>
        )}
      </div>

      {/* Interactive terminal chart */}
      <div className="panel p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div><h2 className="text-lg font-bold text-white">Biểu đồ giá</h2><p className="text-[11px] text-slate-500">Đơn vị: VND · dữ liệu nguồn {data.source ?? "—"}</p></div>
          <div className="flex gap-1 overflow-x-auto">{["1D", "1W", "1M", "3M", "6M", "1Y", "5Y"].map((r) => <button key={r} onClick={() => setRange(r)} className={`px-2.5 py-1.5 rounded text-[11px] font-mono ${range === r ? "bg-[#00d4ff] text-[#0A2540]" : "bg-[#0e2e4f] text-slate-400"}`}>{r}</button>)}</div>
        </div>
        <div className="h-64">{historyLoading ? <div className="h-full grid place-items-center text-sm text-slate-500">Đang tải lịch sử…</div> : chartData.length < 2 ? <div className="h-full grid place-items-center text-sm text-slate-500">Chưa đủ dữ liệu lịch sử cho khung này</div> : <ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid stroke="#173653" strokeDasharray="3 3" /><XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 10 }} minTickGap={28} /><YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={(v) => Math.round(v).toLocaleString("vi-VN")} width={72} domain={["auto", "auto"]} /><Tooltip contentStyle={{ background: "#0a1d33", border: "1px solid #1a3558", color: "#fff" }} formatter={(v, name) => { const n = Number(v ?? 0); const label = String(name); return [Math.round(n).toLocaleString("vi-VN"), label === "priceVnd" ? "Giá" : label.toUpperCase()]; }} /><Line type="monotone" dataKey="priceVnd" stroke="#00d4ff" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="ma20" stroke="#fbbf24" strokeWidth={1.5} dot={false} /><Line type="monotone" dataKey="ma50" stroke="#c084fc" strokeWidth={1.5} dot={false} /></LineChart></ResponsiveContainer>}</div>
        <div className="mt-3 flex gap-4 text-[10px] text-slate-500"><span><i className="inline-block w-3 h-0.5 bg-[#00d4ff] align-middle mr-1" />Giá</span><span><i className="inline-block w-3 h-0.5 bg-amber-400 align-middle mr-1" />MA20</span><span><i className="inline-block w-3 h-0.5 bg-purple-400 align-middle mr-1" />MA50</span></div>
      </div>

      {/* Orca Commodity Insight */}
      <div className="panel p-4 md:p-5 border-[#00d4ff]/25">
        <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-[#00d4ff]">Orca Commodity Insight</div>
        <p className="text-sm text-slate-300 leading-6 mt-2">{insight}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4"><div className="rounded bg-[#0a1d33] p-2"><div className="text-[10px] text-slate-500">Trend</div><b className={trend === "Bullish" ? "text-emerald-400" : "text-rose-400"}>{trend}</b></div><div className="rounded bg-[#0a1d33] p-2"><div className="text-[10px] text-slate-500">Momentum</div><b className="text-emerald-400">{momentum}</b></div><div className="rounded bg-[#0a1d33] p-2"><div className="text-[10px] text-slate-500">Volatility</div><b className="text-amber-400">Moderate</b></div><div className="rounded bg-[#0a1d33] p-2"><div className="text-[10px] text-slate-500">Risk</div><b className="text-orange-400">{rangePosition > 0.85 ? "Elevated" : "Moderate"}</b></div></div>
      </div>

      {/* Stock Impacts */}
      {data.stockImpacts.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-white mb-3">Cổ phiếu bị ảnh hưởng</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.stockImpacts.map((impact, i) => (
              <Link
                key={impact.symbol}
                href={`/stocks/${impact.symbol}`}
                className="panel p-4 hover:border-[#00d4ff]/50 transition-all active:scale-[0.98]"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-white">{impact.symbol}</span>
                  <span
                    className={`text-[10px] px-2 py-1 rounded font-medium ${
                      impact.impactType === "positive"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : impact.impactType === "negative"
                        ? "bg-rose-500/20 text-rose-400"
                        : "bg-slate-700 text-slate-400"
                    }`}
                  >
                    {impact.impactType === "positive" ? "Tích cực" : impact.impactType === "negative" ? "Tiêu cực" : "Trung lập"}
                  </span>
                </div>
                <div className="text-xs text-slate-400">
                  Điểm: {(impact.impactScore * 100).toFixed(0)}%
                </div>
                {impact.reason && (
                  <div className="text-xs text-slate-500 mt-2 line-clamp-2">
                    {impact.reason}
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {data.stockImpacts.length === 0 && (
        <div className="panel p-8 text-center text-slate-500 text-sm">
          Chưa có mapping cổ phiếu bị ảnh hưởng cho hàng hóa này
        </div>
      )}
    </div>
    </ProtectedPage>
  );
}
