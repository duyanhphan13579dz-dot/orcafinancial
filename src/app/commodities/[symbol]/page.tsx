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
  changeDayPct: number | null;
  changeMonthPct: number | null;
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
      <div className="panel p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-sm text-slate-400">Giá hiện tại</div>
            <div className="text-3xl md:text-4xl font-bold text-white mt-1">
              {fmtNum(data.priceVnd, 0)} <span className="text-sm text-slate-500">VND</span>
            </div>
            {data.currency !== "VND" && (
              <div className="text-sm text-slate-500 mt-1">
                {fmtNum(data.price, 2)} {data.currency}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-sm text-slate-400">Biến động</div>
            <div className={`text-xl font-bold mt-1 ${changeColor(data.changeDayPct)}`}>
              {data.changeDayPct !== null ? fmtPct(data.changeDayPct) : "—"}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Tháng: {data.changeMonthPct !== null ? fmtPct(data.changeMonthPct) : "—"} ·
              Năm: {data.changeYearPct !== null ? fmtPct(data.changeYearPct) : "—"}
            </div>
          </div>
        </div>
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
