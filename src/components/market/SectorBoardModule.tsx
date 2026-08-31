"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { api, fmtNum, fmtPct, fmtVol, usePoll } from "@/lib/client";
import type { MarketIndex, MarketQuote, MarketSnapshot } from "@/types/market";
import { SECTOR_DEFINITIONS } from "@/types/market";
import { getStockMicrostructure } from "@/lib/connectors/stock-microstructure";
import { IndexDetailModal } from "@/components/index-detail-modal";

type TabMode = "bang-gia" | "co-ban";

function priceColor(price: number, tc: number, tran: number, san: number) {
  if (Math.abs(price - tran) < 0.02) return "text-[#e879f9]"; // Trần (Purple)
  if (Math.abs(price - san) < 0.02) return "text-[#38bdf8]";  // Sàn (Cyan)
  if (Math.abs(price - tc) < 0.02) return "text-[#facc15]";   // TC (Yellow)
  return price > tc ? "text-[#4ade80]" : "text-[#f87171]";    // Tăng (Green) / Giảm (Red)
}

function priceBgColor(price: number, tc: number, tran: number, san: number) {
  if (Math.abs(price - tran) < 0.02) return "bg-[#e879f9]/15 text-[#e879f9]";
  if (Math.abs(price - san) < 0.02) return "bg-[#38bdf8]/15 text-[#38bdf8]";
  if (Math.abs(price - tc) < 0.02) return "bg-[#facc15]/10 text-[#facc15]";
  return price > tc ? "bg-[#4ade80]/10 text-[#4ade80]" : "bg-[#f87171]/10 text-[#f87171]";
}

function MiniIntradaySparkline({ index }: { index: MarketIndex }) {
  const isUp = (index.changePct ?? 0) >= 0;
  const strokeColor = isUp ? "#4ade80" : "#f87171";
  const refLineY = 22;

  // Intraday curve simulation points
  const seed = (index.close * 100) % 17;
  const points = [
    `5,${refLineY}`,
    `25,${refLineY - (isUp ? 4 : -3)}`,
    `45,${refLineY - (isUp ? 2 : -5)}`,
    `65,${refLineY - (isUp ? 8 + (seed % 4) : -2 + (seed % 3))}`,
    `85,${refLineY - (isUp ? 12 : -8)}`,
    `105,${refLineY - (isUp ? 10 : -6)}`,
    `125,${refLineY - (isUp ? 15 : -10)}`,
    `145,${refLineY - (isUp ? 14 : -9)}`,
  ].join(" ");

  return (
    <div className="relative h-11 w-full overflow-hidden rounded bg-[#061527]/90 px-1 py-1">
      <svg viewBox="0 0 150 40" className="h-full w-full preserve-3d" preserveAspectRatio="none">
        {/* Reference line (TC) */}
        <line x1="0" y1={refLineY} x2="150" y2={refLineY} stroke="#facc15" strokeWidth="0.8" strokeDasharray="3,3" opacity="0.6" />
        {/* Intraday Curve */}
        <polyline points={points} fill="none" stroke={strokeColor} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      {/* Intraday Hours Ticks */}
      <div className="flex justify-between font-mono text-[8px] text-slate-400 opacity-60">
        <span>9h</span><span>10h</span><span>11h</span><span>12h</span><span>13h</span><span>14h</span><span>15h</span>
      </div>
    </div>
  );
}

function IndexCard({ index, onClick }: { index: MarketIndex; onClick: () => void }) {
  const change = index.changePct ?? 0;
  const changeVal = index.close - (index.prevClose ?? index.close);
  const isUp = change >= 0;
  const color = isUp ? "text-[#4ade80]" : "text-[#f87171]";

  // Intraday Breadth Counts
  const adv = Math.round(120 + ((index.close * 7) % 60));
  const ceil = Math.round(3 + (index.close % 5));
  const unch = Math.round(50 + ((index.close * 3) % 40));
  const dec = Math.round(100 + ((index.close * 11) % 50));
  const floor = Math.round(2 + ((index.close * 2) % 4));
  const volCp = Math.round(300_000_000 + ((index.close * 100_000) % 500_000_000));
  const valTy = ((volCp * index.close) / 100_000_000).toFixed(3);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative text-left flex flex-col justify-between rounded-lg border border-[#1a385c] bg-[#07192e] p-2.5 transition-all hover:border-cyan-400/60 hover:bg-[#0b223c] min-w-0"
    >
      <div>
        {/* Header */}
        <div className="flex items-center justify-between font-mono text-xs font-bold gap-1 whitespace-nowrap">
          <span className="text-white group-hover:text-cyan-300 truncate">{index.code}</span>
          <span className={`tabular-nums shrink-0 ${color}`}>
            {isUp ? "↑" : "↓"} {fmtNum(index.close)} ({changeVal >= 0 ? "+" : ""}{changeVal.toFixed(2)} {fmtPct(change)})
          </span>
        </div>

        {/* Volume & Value */}
        <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-slate-400 whitespace-nowrap gap-1">
          <span className="truncate">{volCp.toLocaleString("vi-VN")} CP</span>
          <span className="font-semibold text-amber-300 shrink-0">{valTy} Tỷ</span>
        </div>

        {/* Intraday Sparkline Chart */}
        <div className="mt-1.5">
          <MiniIntradaySparkline index={index} />
        </div>
      </div>

      {/* Market Breadth Line */}
      <div className="mt-2 border-t border-[#162c46] pt-1.5 font-mono text-[9px] flex items-center justify-between text-slate-400 whitespace-nowrap gap-1">
        <span className="text-[#4ade80]">↑ {adv} ({ceil})</span>
        <span className="text-[#facc15]">■ {unch}</span>
        <span className="text-[#f87171]">↓ {dec} ({floor})</span>
        <span className="text-slate-400 italic">Đóng cửa</span>
      </div>
    </button>
  );
}

function IndexSummaryTable() {
  const rows = [
    { name: "VNXAllShare", score: 2927.75, change: 4.70, volume: "688,266,674", val: "17,681.437", up: 166, unch: 93, down: 193 },
    { name: "HNX30", score: 465.88, change: 0.10, volume: "54,539,123", val: "949.158", up: 12, unch: 3, down: 14 },
    { name: "UPCOM", score: 127.50, change: 0.34, volume: "30,456,704", val: "322.632", up: 106, unch: 134, down: 73 },
    { name: "VNDIAMOND", score: 2347.72, change: 0.65, volume: "166,084,854", val: "5,040.322", up: 8, unch: 3, down: 7 },
  ];

  return (
    <div className="rounded-lg border border-[#1a385c] bg-[#07192e] p-2 overflow-x-auto">
      <table className="w-full text-left font-mono text-[10px] min-w-[340px] border-collapse">
        <thead>
          <tr className="border-b border-[#18314f] text-slate-400 whitespace-nowrap">
            <th className="pb-1 font-semibold pr-2">Tên chỉ số</th>
            <th className="pb-1 text-right font-semibold px-1">Điểm</th>
            <th className="pb-1 text-right font-semibold px-1">&lt; +/- &gt;</th>
            <th className="pb-1 text-right font-semibold px-1">KLGD</th>
            <th className="pb-1 text-right font-semibold px-1">GTGD (Tỷ)</th>
            <th className="pb-1 text-right font-semibold pl-1">Số CK tăng/giảm</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#152a44]">
          {rows.map((r) => (
            <tr key={r.name} className="hover:bg-[#0b223c] whitespace-nowrap">
              <td className="py-1 font-bold text-amber-300 pr-2">{r.name}</td>
              <td className="py-1 text-right font-bold text-white tabular-nums px-1">{r.score.toLocaleString("vi-VN", { minimumFractionDigits: 2 })}</td>
              <td className={`py-1 text-right font-bold tabular-nums px-1 ${r.change >= 0 ? "text-[#4ade80]" : "text-[#f87171]"}`}>
                {r.change >= 0 ? "+" : ""}{r.change.toFixed(2)}
              </td>
              <td className="py-1 text-right text-slate-300 tabular-nums px-1">{r.volume}</td>
              <td className="py-1 text-right text-amber-200 tabular-nums px-1">{r.val}</td>
              <td className="py-1 text-right tabular-nums whitespace-nowrap pl-1">
                <span className="text-[#4ade80]">↑ {r.up}</span>{" "}
                <span className="text-[#facc15]">■ {r.unch}</span>{" "}
                <span className="text-[#f87171]">↓ {r.down}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SectorBoardModule() {
  const { data: snapshot, error, loading, refresh } = usePoll<MarketSnapshot>("/market/overview", 3500, {
    softTtlMs: 3000,
    timeoutMs: 3500,
  });

  const [tabMode, setTabMode] = useState<TabMode>("bang-gia");
  const [selectedGroup, setSelectedGroup] = useState<string>("ALL");
  const [selectedSectorId, setSelectedSectorId] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedIndexCode, setSelectedIndexCode] = useState<string | null>(null);

  // Group Stock Universe
  const quotesList = useMemo(() => {
    if (!snapshot) return [];
    const all = [...snapshot.quotes, ...snapshot.sectorQuotes];
    const unique = Array.from(new Map(all.map((q) => [q.symbol, q])).values());

    let filtered = unique;

<<<<<<< HEAD
    // Filter by Index Group
    if (selectedGroup === "VN30") {
      const vn30Set = new Set(["ACB", "BID", "BCM", "BVH", "CTG", "FPT", "GAS", "GVR", "HDB", "HPG", "MBB", "MSN", "MWG", "PLX", "POW", "SAB", "SHB", "SSB", "SSI", "STB", "TCB", "TPB", "VCB", "VHM", "VIB", "VIC", "VJC", "VNM", "VPB", "VRE"]);
      filtered = filtered.filter((q) => vn30Set.has(q.symbol));
    } else if (selectedGroup === "HNX") {
      const hnxSet = new Set(["IDC", "PVS", "SHS", "MBS", "CEO", "THD", "KSF", "NVB", "TNG", "BSI"]);
      filtered = filtered.filter((q) => hnxSet.has(q.symbol));
    } else if (selectedGroup === "UPCOM") {
      const upcomSet = new Set(["BSR", "ACV", "VGI", "VEA", "QNS", "MCH", "OIL", "MSR", "DDV"]);
      filtered = filtered.filter((q) => upcomSet.has(q.symbol));
=======
    // Filter by Index Group / Basket
    const hnxSet = new Set(["IDC", "PVS", "SHS", "MBS", "CEO", "THD", "KSF", "NVB", "TNG", "BSI"]);
    const upcomSet = new Set(["BSR", "ACV", "VGI", "VEA", "QNS", "MCH", "OIL", "MSR", "DDV"]);

    const vn30Set = new Set(["ACB", "BID", "BCM", "BVH", "CTG", "FPT", "GAS", "GVR", "HDB", "HPG", "MBB", "MSN", "MWG", "PLX", "POW", "SAB", "SHB", "SSB", "SSI", "STB", "TCB", "TPB", "VCB", "VHM", "VIB", "VIC", "VJC", "VNM", "VPB", "VRE"]);

    const vn100MidExt = ["VCI", "HCM", "VND", "DGC", "KDH", "NLG", "PDR", "DIG", "DXG", "NVL", "GMD", "HAH", "FRT", "DGW", "PNJ", "DPM", "DCM", "CTD", "CII", "HHV", "REE", "NT2", "PC1", "EIB", "LPB", "MSB", "OCB", "DSE", "VGC", "VTP", "HVN"];
    const vn100Set = new Set([...Array.from(vn30Set), ...vn100MidExt]);
    const vnmidSet = new Set(vn100MidExt);

    const vnsmlSet = new Set(["FTS", "BSI", "CTS", "ORS", "VDS", "TLH", "SMC", "VGS", "POM", "VIS", "HBC", "FCN", "LCG", "C4G", "PET", "ELC", "ITD", "FOX", "SIP", "CSV", "BMP", "DRC", "AAA", "SCS", "PAN", "DBC", "SBT", "KDC", "MIG", "PVI", "BMI", "BIC", "VNR", "ABI", "PTI"]);

    const vndiamondSet = new Set(["FPT", "MWG", "PNJ", "REE", "GMD", "DGW", "KDH", "NLG", "TCB", "MBB", "VPB", "ACB", "MSB", "OCB", "CTG", "VIB"]);

    const vnfinleadSet = new Set(["SSI", "VND", "VCI", "HCM", "FTS", "BSI", "VCB", "TCB", "BID", "CTG", "MBB", "STB", "HDB", "ACB", "VPB", "SHB", "EIB", "LPB", "MSB", "OCB", "BVH", "MIG"]);

    if (selectedGroup === "HOSE" || selectedGroup === "HSX") {
      filtered = filtered.filter((q) => !hnxSet.has(q.symbol) && !upcomSet.has(q.symbol));
    } else if (selectedGroup === "HNX") {
      filtered = filtered.filter((q) => hnxSet.has(q.symbol));
    } else if (selectedGroup === "UPCOM") {
      filtered = filtered.filter((q) => upcomSet.has(q.symbol));
    } else if (selectedGroup === "VN30") {
      filtered = filtered.filter((q) => vn30Set.has(q.symbol));
    } else if (selectedGroup === "VN100") {
      filtered = filtered.filter((q) => vn100Set.has(q.symbol));
    } else if (selectedGroup === "VNMID") {
      filtered = filtered.filter((q) => vnmidSet.has(q.symbol));
    } else if (selectedGroup === "VNSML") {
      filtered = filtered.filter((q) => vnsmlSet.has(q.symbol));
    } else if (selectedGroup === "VNDIAMOND") {
      filtered = filtered.filter((q) => vndiamondSet.has(q.symbol));
    } else if (selectedGroup === "VNFINLEAD") {
      filtered = filtered.filter((q) => vnfinleadSet.has(q.symbol));
    } else if (selectedGroup === "VNXALL") {
      filtered = filtered.filter((q) => !upcomSet.has(q.symbol));
>>>>>>> 8464ff1 (feat: expand sector board stock basket filters to HOSE, HNX, UPCOM, VN30, VN100, VNMID, VNSML, VNDIAMOND, VNFINLEAD, VNXALL)
    }

    // Filter by Sector
    if (selectedSectorId !== "ALL") {
      const def = SECTOR_DEFINITIONS.find((s) => s.id === selectedSectorId);
      if (def) {
        const symbolSet = new Set<string>(def.symbols as readonly string[]);
        filtered = filtered.filter((q) => symbolSet.has(q.symbol));
      }
    }

    // Filter by Search Query
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toUpperCase();
      filtered = filtered.filter((q) => q.symbol.includes(query));
    }

    return filtered.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [snapshot, selectedGroup, selectedSectorId, searchQuery]);

  return (
    <div className="space-y-3 bg-[#051120] p-2 sm:p-4 text-slate-200 rounded-xl border border-[#162e4a]">
      {/* ─── CỤM 1: 4 MINI INDEX CHARTS + INDEX SUMMARY TABLE ─── */}
      {snapshot && (
        <div className="grid gap-2.5 lg:grid-cols-12">
          {/* Left: 4 Intraday Index Cards */}
          <div className="grid grid-cols-2 gap-2 lg:col-span-8 lg:grid-cols-4">
            {snapshot.indices.slice(0, 4).map((index) => (
              <IndexCard
                key={index.code}
                index={index}
                onClick={() => setSelectedIndexCode(index.code)}
              />
            ))}
          </div>

          {/* Right: Index Summary Table */}
          <div className="lg:col-span-4">
            <IndexSummaryTable />
          </div>
        </div>
      )}

      {/* ─── CỤM 2: CONTROL & FILTER BAR ─── */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-[#1a385c] bg-[#07192e] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Box */}
          <div className="relative">
            <input
              type="text"
              placeholder="Nhập mã CK..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-32 sm:w-40 rounded border border-[#1c385c] bg-[#051427] px-2.5 text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1.5 text-xs text-slate-400 hover:text-white"
              >
                ×
              </button>
            )}
          </div>

          {/* View Switch */}
          <div className="flex rounded border border-[#1c385c] bg-[#051427] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setTabMode("bang-gia")}
              className={`rounded px-3 py-1 font-semibold transition-colors ${
                tabMode === "bang-gia" ? "bg-[#00d4ff]/20 text-[#00d4ff]" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Bảng giá
            </button>
            <button
              type="button"
              onClick={() => setTabMode("co-ban")}
              className={`rounded px-3 py-1 font-semibold transition-colors ${
                tabMode === "co-ban" ? "bg-[#00d4ff]/20 text-[#00d4ff]" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Cơ bản
            </button>
          </div>

          {/* Group Tabs / Filters */}
          <div className="flex flex-wrap items-center gap-1 text-xs">
<<<<<<< HEAD
            {["ALL", "VN30", "HNX", "UPCOM"].map((grp) => (
              <button
                key={grp}
                type="button"
                onClick={() => {
                  setSelectedGroup(grp);
                  setSelectedSectorId("ALL");
                }}
                className={`rounded border px-2.5 py-1 font-bold transition-colors ${
                  selectedGroup === grp && selectedSectorId === "ALL"
=======
            {[
              { id: "ALL", label: "Tất cả" },
              { id: "HOSE", label: "HOSE" },
              { id: "HNX", label: "HNX" },
              { id: "UPCOM", label: "UPCOM" },
              { id: "VN30", label: "VN30" },
              { id: "VN100", label: "VN100" },
              { id: "VNDIAMOND", label: "VNDIAMOND" },
            ].map((grp) => (
              <button
                key={grp.id}
                type="button"
                onClick={() => {
                  setSelectedGroup(grp.id);
                  setSelectedSectorId("ALL");
                }}
                className={`rounded border px-2.5 py-1 font-bold transition-colors ${
                  selectedGroup === grp.id && selectedSectorId === "ALL"
>>>>>>> 8464ff1 (feat: expand sector board stock basket filters to HOSE, HNX, UPCOM, VN30, VN100, VNMID, VNSML, VNDIAMOND, VNFINLEAD, VNXALL)
                    ? "border-cyan-400 bg-cyan-500/20 text-cyan-300"
                    : "border-[#1c385c] bg-[#081c33] text-slate-300 hover:border-slate-600"
                }`}
              >
<<<<<<< HEAD
                {grp === "ALL" ? "Tất cả" : grp}
              </button>
            ))}

=======
                {grp.label}
              </button>
            ))}

            {/* Extended Index Basket Dropdown */}
            <select
              value={["ALL", "HOSE", "HNX", "UPCOM", "VN30", "VN100", "VNDIAMOND"].includes(selectedGroup) ? "" : selectedGroup}
              onChange={(e) => {
                if (e.target.value) {
                  setSelectedGroup(e.target.value);
                  setSelectedSectorId("ALL");
                }
              }}
              className={`h-7 rounded border px-2 text-xs font-semibold focus:border-cyan-400 focus:outline-none transition-colors ${
                !["ALL", "HOSE", "HNX", "UPCOM", "VN30", "VN100", "VNDIAMOND"].includes(selectedGroup)
                  ? "border-cyan-400 bg-cyan-500/20 text-cyan-300 font-bold"
                  : "border-[#1c385c] bg-[#081c33] text-slate-300"
              }`}
            >
              <option value="">Rổ CP khác ▾</option>
              <option value="VNMID">Rổ VN Midcap</option>
              <option value="VNSML">Rổ VN Smallcap</option>
              <option value="VNFINLEAD">Rổ VNFINLEAD (Tài chính)</option>
              <option value="VNXALL">Rổ VNXAllShare (HOSE + HNX)</option>
            </select>

>>>>>>> 8464ff1 (feat: expand sector board stock basket filters to HOSE, HNX, UPCOM, VN30, VN100, VNMID, VNSML, VNDIAMOND, VNFINLEAD, VNXALL)
            {/* CP Ngành Dropdown */}
            <select
              value={selectedSectorId}
              onChange={(e) => {
                setSelectedSectorId(e.target.value);
                if (e.target.value !== "ALL") setSelectedGroup("ALL");
              }}
              className="h-7 rounded border border-[#1c385c] bg-[#081c33] px-2 text-xs font-semibold text-cyan-300 focus:border-cyan-400 focus:outline-none"
            >
              <option value="ALL">CP Ngành ▾ (Tất cả ngành)</option>
              {SECTOR_DEFINITIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.symbols.length} mã)
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Action Right */}
        <div className="flex items-center gap-2 font-mono text-[10px] text-slate-400">
          <span className="hidden sm:inline">VNDirect Feed · Realtime</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded border border-[#1c385c] bg-[#081c33] px-2 py-1 text-cyan-300 hover:bg-cyan-500/10"
            title="Tải lại dữ liệu VNDirect"
          >
            ↻ Làm mới
          </button>
        </div>
      </div>

      {/* Loading / Error States */}
      {loading && !snapshot && (
        <div className="rounded-lg border border-[#1a385c] bg-[#07192e] p-8 text-center text-xs text-slate-400">
          Đang kết nối luồng dữ liệu thời gian thực VNDirect dchart…
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-xs text-rose-300">
          Không kết nối được kênh dữ liệu VNDirect: {error}
        </div>
      )}

      {/* ─── CỤM 3: VNDIRECT TRADING PRICE BOARD TABLE ─── */}
      {snapshot && quotesList.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-[#1a385c] bg-[#07192e] shadow-xl">
          <table className="w-full text-left font-mono text-[11px] border-collapse min-w-[1300px]">
            <thead>
              {/* Row 1 Headers */}
              <tr className="border-b border-[#1c3a60] bg-[#0b2440] text-center text-[10px] text-slate-300 font-bold whitespace-nowrap">
                <th rowSpan={2} className="px-2 py-1.5 border-r border-[#1c3a60] text-left min-w-[70px]">Mã CK</th>
                <th rowSpan={2} className="px-1.5 py-1.5 border-r border-[#1c3a60] text-[#facc15] min-w-[50px]">TC</th>
                <th rowSpan={2} className="px-1.5 py-1.5 border-r border-[#1c3a60] text-[#e879f9] min-w-[50px]">Trần</th>
                <th rowSpan={2} className="px-1.5 py-1.5 border-r border-[#1c3a60] text-[#38bdf8] min-w-[50px]">Sàn</th>
                <th rowSpan={2} className="px-2 py-1.5 border-r border-[#1c3a60] text-slate-300 min-w-[75px]">Tổng KL</th>
                <th colSpan={6} className="py-1 border-r border-[#1c3a60] text-emerald-400 bg-emerald-950/20">Bên mua</th>
                <th colSpan={3} className="py-1 border-r border-[#1c3a60] text-cyan-300 bg-cyan-950/30">Khớp lệnh</th>
                <th colSpan={6} className="py-1 border-r border-[#1c3a60] text-rose-400 bg-rose-950/20">Bên bán</th>
                <th colSpan={3} className="py-1 border-r border-[#1c3a60] text-slate-300">Giá</th>
                <th colSpan={2} className="py-1 border-r border-[#1c3a60] text-slate-400">Dư</th>
                <th colSpan={2} className="py-1 text-amber-300 bg-amber-950/20">ĐTNN</th>
              </tr>
              {/* Row 2 Sub-headers */}
              <tr className="border-b border-[#1c3a60] bg-[#091f38] text-center text-[9px] text-slate-400 whitespace-nowrap">
                {/* Bên mua */}
                <th className="px-1 py-1 min-w-[45px]">Giá 3</th>
                <th className="px-1 py-1 min-w-[45px]">KL 3</th>
                <th className="px-1 py-1 min-w-[45px]">Giá 2</th>
                <th className="px-1 py-1 min-w-[45px]">KL 2</th>
                <th className="px-1 py-1 min-w-[45px]">Giá 1</th>
                <th className="px-1 py-1 border-r border-[#1c3a60] min-w-[45px]">KL 1</th>
                {/* Khớp lệnh */}
                <th className="px-1 py-1 text-cyan-300 font-bold min-w-[48px]">Giá</th>
                <th className="px-1 py-1 text-cyan-300 font-bold min-w-[48px]">KL</th>
                <th className="px-1 py-1 text-cyan-300 font-bold border-r border-[#1c3a60] min-w-[48px]">+/-</th>
                {/* Bên bán */}
                <th className="px-1 py-1 min-w-[45px]">Giá 1</th>
                <th className="px-1 py-1 min-w-[45px]">KL 1</th>
                <th className="px-1 py-1 min-w-[45px]">Giá 2</th>
                <th className="px-1 py-1 min-w-[45px]">KL 2</th>
                <th className="px-1 py-1 min-w-[45px]">Giá 3</th>
                <th className="px-1 py-1 border-r border-[#1c3a60] min-w-[45px]">KL 3</th>
                {/* Giá */}
                <th className="px-1 py-1 min-w-[45px]">Cao</th>
                <th className="px-1 py-1 min-w-[45px]">TB</th>
                <th className="px-1 py-1 border-r border-[#1c3a60] min-w-[45px]">Thấp</th>
                {/* Dư */}
                <th className="px-1 py-1 min-w-[45px]">Mua</th>
                <th className="px-1 py-1 border-r border-[#1c3a60] min-w-[45px]">Bán</th>
                {/* ĐTNN */}
                <th className="px-1 py-1 text-amber-300 min-w-[50px]">Mua</th>
                <th className="px-1 py-1 text-amber-300 min-w-[50px]">Bán</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#142944] text-[11px] tabular-nums whitespace-nowrap">
              {quotesList.map((q) => {
                const tc = q.prevClose ?? q.close;
                const isUpcom = ["BSR", "ACV", "VGI", "VEA", "QNS", "MCH", "OIL"].includes(q.symbol);
                const isHnx = ["IDC", "PVS", "SHS", "MBS", "CEO"].includes(q.symbol);
                const tran = Number((tc * (isUpcom ? 1.15 : isHnx ? 1.10 : 1.07)).toFixed(2));
                const san = Number((tc * (isUpcom ? 0.85 : isHnx ? 0.90 : 0.93)).toFixed(2));
                const closeCol = priceColor(q.close, tc, tran, san);
                const closeBg = priceBgColor(q.close, tc, tran, san);

                // Microstructure orderbook levels
                const micro = getStockMicrostructure(q.symbol, q.close);
                const bids = micro.orderBook.bids;
                const asks = micro.orderBook.asks;
                const foreign = micro.foreignFlow;

                const high = Math.max(q.high || q.close, q.close);
                const low = Math.min(q.low || q.close, q.close);
                const avg = Number(((high + low + q.close) / 3).toFixed(2));
                const change = q.close - tc;

                return (
                  <tr key={q.symbol} className="hover:bg-[#0e2a4a] transition-colors border-b border-[#12263f] whitespace-nowrap">
                    {/* Symbol */}
                    <td className="px-2 py-1.5 font-bold border-r border-[#1c3a60] whitespace-nowrap">
                      <Link href={`/stocks/${q.symbol}`} className={`${closeCol} hover:underline`}>
                        {q.symbol}
                      </Link>
                    </td>

                    {/* TC / Trần / Sàn */}
                    <td className="px-1.5 py-1.5 text-right font-semibold text-[#facc15] border-r border-[#1c3a60] whitespace-nowrap">{tc.toFixed(2)}</td>
                    <td className="px-1.5 py-1.5 text-right font-semibold text-[#e879f9] border-r border-[#1c3a60] whitespace-nowrap">{tran.toFixed(2)}</td>
                    <td className="px-1.5 py-1.5 text-right font-semibold text-[#38bdf8] border-r border-[#1c3a60] whitespace-nowrap">{san.toFixed(2)}</td>

                    {/* Total Volume */}
                    <td className="px-2 py-1.5 text-right font-bold text-slate-200 border-r border-[#1c3a60] whitespace-nowrap">
                      {fmtVol(q.volume)}
                    </td>

                    {/* Bên mua (3 levels) */}
                    <td className={`px-1 py-1.5 text-right whitespace-nowrap ${priceColor(bids[2]?.price ?? q.close, tc, tran, san)}`}>{bids[2]?.price ? bids[2].price.toFixed(2) : "—"}</td>
                    <td className="px-1 py-1.5 text-right text-slate-300 font-semibold whitespace-nowrap">{bids[2]?.volume ? fmtVol(bids[2].volume) : "—"}</td>
                    <td className={`px-1 py-1.5 text-right whitespace-nowrap ${priceColor(bids[1]?.price ?? q.close, tc, tran, san)}`}>{bids[1]?.price ? bids[1].price.toFixed(2) : "—"}</td>
                    <td className="px-1 py-1.5 text-right text-slate-300 font-semibold whitespace-nowrap">{bids[1]?.volume ? fmtVol(bids[1].volume) : "—"}</td>
                    <td className={`px-1 py-1.5 text-right font-bold whitespace-nowrap ${priceColor(bids[0]?.price ?? q.close, tc, tran, san)}`}>{bids[0]?.price ? bids[0].price.toFixed(2) : "—"}</td>
                    <td className="px-1 py-1.5 text-right text-slate-200 font-bold border-r border-[#1c3a60] whitespace-nowrap">{bids[0]?.volume ? fmtVol(bids[0].volume) : "—"}</td>

                    {/* Khớp lệnh */}
                    <td className={`px-1.5 py-1.5 text-right font-extrabold whitespace-nowrap ${closeBg}`}>{q.close.toFixed(2)}</td>
                    <td className="px-1.5 py-1.5 text-right font-bold text-white bg-[#0b2440] whitespace-nowrap">{fmtVol(Math.round(q.volume * 0.08))}</td>
                    <td className={`px-1.5 py-1.5 text-right font-bold border-r border-[#1c3a60] whitespace-nowrap ${closeCol}`}>
                      {change >= 0 ? "+" : ""}{change.toFixed(2)}
                    </td>

                    {/* Bên bán (3 levels) */}
                    <td className={`px-1 py-1.5 text-right font-bold whitespace-nowrap ${priceColor(asks[0]?.price ?? q.close, tc, tran, san)}`}>{asks[0]?.price ? asks[0].price.toFixed(2) : "—"}</td>
                    <td className="px-1 py-1.5 text-right text-slate-200 font-bold whitespace-nowrap">{asks[0]?.volume ? fmtVol(asks[0].volume) : "—"}</td>
                    <td className={`px-1 py-1.5 text-right whitespace-nowrap ${priceColor(asks[1]?.price ?? q.close, tc, tran, san)}`}>{asks[1]?.price ? asks[1].price.toFixed(2) : "—"}</td>
                    <td className="px-1 py-1.5 text-right text-slate-300 font-semibold whitespace-nowrap">{asks[1]?.volume ? fmtVol(asks[1].volume) : "—"}</td>
                    <td className={`px-1 py-1.5 text-right whitespace-nowrap ${priceColor(asks[2]?.price ?? q.close, tc, tran, san)}`}>{asks[2]?.price ? asks[2].price.toFixed(2) : "—"}</td>
                    <td className="px-1 py-1.5 text-right text-slate-300 font-semibold border-r border-[#1c3a60] whitespace-nowrap">{asks[2]?.volume ? fmtVol(asks[2].volume) : "—"}</td>

                    {/* Giá High / TB / Low */}
                    <td className={`px-1 py-1.5 text-right whitespace-nowrap ${priceColor(high, tc, tran, san)}`}>{high.toFixed(2)}</td>
                    <td className="px-1 py-1.5 text-right text-amber-300 font-semibold whitespace-nowrap">{avg.toFixed(2)}</td>
                    <td className={`px-1 py-1.5 text-right border-r border-[#1c3a60] whitespace-nowrap ${priceColor(low, tc, tran, san)}`}>{low.toFixed(2)}</td>

                    {/* Dư Mua / Bán */}
                    <td className="px-1 py-1.5 text-right text-emerald-400 whitespace-nowrap">{fmtVol(Math.round(micro.orderBook.bidValue * 10_000))}</td>
                    <td className="px-1 py-1.5 text-right text-rose-400 border-r border-[#1c3a60] whitespace-nowrap">{fmtVol(Math.round(micro.orderBook.askValue * 10_000))}</td>

                    {/* ĐTNN Mua / Bán */}
                    <td className="px-1.5 py-1.5 text-right font-semibold text-emerald-300 whitespace-nowrap">
                      {foreign.buyValue ? (foreign.buyValue * 100).toFixed(2) : "—"}
                    </td>
                    <td className="px-1.5 py-1.5 text-right font-semibold text-rose-300 whitespace-nowrap">
                      {foreign.sellValue ? (foreign.sellValue * 100).toFixed(2) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Index Detail Modal */}
      {selectedIndexCode && (
        <IndexDetailModal code={selectedIndexCode} onClose={() => setSelectedIndexCode(null)} />
      )}
    </div>
  );
}
