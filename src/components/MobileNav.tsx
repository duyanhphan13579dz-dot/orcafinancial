"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SearchBar } from "@/components/search-bar";
import { UserMenu } from "@/components/UserMenu";

const PRIMARY = [
  { href: "/", label: "Tổng quan", icon: "📊" },
  { href: "/heatmap", label: "Bản đồ nhiệt", icon: "🟩" },
  { href: "/crypto", label: "Crypto", icon: "🪙" },
  { href: "/forex", label: "Forex", icon: "💱" },
  { href: "/commodities", label: "Hàng hóa", icon: "📦" },
];

const MORE = [
  { href: "/sector-board", label: "Bảng thị trường", icon: "▦" },
  { href: "/reports", label: "Báo cáo", icon: "📰" },
  { href: "/screener", label: "Bộ lọc", icon: "🔍" },
  { href: "/news", label: "Tin tức", icon: "📡" },
  { href: "/watchlist", label: "Theo dõi", icon: "⭐" },
  { href: "/agent", label: "Trợ lý AI", icon: "🤖" },
  { href: "/system", label: "Hệ thống", icon: "🩺" },
  { href: "/settings", label: "Cài đặt", icon: "⚙️" },
];

const ALL_NAV = [...PRIMARY, ...MORE];

export function MobileHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <div className="lg:hidden sticky top-0 z-50 border-b border-[#1a3558] bg-[#0A2540]/98 backdrop-blur safe-area-pt">
        <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5">
          <Link href="/" className="flex items-center gap-2 shrink-0 min-w-0">
            <div className="h-8 w-8 rounded-md bg-gradient-to-br from-[#00d4ff] to-[#0073a8] flex items-center justify-center text-sm shrink-0">
              🐋
            </div>
            <div className="font-display font-bold text-white text-sm truncate">ORCA</div>
          </Link>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:block">
              <UserMenu />
            </div>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="h-11 w-11 flex items-center justify-center rounded-lg border border-[#1a3558] bg-[#0e2e4f] text-white text-lg active:scale-95 transition-transform touch-min"
              aria-label={open ? "Đóng menu" : "Mở menu"}
              aria-expanded={open}
            >
              {open ? "✕" : "☰"}
            </button>
          </div>
        </div>

        <div className="px-3 sm:px-4 pb-2.5 min-w-0">
          <SearchBar />
        </div>
      </div>

      {open && (
        <>
          <button
            type="button"
            className="lg:hidden fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
            aria-label="Đóng menu"
            onClick={() => setOpen(false)}
          />
          <div
            className="lg:hidden fixed inset-y-0 right-0 z-[70] w-[min(100vw,320px)] bg-[#0A2540] border-l border-[#1a3558] shadow-2xl flex flex-col safe-area-pb"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a3558]">
              <span className="font-display font-bold text-white text-sm">Điều hướng</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-10 w-10 rounded-lg border border-[#1a3558] flex items-center justify-center text-slate-300 active:scale-95"
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto overscroll-contain p-2">
              {ALL_NAV.map((n) => {
                const active =
                  n.href === "/"
                    ? pathname === "/"
                    : pathname === n.href || pathname.startsWith(`${n.href}/`);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-lg mb-1 min-h-[48px] active:scale-[0.98] transition-all ${
                      active
                        ? "bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30"
                        : "text-slate-300 hover:bg-[#0e2e4f] border border-transparent"
                    }`}
                  >
                    <span className="text-xl w-7 text-center shrink-0">{n.icon}</span>
                    <span className="font-medium text-sm">{n.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="border-t border-[#1a3558] p-3 sm:hidden">
              <UserMenu />
            </div>
          </div>
        </>
      )}
    </>
  );
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const items = [
    ...PRIMARY.slice(0, 4),
    { href: "/settings", label: "Cài đặt", icon: "⚙️" },
  ];

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0A2540]/98 backdrop-blur border-t border-[#1a3558] safe-area-pb">
      <nav className="flex items-center justify-around px-1 py-1.5">
        {items.map((n) => {
          const active =
            n.href === "/"
              ? pathname === "/"
              : pathname === n.href || pathname.startsWith(`${n.href}/`);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`flex flex-col items-center justify-center flex-1 min-w-0 py-2 px-0.5 min-h-[48px] active:scale-95 transition-transform ${
                active ? "text-[#00d4ff]" : "text-slate-400"
              }`}
            >
              <span className="text-lg leading-none mb-0.5">{n.icon}</span>
              <span className="text-[9px] sm:text-[10px] font-medium truncate max-w-full">{n.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
