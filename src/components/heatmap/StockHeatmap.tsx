"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, fmtNum, fmtPct, fmtVol, usePoll } from "@/lib/client";

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
  confidence: number | null;
  updatedAt: string | null;
  ageSeconds: number | null;
  isStale: boolean;
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
  PRE_MARKET: "Trước phiên",
  TRADING: "Đang giao dịch",
  LUNCH_BREAK: "Nghỉ trưa",
  POST_MARKET: "Sau phiên",
  CLOSED: "Đã đóng cửa",
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

type HistoryBar = { time: number; close: number; volume: number };
type Intelligence = {
  analysis?: { recommendation?: string; score?: number; confidence?: number; reasons?: string[] };
  technical?: { candlestickPatterns?: { nameVi?: string; type?: string }[]; chartPatterns?: { nameVi?: string; type?: string }[] };
  fundamental?: { roe?: number | null; valuation?: { pe?: number | null; pb?: number | null }; financialHealth?: { rating?: string } };
  news?: { items?: { title?: string; publishedAt?: string; sourceName?: string }[] };
};

function MiniChart({ bars }: { bars: HistoryBar[] }) {
  if (bars.length < 2) return <div className="flex h-20 items-center justify-center text-[10px] text-slate-600">Chưa đủ dữ liệu lịch sử</div>;
  const values = bars.map((bar) => bar.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = max === min ? 50 : 92 - ((value - min) / (max - min)) * 84;
    return `${x},${y}`;
  }).join(" ");
  const positive = values[values.length - 1] >= values[0];
  return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-20 w-full"><polyline fill="none" stroke={positive ? "#10b981" : "#f43f5e"} strokeWidth="2.5" points={points} vectorEffect="non-scaling-stroke" /></svg>;
}

function StockTooltip({ item, close }: { item: Item; close: () => void }) {
  const [timeframe, setTimeframe] = useState("1M");
  const [bars, setBars] = useState<HistoryBar[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [intelligence, setIntelligence] = useState<Intelligence>({});
  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      api<{ recommendation?: string; score?: number; confidence?: number; reasons?: string[] }>(`/stocks/${item.symbol}/analysis`),
      api<{ candlestickPatterns?: { nameVi?: string; type?: string }[]; chartPatterns?: { nameVi?: string; type?: string }[] }>(`/stocks/${item.symbol}/technical?timeframe=1d`),
      api<{ roe?: number | null; valuation?: { pe?: number | null; pb?: number | null }; financialHealth?: { rating?: string } }>(`/stocks/${item.symbol}/fundamental`),
      api<{ items?: { title?: string; publishedAt?: string; sourceName?: string }[] }>(`/news?symbol=${item.symbol}&limit=3`),
    ]).then(([analysis, technical, fundamental, news]) => {
      if (!active) return;
      setIntelligence({
        analysis: analysis.status === "fulfilled" ? analysis.value.data : undefined,
        technical: technical.status === "fulfilled" ? technical.value.data : undefined,
        fundamental: fundamental.status === "fulfilled" ? fundamental.value.data : undefined,
        news: news.status === "fulfilled" ? news.value.data : undefined,
      });
    });
    return () => { active = false; };
  }, [item.symbol]);
  useEffect(() => {
    if (!playing || bars.length < 2) return;
    const timer = window.setInterval(() => {
      setPlaybackIndex((index) => {
        if (index >= bars.length - 1) { setPlaying(false); return 0; }
        return index + 1;
      });
    }, Math.max(180, 900 / speed));
    return () => window.clearInterval(timer);
  }, [playing, speed, bars.length]);
  useEffect(() => {
    let active = true;
    void api<{ bars: HistoryBar[] }>(`/market/heatmap/history?symbol=${encodeURIComponent(item.symbol)}&timeframe=${timeframe}`)
      .then((result) => { if (active) setBars(result.data.bars ?? []); })
      .catch(() => { if (active) setBars([]); })
      .finally(() => { if (active) setLoadingHistory(false); });
    return () => { active = false; };
  }, [item.symbol, timeframe]);
  return (
    <div className="fixed z-[80] inset-x-3 bottom-24 mx-auto w-[min(92vw,360px)] rounded-xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl backdrop-blur md:absolute md:inset-auto md:right-2 md:top-10 md:bottom-auto md:mx-0">
      <button type="button" onClick={close} aria-label="Đóng" className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 touch-min">✕</button>
      <div className="flex items-center gap-2 pr-8"><span className="text-lg font-black text-white">{item.symbol}</span><span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">{item.exchange || "—"}</span></div>
      <div className="truncate text-xs text-slate-500">{item.name}</div><div className="mt-1 text-[10px] text-slate-600">{item.sector} · {item.industry}</div>
      <div className="mt-3 grid grid-cols-2 gap-y-1.5 text-xs"><span className="text-slate-500">Giá</span><span className="text-right font-mono text-white">{fmtNum(item.price)}</span><span className="text-slate-500">Biến động</span><span className="text-right font-bold" style={{ color: colorFor(item) }}>{fmtPct(item.changePercent)}</span><span className="text-slate-500">Khối lượng</span><span className="text-right font-mono text-white">{fmtVol(item.volume)}</span><span className="text-slate-500">GTGD</span><span className="text-right font-mono text-white">{fmtVol(item.tradingValue)}</span></div>
      <div className="mt-3 flex items-center justify-between"><span className="text-[10px] uppercase tracking-widest text-slate-500">Lịch sử</span><div className="flex gap-1">{["1D", "1W", "1M", "3M", "YTD", "1Y"].map((value) => <button key={value} type="button" onClick={() => { setPlaying(false); setPlaybackIndex(0); setTimeframe(value); }} className={`rounded px-1.5 py-1 text-[9px] ${timeframe === value ? "bg-[#00d4ff]/20 text-[#00d4ff]" : "text-slate-500 hover:text-white"}`}>{value}</button>)}</div></div>
      <div className="mt-1 rounded-lg bg-slate-950/70 p-2">{loadingHistory ? <div className="h-20 animate-pulse rounded bg-slate-800/40" /> : <MiniChart bars={bars} />}</div>
      {bars.length > 1 && <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2"><div className="flex items-center gap-2"><button type="button" onClick={() => setPlaying((value) => !value)} className="rounded bg-[#00d4ff]/15 px-2 py-1 text-[10px] font-bold text-[#00d4ff]">{playing ? "Pause" : "Play"}</button><input aria-label="Playback timeline" type="range" min={0} max={bars.length - 1} value={Math.min(playbackIndex, bars.length - 1)} onChange={(event) => { setPlaying(false); setPlaybackIndex(Number(event.target.value)); }} className="h-1 flex-1 accent-cyan-400" /><select aria-label="Playback speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="rounded bg-slate-800 px-1 py-1 text-[10px] text-slate-300"><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></div><div className="mt-1 flex justify-between text-[9px] text-slate-500"><span>Playback</span><span>{new Date((bars[Math.min(playbackIndex, bars.length - 1)]?.time ?? 0) * 1000).toLocaleDateString("vi-VN")} · {fmtNum(bars[Math.min(playbackIndex, bars.length - 1)]?.close ?? null)}</span></div></div>}
      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3"><div className="mb-2 text-[10px] uppercase tracking-widest text-[#00d4ff]">Stock Intelligence</div><div className="grid grid-cols-2 gap-2 text-[10px]"><span className="text-slate-500">Tín hiệu</span><span className="text-right font-semibold text-white">{intelligence.analysis?.recommendation ?? "Đang phân tích"}</span><span className="text-slate-500">Score</span><span className="text-right font-mono text-slate-300">{intelligence.analysis?.score ?? "—"}</span><span className="text-slate-500">Kỹ thuật</span><span className="truncate text-right text-slate-300">{intelligence.technical?.chartPatterns?.[0]?.nameVi ?? intelligence.technical?.candlestickPatterns?.[0]?.nameVi ?? "Chưa có mẫu"}</span><span className="text-slate-500">Fundamentals</span><span className="text-right text-slate-300">ROE {intelligence.fundamental?.roe != null ? `${intelligence.fundamental.roe.toFixed(1)}%` : "—"} · P/E {intelligence.fundamental?.valuation?.pe ?? "—"}</span></div>{(intelligence.analysis?.reasons?.[0] || intelligence.news?.items?.[0]?.title) && <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-slate-500">{intelligence.analysis?.reasons?.[0] ?? intelligence.news?.items?.[0]?.title}</p>}</div>
      <div className="mt-2 flex justify-between text-[10px] text-slate-500"><span>{item.isStale ? `Dữ liệu cũ ${item.ageSeconds ?? "—"}s` : "Dữ liệu mới"}</span><span>{item.source ?? "unknown"} · {item.confidence != null ? `${Math.round(item.confidence * 100)}%` : "—"}</span></div>
      <Link href={`/stocks/${item.symbol}`} className="mt-3 flex min-h-11 items-center justify-center rounded-lg bg-[#00d4ff] text-xs font-bold text-[#0A2540] hover:brightness-110">Mở Stock Intelligence →</Link>
    </div>
  );
}

const selectClass =
  "h-10 min-h-10 rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-xs text-slate-200 outline-none focus:border-[#00d4ff]/50";

export function StockHeatmap({ compact = false }: { compact?: boolean }) {
  const { data, meta, error, loading, isValidating, refresh } = usePoll<Item[]>("/market/heatmap", 12_000);
  const [shape, setShape] = useState<Shape>("rectangle");
  const [metric, setMetric] = useState<Metric>("tradingValue");
  const [exchange, setExchange] = useState("all");
  const [sector, setSector] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Item | null>(null);
  const marketStatus = String(meta?.marketStatus ?? "PRE_MARKET");
  const stats = meta?.stats as unknown as Stats | undefined;
  const dataQuality = meta?.dataQuality as { universeCount?: number; validQuoteCount?: number; staleCount?: number; exchanges?: string[] } | undefined;
  const realtime = meta?.realtime as { status?: string; ageSeconds?: number | null } | undefined;
  const [aiInsight, setAiInsight] = useState<{ insight?: string; provider?: string }>({});

  useEffect(() => {
    let active = true;
    void api<{ insight?: string; provider?: string }>("/market/heatmap/ai")
      .then((result) => { if (active) setAiInsight(result.data); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [marketStatus]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("orca_heatmap_shape");
      if (stored === "circle" || stored === "rectangle" || stored === "square") {
        // Hydration-safe preference restore; localStorage is unavailable during SSR.
        // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const allItems = useMemo(() => data ?? [], [data]);
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

  const sectorIntel = useMemo(() => groups.map((group) => {
    const valid = group.items.filter((item) => item.changePercent != null);
    const averageChange = valid.length ? valid.reduce((sum, item) => sum + (item.changePercent ?? 0), 0) / valid.length : null;
    const advancing = valid.filter((item) => (item.changePercent ?? 0) > 0.01).length;
    const declining = valid.filter((item) => (item.changePercent ?? 0) < -0.01).length;
    const volume = valid.reduce((sum, item) => sum + (item.tradingValue || 0), 0);
    return { name: group.name, averageChange, advancing, declining, count: valid.length, volume };
  }).sort((a, b) => (b.averageChange ?? -Infinity) - (a.averageChange ?? -Infinity)), [groups]);
  const breadth = useMemo(() => {
    const valid = filtered.filter((item) => item.changePercent != null);
    const advancing = valid.filter((item) => (item.changePercent ?? 0) > 0.01).length;
    const declining = valid.filter((item) => (item.changePercent ?? 0) < -0.01).length;
    return { advancing, declining, unchanged: Math.max(0, valid.length - advancing - declining), total: valid.length };
  }, [filtered]);
  const marketBias = breadth.advancing > breadth.declining * 1.2 ? "Bullish" : breadth.declining > breadth.advancing * 1.2 ? "Bearish" : "Phân hóa";

  return (
    <section className="relative space-y-3">
      {/* Toolbar — matches Crypto/Forex dark panels */}
      <div className="panel flex flex-col gap-2 p-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="mr-auto flex items-center gap-2">
          <i
            className={`h-2 w-2 rounded-full ${
              marketStatus === "TRADING" ? "bg-emerald-400 live-dot" : marketStatus === "PRE_MARKET" ? "bg-amber-400" : "bg-sky-400"
            }`}
          />
          <span className="text-xs font-semibold text-slate-200">
            {STATUS_LABEL[marketStatus] ?? marketStatus}
          </span>
          <span className="hidden text-[10px] text-slate-500 sm:inline">· cập nhật ~12s</span>
          {dataQuality && <span className="hidden text-[10px] text-slate-600 lg:inline">· {dataQuality.validQuoteCount ?? 0}/{dataQuality.universeCount ?? 0} quote · stale {dataQuality.staleCount ?? 0}</span>}
          {realtime && <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${realtime.status === "LIVE" ? "bg-emerald-400/15 text-emerald-300" : realtime.status === "DEGRADED" ? "bg-amber-400/15 text-amber-300" : "bg-rose-400/15 text-rose-300"}`}>{realtime.status ?? "STALE"}{realtime.ageSeconds != null ? ` · ${realtime.ageSeconds}s` : ""}</span>}
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => refresh()} disabled={isValidating} className="h-10 rounded-lg border border-[#00d4ff]/30 bg-[#00d4ff]/10 px-3 text-xs font-semibold text-[#00d4ff] hover:bg-[#00d4ff]/15 disabled:opacity-50">{isValidating ? "Đang cập nhật…" : "↻ Làm mới"}</button>
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
                            {marketStatus === "PRE_MARKET" ? "—" : fmtPct(rect.item.changePercent)}
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
                {marketStatus === "PRE_MARKET" ? "—" : fmtPct(item.changePercent)}
              </span>
            </button>
          ))}
        </div>
      )}

      {!compact && (
        <section className="grid gap-3 lg:grid-cols-[1.15fr_.85fr]">
          <div className="panel p-4">
            <div className="mb-3 flex items-center justify-between"><div><div className="text-[10px] uppercase tracking-[.25em] text-[#00d4ff]">Market Intelligence</div><h2 className="mt-1 text-sm font-bold text-white">Breadth & Sector Rotation</h2></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${marketBias === "Bullish" ? "bg-emerald-400/15 text-emerald-300" : marketBias === "Bearish" ? "bg-rose-400/15 text-rose-300" : "bg-amber-400/15 text-amber-300"}`}>{marketBias}</span></div>
            <div className="mb-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-emerald-400/10 p-2"><div className="text-lg font-black text-emerald-300">{breadth.advancing}</div><div className="text-[10px] text-slate-500">Tăng</div></div><div className="rounded-lg bg-amber-400/10 p-2"><div className="text-lg font-black text-amber-300">{breadth.unchanged}</div><div className="text-[10px] text-slate-500">Đứng</div></div><div className="rounded-lg bg-rose-400/10 p-2"><div className="text-lg font-black text-rose-300">{breadth.declining}</div><div className="text-[10px] text-slate-500">Giảm</div></div></div>
            <div className="space-y-2">{sectorIntel.slice(0, 6).map((sector) => <div key={sector.name} className="flex items-center gap-3 text-xs"><span className="w-28 truncate text-slate-400">{sector.name}</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800"><div className={`h-full rounded-full ${sector.averageChange != null && sector.averageChange >= 0 ? "bg-emerald-400" : "bg-rose-400"}`} style={{ width: `${Math.min(100, Math.max(4, Math.abs(sector.averageChange ?? 0) * 14))}%` }} /></div><span className={`w-14 text-right font-mono ${sector.averageChange != null && sector.averageChange >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtPct(sector.averageChange)}</span></div>)}</div>
          </div>
          <div className="panel p-4"><div className="text-[10px] uppercase tracking-[.25em] text-[#00d4ff]">ORCA AI MARKET INSIGHT</div><p className="mt-3 text-sm leading-6 text-slate-300">{aiInsight.insight ?? <>Dòng tiền đang tập trung vào nhóm <strong className="text-white">{sectorIntel[0]?.name ?? "—"}</strong>{sectorIntel[0]?.averageChange != null ? ` (${fmtPct(sectorIntel[0].averageChange)} bình quân)` : ""}. {sectorIntel[0]?.advancing ?? 0} mã tăng trong nhóm dẫn đầu.</>}</p><p className="mt-2 text-xs leading-5 text-slate-500">Nguồn insight: {aiInsight.provider ?? "rule-engine"}. Market Regime: <span className="font-semibold text-slate-300">{marketStatus === "TRADING" ? "Intraday" : STATUS_LABEL[marketStatus] ?? marketStatus}</span>. Đây là insight định lượng từ breadth và sector performance, không phải khuyến nghị đầu tư.</p></div>
        </section>
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
            <Legend color={COLORS["no-data"]} label={`Thiếu dữ liệu ${stats["no-data"]}`} />
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
