"use client";
import { ProtectedPage } from "@/components/ProtectedPage";
import { StockHeatmap } from "@/components/heatmap/StockHeatmap";
export default function HeatmapPage() {
  return <ProtectedPage featureName="heatmap toàn thị trường"><div className="space-y-4"><div><div className="font-mono text-[10px] tracking-[.3em] uppercase text-[#00d4ff]">Market Breadth Visualization</div><h1 className="text-3xl font-black text-white mt-1">Heatmap cổ phiếu</h1><p className="text-sm text-slate-400 mt-1">Màu sắc phản ánh biến động phiên; dữ liệu chưa giao dịch hiển thị vàng/trung tính.</p></div><StockHeatmap /></div></ProtectedPage>;
}
