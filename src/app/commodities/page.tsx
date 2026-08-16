"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { ProtectedPage } from "@/components/ProtectedPage";

interface CommodityPrice {
  symbol: string;
  name: string;
  nameEn: string;
  group: string;
  unit: string;
  price: number;
  priceVnd: number;
  currency: string;
  date: string;
  source: string | null;
  prevClose: number | null;
  high52w: number | null;
  low52w: number | null;
  changeDayPct: number | null;
  changeWeekPct: number | null;
  changeMonthPct: number | null;
  changeYtdPct: number | null;
  changeYearPct: number | null;
}

const GROUP_LABELS: Record<string, string> = {
  precious_metals: "Kim loại quý",
  industrial_metals: "Kim loại CN",
  energy: "Năng lượng",
  agriculture: "Nông sản",
  livestock: "Chăn nuôi",
  dairy: "Sữa",
  rubber: "Cao su",
  fertilizer: "Phân bón",
};

function pctClass(v: number | null): string {
  if (v === null || v === 0) return "text-slate-400";
  return v > 0 ? "text-emerald-400" : "text-rose-400";
}
function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}
/** VND is shown whole; the native-unit price keeps 2 decimals when small. */
function fmtVnd(v: number): string {
  return Math.round(v).toLocaleString("vi-VN");
}
function fmtNative(v: number): string {
  return v >= 1000 ? v.toLocaleString("vi-VN", { maximumFractionDigits: 0 }) : v.toFixed(2);
}

/** Position of current price inside the 52-week range, as a percentage. */
function rangePos(p: number, lo: number | null, hi: number | null): number | null {
  if (lo === null || hi === null || hi <= lo) return null;
  return Math.max(0, Math.min(100, ((p - lo) / (hi - lo)) * 100));
}

export default function CommoditiesPage() {
  const [items, setItems] = useState<CommodityPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState("all");
  const [q, setQ] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [status, setStatus] = useState<{
    currentAuthority: string | null;
    policy: { primary: string; secondary: string };
    scanner: { intervalMs: number; ticks: number; running: boolean };
    lastCycle: { vnTime: string; rowsWritten: number; reason: string } | null;
    probes?: Array<{ source: string; ok: boolean; rows: number; latencyMs: number }>;
  } | null>(null);

  const load = async () => {
    try {
      const [board, st] = await Promise.all([
        api<{ commodities: CommodityPrice[] }>("/commodities"),
        fetch("/api/v1/commodities/sources/status")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      setItems(board.data.commodities);
      if (st?.data) {
        setStatus({
          currentAuthority: st.data.currentAuthority,
          policy: st.data.policy,
          scanner: st.data.scanner,
          lastCycle: st.data.lastCycle,
          probes: st.data.lastCycle?.probes,
        });
      }
      setUpdatedAt(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Live board: re-poll every 60s so prices stay fresh without a page reload.
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, []);

  const refreshNow = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/v1/commodities/refresh", { method: "POST" });
      await load();
    } catch {
      /* surfaced by load() */
    } finally {
      setRefreshing(false);
    }
  };

  const filtered = items.filter((c) => {
    const okGroup = group === "all" || c.group === group;
    const okQ =
      !q ||
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      (c.nameEn ?? "").toLowerCase().includes(q.toLowerCase()) ||
      c.symbol.toLowerCase().includes(q.toLowerCase());
    return okGroup && okQ;
  });

  const groups = ["all", ...Array.from(new Set(items.map((c) => c.group)))];
  const sources = Array.from(new Set(items.map((c) => c.source).filter(Boolean)));

  return (
    <ProtectedPage featureName="bảng giá hàng hóa">
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-[#00d4ff]">Live commodity board</div>
            <h1 className="display-xl text-2xl md:text-3xl text-white mt-1">Hàng hóa</h1>
            <p className="text-xs md:text-sm text-slate-400 mt-1.5">
              {items.length} mặt hàng · quy đổi VND theo tỷ giá Vietcombank
              {status?.currentAuthority && (
                <>
                  {" "}· nguồn đang dùng:{" "}
                  <span className="text-[#00d4ff] font-semibold">{status.currentAuthority}</span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {updatedAt && (
              <span className="font-mono text-[10px] text-slate-500">
                cập nhật {updatedAt.toLocaleTimeString("vi-VN")}
              </span>
            )}
            <button
              onClick={refreshNow}
              disabled={refreshing}
              className="rounded-lg border border-[#00d4ff] px-3 py-2 text-xs font-semibold text-[#00d4ff] hover:bg-[#00d4ff]/10 disabled:opacity-50 min-h-[40px] active:scale-95 transition-transform"
            >
              {refreshing ? "Đang tải…" : "↻ Làm mới"}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="panel p-3 md:p-4 space-y-3">
          <input
            type="text"
            placeholder="Tìm hàng hóa (vàng, thép, cà phê…)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full bg-[#0e2e4f] border border-[#1a3558] rounded-lg px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-[#00d4ff] focus:outline-none min-h-[44px]"
          />
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
            {groups.map((g) => (
              <button
                key={g}
                onClick={() => setGroup(g)}
                className={`shrink-0 px-3 py-2 rounded-lg text-xs font-medium min-h-[40px] transition-all active:scale-95 ${
                  group === g
                    ? "bg-[#00d4ff] text-[#0A2540]"
                    : "bg-[#0e2e4f] text-slate-400 hover:text-slate-200"
                }`}
              >
                {g === "all" ? `Tất cả (${items.length})` : GROUP_LABELS[g] ?? g}
              </button>
            ))}
          </div>
        </div>

        {/* Source policy panel — makes the single-source rule visible */}
        {status && (
          <div className="panel p-3 md:p-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px]">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 uppercase tracking-wider font-mono text-[10px]">Nguồn dữ liệu</span>
                <span
                  className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                  style={{ boxShadow: "0 0 6px #34d399" }}
                />
                <span className="text-white font-semibold">{status.currentAuthority ?? "—"}</span>
                <span className="text-slate-600">
                  (ưu tiên: {status.policy.primary} → dự phòng: {status.policy.secondary})
                </span>
              </div>

              {status.probes && status.probes.length > 0 && (
                <div className="flex items-center gap-3">
                  {status.probes.map((p) => (
                    <span key={p.source} className="flex items-center gap-1.5 font-mono">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${p.ok ? "bg-emerald-400" : "bg-rose-500"}`}
                      />
                      <span className={p.ok ? "text-slate-300" : "text-rose-300"}>{p.source}</span>
                      <span className="text-slate-600">
                        {p.ok ? `${p.rows} mã · ${p.latencyMs}ms` : "lỗi"}
                      </span>
                    </span>
                  ))}
                </div>
              )}

              <div className="ml-auto flex items-center gap-3 font-mono text-slate-500">
                <span>quét mỗi {Math.round(status.scanner.intervalMs / 1000)}s</span>
                <span>·</span>
                <span>chu kỳ #{status.scanner.ticks}</span>
                {status.lastCycle && (
                  <>
                    <span>·</span>
                    <span>{status.lastCycle.vnTime}</span>
                  </>
                )}
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-[#1a3558]/60 text-[10px] text-slate-600">
              Chính sách: quét liên tục cả hai nguồn để giám sát, nhưng mỗi lần lưu chỉ lấy giá từ{" "}
              <strong className="text-slate-400">một nguồn duy nhất</strong> — không trung bình cộng.
            </div>
          </div>
        )}

        {error && <div className="panel border-rose-700 bg-rose-950/30 p-4 text-sm text-rose-300">{error}</div>}

        {loading ? (
          <div className="panel p-12 text-center text-slate-500">
            <div className="inline-block h-6 w-6 border-2 border-[#00d4ff] border-t-transparent rounded-full animate-spin" />
            <div className="mt-3 text-sm">Đang tải bảng giá…</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="panel p-12 text-center text-slate-500 text-sm">Không tìm thấy hàng hóa phù hợp</div>
        ) : (
          <>
            {/* ── Desktop / tablet: table ── */}
            <div className="panel overflow-hidden hidden md:block">
              <div className="overflow-x-auto scrollbar-hide">
                <table className="w-full text-sm min-w-[860px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-[#1a3558] bg-[#0a1d33]/60">
                      <th className="py-3 px-4 font-medium">Hàng hóa</th>
                      <th className="py-3 px-3 font-medium text-right">Giá (VND)</th>
                      <th className="py-3 px-3 font-medium text-right">Gốc</th>
                      <th className="py-3 px-3 font-medium text-right">Ngày</th>
                      <th className="py-3 px-3 font-medium text-right">Tuần</th>
                      <th className="py-3 px-3 font-medium text-right">Tháng</th>
                      <th className="py-3 px-3 font-medium text-right">Năm</th>
                      <th className="py-3 px-4 font-medium">Vùng 52 tuần</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => {
                      const pos = rangePos(c.priceVnd, c.low52w, c.high52w);
                      return (
                        <tr key={c.symbol} className="border-b border-[#1a3558]/40 hover:bg-[#0e2e4f]/40 transition-colors">
                          <td className="py-3 px-4">
                            <Link href={`/commodities/${c.symbol}`} className="font-medium text-white hover:text-[#00d4ff]">
                              {c.name}
                            </Link>
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              {GROUP_LABELS[c.group] ?? c.group} · {c.unit}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-white">{fmtVnd(c.priceVnd)}</td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-[11px] text-slate-400">
                            {c.currency === "VND" ? "—" : `${fmtNative(c.price)} ${c.currency}`}
                          </td>
                          <td className={`py-3 px-3 text-right font-mono tabular-nums ${pctClass(c.changeDayPct)}`}>
                            {fmtPct(c.changeDayPct)}
                          </td>
                          <td className={`py-3 px-3 text-right font-mono tabular-nums text-[12px] ${pctClass(c.changeWeekPct)}`}>
                            {fmtPct(c.changeWeekPct)}
                          </td>
                          <td className={`py-3 px-3 text-right font-mono tabular-nums text-[12px] ${pctClass(c.changeMonthPct)}`}>
                            {fmtPct(c.changeMonthPct)}
                          </td>
                          <td className={`py-3 px-3 text-right font-mono tabular-nums text-[12px] ${pctClass(c.changeYearPct)}`}>
                            {fmtPct(c.changeYearPct)}
                          </td>
                          <td className="py-3 px-4 w-40">
                            {pos === null ? (
                              <span className="text-[10px] text-slate-600">—</span>
                            ) : (
                              <div>
                                <div className="h-1.5 rounded-full bg-slate-700 relative overflow-hidden">
                                  <div
                                    className="absolute top-0 h-full w-1 rounded-full bg-[#00d4ff]"
                                    style={{ left: `calc(${pos}% - 2px)` }}
                                  />
                                </div>
                                <div className="flex justify-between text-[9px] font-mono text-slate-600 mt-1">
                                  <span>{fmtVnd(c.low52w!)}</span>
                                  <span>{fmtVnd(c.high52w!)}</span>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Mobile: cards ── */}
            <div className="md:hidden space-y-2">
              {filtered.map((c) => {
                const pos = rangePos(c.priceVnd, c.low52w, c.high52w);
                return (
                  <Link
                    key={c.symbol}
                    href={`/commodities/${c.symbol}`}
                    className="panel p-3 block active:scale-[0.99] transition-transform"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-white text-sm truncate">{c.name}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {GROUP_LABELS[c.group] ?? c.group} · {c.unit}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono tabular-nums text-white text-sm">{fmtVnd(c.priceVnd)}</div>
                        <div className={`font-mono tabular-nums text-xs ${pctClass(c.changeDayPct)}`}>
                          {fmtPct(c.changeDayPct)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] font-mono">
                      <div className="bg-[#0a1d33]/60 rounded px-2 py-1">
                        <span className="text-slate-500">Tuần </span>
                        <span className={pctClass(c.changeWeekPct)}>{fmtPct(c.changeWeekPct)}</span>
                      </div>
                      <div className="bg-[#0a1d33]/60 rounded px-2 py-1">
                        <span className="text-slate-500">Tháng </span>
                        <span className={pctClass(c.changeMonthPct)}>{fmtPct(c.changeMonthPct)}</span>
                      </div>
                      <div className="bg-[#0a1d33]/60 rounded px-2 py-1">
                        <span className="text-slate-500">Năm </span>
                        <span className={pctClass(c.changeYearPct)}>{fmtPct(c.changeYearPct)}</span>
                      </div>
                    </div>
                    {pos !== null && (
                      <div className="mt-2">
                        <div className="h-1 rounded-full bg-slate-700 relative overflow-hidden">
                          <div
                            className="absolute top-0 h-full w-1 rounded-full bg-[#00d4ff]"
                            style={{ left: `calc(${pos}% - 2px)` }}
                          />
                        </div>
                        <div className="flex justify-between text-[9px] font-mono text-slate-600 mt-0.5">
                          <span>52T thấp {fmtVnd(c.low52w!)}</span>
                          <span>cao {fmtVnd(c.high52w!)}</span>
                        </div>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </>
        )}

        <div className="text-[10px] text-slate-600 text-center">
          Hiển thị {filtered.length}/{items.length} mặt hàng · dữ liệu thời gian thực, không phải lời khuyên đầu tư
        </div>
      </div>
    </ProtectedPage>
  );
}
