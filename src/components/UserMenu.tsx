"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/context";

export function UserMenu() {
  const { user, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (loading) {
    return <div className="h-9 w-9 rounded-full bg-[#0e2e4f] animate-pulse" />;
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/auth/login"
          className="rounded-lg border border-[#2a4a75] px-3 py-2 text-xs font-semibold text-slate-300 hover:border-[#00d4ff] hover:text-[#00d4ff] transition-colors min-h-[40px] flex items-center"
        >
          Đăng nhập
        </Link>
        <Link
          href="/auth/register"
          className="rounded-lg bg-gradient-to-r from-[#00d4ff] to-[#0073a8] px-3 py-2 text-xs font-bold text-[#0A2540] min-h-[40px] flex items-center active:scale-95 transition-transform"
        >
          Đăng ký
        </Link>
      </div>
    );
  }

  const initials = (user.name ?? user.email).slice(0, 2).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full border border-[#1a3558] bg-[#0e2e4f] p-1 pr-3 hover:border-[#00d4ff]/50 transition-colors min-h-[40px]"
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <span className="h-8 w-8 rounded-full bg-gradient-to-br from-[#00d4ff] to-[#0073a8] flex items-center justify-center text-xs font-bold text-[#0A2540]">
            {initials}
          </span>
        )}
        <span className="hidden xl:block text-xs text-slate-300 max-w-[120px] truncate">
          {user.name || user.email}
        </span>
        <span className={`text-[10px] text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-[#1a3558] bg-[#0A2540] shadow-2xl overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-[#1a3558]">
            <div className="text-sm font-semibold text-white truncate">{user.name || "Tài khoản"}</div>
            <div className="text-[11px] text-slate-500 truncate">{user.email}</div>
          </div>
          <Link
            href="/settings?tab=account"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-3 text-sm text-slate-300 hover:bg-[#0e2e4f] transition-colors min-h-[44px]"
          >
            <span>👤</span> Hồ sơ cá nhân
          </Link>
          <Link
            href="/settings?tab=appearance"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-3 text-sm text-slate-300 hover:bg-[#0e2e4f] transition-colors min-h-[44px]"
          >
            <span>⚙️</span> Cài đặt
          </Link>
          <button
            onClick={() => {
              setOpen(false);
              void logout();
            }}
            className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-rose-300 hover:bg-rose-950/30 transition-colors min-h-[44px] border-t border-[#1a3558]"
          >
            <span>🚪</span> Đăng xuất
          </button>
        </div>
      )}
    </div>
  );
}
