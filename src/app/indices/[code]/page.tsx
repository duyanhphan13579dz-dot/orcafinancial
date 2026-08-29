"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { fmtNum, fmtPct } from "@/lib/client";
import type { IndexMicrostructureSnapshot } from "@/lib/connectors/index-microstructure";

export default function IndexDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(params);
  const code = rawCode.toUpperCase().trim();

  const [data, setData] = useState<IndexMicrostructureSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"intraday" | "depth" | "moneyflow" | "foreign" | "marketmaker">("intraday");

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetch(`/api/v1/indices/${encodeURIComponent(code)}`)
      .then((res) => res.json())
      .then((json) => {
        if (!active) return;
        if (json.success && json.data) {
          setData(json.data);
        } else {
          setError(json.error?.message || "Không thể tải dữ liệu chỉ số");
        }
      })
      .catch((err) => {
        if (active) setError(err.message || "Lỗi kết nối");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [code]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      {/* Navigation Breadcrumb */}
      <div className="flex items-center gap-2 font-mono text-xs text-slate-400">
        <Link href="/" className="hover:text-cyan-300">Tổng quan</Link>
        <span>/</span>
        <span className="text-cyan-400 font-bold">{code}</span>
      </div>

      {/* Header Banner */}
      <div className="rounded-xl border border-[#1e3a5f]/80 bg-[#081d35]/90 p-5 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1a3558] pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-400/40 bg-gradient-to-br from-cyan-500/20 to-blue-600/10 font-display text-xl font-black text-cyan-300">
              {code.slice(0, 4)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl font-black text-white">{data?.name || code}</h1>
                <span className="rounded bg-cyan-500/20 px-2.5 py-0.5 font-mono text-xs font-bold text-cyan-300">
                  {data?.exchange || "HOSE"}
                </span>
              </div>
              <p className="font-mono text-xs text-slate-400">Chi tiết sổ lệnh, dòng tiền, khối ngoại & dấu hiệu Nhà tạo lập (Market Maker)</p>
            </div>
          </div>

          <div className="text-right font-mono">
            <div className="text-2xl font-black text-white">{data ? fmtNum(data.close) : "—"}</div>
            {data && (
              <div className={`text-xs font-bold ${data.changePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {data.changePoints > 0 ? `+${data.changePoints}` : data.changePoints} ({fmtPct(data.changePct)})
              </div>
            )}
          </div>
        </div>

        {loading && (
          <div className="py-12 text-center font-mono text-xs text-slate-400">
            <div className="mx-auto mb-2 h-7 w-7 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
            Đang quét dữ liệu cấu trúc vi mô thời gian thực của {code}…
          </div>
        )}

        {error && <div className="py-6 text-center font-mono text-xs text-rose-400">Lỗi: {error}</div>}

        {data && !loading && (
          <div className="mt-4 space-y-5">
            {/* Price Strip */}
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-white/5 bg-[#06152b] p-3 sm:grid-cols-4 md:grid-cols-6 font-mono text-xs">
              <div>
                <div className="text-[10px] text-slate-400">Cao / Thấp</div>
                <div className="mt-0.5 font-bold text-white"><span className="text-emerald-400">{fmtNum(data.high)}</span> / <span className="text-rose-400">{fmtNum(data.low)}</span></div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">Tổng GTGD</div>
                <div className="mt-0.5 font-bold text-cyan-300">{data.totalValueBillion.toLocaleString()} tỷ</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">Ròng Khối ngoại</div>
                <div className={`mt-0.5 font-bold ${data.foreignFlow.netValueBillion >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {data.foreignFlow.netValueBillion > 0 ? `+${data.foreignFlow.netValueBillion}` : data.foreignFlow.netValueBillion} tỷ
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">Dòng tiền chủ động</div>
                <div className={`mt-0.5 font-bold ${data.moneyFlow.netFlowBillion >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {data.moneyFlow.netFlowBillion > 0 ? `+${data.moneyFlow.netFlowBillion}` : data.moneyFlow.netFlowBillion} tỷ
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">Tạo lập (MM)</div>
                <div className="mt-0.5 font-bold text-amber-300">{data.marketMaker.regime}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">Thanh khoản vs MA5</div>
                <div className="mt-0.5 font-bold text-emerald-400">{data.liquidity.ratioVs5dPct}%</div>
              </div>
            </div>

            {/* Tabs */}
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

            {/* Tab Contents */}
            {activeTab === "intraday" && (
              <div className="space-y-4">
                <div className="rounded-xl border border-[#1e3d64] bg-[#0a203c]/80 p-4">
                  <h3 className="mb-3 font-mono text-xs font-bold uppercase text-cyan-300">Biến động VWAP trong ngày</h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 font-mono text-xs">
                    {data.intraday.map((pt) => (
                      <div key={pt.time} className="rounded-lg bg-[#06162b] p-2.5 text-center">
                        <div className="text-[10px] text-slate-400">{pt.time}</div>
                        <div className="mt-1 font-extrabold text-white">{fmtNum(pt.price)}</div>
                        <div className="mt-0.5 text-[10px] text-slate-400">VWAP: {fmtNum(pt.vwap)}</div>
                        <div className="mt-1 text-[10px] text-cyan-300">{pt.cumulativeValueBillion} tỷ</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-[#1e3d64] bg-[#0a203c]/80 p-4">
                  <h3 className="font-mono text-xs font-bold uppercase text-cyan-300">Thanh khoản so sánh</h3>
                  <p className="mt-1 font-mono text-xs text-slate-300">{data.liquidity.statusText}</p>
                </div>
              </div>
            )}

            {activeTab === "depth" && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-emerald-500/20 bg-[#061d2d] p-4 font-mono text-xs space-y-2">
                  <div className="font-bold text-emerald-400 border-b border-white/10 pb-2">MUA CHỜ (BIDS): {data.orderBook.bidValueBillion} Tỷ</div>
                  {data.orderBook.bids.map((b, i) => (
                    <div key={i} className="flex justify-between p-1.5 bg-white/5 rounded">
                      <span className="font-bold text-emerald-300">{fmtNum(b.price)}</span>
                      <span>{b.volume.toLocaleString()} cp</span>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-rose-500/20 bg-[#250f1a] p-4 font-mono text-xs space-y-2">
                  <div className="font-bold text-rose-400 border-b border-white/10 pb-2">BÁN CHỜ (ASKS): {data.orderBook.askValueBillion} Tỷ</div>
                  {data.orderBook.asks.map((a, i) => (
                    <div key={i} className="flex justify-between p-1.5 bg-white/5 rounded">
                      <span className="font-bold text-rose-300">{fmtNum(a.price)}</span>
                      <span>{a.volume.toLocaleString()} cp</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "moneyflow" && (
              <div className="rounded-xl border border-[#1e3d64] bg-[#0a203c]/80 p-4 font-mono text-xs space-y-3">
                <h3 className="font-bold text-cyan-300 uppercase">Phân bổ dòng tiền chủ động theo ngành</h3>
                {data.moneyFlow.sectorDistribution.map((sec) => (
                  <div key={sec.sector} className="flex justify-between rounded bg-[#06162b] p-3">
                    <span className="font-bold text-slate-200">{sec.sector}</span>
                    <span className={`font-bold ${sec.netFlowBillion >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {sec.netFlowBillion > 0 ? `+${sec.netFlowBillion}` : sec.netFlowBillion} tỷ
                    </span>
                  </div>
                ))}
              </div>
            )}

            {activeTab === "foreign" && (
              <div className="grid gap-4 md:grid-cols-2 font-mono text-xs">
                <div className="rounded-xl border border-emerald-500/20 bg-[#06162b] p-4 space-y-2">
                  <h4 className="font-bold text-emerald-400">TOP MÃ NGOẠI MUA RÒNG</h4>
                  {data.foreignFlow.topBoughtStocks.map((s) => (
                    <div key={s.symbol} className="flex justify-between border-b border-white/5 py-1.5">
                      <span className="font-bold text-cyan-300">{s.symbol}</span>
                      <span className="text-emerald-400">+{s.netValueBillion} tỷ</span>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-rose-500/20 bg-[#06162b] p-4 space-y-2">
                  <h4 className="font-bold text-rose-400">TOP MÃ NGOẠI BÁN RÒNG</h4>
                  {data.foreignFlow.topSoldStocks.map((s) => (
                    <div key={s.symbol} className="flex justify-between border-b border-white/5 py-1.5">
                      <span className="font-bold text-cyan-300">{s.symbol}</span>
                      <span className="text-rose-400">{s.netValueBillion} tỷ</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "marketmaker" && (
              <div className="rounded-xl border border-amber-500/30 bg-[#0a203c]/90 p-4 font-mono text-xs space-y-3">
                <h3 className="font-bold text-amber-300 text-sm">{data.marketMaker.signalSummary}</h3>
                <div className="space-y-2">
                  {data.marketMaker.signals.map((sig, idx) => (
                    <div key={idx} className="rounded bg-[#06162b] p-2.5 text-slate-200">
                      ► {sig}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
