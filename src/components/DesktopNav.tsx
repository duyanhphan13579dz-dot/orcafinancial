"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Tổng quan" },
  { href: "/heatmap", label: "Bản đồ nhiệt" },
  { href: "/sector-board", label: "Ngành" },
  { href: "/commodities", label: "Hàng hóa" },
  { href: "/crypto", label: "Crypto" },
  { href: "/forex", label: "Forex" },
  { href: "/reports", label: "Báo cáo" },
  { href: "/screener", label: "Bộ lọc" },
  { href: "/news", label: "Tin tức" },
  { href: "/watchlist", label: "Theo dõi" },
  { href: "/agent", label: "Trợ lý AI" },
  { href: "/system", label: "Hệ thống" },
  { href: "/settings", label: "Cài đặt" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DesktopNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 xl:gap-2 text-sm text-slate-400 font-display border-t border-[#1a3558]/60 -mx-4 px-4 overflow-x-auto scrollbar-hide">
      {NAV.map((n) => {
        const active = isActive(pathname, n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            prefetch
            className={`relative shrink-0 whitespace-nowrap px-2.5 py-2 transition-colors after:content-[''] after:absolute after:left-2.5 after:right-2.5 after:bottom-0 after:h-0.5 after:bg-[#00d4ff] after:origin-left after:transition-transform ${
              active
                ? "text-[#00d4ff] after:scale-x-100"
                : "hover:text-[#00d4ff] after:scale-x-0 hover:after:scale-x-100"
            }`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
