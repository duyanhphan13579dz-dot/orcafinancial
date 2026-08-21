"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fmtNum, fmtPct, fmtVol, usePoll } from "@/lib/client";

type Shape = "rectangle" | "circle";
type Metric = "tradingValue" | "volume";
type HeatColor = "ceiling" | "up" | "unchanged" | "down" | "floor" | "no-data";

interface Item {
  symbol: string;
  name: string;
  exchange: string;
  sector: string;
  industry: string;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  tradingValue: number;
  status: HeatColor;
  color: HeatColor;
  intensity: number;
  source: string | null;
  updatedAt: string | null;
}

interface Stats {
  ceiling: number;
  up: number;
  unchanged: number;
  down: number;
  floor: number;
  "no-data": number;
  total: number;
}

interface Rect {
  item: Item;
  x: number;
  y: number;
  w: number;
  h: number;
}

const STATUS_LABEL: Record<string, string> = {
  "pre-market": "Trước phiên",
  trading: "Đang giao dịch",
  "lunch-break": "Nghỉ trưa",
  "post-market": "Đã đóng cửa",
  closed: "Thị trường nghỉ",
};

const COLORS: Record<HeatColor, string> = {
  ceiling: "#c026d3",
  up: "#10b981",
  unchanged: "#f59e0b",
  down: "#f43f5e",
  floor: "#3b82f6",
  "no-data": "#475569",
};

function colorFor(item: Item) {
  if (item.color === "up") {
    const light = Math.round(38 - item.intensity * 10);
    return `hsl(160 84% ${light}%)`;
  }
  if (item.color === "down") {
    const light = Math.round(48 - item.intensity * 14);
    return `hsl(350 89% ${light}%)`;
  }
  return COLORS[item.color];
}

function textColor(item: Item) {
  return item.color === "unchanged" || item.color === "no-data" ? "#e2e8f0" : "#fff";
}

function weight(item: Item, metric: Metric) {
  return Math.max(1, metric === "volume" ? (item.volume ?? 0) : item.tradingValue);
}

function treemap(items: Item[], metric: Metric, x = 0, y = 0, w = 100, h = 100): Rect[] {
  if (!items.length) return [];
  if (items.length === 1) return [{ item: items[0], x, y, w, h }];
  const sorted = [...items].sort((a, b) => weight(b, metric) - weight(a, metric));
  const total = sorted.reduce((sum, item) => sum + weight(item, metric), 0);
  let cumulative = 0;
  let split = 1;
  let best = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    cumulative += weight(sorted[i - 1], metric);
    const distance = Math.abs(total / 2 - cumulative);
    if (distance < best) {
      best = distance;
      split = i;
    }
  }
  const first = sorted.slice(0, split);
  const second = sorted.slice(split);
  const firstWeight = first.reduce((sum, item) => sum + weight(item, metric), 0);
  const ratio = Math.max(0.12, Math.min(0.88, firstWeight / total));
  if (w >= h) {
    const firstW = w * ratio;
    return [
      ...treemap(first, metric, x, y, firstW, h),
      ...treemap(second, metric, x + firstW, y, w - firstW, h),
    ];
  }
  const firstH = h * ratio;
  return [
    ...treemap(first, metric, x, y, w, firstH),
    ...treemap(second, metric, x, y + firstH, w, h - firstH),
  ];
}

function StockTooltip({ item, close }: { item: Item; close: () => void }) {
  return (
    <div className="fixed z-[80] inset-x-3 bottom-24 mx-auto max-w-xs rounded-xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl backdrop-blur md:absolute md:inset-auto md:right-2 md:top-10 md:bottom-auto md:mx-0">
      <button
        type="button"
        onClick={close}
        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 touch-min"
      >
        ✕
      </button>
      <div className="flex items-center gap-2 pr-8">
        <span className="text-lg font-black text-white">{item.symbol}</span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
          {item.exchange || "—"}
        </span>
      </div>
      <div className="truncate text-xs text-slate-500">{item.name}</div>
      <div className="mt-1 text-[10px] text-slate-600">
        {item.sector} · {item.industry}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-y-1.5 text-xs">
        <span className="text-slate-500">Giá</span>
        <span className="text-right font-mono text-white">{fmtNum(item.price)}</span>
        <span className="text-slate-500">Biến động</span>
        <span className="text-right font-bold" style={{ color: colorFor(item) }}>
          {fmtPct(item.changePercent)}
        </span>
        <span className="text-slate-500">Khối lượng</span>
        <span className="text-right font-mono text-white">{fmtVol(item.volume)}</span>
        <span className="text-slate-500">GTGD</span>
        <span className="text-right font-mono text-white">{fmtVol(item.tradingValue)}</span>
      </div>
      <Link
        href={`/stocks/${item.symbol}`}
        className="mt-3 flex min-h-11 items-center justify-center rounded-lg bg-[#00d4ff] text-xs font-bold text-[#0A2540] hover:brightness-110"
      >
        Xem chi tiết →
      </Link>
    </div>
  );
}

const selectClass =
  "h-10 min-h-10 rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-xs text-slate-200 outline-none focus:border-[#00d4ff]/50";

export function StockHeatmap({ compact = false }: { compact?: boolean }) {
  const { data, meta, error, loading } = usePoll<Item[]>("/market/heatmap", 12_000);
  const [shape, setShape] = useState<Shape>("rectangle");
  const [metric, setMetric] = useState<Metric>("tradingValue");
  const [exchange, setExchange] = useState("all");
  const [sector, setSector] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Item | null>(null);
  const marketStatus = String(meta?.marketStatus ?? "pre-market");
  const stats = meta?.stats as unknown as Stats | undefined;

  useEffect(() => {
    try {
      const stored = localStorage.getItem("orca_heatmap_shape");
      if (stored === "circle" || stored === "rectangle" || stored === "square") {
        setShape(stored === "circle" ? "circle" : "rectangle");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const setView = (value: Shape) => {
    setShape(value);
    try {
      localStorage.setItem("orca_heatmap_shape", value);
    } catch {
      /* ignore */
    }
  };

  const allItems = data ?? [];
  const exchanges = useMemo(
    () => [...new Set(allItems.map((item) => item.exchange).filter(Boolean))].sort(),
    [allItems],
  );
  const sectors = useMemo(
    () => [...new Set(allItems.map((item) => item.sector).filter(Boolean))].sort(),
    [allItems],
  );
  const filtered = useMemo(
    () =>
      allItems.filter(
        (item) =>
          (exchange === "all" || item.exchange === exchange) &&
          (sector === "all" || item.sector === sector) &&
          (!query ||
            item.symbol.includes(query.toUpperCase()) ||
            item.name.toLowerCase().includes(query.toLowerCase())),
      ),
    [allItems, exchange, sector, query],
  );
  const groups = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of filtered) {
      map.set(item.sector, [...(map.get(item.sector) ?? []), item]);
    }
    return [...map.entries()]
      .map(([name, items]) => ({
        name,
        items,
        value: items.reduce((s, i) => s + weight(i, metric), 0),
      }))
      .sort((a, b) => b.value - a.value);
  }, [filtered, metric]);
  const visibleGroups = compact ? groups.slice(0, 6) : groups;

  const neutralSession = marketStatus === "pre-market" || marketStatus === "closed";

  return (
    <section className="relative space-y-3">
      {/* Toolbar — matches Crypto/Forex dark panels */}
      <div className="panel flex flex-col gap-2 p-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="mr-auto flex items-center gap-2">
          <i
            className={`h-2 w-2 rounded-full ${
              marketStatus === "trading" ? "bg-emerald-400 live-dot" : "bg-amber-400"
            }`}
          />
          <span className="text-xs font-semibold text-slate-200">
            {STATUS_LABEL[marketStatus] ?? marketStatus}
          </span>
          <span className="hidden text-[10px] text-slate-500 sm:inline">· cập nhật ~12s</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={exchange}
            onChange={(e) => setExchange(e.target.value)}
            className={selectClass}
          >
            <option value="all">Tất cả sàn</option>
            {exchanges.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className={`${selectClass} max-w-[160px]`}
          >
            <option value="all">Tất cả ngành</option>
            {sectors.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as Metric)}
            className={selectClass}
          >
            <option value="tradingValue">GT giao dịch</option>
            <option value="volume">Khối lượng</option>
          </select>
          <div className="flex h-10 rounded-lg border border-slate-700 bg-slate-900 p-0.5">
            <button
              type="button"
              onClick={() => setView("rectangle")}
              className={`rounded-md px-2.5 text-xs touch-min ${
                shape === "rectangle"
                  ? "bg-[#00d4ff]/15 text-[#00d4ff]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              ▭ Ô
            </button>
            <button
              type="button"
              onClick={() => setView("circle")}
              className={`rounded-md px-2.5 text-xs touch-min ${
                shape === "circle"
                  ? "bg-[#00d4ff]/15 text-[#00d4ff]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              ● Tròn
            </button>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Mã CK…"
            className="Input h-10 min-h-10 w-full sm:w-28"
          />
        </div>
      </div>

      {error && (
        <div className="panel border-rose-800 bg-rose-950/30 p-4 text-sm text-rose-300">{error}</div>
      )}
      {loading && !data && (
        <div className="panel p-12 text-center text-sm text-slate-500">
          Đang dựng bản đồ thị trường…
        </div>
      )}

      {shape === "rectangle" ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {visibleGroups.map((group, index) => {
            const rects = treemap(group.items, metric);
            const large = index < 2 && !compact;
            return (
              <article
                key={group.name}
                className={`panel overflow-hidden p-0 ${
                  large ? "xl:col-span-2" : ""
                }`}
              >
                <h3 className="flex h-8 items-center justify-center border-b border-slate-800 bg-slate-900/80 text-xs font-bold text-slate-300">
                  {group.name}
                  <span className="ml-2 text-[10px] font-normal text-slate-600">
                    {group.items.length}
                  </span>
                </h3>
                <div
                  className={`relative ${
                    large ? "h-[280px] sm:h-[310px]" : compact ? "h-[160px]" : "h-[200px] sm:h-[220px]"
                  }`}
                >
                  {rects.map((rect) => {
                    const showChange = rect.w > 14 && rect.h > 16;
                    const big = rect.w > 36 && rect.h > 34;
                    return (
                      <button
                        type="button"
                        key={rect.item.symbol}
                        onClick={() => setSelected(rect.item)}
                        title={`${rect.item.symbol} ${fmtPct(rect.item.changePercent)}`}
                        className="absolute flex flex-col items-center justify-center overflow-hidden border border-slate-950/40 transition hover:brightness-110 active:scale-[.98]"
                        style={{
                          left: `${rect.x}%`,
                          top: `${rect.y}%`,
                          width: `${rect.w}%`,
                          height: `${rect.h}%`,
                          background: colorFor(rect.item),
                          color: textColor(rect.item),
                        }}
                      >
                        <span className={`${big ? "text-xl sm:text-2xl" : "text-[10px] sm:text-xs"} font-black leading-none`}>
                          {rect.item.symbol}
                        </span>
                        {showChange && (
                          <span
                            className={`${big ? "text-base sm:text-xl" : "text-[9px] sm:text-[10px]"} mt-0.5 font-bold`}
                          >
                            {neutralSession ? "—" : fmtPct(rect.item.changePercent)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="panel grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-1.5 p-3 sm:grid-cols-[repeat(auto-fill,minmax(64px,1fr))]">
          {filtered.map((item) => (
            <button
              type="button"
              key={item.symbol}
              onClick={() => setSelected(item)}
              className="flex aspect-square flex-col items-center justify-center rounded-full border border-slate-800 shadow-sm transition active:scale-95 hover:brightness-110"
              style={{ background: colorFor(item), color: textColor(item) }}
            >
              <span className="text-[10px] font-black sm:text-xs">{item.symbol}</span>
              <span className="text-[8px] font-bold sm:text-[9px]">
                {neutralSession ? "—" : fmtPct(item.changePercent)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="panel flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-xs text-slate-400">
        {stats && (
          <>
            <Legend color={COLORS.ceiling} label={`Trần ${stats.ceiling}`} />
            <Legend color={COLORS.up} label={`Tăng ${stats.up}`} />
            <Legend color={COLORS.unchanged} label={`Đứng ${stats.unchanged}`} />
            <Legend color={COLORS.down} label={`Giảm ${stats.down}`} />
            <Legend color={COLORS.floor} label={`Sàn ${stats.floor}`} />
            <span className="text-slate-600">· {stats.total} mã</span>
          </>
        )}
      </div>

      {selected && <StockTooltip item={selected} close={() => setSelected(null)} />}

      {compact && (
        <Link
          href="/heatmap"
          className="flex min-h-11 items-center justify-center rounded-lg border border-[#00d4ff]/30 bg-[#00d4ff]/10 text-sm font-semibold text-[#00d4ff] hover:bg-[#00d4ff]/15"
        >
          Mở heatmap toàn thị trường →
        </Link>
      )}
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className="h-3 w-5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
