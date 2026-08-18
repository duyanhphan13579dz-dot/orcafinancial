"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fmtNum, fmtPct, fmtVol, usePoll } from "@/lib/client";

type Shape = "rectangle" | "circle";
type Metric = "tradingValue" | "volume";
type HeatColor = "ceiling" | "up" | "unchanged" | "down" | "floor" | "no-data";
interface Item {
  symbol: string; name: string; exchange: string; sector: string; industry: string;
  price: number | null; changePercent: number | null; volume: number | null; tradingValue: number;
  status: HeatColor; color: HeatColor; intensity: number; source: string | null; updatedAt: string | null;
}
interface Stats { ceiling: number; up: number; unchanged: number; down: number; floor: number; "no-data": number; total: number }
interface Rect { item: Item; x: number; y: number; w: number; h: number }

const STATUS_LABEL: Record<string, string> = {
  "pre-market": "Trước phiên", trading: "Đang giao dịch", "lunch-break": "Nghỉ trưa",
  "post-market": "Đã đóng cửa", closed: "Thị trường nghỉ",
};
const COLORS: Record<HeatColor, string> = {
  ceiling: "#8c159d", up: "#06c72d", unchanged: "#f8bc52", down: "#ef3034", floor: "#1684d8", "no-data": "#64748b",
};

function colorFor(item: Item) {
  if (item.color === "up") {
    const light = Math.round(42 - item.intensity * 12);
    return `hsl(132 94% ${light}%)`;
  }
  if (item.color === "down") {
    const light = Math.round(57 - item.intensity * 16);
    return `hsl(359 84% ${light}%)`;
  }
  return COLORS[item.color];
}
function textColor(item: Item) { return item.color === "up" || item.color === "unchanged" ? "#09223a" : "#fff"; }
function weight(item: Item, metric: Metric) { return Math.max(1, metric === "volume" ? (item.volume ?? 0) : item.tradingValue); }

/** Binary treemap: recursively bisects around half the total weight. */
function treemap(items: Item[], metric: Metric, x = 0, y = 0, w = 100, h = 100): Rect[] {
  if (!items.length) return [];
  if (items.length === 1) return [{ item: items[0], x, y, w, h }];
  const sorted = [...items].sort((a, b) => weight(b, metric) - weight(a, metric));
  const total = sorted.reduce((sum, item) => sum + weight(item, metric), 0);
  let cumulative = 0, split = 1, best = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    cumulative += weight(sorted[i - 1], metric);
    const distance = Math.abs(total / 2 - cumulative);
    if (distance < best) { best = distance; split = i; }
  }
  const first = sorted.slice(0, split), second = sorted.slice(split);
  const firstWeight = first.reduce((sum, item) => sum + weight(item, metric), 0);
  const ratio = Math.max(.12, Math.min(.88, firstWeight / total));
  if (w >= h) {
    const firstW = w * ratio;
    return [...treemap(first, metric, x, y, firstW, h), ...treemap(second, metric, x + firstW, y, w - firstW, h)];
  }
  const firstH = h * ratio;
  return [...treemap(first, metric, x, y, w, firstH), ...treemap(second, metric, x, y + firstH, w, h - firstH)];
}

function StockTooltip({ item, close }: { item: Item; close: () => void }) {
  return <div className="fixed z-[80] inset-x-3 bottom-24 mx-auto max-w-xs rounded-xl border border-[#2a4a75] bg-[#071a2d] p-4 shadow-2xl md:absolute md:inset-auto md:right-2 md:top-10 md:bottom-auto md:mx-0">
    <button onClick={close} className="absolute right-2 top-2 h-8 w-8 text-slate-400">✕</button>
    <div className="flex items-center gap-2"><span className="text-lg font-black text-white">{item.symbol}</span><span className="text-[10px] rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">{item.exchange || "—"}</span></div>
    <div className="text-xs text-slate-500 truncate">{item.name}</div>
    <div className="grid grid-cols-2 gap-y-1 mt-3 text-xs"><span className="text-slate-500">Giá</span><span className="text-right text-white">{fmtNum(item.price)}</span><span className="text-slate-500">Biến động</span><span className="text-right font-bold" style={{color:colorFor(item)}}>{fmtPct(item.changePercent)}</span><span className="text-slate-500">Khối lượng</span><span className="text-right text-white">{fmtVol(item.volume)}</span><span className="text-slate-500">GT giao dịch</span><span className="text-right text-white">{fmtVol(item.tradingValue)}</span></div>
    <Link href={`/stocks/${item.symbol}`} className="mt-3 flex min-h-10 items-center justify-center rounded-lg bg-[#00d4ff] text-xs font-bold text-[#0A2540]">Xem chi tiết →</Link>
  </div>;
}

export function StockHeatmap({ compact = false }: { compact?: boolean }) {
  const { data, meta, error, loading } = usePoll<Item[]>("/market/heatmap", 5000);
  const [shape, setShape] = useState<Shape>("rectangle");
  const [metric, setMetric] = useState<Metric>("tradingValue");
  const [exchange, setExchange] = useState("all");
  const [sector, setSector] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Item | null>(null);
  const marketStatus = String(meta?.marketStatus ?? "pre-market");
  const stats = meta?.stats as unknown as Stats | undefined;

  useEffect(() => {
    const stored = localStorage.getItem("orca_heatmap_shape");
    if (stored === "circle" || stored === "rectangle" || stored === "square") setShape(stored === "circle" ? "circle" : "rectangle");
  }, []);
  const setView = (value: Shape) => { setShape(value); localStorage.setItem("orca_heatmap_shape", value); };

  const allItems = data ?? [];
  const exchanges = useMemo(() => [...new Set(allItems.map((item) => item.exchange).filter(Boolean))].sort(), [allItems]);
  const sectors = useMemo(() => [...new Set(allItems.map((item) => item.sector).filter(Boolean))].sort(), [allItems]);
  const filtered = useMemo(() => allItems.filter((item) =>
    (exchange === "all" || item.exchange === exchange) &&
    (sector === "all" || item.sector === sector) &&
    (!query || item.symbol.includes(query.toUpperCase()) || item.name.toLowerCase().includes(query.toLowerCase()))
  ), [allItems, exchange, sector, query]);
  const groups = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of filtered) map.set(item.sector, [...(map.get(item.sector) ?? []), item]);
    return [...map.entries()].map(([name, items]) => ({ name, items, value: items.reduce((s, i) => s + weight(i, metric), 0) }))
      .sort((a, b) => b.value - a.value);
  }, [filtered, metric]);
  const visibleGroups = compact ? groups.slice(0, 6) : groups;

  return <section className="relative rounded-lg border border-[#d9e0e8] bg-[#f4f5f7] p-2 text-[#102136] shadow-sm">
    <div className="flex flex-wrap items-center gap-2 border-b border-[#d3d9e0] bg-white rounded-md px-2 py-2 mb-2">
      <div className="flex items-center gap-2 mr-auto"><span className={`h-2 w-2 rounded-full ${marketStatus === "trading" ? "bg-emerald-500 live-dot" : "bg-amber-500"}`}/><span className="text-xs font-bold">{STATUS_LABEL[marketStatus] ?? marketStatus}</span><span className="hidden sm:inline text-[10px] text-slate-500">· cập nhật 5 giây</span></div>
      <select value={exchange} onChange={(e)=>setExchange(e.target.value)} className="h-10 min-h-0 rounded-md border border-slate-300 bg-white px-2 text-xs"><option value="all">☰ Tất cả sàn</option>{exchanges.map((x)=><option key={x}>{x}</option>)}</select>
      <select value={sector} onChange={(e)=>setSector(e.target.value)} className="h-10 min-h-0 max-w-[155px] rounded-md border border-slate-300 bg-white px-2 text-xs"><option value="all">▦ Tất cả ngành</option>{sectors.map((x)=><option key={x}>{x}</option>)}</select>
      <select value={metric} onChange={(e)=>setMetric(e.target.value as Metric)} className="h-10 min-h-0 rounded-md border border-slate-300 bg-white px-2 text-xs"><option value="tradingValue">▣ GT giao dịch</option><option value="volume">▥ Khối lượng</option></select>
      <div className="flex h-10 rounded-md border border-slate-300 bg-white p-1"><button onClick={()=>setView("rectangle")} className={`px-2 rounded text-xs ${shape==="rectangle"?"bg-sky-50 text-sky-700":"text-slate-500"}`}>▭ Hình chữ nhật</button><button onClick={()=>setView("circle")} className={`px-2 rounded text-xs ${shape==="circle"?"bg-sky-50 text-sky-700":"text-slate-500"}`}>● Tròn</button></div>
    </div>

    {error && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {loading && !data && <div className="py-16 text-center text-sm text-slate-500">Đang dựng bản đồ thị trường…</div>}

    {shape === "rectangle" ? <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-1.5">
      {visibleGroups.map((group, index) => {
        const rects = treemap(group.items, metric);
        const large = index < 2 && !compact;
        return <article key={group.name} className={`rounded border border-[#e0e4e9] bg-[#f7f7f8] overflow-hidden ${large ? "xl:col-span-2" : ""}`}>
          <h3 className="h-7 flex items-center justify-center border-b border-[#e0e4e9] bg-[#f7f7f8] text-xs font-bold">{group.name}</h3>
          <div className={`relative ${large ? "h-[310px]" : compact ? "h-[170px]" : "h-[220px]"}`}>
            {rects.map((rect) => {
              const showChange = rect.w > 14 && rect.h > 16;
              const big = rect.w > 36 && rect.h > 34;
              return <button key={rect.item.symbol} onClick={()=>setSelected(rect.item)} title={`${rect.item.symbol} ${fmtPct(rect.item.changePercent)}`} className="absolute overflow-hidden border border-white/90 flex flex-col items-center justify-center hover:brightness-110 active:scale-[.98] transition" style={{left:`${rect.x}%`,top:`${rect.y}%`,width:`${rect.w}%`,height:`${rect.h}%`,background:colorFor(rect.item),color:textColor(rect.item)}}><span className={`${big?"text-2xl":"text-xs"} font-black leading-none`}>{rect.item.symbol}</span>{showChange&&<span className={`${big?"text-xl":"text-[10px]"} font-bold mt-1`}>{marketStatus==="pre-market"||marketStatus==="closed"?"—":fmtPct(rect.item.changePercent)}</span>}</button>;
            })}
          </div>
        </article>;
      })}
    </div> : <div className="grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(62px,1fr))]">{filtered.map((item)=><button key={item.symbol} onClick={()=>setSelected(item)} className="aspect-square rounded-full border-2 border-white flex flex-col items-center justify-center shadow-sm active:scale-95" style={{background:colorFor(item),color:textColor(item)}}><span className="text-xs font-black">{item.symbol}</span><span className="text-[9px] font-bold">{marketStatus==="pre-market"||marketStatus==="closed"?"—":fmtPct(item.changePercent)}</span></button>)}</div>}

    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 bg-white rounded-md border border-[#dde2e8] px-3 py-2 text-xs">
      {stats && <><Legend color={COLORS.ceiling} label={`Tăng trần: ${stats.ceiling}`}/><Legend color={COLORS.up} label={`Tăng giá: ${stats.up}`}/><Legend color={COLORS.unchanged} label={`Đứng giá: ${stats.unchanged}`}/><Legend color={COLORS.down} label={`Giảm giá: ${stats.down}`}/><Legend color={COLORS.floor} label={`Giảm sàn: ${stats.floor}`}/></>}
      <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Mã CK" className="ml-auto h-10 min-h-0 w-28 rounded border border-slate-300 bg-white px-3 text-sm"/>
    </div>
    {selected && <StockTooltip item={selected} close={()=>setSelected(null)}/>} 
    {compact && <Link href="/heatmap" className="mt-2 min-h-10 flex items-center justify-center rounded-md border border-sky-300 bg-white text-sm font-semibold text-sky-700">Mở heatmap toàn thị trường →</Link>}
  </section>;
}

function Legend({color,label}:{color:string;label:string}){return <span className="inline-flex items-center gap-1.5"><i className="h-3.5 w-7" style={{background:color}}/>{label}</span>}
