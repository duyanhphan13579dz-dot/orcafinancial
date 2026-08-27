"use client";

import { useState } from "react";
import Link from "next/link";
import { api, changeColor, fmtNum, fmtPct, fmtVol, timeAgo, usePoll } from "@/lib/client";
import type { MarketIndex, MarketQuote, MarketNewsItem, MarketSnapshot } from "@/types/market";
import { OvernightMarkets } from "@/components/market/OvernightMarkets";

const QUICK_LINKS = [
  { href: "/heatmap", label: "Heatmap", desc: "Bản đồ sức mạnh thị trường" },
  { href: "/screener", label: "Bộ lọc", desc: "CANSLIM · Minervini · Wyckoff" },
  { href: "/reports", label: "Báo cáo", desc: "Morning Brief · Market Summary" },
  { href: "/agent", label: "AI Agent", desc: "Phân tích từ dữ liệu thật" },
];

function tone(value: number | null | undefined) {
  if (value == null || Math.abs(value) < 0.005) return "text-amber-300";
  return value > 0 ? "text-emerald-400" : "text-rose-400";
}

function MiniSparkline({ quote }: { quote: MarketQuote }) {
  const values = [quote.open, quote.high, quote.low, quote.close];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.000001, max - min);
  const points = values.map((value, index) => `${2 + index * 30},${26 - ((value - min) / span) * 20}`).join(" ");
  const positive = (quote.changePct ?? quote.close - quote.open) >= 0;
  return <svg viewBox="0 0 96 30" className="h-7 w-24" aria-label="Biên độ OHLC trong phiên" role="img"><polyline points={points} fill="none" stroke={positive ? "#34d399" : "#fb7185"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="92" cy={26 - ((quote.close - min) / span) * 20} r="2.5" fill={positive ? "#34d399" : "#fb7185"} /></svg>;
}

function SectionHeader({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) {
  return <div className="mb-3 flex items-end justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400">{eyebrow ?? "ORCA MARKET"}</div><h2 className="font-display text-lg font-bold text-white md:text-xl">{title}</h2></div>{action}</div>;
}

function IndexCard({ index, primary }: { index: MarketIndex; primary?: boolean }) {
  return <div className={`panel relative overflow-hidden p-3 ${primary ? "border-cyan-400/50 bg-gradient-to-br from-[#123d60] to-[#0b2745] shadow-[0_0_24px_rgba(0,212,255,.12)]" : ""}`}><div className="flex items-center justify-between gap-2"><span className={`text-xs font-semibold ${primary ? "text-cyan-200" : "text-slate-300"}`}>{index.name}</span><span className="flex items-center gap-1 text-[10px] text-slate-500"><span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />LIVE</span></div><div className="mt-2 flex items-end justify-between gap-2"><div><div className={`font-mono font-bold tabular-nums ${primary ? "text-2xl text-white" : "text-xl text-slate-100"}`}>{fmtNum(index.close)}</div><div className={`mt-0.5 font-mono text-xs font-semibold ${tone(index.changePct)}`}>{fmtPct(index.changePct)}</div></div><MiniSparkline quote={index} /></div><div className="mt-2 flex justify-between text-[10px] text-slate-500"><span>{index.exchange}</span><span>KLGD {fmtVol(index.volume)}</span></div></div>;
}

function StatusPill({ label, value, color }: { label: string; value: string; color: string }) {
  return <div className="rounded-md border border-white/5 bg-[#091d34]/70 px-3 py-2"><div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div><div className={`mt-1 text-sm font-bold ${color}`}>{value}</div></div>;
}

function BreadthMeter({ title, breadth }: { title: string; breadth: MarketSnapshot["breadth"] }) {
  const total = Math.max(1, breadth.sample);
  return <div className="rounded-md border border-white/5 bg-[#091d34]/70 p-3"><div className="flex items-center justify-between"><span className="text-[10px] uppercase tracking-wider text-slate-500">{title}</span><span className="font-mono text-[10px] text-slate-500">{breadth.sample} mã</span></div><div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-800"><span className="bg-emerald-400" style={{ width: `${breadth.advancing / total * 100}%` }} /><span className="bg-amber-400" style={{ width: `${breadth.unchanged / total * 100}%` }} /><span className="bg-rose-400" style={{ width: `${breadth.declining / total * 100}%` }} /></div><div className="mt-2 flex justify-between text-[10px]"><span className="text-emerald-400">{breadth.advancing} ↑</span><span className="text-amber-300">{breadth.unchanged} =</span><span className="text-rose-400">{breadth.declining} ↓</span></div></div>;
}

function Pulse({ snapshot }: { snapshot: MarketSnapshot }) {
  const p = snapshot.pulse;
  const breadth = snapshot.marketBreadth;
  const colors = { up: "text-emerald-400", down: "text-rose-400", flat: "text-amber-300" };
  return <section className="panel overflow-hidden p-4 md:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400">ORCA MARKET PULSE</div><div className="mt-1 flex flex-wrap items-center gap-2"><h2 className="font-display text-xl font-bold text-white md:text-2xl">{p.regimeLabel}</h2><span className={`rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-300`}>Risk {p.risk}</span></div><p className="mt-1 max-w-2xl text-xs text-slate-400">{p.summary}</p></div><div className="text-right text-[10px] text-slate-500"><div>QUANT ENGINE</div><div className="mt-1 text-cyan-300">Không dùng dự đoán LLM</div></div></div><div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4"><StatusPill label="Trend" value={p.trend === "up" ? "Bullish" : p.trend === "down" ? "Bearish" : "Sideways"} color={colors[p.trend]} /><StatusPill label={breadth.scope === "market" ? "Market breadth" : "Tracked breadth"} value={`${breadth.advancing} ↑ · ${breadth.unchanged} = · ${breadth.declining} ↓`} color={breadth.ratio >= 0 ? "text-emerald-400" : "text-rose-400"} /><StatusPill label="Liquidity" value={p.liquidity === "up" ? "Active" : "Limited"} color={colors[p.liquidity]} /><StatusPill label="Foreign flow" value={p.foreignFlow === "unknown" ? "N/A" : p.foreignFlow === "buying" ? "Buying" : "Selling"} color="text-slate-300" /></div><div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />{breadth.scope === "market" ? "Market breadth từ các snapshot hiện có" : "Chưa đủ universe để tính breadth toàn thị trường; đang dùng nhóm theo dõi"} · Dữ liệu định lượng, không phải lời khuyên đầu tư</div></section>;
}



function Heatmap({ quotes, onSelect }: { quotes: MarketQuote[]; onSelect: (symbol: string) => void }) {
  return <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 md:grid-cols-5">{quotes.map((quote) => { const pct = quote.changePct ?? 0; const bg = pct >= 1 ? "bg-emerald-500/80" : pct > 0.05 ? "bg-emerald-700/70" : pct <= -1 ? "bg-rose-500/80" : pct < -0.05 ? "bg-rose-700/70" : "bg-amber-500/70"; return <button key={quote.symbol} onClick={() => onSelect(quote.symbol)} className={`min-h-16 rounded-md p-2 text-left transition-transform hover:scale-[1.03] ${bg}`}><div className="flex items-center justify-between gap-1"><span className="font-bold text-white">{quote.symbol}</span><span className="font-mono text-[10px] text-white/90">{fmtPct(pct)}</span></div><div className="mt-2 font-mono text-[10px] text-white/70">{fmtNum(quote.close)} · {fmtVol(quote.volume)}</div></button>; })}</div>;
}

function AIInsight({ snapshot, onSelect }: { snapshot: MarketSnapshot; onSelect: (symbol: string) => void }) {
  const strongest = [...snapshot.sectors].sort((a, b) => (b.strength ?? -1) - (a.strength ?? -1))[0];
  const weakest = [...snapshot.sectors].sort((a, b) => (a.strength ?? 101) - (b.strength ?? 101))[0];
  const marketBreadth = snapshot.marketBreadth;
  const riskCopy = snapshot.pulse.risk === "high" ? "Biến động và áp lực giảm đang lan rộng." : snapshot.pulse.risk === "medium" ? "Nên ưu tiên chọn lọc theo sức mạnh ngành và thanh khoản." : "Điều kiện thị trường hiện nghiêng về kiểm soát rủi ro thấp.";
  return <div className="panel h-full overflow-hidden"><div className="border-b border-cyan-400/20 bg-gradient-to-r from-cyan-400/10 to-transparent p-4"><div className="flex items-center justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400">ORCA AI INSIGHT</div><h2 className="mt-1 font-display text-lg font-bold text-white">Market intelligence</h2></div><span className="rounded border border-cyan-400/30 px-2 py-1 text-[9px] uppercase text-cyan-300">Quant-backed</span></div><p className="mt-3 text-xs leading-relaxed text-slate-300">{snapshot.pulse.summary} {riskCopy}</p></div><div className="space-y-4 p-4"><div><div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Market regime</div><div className="rounded-md bg-[#091d34] p-3"><div className="font-display text-sm font-bold text-amber-300">{snapshot.pulse.regimeLabel}</div><div className="mt-1 text-[11px] text-slate-500">Breadth {marketBreadth.advancing} tăng · {marketBreadth.declining} giảm · {marketBreadth.sample} mã</div></div></div><div><div className="mb-2 text-[10px] uppercase tracking-wider text-emerald-400">Top opportunities</div>{snapshot.topGainers.slice(0, 3).map((quote) => <button key={quote.symbol} onClick={() => onSelect(quote.symbol)} className="flex w-full items-center justify-between border-b border-white/5 py-2 text-xs"><span className="font-bold text-cyan-300">{quote.symbol}</span><span className="font-mono text-emerald-400">{fmtPct(quote.changePct)}</span></button>)}{strongest && <div className="mt-2 text-[10px] text-slate-500">Ngành dẫn dắt: <span className="text-emerald-300">{strongest.label}</span></div>}</div><div><div className="mb-2 text-[10px] uppercase tracking-wider text-rose-400">Risk watch</div>{snapshot.topLosers.slice(0, 3).map((quote) => <button key={quote.symbol} onClick={() => onSelect(quote.symbol)} className="flex w-full items-center justify-between border-b border-white/5 py-2 text-xs"><span className="font-bold text-cyan-300">{quote.symbol}</span><span className="font-mono text-rose-400">{fmtPct(quote.changePct)}</span></button>)}{weakest && <div className="mt-2 text-[10px] text-slate-500">Cần quan sát: <span className="text-rose-300">{weakest.label}</span></div>}</div></div></div>;
}

function NewsTimeline({ items }: { items: MarketNewsItem[] }) {
  return <section className="panel p-4"><SectionHeader eyebrow="MARKET EVENTS / TIMELINE" title="Tin tức và diễn biến" action={<Link href="/news" className="text-xs text-cyan-400 hover:underline">Xem tất cả →</Link>} />{items.length === 0 ? <div className="text-sm text-slate-500">Đang đồng bộ tin tức thị trường…</div> : <div className="relative ml-2 border-l border-cyan-400/20 pl-5">{items.slice(0, 8).map((item) => <a key={item.id} href={item.link} target="_blank" rel="noreferrer" className="group relative mb-4 block last:mb-0"><span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[#0b2644] bg-cyan-400 transition-transform group-hover:scale-125" /><div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500"><span className="font-mono text-cyan-300">{new Date(item.publishedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</span><span>{item.sourceName}</span>{item.symbols && <span className="text-amber-300">{item.symbols}</span>}</div><div className="mt-1 text-sm leading-snug text-slate-200 transition-colors group-hover:text-cyan-200">{item.title}</div><div className="mt-1 text-[10px] text-slate-500">{timeAgo(item.publishedAt)} · Mở bài gốc</div></a>)}</div>}</section>;
}

function WatchlistPanel({ items, onSelect, onRemove }: { items: Array<{ symbol: string; quote: MarketQuote | null }>; onSelect: (symbol: string) => void; onRemove: (symbol: string) => void }) {
  return <section className="panel p-4"><SectionHeader eyebrow="MY WATCHLIST" title="Danh mục của tôi" action={<Link href="/watchlist" className="text-xs text-cyan-400 hover:underline">Quản lý →</Link>} />{items.length === 0 ? <div className="rounded-md border border-dashed border-[#2a4a75] p-4 text-center text-xs text-slate-500">Chưa có mã theo dõi. Click một mã trong board để thêm vào danh mục.</div> : <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{items.map((item) => <div key={item.symbol} className="flex items-center justify-between rounded-md border border-white/5 bg-[#091d34]/70 p-2"><button onClick={() => onSelect(item.symbol)} className="min-w-0 text-left"><div className="font-bold text-cyan-300">★ {item.symbol}</div><div className={`font-mono text-[11px] ${tone(item.quote?.changePct)}`}>{item.quote ? `${fmtNum(item.quote.close)} · ${fmtPct(item.quote.changePct)}` : "Đang lấy giá…"}</div></button><button onClick={() => onRemove(item.symbol)} className="px-2 text-slate-500 hover:text-rose-400" aria-label={`Xóa ${item.symbol}`}>×</button></div>)}</div>}</section>;
}

function StockQuickView({ symbol, snapshot, onClose, isWatched, onWatch }: { symbol: string; snapshot: MarketSnapshot; onClose: () => void; isWatched: boolean; onWatch: (symbol: string) => void }) {
  const quote = [...snapshot.quotes, ...snapshot.sectorQuotes].find((q) => q.symbol === symbol);
  if (!quote) return null;
  return <div className="fixed inset-x-3 bottom-20 z-50 max-w-sm rounded-xl border border-cyan-400/40 bg-[#081d35] p-4 shadow-[0_20px_60px_rgba(0,0,0,.5)] md:inset-auto md:right-6 md:top-24 md:bottom-auto"><div className="flex items-start justify-between"><div><div className="font-mono text-[10px] text-cyan-400">STOCK QUICK VIEW</div><h3 className="mt-1 text-xl font-bold text-white">{quote.symbol}</h3></div><button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Đóng">×</button></div><div className="mt-4 flex items-end justify-between"><div><div className="font-mono text-2xl font-bold text-white">{fmtNum(quote.close)}</div><div className={`font-mono text-sm font-semibold ${tone(quote.changePct)}`}>{fmtPct(quote.changePct)}</div></div><MiniSparkline quote={quote} /></div><div className="mt-4 grid grid-cols-2 gap-2 text-xs"><div className="rounded bg-[#0e2e4f] p-2"><div className="text-slate-500">Volume</div><div className="mt-1 font-mono text-white">{fmtVol(quote.volume)}</div></div><div className="rounded bg-[#0e2e4f] p-2"><div className="text-slate-500">Confidence</div><div className="mt-1 font-mono text-white">{Math.round(quote.confidence * 100)}%</div></div></div><div className="mt-3 flex gap-2"><button onClick={() => onWatch(quote.symbol)} className="btn-orca-ghost flex-1">{isWatched ? "★ Đang theo dõi" : "☆ Theo dõi mã"}</button><Link href={`/stocks/${quote.symbol}`} className="btn-orca flex-1 text-center text-sm">Mở phân tích</Link></div></div>;
}

export function DashboardHome() {
  const { data: snapshot, error, loading, isValidating } = usePoll<MarketSnapshot>("/market/overview", 30000, { softTtlMs: 15000, timeoutMs: 7000 });
  const watchlist = usePoll<{ items: Array<{ symbol: string; quote: MarketQuote | null }> }>("/watchlist", 60000);
  const [selected, setSelected] = useState<string | null>(null);
  const watchedSymbols = new Set((watchlist.data?.items ?? []).map((item) => item.symbol));
  const toggleWatch = async (symbol: string) => {
    if (watchedSymbols.has(symbol)) await api(`/watchlist?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE", skipCache: true });
    else await api("/watchlist", { method: "POST", skipCache: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol }) });
    await watchlist.refresh();
  };

  return <div className="space-y-5 md:space-y-6">
    <section className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-[#1a3558] px-3 py-2"><div><div className="font-mono text-[10px] uppercase tracking-[0.25em] text-cyan-400">MARKET TERMINAL</div><h1 className="font-display text-lg font-extrabold text-white">Tổng quan thị trường</h1></div><div className="text-right text-[10px] text-slate-500"><div className="flex items-center justify-end gap-1"><span className={`h-1.5 w-1.5 rounded-full ${isValidating ? "animate-pulse bg-cyan-400" : snapshot?.quality.stale ? "bg-rose-400" : snapshot?.quality.partial ? "bg-amber-400" : "live-dot bg-emerald-400"}`} /> {isValidating ? "SYNCING" : snapshot?.quality.stale ? "STALE" : snapshot?.quality.partial ? "PARTIAL" : "LIVE DATA"}</div><div className="mt-1">{snapshot ? `${new Date(snapshot.generatedAt).toLocaleTimeString("vi-VN")} · ${snapshot.quality.ageSeconds}s` : "Đang đồng bộ"}</div></div></div>{snapshot && <div className="ticker-tape flex w-max gap-6 whitespace-nowrap px-3 py-2 text-xs"><span className="text-slate-500">ORCA FEED</span>{[...snapshot.quotes, ...snapshot.quotes].map((q, i) => <Link key={`${q.symbol}-${i}`} href={`/stocks/${q.symbol}`} className="flex items-center gap-2"><span className="font-semibold text-slate-200">{q.symbol}</span><span className="font-mono text-slate-400">{fmtNum(q.close)}</span><span className={tone(q.changePct)}>{fmtPct(q.changePct)}</span></Link>)}</div>}</section>
    {loading && !snapshot && <div className="panel p-10 text-center text-sm text-slate-400"><div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" /><div className="mt-3">Đang tải dữ liệu thật từ Data Engine…</div></div>}
    {error && <div className="panel border-rose-700 bg-rose-950/30 p-4 text-sm text-rose-300">Không lấy được snapshot mới: {error}. Các lớp fallback đang được thử lại.</div>}
    {snapshot && <>
      <section><SectionHeader eyebrow="MARKET HEADER" title="Chỉ số thị trường" action={<span className="text-[10px] text-slate-500">VN-Index là chỉ số chính</span>} /><div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">{snapshot.indices.map((index) => <IndexCard key={index.code} index={index} primary={index.code === "VNINDEX"} />)}{snapshot.crypto.slice(0, 2).map((crypto) => <div key={crypto.symbol} className="panel p-3"><div className="flex items-center justify-between text-xs font-semibold text-slate-300"><span>{crypto.symbol}</span><span className="text-[10px] text-slate-500">CRYPTO</span></div><div className="mt-3 font-mono text-xl font-bold text-white">${crypto.priceUsd.toLocaleString()}</div><div className={`mt-1 font-mono text-xs ${tone(crypto.change24hPct)}`}>{fmtPct(crypto.change24hPct)}</div><div className="mt-3 text-[10px] text-slate-500">{crypto.source}</div></div>)}</div></section>
      <Pulse snapshot={snapshot} />
      <section className="grid gap-3 md:grid-cols-2"><BreadthMeter title="Market breadth" breadth={snapshot.marketBreadth} /><BreadthMeter title="Large-cap / tracked breadth" breadth={snapshot.largeCapBreadth} /></section>
      <OvernightMarkets snapshot={snapshot.overnight} />
      <section className="grid gap-4 lg:grid-cols-[1.65fr_1fr]"><div className="panel p-4"><SectionHeader eyebrow="MARKET HEATMAP" title="Sức mạnh nhóm theo dõi" action={<span className="text-[10px] text-slate-500">Click mã để xem nhanh</span>} /><Heatmap quotes={snapshot.quotes} onSelect={setSelected} /><div className="mt-3 flex gap-3 text-[10px] text-slate-500"><span><i className="mr-1 inline-block h-2 w-2 rounded bg-emerald-500" />Tăng</span><span><i className="mr-1 inline-block h-2 w-2 rounded bg-amber-500" />Đi ngang</span><span><i className="mr-1 inline-block h-2 w-2 rounded bg-rose-500" />Giảm</span></div></div><AIInsight snapshot={snapshot} onSelect={setSelected} /></section>
      <WatchlistPanel items={watchlist.data?.items ?? []} onSelect={setSelected} onRemove={(symbol) => void toggleWatch(symbol)} />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">{QUICK_LINKS.map((item) => <Link key={item.href} href={item.href} className="panel p-3 transition-all hover:-translate-y-0.5 hover:border-cyan-400/50"><div className="font-display text-sm font-bold text-white">{item.label}</div><div className="mt-1 text-[10px] leading-snug text-slate-500">{item.desc}</div></Link>)}</section>
    </>}
    <NewsTimeline items={snapshot?.news ?? []} />
    {snapshot && selected && <StockQuickView symbol={selected} snapshot={snapshot} isWatched={watchedSymbols.has(selected)} onWatch={(symbol) => void toggleWatch(symbol)} onClose={() => setSelected(null)} />}
  </div>;
}
