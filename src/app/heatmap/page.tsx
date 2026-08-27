"use client";

import { StockHeatmap } from "@/components/heatmap/StockHeatmap";

export default function HeatmapPage() {
  return (
    <div className="space-y-5">
      <div>
        <div className="font-mono text-[10px] tracking-[.3em] uppercase text-[#00d4ff]">
          PHÂN BỐ ĐỘ RỘNG THỊ TRƯỜNG
        </div>
        <h1 className="mt-1 text-3xl font-black text-white">Heatmap cổ phiếu</h1>
      </div>
      <StockHeatmap />
    </div>
  );
}
