"use client";

import { StockHeatmap } from "@/components/heatmap/StockHeatmap";

export default function HeatmapPage() {
  return (
    <div className="space-y-5">
      <div>
        <div className="font-mono text-[10px] tracking-[.3em] uppercase text-[#00d4ff]">
          Market Breadth Visualization
        </div>
        <h1 className="mt-1 text-3xl font-black text-white">Heatmap cổ phiếu</h1>
        <p className="mt-1 text-sm text-slate-400">
          Kích thước theo GTGD / khối lượng · màu theo biến động phiên · dữ liệu VNDirect &
          snapshot nội bộ
        </p>
      </div>
      <StockHeatmap />
    </div>
  );
}
