"use client";

import type { OrderBookSnapshot, ForeignFlowSnapshot } from "@/lib/connectors/tcbs-microstructure";

type Props = { orderBook: OrderBookSnapshot; foreignFlow: ForeignFlowSnapshot };
const money = (value: number | null) => value == null ? "—" : `${value.toLocaleString("vi-VN", { maximumFractionDigits: 2 })} tỷ`;
const qty = (value: number | null) => value == null ? "—" : value.toLocaleString("vi-VN");
const timeLabel = (seconds: number) => seconds ? new Date(seconds * 1000).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "Chưa có";
const statusLabel: Record<string, string> = { live: "Trực tiếp", delayed: "Trễ", stale: "Cũ", unavailable: "Chưa khả dụng" };

function Status({ status, source }: { status: string; source: string }) {
  const color = status === "live" ? "text-emerald-400" : status === "unavailable" ? "text-slate-500" : "text-amber-400";
  const label = source === "tcbs-market-data-mock" ? "Mô phỏng phát triển" : (statusLabel[status] ?? status);
  return <span className={`text-[10px] ${color}`} title={`Nguồn dữ liệu: ${source}`}>● {label}</span>;
}

export function StockMicrostructurePanel({ orderBook, foreignFlow }: Props) {
  const unavailable = orderBook.status === "unavailable" && foreignFlow.status === "unavailable";
  return <div className="grid gap-4 xl:grid-cols-2">
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div><h3 className="text-sm font-semibold text-slate-200">Sổ lệnh</h3><p className="mt-0.5 text-[10px] text-slate-500">Thanh khoản đang chờ mua và chờ bán</p></div>
        <Status status={orderBook.status} source={orderBook.source} />
      </div>
      {unavailable ? <div className="p-5 text-xs text-slate-500">Sổ lệnh TCBS chưa khả dụng. Hệ thống sẽ tự cập nhật khi luồng dữ liệu được kết nối.</div> : <>
        <div className="grid grid-cols-2 gap-3 px-4 py-3 text-xs"><div><span className="text-slate-500">Bên mua</span><strong className="ml-2 text-emerald-400">{money(orderBook.bidValue)}</strong></div><div className="text-right"><span className="text-slate-500">Bên bán</span><strong className="ml-2 text-rose-400">{money(orderBook.askValue)}</strong></div></div>
        <div className="grid grid-cols-2 gap-3 px-4 pb-3"><div className="space-y-1">{orderBook.bids.map((row, i) => <div key={`b${i}`} className="flex justify-between rounded bg-emerald-500/[.06] px-2 py-1 text-[11px]"><span className="text-emerald-300">{row.price.toLocaleString("vi-VN")}</span><span className="text-slate-400">{qty(row.volume)}</span></div>)}</div><div className="space-y-1">{orderBook.asks.map((row, i) => <div key={`a${i}`} className="flex justify-between rounded bg-rose-500/[.06] px-2 py-1 text-[11px]"><span className="text-rose-300">{row.price.toLocaleString("vi-VN")}</span><span className="text-slate-400">{qty(row.volume)}</span></div>)}</div></div>
        <div className="flex justify-between border-t border-slate-800 px-4 py-2 text-[10px] text-slate-500"><span>Chênh lệch giá: {orderBook.spread ?? "—"}</span><span>Cân bằng: <b className={orderBook.imbalancePct != null && orderBook.imbalancePct >= 0 ? "text-emerald-400" : "text-rose-400"}>{orderBook.imbalancePct == null ? "—" : `${orderBook.imbalancePct}%`}</b></span><span>{timeLabel(orderBook.updatedAt)}</span></div>
      </>}
    </section>
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3"><div><h3 className="text-sm font-semibold text-slate-200">Khối ngoại</h3><p className="mt-0.5 text-[10px] text-slate-500">Giá trị mua bán trong phiên</p></div><Status status={foreignFlow.status} source={foreignFlow.source} /></div>
      {foreignFlow.status === "unavailable" ? <div className="p-5 text-xs text-slate-500">Dữ liệu giao dịch khối ngoại TCBS chưa khả dụng. Không hiển thị số ước tính khi chưa có nguồn xác thực.</div> : <div className="p-4"><div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-emerald-500/[.08] p-3"><div className="text-[10px] text-slate-500">Mua vào</div><strong className="mt-1 block text-sm text-emerald-400">{money(foreignFlow.buyValue)}</strong></div><div className="rounded-lg bg-rose-500/[.08] p-3"><div className="text-[10px] text-slate-500">Bán ra</div><strong className="mt-1 block text-sm text-rose-400">{money(foreignFlow.sellValue)}</strong></div><div className="rounded-lg bg-slate-800/60 p-3"><div className="text-[10px] text-slate-500">Mua/bán ròng</div><strong className={`mt-1 block text-sm ${(foreignFlow.netValue ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{money(foreignFlow.netValue)}</strong></div></div><div className="mt-4 grid grid-cols-2 gap-y-2 text-xs"><span className="text-slate-500">Khối lượng mua</span><span className="text-right text-slate-300">{qty(foreignFlow.buyVolume)} cp</span><span className="text-slate-500">Khối lượng bán</span><span className="text-right text-slate-300">{qty(foreignFlow.sellVolume)} cp</span><span className="text-slate-500">Room còn lại</span><span className="text-right text-slate-300">{foreignFlow.foreignRoomPct == null ? "—" : `${foreignFlow.foreignRoomPct}%`}</span></div><div className="mt-4 border-t border-slate-800 pt-2 text-[10px] text-slate-500">Cập nhật {timeLabel(foreignFlow.updatedAt)} · Đơn vị giá trị: tỷ đồng</div></div>}
    </section>
  </div>;
}
