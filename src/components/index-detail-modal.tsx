"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api, fmtNum, fmtPct, fmtVol } from "@/lib/client";
import type { IndexMicrostructureSnapshot } from "@/lib/connectors/index-microstructure";

interface Props {
  code: string;
  onClose: () => void;
}

export function IndexDetailModal({ code, onClose }: Props) {
  const [data, setData] = useState<IndexMicrostructureSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"intraday" | "depth" | "moneyflow" | "foreign" | "marketmaker">("intraday");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    api<IndexMicrostructureSnapshot>(`/indices/${encodeURIComponent(code)}`)
      .then((env) => {
        if (!active) return;
        if (env && env.data) {
          setData(env.data);
        } else {
          setError("Không thể tải dữ liệu chỉ số");
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [code]);

  if (!code) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-md md:p-6 animate-fadeIn">
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-cyan-500/30 bg-[#07182e] shadow-[0_0_50px_rgba(0,0,0,0.8)]">
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between border-b border-[#1c3a60] bg-[#0a213e]/90 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-400/40 bg-gradient-to-br from-cyan-500/20 to-blue-600/10 font-display text-lg font-black text-cyan-300 shadow-inner">
              {code.slice(0, 4)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-xl font-black text-white">{data?.name || code}</h2>
                <span className="rounded bg-cyan-500/20 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-cyan-300">
                  {data?.exchange || "HOSE"}
                </span>
              </div>
              <p className="font-mono text-[11px] text-slate-400">Dữ liệu thời gian thực từ VNDIRECT · Vietstock · HOSE/HNX</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href={`/indices/${encodeURIComponent(code)}`}
              className="hidden rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-1.5 font-mono text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 md:inline-block"
            >
              Trang riêng →
            </Link>
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 transition-colors hover:bg-rose-500/20 hover:text-rose-400"
              aria-label="Đóng"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Loading / Error States */}
        {loading && (
          <div className="flex h-96 flex-col items-center justify-center gap-3 p-8 text-slate-400">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
            <span className="font-mono text-xs">Đang quét sổ lệnh & dòng tiền thời gian thực của {code}…</span>
          </div>
        )}

        {error && !loading && (
          <div className="p-8 text-center font-mono text-sm text-rose-400">
            Lỗi tải dữ liệu: {error}
          </div>
        )}

        {/* Content Body */}
        {data && !loading && (
          <div className="flex flex-1 flex-col overflow-y-auto p-4 md:p-6 space-y-5">
            {/* Price Summary Strip */}
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-[#1e3d64] bg-[#0a203c]/80 p-4 sm:grid-cols-4 md:grid-cols-6">
              <div>
                <div className="font-mono text-[10px] uppercase text-slate-400">Điểm chỉ số</div>
                <div className="mt-0.5 font-mono text-2xl font-black text-white">{fmtNum(data.close)}</div>
                <div className={`mt-0.5 font-mono text-xs font-bold ${data.changePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {data.changePoints > 0 ? `+${data.changePoints}` : data.changePoints} ({fmtPct(data.changePct)})
                </div>
              </div>

              <div>
                <div className="font-mono text-[10px] uppercase text-slate-400">Cao nhất / Thấp nhất</div>
                <div className="mt-1 font-mono text-sm font-bold text-slate-200">
                  <span className="text-emerald-400">{fmtNum(data.high)}</span> / <span className="text-rose-400">{fmtNum(data.low)}</span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-slate-500">Mở cửa: {fmtNum(data.open)}</div>
              </div>

              <div>
                <div className="font-mono text-[10px] uppercase text-slate-400">Tổng giá trị giao dịch</div>
                <div className="mt-1 font-mono text-sm font-bold text-cyan-300">{data.totalValueBillion.toLocaleString()} tỷ VNĐ</div>
                <div className="mt-1 font-mono text-[10px] text-slate-500">KLGD: {data.totalVolumeMillion} triệu cp</div>
              </div>

              <div>
                <div className="font-mono text-[10px] uppercase text-slate-400">Ròng Khối Ngoại</div>
                <div className={`mt-1 font-mono text-sm font-bold ${data.foreignFlow.netValueBillion >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {data.foreignFlow.netValueBillion > 0 ? `+${data.foreignFlow.netValueBillion}` : data.foreignFlow.netValueBillion} tỷ VNĐ
                </div>
                <div className="mt-1 font-mono text-[10px] text-slate-500">Mua {data.foreignFlow.buyValueBillion}B · Bán {data.foreignFlow.sellValueBillion}B</div>
              </div>

              <div>
                <div className="font-mono text-[10px] uppercase text-slate-400">Dòng Tiền Chủ Động</div>
                <div className={`mt-1 font-mono text-sm font-bold ${data.moneyFlow.netFlowBillion >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {data.moneyFlow.netFlowBillion > 0 ? `+${data.moneyFlow.netFlowBillion}` : data.moneyFlow.netFlowBillion} tỷ VNĐ
                </div>
                <div className="mt-1 font-mono text-[10px] text-slate-500">Tổ chức {data.moneyFlow.institutionalFlowBillion}B</div>
              </div>

              <div>
                <div className="font-mono text-[10px] uppercase text-slate-400">Tín hiệu Tạo Lập</div>
                <div className="mt-1 font-mono text-sm font-bold text-amber-300">{data.marketMaker.regime}</div>
                <div className="mt-1 font-mono text-[10px] text-cyan-300">Score: {data.marketMaker.activityScore}/100</div>
              </div>
            </div>

            {/* Tab Bar */}
            <div className="flex border-b border-[#1c3a60] font-mono text-xs">
              {[
                { id: "intraday", label: "Biến động & Thanh khoản" },
                { id: "depth", label: "Sổ lệnh & Cung cầu" },
                { id: "moneyflow", label: "Dòng tiền chủ động" },
                { id: "foreign", label: "Giao dịch Khối ngoại" },
                { id: "marketmaker", label: "Dấu hiệu Tạo lập (MM)" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`border-b-2 px-4 py-2.5 font-bold transition-colors ${
                    activeTab === tab.id
                      ? "border-cyan-400 text-cyan-300 bg-cyan-500/10"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab 1: Intraday & Liquidity */}
            {activeTab === "intraday" && (
              <div className="space-y-4">
                <div className="rounded-xl border border-[#1e3d64] bg-[#0a203c]/80 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-300">
                      Biến động giá & Giá bình quân VWAP trong ngày
                    </h3>
                    <span className="font-mono text-[10px] text-slate-400">Cập nhật từng phút</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                    {data.intraday.map((pt) => (
                      <div key={pt.time} className="rounded-lg border border-white/5 bg-[#06162b] p-2.5 text-center font-mono">
                        <div className="text-[10px] text-slate-400">{pt.time}</div>
                        <div className="mt-1 text-sm font-extrabold text-white">{fmtNum(pt.price)}</div>
                        <div className="mt-0.5 text-[10px] text-slate-400">VWAP: {fmtNum(pt.vwap)}</div>
                        <div className="mt-1 text-[10px] text-cyan-300">{pt.cumulativeValueBillion} tỷ</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Liquidity Benchmark */}
                <div className="rounded-xl border border-[#1e3d64] bg-[#0a203c]/80 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-300">
                        So sánh thanh khoản với trung bình 5 ngày & 20 ngày
                      </h3>
                      <p className="mt-1 font-mono text-xs text-slate-300">{data.liquidity.statusText}</p>
                    </div>
                    <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 font-mono text-xs font-bold text-emerald-400">
                      NHỊP GD: {data.liquidity.liquidityPace}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-3 font-mono text-center">
                    <div className="rounded-lg bg-[#06162b] p-3">
                      <div className="text-[10px] text-slate-400">Phiên hôm nay</div>
                      <div className="mt-1 text-lg font-bold text-white">{data.liquidity.currentValueBillion} tỷ</div>
                    </div>
                    <div className="rounded-lg bg-[#06162b] p-3">
                      <div className="text-[10px] text-slate-400">Trung bình 5 phiên</div>
                      <div className="mt-1 text-lg font-bold text-slate-300">{data.liquidity.avg5dValueBillion} tỷ</div>
                    </div>
                    <div className="rounded-lg bg-[#06162b] p-3">
                      <div className="text-[10px] text-slate-400">Tỷ lệ so với MA5</div>
                      <div className="mt-1 text-lg font-bold text-emerald-400">{data.liquidity.ratioVs5dPct}%</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: OrderBook Depth */}
            {activeTab === "depth" && (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  {/* Bids */}
                  <div className="rounded-xl border border-emerald-500/20 bg-[#061d2d]/90 p-4">
                    <div className="mb-3 flex items-center justify-between border-b border-emerald-500/20 pb-2">
                      <span className="font-mono text-xs font-bold text-emerald-400">MUA CHỜ (BIDS) - RỔ CỔ PHIẾU</span>
                      <span className="font-mono text-xs text-emerald-300">{data.orderBook.bidValueBillion} Tỷ VNĐ</span>
                    </div>
                    <div className="space-y-2 font-mono text-xs">
                      {data.orderBook.bids.map((b, i) => (
                        <div key={i} className="flex items-center justify-between rounded bg-emerald-500/5 p-2">
                          <span className="font-bold text-emerald-300">{fmtNum(b.price)}</span>
                          <span className="text-slate-300">{b.volume.toLocaleString()} cp</span>
                          <span className="text-slate-400">{b.orders} lệnh</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Asks */}
                  <div className="rounded-xl border border-rose-500/20 bg-[#250f1a]/90 p-4">
                    <div className="mb-3 flex items-center justify-between border-b border-rose-500/20 pb-2">
                      <span className="font-mono text-xs font-bold text-rose-400">BÁN CHỜ (ASKS) - RỔ CỔ PHIẾU</span>
                      <span className="font-mono text-xs text-rose-300">{data.orderBook.askValueBillion} Tỷ VNĐ</span>
                    </div>
                    <div className="space-y-2 font-mono text-xs">
                      {data.orderBook.asks.map((a, i) => (
                        <div key={i} className="flex items-center justify-between rounded bg-rose-500/5 p-2">
                          <span className="font-bold text-rose-300">{fmtNum(a.price)}</span>
                          <span className="text-slate-300">{a.volume.toLocaleString()} cp</span>
                          <span className="text-slate-400">{a.orders} lệnh</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Pressure Ratio */}
                <div className="rounded-xl border border-[#1e3d64] bg-[#0a203c]/80 p-4">
                  <div className="flex items-center justify-between font-mono text-xs">
                    <span className="text-slate-300">Tỷ lệ áp lực Cung / Cầu</span>
                    <span className="font-bold text-cyan-300">Chênh lệch lệnh: {data.orderBook.imbalancePct}%</span>
                  </div>
                  <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-800 p-0.5">
                    <div
                      className="rounded-l-full bg-emerald-400 transition-all"
                      style={{ width: `${data.orderBook.buyPressurePct}%` }}
                    />
                    <div
                      className="rounded-r-full bg-rose-400 transition-all"
                      style={{ width: `${100 - data.orderBook.buyPressurePct}%` }}
                    />
                  </div>
                  <div className="mt-2 flex justify-between font-mono text-[11px]">
                    <span className="text-emerald-400">Lực Mua {data.orderBook.buyPressurePct}%</span>
                    <span className="text-rose-400">Lực Bán {Math.round((100 - data.orderBook.buyPressurePct) * 10) / 10}%</span>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 3: Money Flow */}
            {activeTab === "moneyflow" && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3 font-mono">
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <div className="text-[10px] text-emerald-300">Chủ động mua</div>
                    <div className="mt-1 text-2xl font-black text-emerald-400">+{data.moneyFlow.activeBuyValueBillion} tỷ</div>
                  </div>
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
                    <div className="text-[10px] text-rose-300">Chủ động bán</div>
                    <div className="mt-1 text-2xl font-black text-rose-400">-{data.moneyFlow.activeSellValueBillion} tỷ</div>
                  </div>
                  <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4">
                    <div className="text-[10px] text-cyan-300">Dòng tiền cá mập / tổ chức</div>
                    <div className="mt-1 text-2xl font-black text-cyan-300">
                      {data.moneyFlow.institutionalFlowBillion > 0 ? `+${data.moneyFlow.institutionalFlowBillion}` : data.moneyFlow.institutionalFlowBillion} tỷ
                    </div>
                  </div>
                </div>

                {/* Sector Money Flow */}
                <div className="rounded-xl border border-[#1e3d64] bg-[#0a203c]/80 p-4">
                  <h3 className="mb-3 font-mono text-xs font-bold uppercase tracking-wider text-cyan-300">
                    Phân bổ dòng tiền theo nhóm ngành chính
                  </h3>
                  <div className="space-y-2.5 font-mono text-xs">
                    {data.moneyFlow.sectorDistribution.map((sec) => (
                      <div key={sec.sector} className="flex items-center justify-between rounded-lg bg-[#06162b] p-3">
                        <span className="font-bold text-slate-200">{sec.sector}</span>
                        <div className="flex items-center gap-4">
                          <span className="text-slate-400">{sec.percent}% thị phần</span>
                          <span className={`font-bold ${sec.netFlowBillion >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {sec.netFlowBillion > 0 ? `+${sec.netFlowBillion}` : sec.netFlowBillion} tỷ VNĐ
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 4: Foreign Flow */}
            {activeTab === "foreign" && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3 font-mono">
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <div className="text-[10px] text-emerald-300">Khối ngoại mua</div>
                    <div className="mt-1 text-2xl font-black text-emerald-400">{data.foreignFlow.buyValueBillion} tỷ</div>
                    <div className="mt-1 text-[10px] text-slate-400">{data.foreignFlow.buyVolumeMillion}M cp</div>
                  </div>
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
                    <div className="text-[10px] text-rose-300">Khối ngoại bán</div>
                    <div className="mt-1 text-2xl font-black text-rose-400">{data.foreignFlow.sellValueBillion} tỷ</div>
                    <div className="mt-1 text-[10px] text-slate-400">{data.foreignFlow.sellVolumeMillion}M cp</div>
                  </div>
                  <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4">
                    <div className="text-[10px] text-cyan-300">Mua / Bán Ròng</div>
                    <div className={`mt-1 text-2xl font-black ${data.foreignFlow.netValueBillion >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {data.foreignFlow.netValueBillion > 0 ? `+${data.foreignFlow.netValueBillion}` : data.foreignFlow.netValueBillion} tỷ
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-emerald-500/20 bg-[#06162b] p-4">
                    <h4 className="mb-2 font-mono text-xs font-bold text-emerald-400">TOP MÃ KHỐI NGOẠI MUA RÒNG</h4>
                    <div className="space-y-2 font-mono text-xs">
                      {data.foreignFlow.topBoughtStocks.map((stk) => (
                        <div key={stk.symbol} className="flex justify-between border-b border-white/5 py-1.5">
                          <span className="font-bold text-cyan-300">{stk.symbol}</span>
                          <span className="font-bold text-emerald-400">+{stk.netValueBillion} tỷ</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-rose-500/20 bg-[#06162b] p-4">
                    <h4 className="mb-2 font-mono text-xs font-bold text-rose-400">TOP MÃ KHỐI NGOẠI BÁN RÒNG</h4>
                    <div className="space-y-2 font-mono text-xs">
                      {data.foreignFlow.topSoldStocks.map((stk) => (
                        <div key={stk.symbol} className="flex justify-between border-b border-white/5 py-1.5">
                          <span className="font-bold text-cyan-300">{stk.symbol}</span>
                          <span className="font-bold text-rose-400">{stk.netValueBillion} tỷ</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 5: Market Maker Signals */}
            {activeTab === "marketmaker" && (
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-500/30 bg-[#0a203c]/90 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-mono text-[10px] uppercase text-amber-400">DẤU HIỆU NHÀ TẠO LẬP & SMART MONEY</div>
                      <h3 className="font-display text-lg font-bold text-white">{data.marketMaker.signalSummary}</h3>
                    </div>
                    <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 font-mono text-center">
                      <div className="text-[10px] text-amber-300">MM Activity Score</div>
                      <div className="text-xl font-black text-amber-400">{data.marketMaker.activityScore} / 100</div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 font-mono text-xs">
                    <div className="rounded-lg bg-[#06162b] p-3">
                      <div className="text-slate-400">Chế độ giao dịch</div>
                      <div className="mt-1 font-bold text-cyan-300">{data.marketMaker.regime}</div>
                    </div>
                    <div className="rounded-lg bg-[#06162b] p-3">
                      <div className="text-slate-400">Tỷ lệ hấp thụ lệnh</div>
                      <div className="mt-1 font-bold text-emerald-400">{data.marketMaker.orderAbsorptionRatePct}%</div>
                    </div>
                    <div className="rounded-lg bg-[#06162b] p-3">
                      <div className="text-slate-400">Rủi ro kéo/đè ATC</div>
                      <div className="mt-1 font-bold text-amber-300">{data.marketMaker.atcManipulationRisk}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-[#1e3d64] bg-[#0a203c]/80 p-4">
                  <h4 className="mb-3 font-mono text-xs font-bold uppercase text-cyan-300">Tín hiệu chi tiết trong phiên</h4>
                  <div className="space-y-2 font-mono text-xs">
                    {data.marketMaker.signals.map((sig, idx) => (
                      <div key={idx} className="flex items-start gap-2 rounded-lg bg-[#06162b] p-3 text-slate-200">
                        <span className="text-cyan-400">►</span>
                        <span>{sig}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
