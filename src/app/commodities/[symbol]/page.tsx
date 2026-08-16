"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, fmtNum, fmtPct, changeColor } from "@/lib/client";
import { ProtectedPage } from "@/components/ProtectedPage";

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
            {data.source && (
              <div className="text-[10px] font-mono text-slate-600 mt-1">nguồn: {data.source}</div>
            )}
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
