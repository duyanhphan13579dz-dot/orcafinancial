"use client";

import { useState } from "react";
import Link from "next/link";
import { api, fmtNum, fmtPct, fmtVol, timeAgo, usePoll } from "@/lib/client";
import type { MarketIndex, MarketQuote, MarketNewsItem, MarketSnapshot } from "@/types/market";
import { OvernightMarkets } from "@/components/market/OvernightMarkets";
import { IndexDetailModal } from "@/components/index-detail-modal";

const QUICK_LINKS = [
  { href: "/heatmap", label: "Bản đồ nhiệt", desc: "Bản đồ sức mạnh & dòng tiền" },
  { href: "/screener", label: "Bộ lọc cổ phiếu", desc: "CANSLIM · Minervini · Wyckoff" },
  { href: "/reports", label: "Báo cáo thị trường", desc: "Bản tin sáng · Tóm tắt thị trường" },
  { href: "/agent", label: "ORCA AI", desc: "Trợ lý phân tích tài chính 24/7" },
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
  return (
    <svg viewBox="0 0 96 30" className="h-6 w-14 sm:h-7 sm:w-20 shrink-0" aria-label="Biên độ giá" role="img">
      <polyline
        points={points}
        fill="none"
        stroke={positive ? "#34d399" : "#fb7185"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="92"
        cy={26 - ((quote.close - min) / span) * 20}
        r="2.5"
        fill={positive ? "#34d399" : "#fb7185"}
      />
    </svg>
  );
}

function SectionHeader({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-white/5 pb-2">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400">{eyebrow ?? "ORCA THỊ TRƯỜNG"}</div>
        <h2 className="font-display text-base font-extrabold tracking-tight text-white md:text-lg">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function IndexCard({ index, primary, onClick }: { index: MarketIndex; primary?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`group relative text-left w-full overflow-hidden rounded-xl border p-2.5 sm:p-3.5 transition-all duration-200 hover:scale-[1.02] hover:border-cyan-400/60 hover:shadow-xl ${
        primary
          ? "border-cyan-400/50 bg-gradient-to-br from-[#0c2a47] via-[#0a2340] to-[#071830] shadow-[0_0_25px_rgba(0,212,255,0.12)]"
          : "border-[#1c375c]/70 bg-[#091f38]/80 hover:bg-[#0c2645]"
      }`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className={`text-xs font-bold tracking-wide ${primary ? "text-cyan-200" : "text-slate-300"}`}>
          {index.name}
        </span>
        <span className="flex items-center gap-1 font-mono text-[9px] font-semibold text-emerald-400 shrink-0">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          LIVE
        </span>
      </div>

      <div className="mt-2 flex items-end justify-between gap-1">
        <div className="min-w-0">
          <div className={`font-mono font-black tabular-nums tracking-tight whitespace-nowrap ${primary ? "text-lg sm:text-2xl text-white" : "text-base sm:text-xl text-slate-100"}`}>
            {fmtNum(index.close)}
          </div>
          <div className={`mt-0.5 font-mono text-[11px] sm:text-xs font-bold tabular-nums whitespace-nowrap ${tone(index.changePct)}`}>
            {fmtPct(index.changePct)}
          </div>
        </div>
        <MiniSparkline quote={index} />
      </div>

      <div className="mt-2.5 flex items-center justify-between border-t border-white/5 pt-1.5 font-mono text-[9px] sm:text-[10px] text-slate-400">
        <span>{index.exchange}</span>
        <span className="text-cyan-400 opacity-90 group-hover:underline">Chi tiết →</span>
      </div>
    </button>
  );
}

function StatusPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border border-[#1e3b62]/60 bg-[#081c33]/90 px-2.5 py-2 sm:px-3.5 sm:py-2.5 shadow-sm">
      <div className="font-mono text-[9px] sm:text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-0.5 sm:mt-1 font-display text-xs sm:text-sm font-bold tracking-tight ${color}`}>{value}</div>
    </div>
  );
}

function BreadthMeter({ title, breadth }: { title: string; breadth: MarketSnapshot["breadth"] }) {
  const total = Math.max(1, breadth.sample);
  const advPct = Math.round((breadth.advancing / total) * 100);
  const unchPct = Math.round((breadth.unchanged / total) * 100);
  const decPct = Math.max(0, 100 - advPct - unchPct);

  return (
    <div className="rounded-xl border border-[#1e3a5f]/60 bg-[#081d35]/80 p-3 sm:p-3.5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-300">{title}</span>
        <span className="font-mono text-[9px] sm:text-[10px] text-slate-400">{breadth.sample} mã</span>
      </div>
      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-800/80 p-0.5 ring-1 ring-white/5">
        <span className="rounded-l-full bg-emerald-400 transition-all duration-500" style={{ width: `${advPct}%` }} />
        <span className="bg-amber-400 transition-all duration-500" style={{ width: `${unchPct}%` }} />
        <span className="rounded-r-full bg-rose-400 transition-all duration-500" style={{ width: `${decPct}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] sm:text-[11px]">
        <span className="font-bold text-emerald-400">{breadth.advancing} ↑ ({advPct}%)</span>
        <span className="font-medium text-amber-300">{breadth.unchanged} = ({unchPct}%)</span>
        <span className="font-bold text-rose-400">{breadth.declining} ↓ ({decPct}%)</span>
      </div>
    </div>
  );
}

function Pulse({ snapshot }: { snapshot: MarketSnapshot }) {
  const p = snapshot.pulse;
  const breadth = snapshot.marketBreadth;
  const colors = { up: "text-emerald-400", down: "text-rose-400", flat: "text-amber-300" };

  return (
    <section className="rounded-xl border border-[#1e3a5f]/80 bg-[#081d35]/90 p-3.5 sm:p-5 shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400">NHỊP ĐỘ VÀ TRẠNG THÁI THỊ TRƯỜNG</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg sm:text-2xl font-black tracking-tight text-white">{p.regimeLabel}</h2>
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase text-amber-300">
              RỦI RO {p.risk.toUpperCase()}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-300">{p.summary}</p>
        </div>
        <div className="text-left sm:text-right font-mono text-[10px] text-slate-400">
          <div className="uppercase tracking-wider text-slate-400">BỘ MÁY ĐỊNH LƯỢNG</div>
          <div className="mt-0.5 font-bold text-cyan-300">Tính toán realtime theo thời gian thực</div>
        </div>
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatusPill label="Xu hướng" value={p.trend === "up" ? "Tăng điểm" : p.trend === "down" ? "Giảm điểm" : "Đi ngang"} color={colors[p.trend]} />
        <StatusPill
          label="Tỷ lệ tăng / giảm"
          value={`${breadth.advancing} T · ${breadth.declining} G`}
          color={breadth.ratio >= 0 ? "text-emerald-400" : "text-rose-400"}
        />
        <StatusPill label="Thanh khoản" value={p.liquidity === "up" ? "Tích cực" : "Hạn chế"} color={colors[p.liquidity]} />
        <StatusPill label="Khối ngoại" value={p.foreignFlow === "buying" ? "Mua ròng" : p.foreignFlow === "selling" ? "Bán ròng" : "Cân bằng"} color="text-slate-200" />
      </div>
    </section>
  );
}

function Heatmap({ quotes, onSelect }: { quotes: MarketQuote[]; onSelect: (symbol: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {quotes.map((quote) => {
        const pct = quote.changePct ?? 0;
        const bg =
          pct >= 1.5
            ? "bg-emerald-600/90 hover:bg-emerald-500"
            : pct > 0.05
            ? "bg-emerald-800/80 hover:bg-emerald-700"
            : pct <= -1.5
            ? "bg-rose-600/90 hover:bg-rose-500"
            : pct < -0.05
            ? "bg-rose-800/80 hover:bg-rose-700"
            : "bg-slate-700/70 hover:bg-slate-600";

        return (
          <button
            key={quote.symbol}
            onClick={() => onSelect(quote.symbol)}
            className={`group rounded-lg p-2 sm:p-2.5 text-left transition-all duration-150 hover:scale-[1.02] hover:shadow-md ${bg}`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="font-display font-extrabold text-white tracking-wide text-xs sm:text-sm">{quote.symbol}</span>
              <span className="font-mono text-[10px] sm:text-[11px] font-bold text-white">{fmtPct(pct)}</span>
            </div>
            <div className="mt-1 font-mono text-[9px] sm:text-[10px] text-white/80 whitespace-nowrap">
              {fmtNum(quote.close)} <span className="text-white/50">·</span> {fmtVol(quote.volume)}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function AIInsight({ snapshot, onSelect }: { snapshot: MarketSnapshot; onSelect: (symbol: string) => void }) {
  const strongest = [...snapshot.sectors].sort((a, b) => (b.strength ?? -1) - (a.strength ?? -1))[0];
  const weakest = [...snapshot.sectors].sort((a, b) => (a.strength ?? 101) - (b.strength ?? 101))[0];
  const marketBreadth = snapshot.marketBreadth;
  const riskCopy =
    snapshot.pulse.risk === "high"
      ? "Áp lực điều chỉnh mở rộng, ưu tiên hạ tỷ trọng margin."
      : snapshot.pulse.risk === "medium"
      ? "Ưu tiên chọn lọc cổ phiếu dẫn dắt ngành có dòng tiền vào."
      : "Rủi ro chung ở mức thấp, kiểm soát theo vi mô cổ phiếu.";

  return (
    <div className="rounded-xl border border-[#1e3a5f]/80 bg-[#081d35]/90 overflow-hidden shadow-lg">
      <div className="border-b border-cyan-400/20 bg-gradient-to-r from-cyan-500/10 via-cyan-500/5 to-transparent p-3.5 sm:p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400">GÓC NHÌN AI ORCA</div>
            <h2 className="mt-0.5 font-display text-sm sm:text-base font-extrabold text-white">Định lượng & Tín hiệu</h2>
          </div>
          <span className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase text-cyan-300">
            ĐỊNH LƯỢNG LIVE
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-300">
          {snapshot.pulse.summary} {riskCopy}
        </p>
      </div>

      <div className="space-y-3 p-3.5 sm:p-4 text-xs">
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-400">Trạng thái thị trường</div>
          <div className="rounded-lg border border-white/5 bg-[#06152b] p-2.5">
            <div className="font-display font-bold text-amber-300">{snapshot.pulse.regimeLabel}</div>
            <div className="mt-0.5 font-mono text-[10px] sm:text-[11px] text-slate-400">
              Độ rộng: <span className="text-emerald-400">{marketBreadth.advancing} tăng</span> · <span className="text-rose-400">{marketBreadth.declining} giảm</span> trên {marketBreadth.sample} mã
            </div>
          </div>
        </div>

        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-emerald-400">Top cổ phiếu tích cực</div>
          <div className="divide-y divide-white/5 rounded-lg border border-white/5 bg-[#06152b]">
            {snapshot.topGainers.slice(0, 3).map((quote) => (
              <button
                key={quote.symbol}
                onClick={() => onSelect(quote.symbol)}
                className="flex w-full items-center justify-between p-2 sm:p-2.5 transition-colors hover:bg-white/5"
              >
                <span className="font-bold text-cyan-300">{quote.symbol}</span>
                <span className="font-mono font-bold text-emerald-400">{fmtPct(quote.changePct)}</span>
              </button>
            ))}
          </div>
          {strongest && (
            <div className="mt-1 text-[10px] text-slate-400">
              Ngành dẫn dắt: <strong className="text-emerald-300">{strongest.label}</strong>
            </div>
          )}
        </div>

        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-rose-400">Top cổ phiếu cần quan sát</div>
          <div className="divide-y divide-white/5 rounded-lg border border-white/5 bg-[#06152b]">
            {snapshot.topLosers.slice(0, 3).map((quote) => (
              <button
                key={quote.symbol}
                onClick={() => onSelect(quote.symbol)}
                className="flex w-full items-center justify-between p-2 sm:p-2.5 transition-colors hover:bg-white/5"
              >
                <span className="font-bold text-cyan-300">{quote.symbol}</span>
                <span className="font-mono font-bold text-rose-400">{fmtPct(quote.changePct)}</span>
              </button>
            ))}
          </div>
          {weakest && (
            <div className="mt-1 text-[10px] text-slate-400">
              Ngành suy yếu: <strong className="text-rose-300">{weakest.label}</strong>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NewsTimeline({ items }: { items: MarketNewsItem[] }) {
  return (
    <section className="rounded-xl border border-[#1e3a5f]/80 bg-[#081d35]/90 p-3.5 sm:p-5 shadow-lg">
      <SectionHeader
        eyebrow="DIỄN BIẾN THỊ TRƯỜNG"
        title="Tin tức và cập nhật dòng tin"
        action={
          <Link href="/news" className="font-mono text-xs font-semibold text-cyan-400 hover:underline">
            Xem tất cả →
          </Link>
        }
      />
      {items.length === 0 ? (
        <div className="py-4 text-center text-xs text-slate-400">Đang đồng bộ dữ liệu tin tức thị trường realtime…</div>
      ) : (
        <div className="relative ml-2 border-l border-cyan-400/20 pl-3.5 sm:pl-4 space-y-3">
          {items.slice(0, 8).map((item) => (
            <a
              key={item.id}
              href={item.link}
              target="_blank"
              rel="noreferrer"
              className="group relative block transition-all"
            >
              <span className="absolute -left-[19px] sm:-left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[#081d35] bg-cyan-400 transition-transform group-hover:scale-125" />
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-slate-400">
                <span className="font-bold text-cyan-300">
                  {new Date(item.publishedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span>{item.sourceName}</span>
                {item.symbols && <span className="rounded bg-amber-400/10 px-1 py-0.5 text-amber-300">{item.symbols}</span>}
              </div>
              <div className="mt-1 text-xs font-medium leading-snug text-slate-200 group-hover:text-cyan-200">
                {item.title}
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-slate-400">{timeAgo(item.publishedAt)} · Nguồn gốc</div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function WatchlistPanel({
  items,
  onSelect,
  onRemove,
}: {
  items: Array<{ symbol: string; quote: MarketQuote | null }>;
  onSelect: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}) {
  return (
    <section className="rounded-xl border border-[#1e3a5f]/80 bg-[#081d35]/90 p-3.5 sm:p-5 shadow-lg">
      <SectionHeader
        eyebrow="DANH MỤC THEO DÕI"
        title="Danh mục cổ phiếu quan tâm"
        action={
          <Link href="/watchlist" className="font-mono text-xs font-semibold text-cyan-400 hover:underline">
            Quản lý danh mục →
          </Link>
        }
      />
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#2a4a75] p-4 sm:p-5 text-center text-xs text-slate-400">
          Chưa có mã theo dõi. Chọn mã cổ phiếu trong bản đồ nhiệt hoặc bộ lọc để lưu vào danh mục.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <div
              key={item.symbol}
              className="flex items-center justify-between rounded-lg border border-white/5 bg-[#06152b] p-2.5 transition-colors hover:border-cyan-400/30"
            >
              <button onClick={() => onSelect(item.symbol)} className="min-w-0 text-left">
                <div className="font-display font-bold text-cyan-300">★ {item.symbol}</div>
                <div className={`mt-0.5 font-mono text-[11px] font-semibold ${tone(item.quote?.changePct)}`}>
                  {item.quote ? `${fmtNum(item.quote.close)} · ${fmtPct(item.quote.changePct)}` : "Đang lấy giá…"}
                </div>
              </button>
              <button
                onClick={() => onRemove(item.symbol)}
                className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                aria-label={`Xóa ${item.symbol}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function StockQuickView({
  symbol,
  snapshot,
  onClose,
  isWatched,
  onWatch,
}: {
  symbol: string;
  snapshot: MarketSnapshot;
  onClose: () => void;
  isWatched: boolean;
  onWatch: (symbol: string) => void;
}) {
  const quote = [...snapshot.quotes, ...snapshot.sectorQuotes].find((q) => q.symbol === symbol);
  if (!quote) return null;

  return (
    <div className="fixed inset-x-3 bottom-20 z-50 max-w-sm rounded-2xl border border-cyan-400/40 bg-[#07192e] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.7)] backdrop-blur-xl md:inset-auto md:right-6 md:top-24 md:bottom-auto">
      <div className="flex items-start justify-between border-b border-white/10 pb-2">
        <div>
          <div className="font-mono text-[10px] text-cyan-400">XEM NHANH CỔ PHIẾU</div>
          <h3 className="mt-0.5 font-display text-xl font-bold text-white">{quote.symbol}</h3>
        </div>
        <button onClick={onClose} className="p-1 text-slate-400 hover:text-white" aria-label="Đóng">
          ×
        </button>
      </div>
      <div className="mt-3.5 flex items-end justify-between">
        <div>
          <div className="font-mono text-2xl font-black text-white">{fmtNum(quote.close)}</div>
          <div className={`font-mono text-xs font-bold ${tone(quote.changePct)}`}>{fmtPct(quote.changePct)}</div>
        </div>
        <MiniSparkline quote={quote} />
      </div>
      <div className="mt-3.5 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-[#0b243b] p-2.5">
          <div className="text-[10px] text-slate-400">Khối lượng</div>
          <div className="mt-0.5 font-mono font-bold text-white">{fmtVol(quote.volume)}</div>
        </div>
        <div className="rounded-lg bg-[#0b243b] p-2.5">
          <div className="text-[10px] text-slate-400">Độ tin cậy</div>
          <div className="mt-0.5 font-mono font-bold text-emerald-400">{Math.round(quote.confidence * 100)}%</div>
        </div>
      </div>
      <div className="mt-3.5 flex gap-2">
        <button onClick={() => onWatch(quote.symbol)} className="btn-orca-ghost flex-1 text-xs">
          {isWatched ? "★ Đang theo dõi" : "☆ Theo dõi mã"}
        </button>
        <Link href={`/stocks/${quote.symbol}`} className="btn-orca flex-1 text-center text-xs">
          Mở phân tích
        </Link>
      </div>
    </div>
  );
}

export function DashboardHome() {
  const { data: snapshot, error, loading, isValidating } = usePoll<MarketSnapshot>("/market/overview", 30000, {
    softTtlMs: 15000,
    timeoutMs: 7000,
  });
  const watchlist = usePoll<{ items: Array<{ symbol: string; quote: MarketQuote | null }> }>("/watchlist", 60000);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedIndexCode, setSelectedIndexCode] = useState<string | null>(null);
  const watchedSymbols = new Set((watchlist.data?.items ?? []).map((item) => item.symbol));

  const toggleWatch = async (symbol: string) => {
    if (watchedSymbols.has(symbol)) {
      await api(`/watchlist?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE", skipCache: true });
    } else {
      await api("/watchlist", {
        method: "POST",
        skipCache: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
    }
    await watchlist.refresh();
  };

  return (
    <div className="space-y-4 md:space-y-5">
      {/* Header Terminal Banner */}
      <section className="rounded-xl border border-[#1e3a5f]/80 bg-[#081d35]/90 overflow-hidden shadow-lg">
        <div className="flex flex-wrap items-center justify-between border-b border-[#1a3558] px-3.5 py-2.5 sm:px-4 sm:py-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-cyan-400">ORCA FINANCIAL TERMINAL</div>
            <h1 className="font-display text-base sm:text-lg font-black text-white md:text-xl">Tổng quan thị trường chứng khoán</h1>
          </div>
          <div className="text-right font-mono text-[10px] text-slate-400">
            <div className="flex items-center justify-end gap-1.5 font-bold">
              <span
                className={`h-2 w-2 rounded-full ${
                  isValidating
                    ? "animate-pulse bg-cyan-400"
                    : snapshot?.quality.stale
                    ? "bg-rose-400"
                    : snapshot?.quality.partial
                    ? "bg-amber-400"
                    : "bg-emerald-400 shadow-[0_0_8px_#34d399]"
                }`}
              />
              {isValidating ? "SYNCING REALTIME" : snapshot?.quality.stale ? "STALE DATA" : snapshot?.quality.partial ? "PARTIAL LIVE" : "LIVE REALTIME"}
            </div>
            <div className="mt-0.5 sm:mt-1">
              {snapshot
                ? `${new Date(snapshot.generatedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · ${snapshot.quality.ageSeconds}s`
                : "Đang kết nối Data Engine…"}
            </div>
          </div>
        </div>

        {snapshot && (
          <div className="ticker-tape flex w-max gap-6 whitespace-nowrap px-4 py-2 text-xs font-mono">
            <span className="font-bold text-cyan-400">ORCA FEED</span>
            {[...snapshot.quotes, ...snapshot.quotes].map((q, i) => (
              <Link key={`${q.symbol}-${i}`} href={`/stocks/${q.symbol}`} className="flex items-center gap-2 hover:opacity-80">
                <span className="font-bold text-slate-200">{q.symbol}</span>
                <span className="text-slate-300">{fmtNum(q.close)}</span>
                <span className={`font-bold ${tone(q.changePct)}`}>{fmtPct(q.changePct)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {loading && !snapshot && (
        <div className="rounded-xl border border-[#1e3a5f] bg-[#081d35]/80 p-10 text-center text-sm text-slate-400">
          <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          <div className="mt-3 font-mono text-xs">Đang tải dữ liệu thời gian thực từ ORCA Engine…</div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-700/60 bg-rose-950/30 p-4 text-xs font-mono text-rose-300">
          Lỗi đồng bộ snapshot mới: {error}. Hệ thống đang kết nối kênh dự phòng.
        </div>
      )}

      {snapshot && (
        <>
          {/* Market Indices Section (VNINDEX, VN30, VN100, HNX, UPCOM) */}
          <section>
            <SectionHeader
              eyebrow="CHỈ SỐ CHÍNH"
              title="Chỉ số thị trường Việt Nam"
              action={<span className="font-mono text-[10px] text-slate-400">Click chỉ số để xem chi tiết & biểu đồ</span>}
            />
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
              {snapshot.indices.map((index) => (
                <IndexCard
                  key={index.code}
                  index={index}
                  primary={index.code === "VNINDEX"}
                  onClick={() => setSelectedIndexCode(index.code)}
                />
              ))}
            </div>
          </section>

          {/* Market Pulse & Regime */}
          <Pulse snapshot={snapshot} />

          {/* Breadth Meters */}
          <section className="grid gap-2.5 sm:gap-3 md:grid-cols-2">
            <BreadthMeter title="Độ rộng toàn thị trường" breadth={snapshot.marketBreadth} />
            <BreadthMeter title="Độ rộng nhóm Large-Cap (VN30)" breadth={snapshot.largeCapBreadth} />
          </section>

          {/* Overnight International Markets */}
          <OvernightMarkets snapshot={snapshot.overnight} />

          {/* Heatmap & AI Insights */}
          <section className="grid gap-4 lg:grid-cols-[1.65fr_1fr]">
            <div className="rounded-xl border border-[#1e3a5f]/80 bg-[#081d35]/90 p-3.5 sm:p-5 shadow-lg">
              <SectionHeader
                eyebrow="MARKET HEATMAP"
                title="Bản đồ nhiệt sức mạnh cổ phiếu"
                action={<span className="font-mono text-[10px] text-slate-400">Click mã để xem nhanh</span>}
              />
              <Heatmap quotes={snapshot.quotes} onSelect={setSelected} />
              <div className="mt-3.5 flex gap-4 border-t border-white/5 pt-3 font-mono text-[10px] text-slate-400">
                <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded bg-emerald-500" /> Tăng giá</span>
                <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded bg-slate-600" /> Đi ngang</span>
                <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded bg-rose-500" /> Giảm giá</span>
              </div>
            </div>

            <AIInsight snapshot={snapshot} onSelect={setSelected} />
          </section>

          {/* Watchlist */}
          <WatchlistPanel
            items={watchlist.data?.items ?? []}
            onSelect={setSelected}
            onRemove={(symbol) => void toggleWatch(symbol)}
          />

          {/* Quick Links */}
          <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {QUICK_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-xl border border-[#1e3a5f]/80 bg-[#081d35]/90 p-3 sm:p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-400/50 hover:bg-[#0c2645]"
              >
                <div className="font-display text-xs sm:text-sm font-bold text-white">{item.label}</div>
                <div className="mt-0.5 sm:mt-1 font-mono text-[10px] leading-snug text-slate-400">{item.desc}</div>
              </Link>
            ))}
          </section>
        </>
      )}

      {/* News Timeline */}
      <NewsTimeline items={snapshot?.news ?? []} />

      {/* Index Microstructure Detail Modal */}
      {selectedIndexCode && (
        <IndexDetailModal code={selectedIndexCode} onClose={() => setSelectedIndexCode(null)} />
      )}

      {/* Stock Quick View Drawer */}
      {snapshot && selected && (
        <StockQuickView
          symbol={selected}
          snapshot={snapshot}
          isWatched={watchedSymbols.has(selected)}
          onWatch={(symbol) => void toggleWatch(symbol)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
