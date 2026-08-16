"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, fmtNum, fmtPct, changeColor } from "@/lib/client";
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
  changeDayPct: number | null;
  changeMonthPct: number | null;
  changeYearPct: number | null;
}

const GROUP_LABELS: Record<string, string> = {
  precious_metals: "Kim loại quý",
  industrial_metals: "Kim loại công nghiệp",
  energy: "Năng lượng",
  agriculture: "Nông sản",
  livestock: "Chăn nuôi",
  dairy: "Sữa",
  rubber: "Cao su",
  fertilizer: "Phân bón",
};

export default function CommoditiesPage() {
  const [commodities, setCommodities] = useState<CommodityPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const loadData = async () => {
    try {
      const res = await api<{ commodities: CommodityPrice[] }>("/commodities");
      const list = res.data.commodities || [];
      setCommodities(list);

      // Nếu database chưa có dữ liệu, tự động trigger nạp dữ liệu lần đầu
      if (list.length === 0) {
        await triggerRefresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const triggerRefresh = async () => {
    setRefreshing(true);
    try {
      await api("/commodities/refresh", { method: "POST" });
      const res = await api<{ commodities: CommodityPrice[] }>("/commodities");
      setCommodities(res.data.commodities || []);
      setError(null);
    } catch (err) {
      setError("Không thể cập nhật giá: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const filtered = commodities.filter((c) => {
    const matchesGroup = selectedGroup === "all" || c.group === selectedGroup;
    const matchesSearch =
      searchQuery === "" ||
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.symbol.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesGroup && matchesSearch;
  });

  const groups = ["all", ...new Set(commodities.map((c) => c.group))];

  return (
    <ProtectedPage featureName="danh sách hàng hóa">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-white">Hàng hóa Thế giới</h1>
            <p className="text-xs md:text-sm text-slate-400 mt-1">
              Theo dõi giá 31 loại hàng hóa ảnh hưởng đến thị trường chứng khoán Việt Nam
            </p>
          </div>
          <button
            onClick={triggerRefresh}
            disabled={refreshing}
            className="btn-orca text-xs flex items-center gap-2 disabled:opacity-50 min-h-[40px]"
          >
            {refreshing ? (
              <>
                <span className="h-3.5 w-3.5 border-2 border-[#0A2540] border-t-transparent rounded-full animate-spin" />
                Đang cập nhật giá...
              </>
            ) : (
              <>🔄 Cập nhật giá mới</>
            )}
          </button>
        </div>

        {/* Filters */}
        <div className="panel p-4 space-y-4">
          <input
            type="text"
            placeholder="Tìm kiếm hàng hóa..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#0e2e4f] border border-[#1a3558] rounded-lg px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-[#00d4ff] focus:outline-none min-h-[44px]"
          />

          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <button
                key={g}
                onClick={() => setSelectedGroup(g)}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-all min-h-[40px] ${
                  selectedGroup === g
                    ? "bg-[#00d4ff] text-[#0A2540]"
                    : "bg-[#0e2e4f] text-slate-400 hover:bg-[#1a3558]"
                }`}
              >
                {g === "all" ? "Tất cả" : GROUP_LABELS[g] || g}
              </button>
            ))}
          </div>
        </div>

        {/* Content Table */}
        {loading || refreshing ? (
          <div className="panel p-12 text-center text-slate-500">
            <div className="inline-block h-6 w-6 border-2 border-[#00d4ff] border-t-transparent rounded-full animate-spin" />
            <div className="mt-3 text-sm">Đang tải và cập nhật dữ liệu hàng hóa...</div>
          </div>
        ) : error ? (
          <div className="panel border-rose-700 bg-rose-950/30 p-4 text-sm text-rose-300">
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="panel p-12 text-center text-slate-500 text-sm">
            Không tìm thấy hàng hóa phù hợp. Hãy nhấn nút "Cập nhật giá mới" ở trên.
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-hide">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-[#1a3558]">
                  <th className="py-3 px-4">Hàng hóa</th>
                  <th className="py-3 px-4">Nhóm</th>
                  <th className="py-3 px-4 text-right">Giá hiện tại</th>
                  <th className="py-3 px-4 text-right">Đổi ngày</th>
                  <th className="py-3 px-4 text-right hidden md:table-cell">Đổi tháng</th>
                  <th className="py-3 px-4 text-right hidden lg:table-cell">Đổi năm</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.symbol}
                    className="border-b border-[#1a3558]/50 hover:bg-[#0e2e4f]/50 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <Link
                        href={`/commodities/${c.symbol}`}
                        className="font-medium text-white hover:text-[#00d4ff] transition-colors"
                      >
                        {c.name}
                      </Link>
                      <div className="text-[10px] text-slate-500 mt-0.5">{c.unit}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-[10px] px-2 py-1 rounded bg-[#0e2e4f] text-slate-400">
                        {GROUP_LABELS[c.group] || c.group}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {fmtNum(c.priceVnd, 0)}
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {c.currency !== "VND" ? `${fmtNum(c.price, 2)} ${c.currency}` : ""}
                      </div>
                    </td>
                    <td className={`py-3 px-4 text-right font-mono tabular-nums ${changeColor(c.changeDayPct)}`}>
                      {c.changeDayPct !== null ? fmtPct(c.changeDayPct) : "—"}
                    </td>
                    <td className={`py-3 px-4 text-right font-mono tabular-nums hidden md:table-cell ${changeColor(c.changeMonthPct)}`}>
                      {c.changeMonthPct !== null ? fmtPct(c.changeMonthPct) : "—"}
                    </td>
                    <td className={`py-3 px-4 text-right font-mono tabular-nums hidden lg:table-cell ${changeColor(c.changeYearPct)}`}>
                      {c.changeYearPct !== null ? fmtPct(c.changeYearPct) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ProtectedPage>
  );
}
