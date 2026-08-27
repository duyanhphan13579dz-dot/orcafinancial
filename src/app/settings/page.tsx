"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ProtectedPage } from "@/components/ProtectedPage";
import { ToastProvider } from "@/components/settings/Toast";
import { AppearancePanel } from "@/components/settings/AppearancePanel";
import { AccountPanel } from "@/components/settings/AccountPanel";
import { SecurityPanel } from "@/components/settings/SecurityPanel";
import { NotificationsPanel } from "@/components/settings/NotificationsPanel";
import { SessionsPanel } from "@/components/settings/SessionsPanel";
import { DataPanel } from "@/components/settings/DataPanel";
import { SupportPanel } from "@/components/settings/SupportPanel";
import { useAuth } from "@/lib/auth/context";

const TABS = [
  { id: "appearance", label: "Giao diện", icon: "🎨", desc: "Chủ đề, màu, ngôn ngữ" },
  { id: "account", label: "Tài khoản", icon: "👤", desc: "Hồ sơ cá nhân" },
  { id: "security", label: "Bảo mật", icon: "🔒", desc: "Mật khẩu, 2FA, nhật ký" },
  { id: "notifications", label: "Thông báo", icon: "🔔", desc: "Email, push" },
  { id: "sessions", label: "Phiên đăng nhập", icon: "💻", desc: "Thiết bị đang đăng nhập" },
  { id: "data", label: "Quản lý dữ liệu", icon: "🗄️", desc: "Xuất, xoá tài khoản" },
  { id: "support", label: "Trợ giúp", icon: "💬", desc: "FAQ, liên hệ" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function SettingsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<TabId>("appearance");

  useEffect(() => {
    const q = params.get("tab") as TabId | null;
    if (q && TABS.some((t) => t.id === q)) queueMicrotask(() => setTab(q));
  }, [params]);

  const changeTab = (id: TabId) => {
    setTab(id);
    router.replace(`/settings?tab=${id}`, { scroll: false });
  };

  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div className="space-y-5">
      <header>
        <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-[#00d4ff]">TÀI KHOẢN ORCA</div>
        <h1 className="display-xl text-3xl md:text-4xl text-white mt-1">Cài đặt</h1>
        {user && (
          <p className="text-sm text-slate-400 mt-2">
            Đang đăng nhập với <span className="text-slate-200 font-medium">{user.email}</span>
          </p>
        )}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
        <nav className="lg:sticky lg:top-24 lg:self-start">
          <div className="lg:hidden -mx-4 px-4 overflow-x-auto scrollbar-hide">
            <div className="flex gap-2 pb-2 w-max">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => changeTab(t.id)}
                  className={`shrink-0 rounded-lg border px-3 py-2.5 text-xs font-medium min-h-[44px] transition-all active:scale-95 ${
                    tab === t.id
                      ? "border-[#00d4ff] bg-[#00d4ff]/15 text-[#00d4ff]"
                      : "border-[#1a3558] bg-[#0e2e4f]/60 text-slate-400"
                  }`}
                >
                  <span className="mr-1.5">{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="hidden lg:block panel p-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => changeTab(t.id)}
                className={`w-full text-left rounded-lg px-3 py-2.5 mb-1 transition-all min-h-[44px] ${
                  tab === t.id
                    ? "bg-[#00d4ff]/12 border border-[#00d4ff]/40"
                    : "border border-transparent hover:bg-[#0e2e4f]"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-lg">{t.icon}</span>
                  <div className="min-w-0">
                    <div className={`text-sm font-medium ${tab === t.id ? "text-[#00d4ff]" : "text-slate-200"}`}>
                      {t.label}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">{t.desc}</div>
                  </div>
                </div>
              </button>
            ))}

            <div className="mt-2 pt-2 border-t border-[#1a3558]">
              <button
                onClick={() => void logout()}
                className="w-full text-left rounded-lg px-3 py-2.5 min-h-[44px] border border-transparent hover:bg-rose-950/30 hover:border-rose-800 transition-all"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-lg">🚪</span>
                  <div className="text-sm font-medium text-rose-300">Đăng xuất</div>
                </div>
              </button>
            </div>
          </div>
        </nav>

        <div className="min-w-0">
          <div className="lg:hidden mb-3">
            <h2 className="font-display text-lg font-bold text-white">
              {active.icon} {active.label}
            </h2>
            <p className="text-xs text-slate-500">{active.desc}</p>
          </div>

          {tab === "appearance" && <AppearancePanel />}
          {tab === "account" && <AccountPanel />}
          {tab === "security" && <SecurityPanel />}
          {tab === "notifications" && <NotificationsPanel />}
          {tab === "sessions" && <SessionsPanel />}
          {tab === "data" && <DataPanel />}
          {tab === "support" && <SupportPanel />}

          <div className="lg:hidden mt-5">
            <button
              onClick={() => void logout()}
              className="w-full rounded-lg border border-rose-800 bg-rose-950/25 px-4 py-3 text-sm font-semibold text-rose-300 min-h-[44px] active:scale-[0.98] transition-transform"
            >
              🚪 Đăng xuất
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <ProtectedPage featureName="trang cài đặt">
      <ToastProvider>
        <SettingsInner />
      </ToastProvider>
    </ProtectedPage>
  );
}
