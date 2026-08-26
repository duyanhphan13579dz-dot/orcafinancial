"use client";

import { useCallback, useEffect, useState } from "react";
import { SettingsSection, Button, Badge } from "./primitives";
import { useToast } from "./Toast";

interface SessionView {
  id: string;
  browser: string;
  os: string;
  ipAddress: string | null;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  current: boolean;
}

export function SessionsPanel() {
  const { push } = useToast();
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/users/sessions");
      const j = await res.json();
      setSessions(j.data?.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const revoke = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/v1/users/sessions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Không thể đăng xuất phiên này");
      push("success", "Đã đăng xuất thiết bị");
      await load();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Thất bại");
    } finally {
      setBusy(null);
    }
  };

  const revokeOthers = async () => {
    setBusy("all");
    try {
      const res = await fetch("/api/v1/users/sessions", { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Thất bại");
      push("success", `Đã đăng xuất ${j.data?.revoked ?? 0} thiết bị khác`);
      await load();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Thất bại");
    } finally {
      setBusy(null);
    }
  };

  const others = sessions.filter((s) => !s.current).length;

  return (
    <SettingsSection
      title="Phiên đăng nhập"
      description="Các thiết bị và trình duyệt đang đăng nhập vào tài khoản của bạn."
      footer={
        others > 0 ? (
          <Button variant="danger" onClick={revokeOthers} loading={busy === "all"}>
            Đăng xuất {others} thiết bị khác
          </Button>
        ) : (
          <span className="text-xs text-slate-500">Không có thiết bị nào khác đang đăng nhập.</span>
        )
      }
    >
      {loading ? (
        <div className="py-6 text-center text-slate-500 text-sm">
          <div className="inline-block h-5 w-5 border-2 border-[#00d4ff] border-t-transparent rounded-full animate-spin" />
          <div className="mt-2">Đang tải phiên đăng nhập…</div>
        </div>
      ) : sessions.length === 0 ? (
        <div className="py-6 text-center text-slate-500 text-sm italic">
          Chưa ghi nhận phiên nào. Hãy đăng nhập lại để phiên hiện tại được ghi nhận.
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`rounded-lg border p-3 flex flex-wrap items-center justify-between gap-3 ${
                s.current ? "border-[#00d4ff]/50 bg-[#00d4ff]/5" : "border-[#1a3558] bg-[#0a1d33]/50"
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-white">
                    {s.browser} · {s.os}
                  </span>
                  {s.current && <Badge tone="good">Thiết bị này</Badge>}
                </div>
                <div className="text-[11px] font-mono text-slate-500 mt-1">
                  IP {s.ipAddress ?? "—"} · Hoạt động {new Date(s.lastActiveAt).toLocaleString("vi-VN")}
                </div>
                <div className="text-[10px] text-slate-600 mt-0.5">
                  Đăng nhập {new Date(s.createdAt).toLocaleString("vi-VN")} · Hết hạn{" "}
                  {new Date(s.expiresAt).toLocaleDateString("vi-VN")}
                </div>
              </div>
              {!s.current && (
                <Button variant="ghost" onClick={() => revoke(s.id)} loading={busy === s.id}>
                  Đăng xuất
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
