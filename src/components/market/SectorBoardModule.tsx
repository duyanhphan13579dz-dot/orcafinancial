"use client";

import { useState } from "react";
import Link from "next/link";
import { usePoll } from "@/lib/client";
import type { MarketQuote, MarketSnapshot } from "@/types/market";
import { SectorBoard } from "@/components/market/SectorBoard";

function QuickQuote({ quote }: { quote: MarketQuote }) {
  const change = quote.changePct ?? 0;
  const color = change > 0.005 ? "text-emerald-400" : change < -0.005 ? "text-rose-400" : "text-amber-300";
  return <span className={`font-mono text-[10px] ${color}`}>{quote.symbol} {change >= 0 ? "+" : ""}{change.toFixed(2)}%</span>;
}

export function SectorBoardModule() {
  const { data: snapshot, error, loading } = usePoll<MarketSnapshot>("/market/overview", 30_000, { softTtlMs: 15_000, timeoutMs: 7_000 });
  const [selected, setSelected] = useState<string | null>(null);
  const selectedQuote = selected && snapshot?.quotes.find((quote) => quote.symbol === selected);

  return (
    <div className="space-y-5">
      <header className="panel overflow-hidden p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400">SECTOR INTELLIGENCE</div>
            <h1 className="mt-1 font-display text-2xl font-extrabold text-white">Market Board theo ngành</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">Bảng theo dõi độc lập cho sức mạnh ngành, mã dẫn dắt, thanh khoản và biến động trong phiên Việt Nam.</p>
          </div>
          <Link href="/" className="btn-orca-ghost text-xs">← Về tổng quan</Link>
        </div>
        {snapshot && <div className="mt-4 flex flex-wrap gap-3 border-t border-white/5 pt-3">{snapshot.topGainers.slice(0, 4).map((quote) => <QuickQuote key={quote.symbol} quote={quote} />)}</div>}
      </header>
      {loading && !snapshot && <div className="panel p-8 text-center text-sm text-slate-400">Đang đồng bộ sector snapshot…</div>}
      {error && <div className="panel border-rose-700 bg-rose-950/30 p-4 text-sm text-rose-300">Không lấy được sector snapshot mới: {error}</div>}
      {snapshot && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {snapshot.sectors.map((sector) => <SectorBoard key={sector.id} sector={sector} onSelect={setSelected} />)}
        </div>
        <section className="panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400">SECTOR SUMMARY</div>
              <h2 className="mt-1 font-display text-lg font-bold text-white">Tín hiệu xoay vòng</h2>
            </div>
            <span className="text-[10px] text-slate-500">Snapshot {new Date(snapshot.generatedAt).toLocaleTimeString("vi-VN")}</span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {[...snapshot.sectors].sort((a, b) => (b.strength ?? -1) - (a.strength ?? -1)).slice(0, 4).map((sector) => <div key={sector.id} className="flex items-center justify-between rounded-md border border-white/5 bg-[#091d34]/70 px-3 py-2 text-xs"><span className="text-slate-300">{sector.label}</span><span className="font-mono text-cyan-300">Strength {sector.strength ?? "—"}</span><span className="font-mono text-slate-500">{sector.stocks.length} mã</span></div>)}
          </div>
        </section>
      </>}
      {selected && selectedQuote && <div className="fixed inset-x-3 bottom-4 z-40 flex items-center justify-between gap-3 rounded-lg border border-cyan-400/30 bg-[#081d35] p-3 text-xs shadow-2xl md:inset-auto md:bottom-6 md:right-6 md:w-80"><button type="button" onClick={() => setSelected(null)} className="text-left"><span className="font-bold text-cyan-300">{selectedQuote.symbol}</span><span className="ml-2 text-slate-400">{selectedQuote.close.toLocaleString("vi-VN")}</span></button><Link href={`/stocks/${selectedQuote.symbol}`} className="btn-orca text-xs">Mở phân tích →</Link></div>}
    </div>
  );
}
