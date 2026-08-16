"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Tổng quan", icon: "📊" },
  { href: "/commodities", label: "Hàng hóa", icon: "📦" },
  { href: "/reports", label: "Báo cáo", icon: "📰" },
  { href: "/screener", label: "Bộ lọc", icon: "🔍" },
  { href: "/news", label: "Tin tức", icon: "📰" },
  { href: "/watchlist", label: "Theo dõi", icon: "⭐" },
  { href: "/agent", label: "AI Agent", icon: "🤖" },
  { href: "/system", label: "Hệ thống", icon: "🩺" },
  { href: "/settings", label: "Cài đặt", icon: "⚙️" },
];

export function MobileHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden sticky top-0 z-50 border-b border-[#1a3558] bg-[#0A2540]/98 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <div className="h-7 w-7 rounded bg-gradient-to-br from-[#00d4ff] to-[#0073a8] flex items-center justify-center text-sm">🐋</div>
            <div className="font-display font-bold text-white text-sm">ORCA</div>
          </Link>
          <button
            onClick={() => setOpen(!open)}
            className="h-10 w-10 flex items-center justify-center rounded-lg border border-[#1a3558] bg-[#0e2e4f] text-white active:scale-95 transition-transform"
            aria-label="Menu"
          >
            {open ? "✕" : "☰"}
          </button>
        </div>

        {/* Mobile dropdown menu */}
        {open && (
          <div className="absolute top-full left-0 right-0 bg-[#0A2540] border-b border-[#1a3558] shadow-2xl animate-in slide-in-from-top-2">
            <nav className="p-2">
              {NAV.map((n) => {
                const active = pathname === n.href;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg mb-1 active:scale-[0.98] transition-all ${
                      active ? "bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30" : "text-slate-300 hover:bg-[#0e2e4f]"
                    }`}
                  >
                    <span className="text-xl">{n.icon}</span>
                    <span className="font-medium">{n.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
      </div>

      {/* Desktop header placeholder - actual header rendered in layout */}
      <div className="hidden md:block" />
    </>
  );
}

export function MobileBottomNav() {
  const pathname = usePathname();
  // Only show on mobile/tablet
  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0A2540]/98 backdrop-blur border-t border-[#1a3558] safe-area-pb">
      <nav className="flex items-center justify-around py-2">
        {NAV.slice(0, 5).map((n) => {
          const active = pathname === n.href;
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`flex flex-col items-center justify-center w-full py-2 active:scale-95 transition-transform ${
                active ? "text-[#00d4ff]" : "text-slate-400"
              }`}
            >
              <span className="text-xl mb-0.5">{n.icon}</span>
              <span className="text-[10px] font-medium">{n.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
