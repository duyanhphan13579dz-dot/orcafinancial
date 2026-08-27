import type { OvernightMarketItem, OvernightMarketKind, OvernightMarketSnapshot } from "@/types/market";
import { fmtPct } from "@/lib/client";

const GROUPS: Array<{ kind: OvernightMarketKind; label: string }> = [
  { kind: "index", label: "Chỉ số quốc tế" },
  { kind: "commodity", label: "Hàng hóa" },
  { kind: "fx", label: "Forex" },
  { kind: "rates", label: "Lãi suất & rủi ro" },
];

function tone(value: number | null) {
  if (value == null || Math.abs(value) < 0.005) return "text-amber-300";
  return value > 0 ? "text-emerald-400" : "text-rose-400";
}

function formatValue(item: OvernightMarketItem) {
  if (item.value == null) return "—";
  if (item.unit === "USD") return `$${item.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (item.unit === "%") return `${item.value.toFixed(3)}%`;
  if (item.unit === "rate") return item.value.toFixed(4);
  return item.value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function statusLabel(item: OvernightMarketItem) {
  if (item.status === "live") return "TRỰC TIẾP";
  if (item.status === "stale") return "DỮ LIỆU CŨ";
  if (item.status === "delayed") return "TRỄ";
  return "Chưa có";
}

function MarketCard({ item }: { item: OvernightMarketItem }) {
  return (
    <article className="rounded-md border border-white/5 bg-[#091d34]/75 p-3 transition-colors hover:border-cyan-400/30">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.label}</span>
        <span className={`shrink-0 text-[9px] ${item.status === "unavailable" ? "text-slate-600" : item.status === "stale" ? "text-amber-300" : "text-cyan-300"}`}>
          {statusLabel(item)}
        </span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="font-mono text-lg font-bold tabular-nums text-white">{formatValue(item)}</span>
        <span className={`font-mono text-xs font-semibold tabular-nums ${tone(item.changePct)}`}>{fmtPct(item.changePct)}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[9px] text-slate-600">
        <span>{item.source}</span>
        <span>{item.updatedAt ? new Date(item.updatedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "chưa có thời gian"}</span>
      </div>
    </article>
  );
}

export function OvernightMarkets({ snapshot }: { snapshot: OvernightMarketSnapshot }) {
  return (
    <section className="panel overflow-hidden p-4 md:p-5" aria-label="Thị trường quốc tế qua đêm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400">THỊ TRƯỜNG QUA ĐÊM</div>
          <h2 className="mt-1 font-display text-lg font-bold text-white md:text-xl">Bối cảnh quốc tế qua đêm</h2>
        </div>
        <div className="text-right text-[10px] text-slate-500">
          <div className={snapshot.stale ? "text-amber-300" : "text-cyan-300"}>{snapshot.stale ? "DỮ LIỆU CŨ · DỰ PHÒNG" : snapshot.partial ? "DỮ LIỆU MỘT PHẦN" : "DỮ LIỆU QUA ĐÊM"}</div>
          <div className="mt-1">{new Date(snapshot.generatedAt).toLocaleTimeString("vi-VN")}</div>
        </div>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-4">
        {GROUPS.map((group) => {
          const items = snapshot.items.filter((item) => item.kind === group.kind);
          return (
            <div key={group.kind}>
              <div className="mb-2 flex items-center justify-between border-b border-[#1a3558] pb-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">{group.label}</span>
                <span className="font-mono text-[9px] text-slate-600">{items.filter((item) => item.value != null).length}/{items.length}</span>
              </div>
              <div className="space-y-2">{items.map((item) => <MarketCard key={item.symbol} item={item} />)}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/5 pt-3 text-[10px] text-slate-500">
        <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" />Dữ liệu trễ hoặc cập nhật gần nhất</span>
        <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />Dữ liệu cũ, dùng dự phòng</span>
        <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-slate-600" />Chưa có dữ liệu</span>
      </div>
    </section>
  );
}
