import type { MarketQuote, SectorSnapshot } from "@/types/market";
import { fmtNum, fmtPct, fmtVol } from "@/lib/client";

function tone(value: number | null | undefined) {
  if (value == null || Math.abs(value) < 0.005) return "text-amber-300";
  return value > 0 ? "text-emerald-400" : "text-rose-400";
}

export interface SectorBoardProps {
  sector: SectorSnapshot;
  onSelect: (symbol: string) => void;
}

export function SectorBoard({ sector, onSelect }: SectorBoardProps) {
  return (
    <article className="panel min-w-[276px] flex-1 overflow-hidden" aria-label={`Bảng thị trường ngành ${sector.label}`}>
      <header className="flex items-center justify-between border-b border-[#1a3558] bg-[#0c2d4d]/70 px-3 py-2">
        <div>
          <div className="font-display text-sm font-bold text-white">{sector.label}</div>
          <div className="font-mono text-[10px] text-slate-500">
            {sector.stocks.length >= 6 ? "6 mã hiển thị" : `${sector.stocks.length}/6 mã có dữ liệu`} · {sector.advancing} ↑ · {sector.unchanged} = · {sector.declining} ↓
          </div>
        </div>
        <div className={`font-mono text-sm font-bold ${tone(sector.averageChangePct)}`}>
          {fmtPct(sector.averageChangePct)}
        </div>
      </header>
      <div className="px-3 py-2">
        <div className="mb-2 flex items-center justify-between text-[10px] text-slate-500">
          <span>Sức mạnh ngành</span>
          <span className="font-mono text-slate-300">{sector.strength ?? "—"}/100</span>
        </div>
        <div className="bar-track" aria-label={`Sức mạnh ${sector.strength ?? 0} trên 100`}>
          <div
            className={`bar-fill ${sector.strength != null && sector.strength >= 50 ? "bg-emerald-400" : "bg-rose-400"}`}
            style={{ width: `${sector.strength ?? 0}%` }}
          />
        </div>
      </div>
      <div className="px-2 pb-2">
        <div className="grid grid-cols-[1fr_2.2fr_.9fr_1fr] gap-2 border-b border-[#1a3558] px-1 py-1 text-[9px] uppercase text-slate-500">
          <span>Mã</span>
          <span className="text-right">Giá</span>
          <span className="text-right">+/-</span>
          <span className="text-right">KL</span>
        </div>
        {sector.stocks.slice(0, 6).map((quote: MarketQuote) => (
          <button
            key={quote.symbol}
            type="button"
            onClick={() => onSelect(quote.symbol)}
            className="grid w-full grid-cols-[1fr_2.2fr_.9fr_1fr] gap-2 rounded px-1 py-1.5 text-left text-xs transition-colors hover:bg-cyan-400/10"
          >
            <span className="font-bold text-cyan-300">{quote.symbol}</span>
            <span className="text-right font-mono tabular-nums text-slate-200">{fmtNum(quote.close)}</span>
            <span className={`text-right font-mono tabular-nums ${tone(quote.changePct)}`}>
              {fmtPct(quote.changePct)}
            </span>
            <span className="text-right font-mono tabular-nums text-slate-400">{fmtVol(quote.volume)}</span>
          </button>
        ))}
      </div>
    </article>
  );
}
