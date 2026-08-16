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
  const [error, setError] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    api<{ commodities: CommodityPrice[] }>("/commodities")
      .then((res) => {
        setCommodities(res.data.commodities);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
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
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">Hàng hóa Thế giới</h1>
          <p className="text-xs md:text-sm text-slate-400 mt-1">
            Theo dõi giá 31 loại hàng hóa ảnh hưởng đến thị trường chứng khoán Việt Nam
          </p>
        </div>

      {/* Filters */}
      <div className="panel p-4 space-y-4">
        {/* Search */}
        <input
          type="text"
          placeholder="Tìm kiếm hàng hóa..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-[#0e2e4f] border border-[#1a3558] rounded-lg px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-[#00d4ff] focus:outline-none min-h-[44px]"
        />

        {/* Group filter */}
        <div className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <button
              key={g}
              onClick={() => setSelectedGroup(g)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-all min-h-[44px] ${
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

      {/* Content */}
      {loading ? (
        <div className="panel p-12 text-center text-slate-500">
          <div className="inline-block h-6 w-6 border-2 border-[#00d4ff] border-t-transparent rounded-full animate-spin" />
          <div className="mt-3 text-sm">Đang tải dữ liệu hàng hóa...</div>
        </div>
      ) : error ? (
        <div className="panel border-rose-700 bg-rose-950/30 p-4 text-sm text-rose-300">
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel p-12 text-center text-slate-500 text-sm">
          Không tìm thấy hàng hóa phù hợp
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

      {/* Mobile: Show count */}
      <div className="text-xs text-slate-500 text-center md:hidden">
        Hiển thị {filtered.length} / {commodities.length} hàng hóa
      </div>
      </div>
    </ProtectedPage>
  );
}
