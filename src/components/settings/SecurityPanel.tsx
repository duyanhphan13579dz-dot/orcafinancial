"use client";

import { useEffect, useState } from "react";
import { SettingsSection, Row, TextInput, Button, Badge, Toggle } from "./primitives";
import { useToast } from "./Toast";

interface AuditLog {
  id: string;
  action: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

const ACTION_LABELS: Record<string, string> = {
  login: "Đăng nhập",
  logout: "Đăng xuất",
  register: "Tạo tài khoản",
  change_password: "Đổi mật khẩu",
  update_profile: "Cập nhật hồ sơ",
  update_preferences: "Đổi cài đặt",
  revoke_session: "Đăng xuất thiết bị",
  revoke_other_sessions: "Đăng xuất các thiết bị khác",
  export_data: "Xuất dữ liệu",
  delete_account: "Xoá tài khoản",
};

export function SecurityPanel() {
  const { push } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [twoFA, setTwoFA] = useState(false);

  useEffect(() => {
    fetch("/api/v1/users/audit-logs?limit=30")
      .then((r) => r.json())
      .then((j) => setLogs(j.data?.logs ?? []))
      .catch(() => {});
    fetch("/api/v1/users/me")
      .then((r) => r.json())
      .then((j) => setTwoFA(!!j.data?.user?.twoFactorEnabled))
      .catch(() => {});
  }, []);

  const changePassword = async () => {
    if (next !== confirm) {
      push("error", "Mật khẩu xác nhận không khớp");
      return;
    }
    if (next.length < 6) {
      push("error", "Mật khẩu mới phải có ít nhất 6 ký tự");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/v1/users/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next, confirmPassword: confirm }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Đổi mật khẩu thất bại");
      setCurrent("");
      setNext("");
      setConfirm("");
      push("success", `Đã đổi mật khẩu. Đăng xuất ${j.data?.revokedSessions ?? 0} thiết bị khác.`);
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Đổi mật khẩu thất bại");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <SettingsSection
        title="Đổi mật khẩu"
        description="Sau khi đổi mật khẩu, tất cả thiết bị khác sẽ tự động bị đăng xuất."
      >
        <Row label="Mật khẩu hiện tại" hint="Bỏ trống nếu tài khoản Google chưa đặt mật khẩu.">
          <TextInput type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="••••••" autoComplete="current-password" />
        </Row>
        <Row label="Mật khẩu mới">
          <TextInput type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Tối thiểu 6 ký tự" autoComplete="new-password" />
        </Row>
        <Row label="Xác nhận mật khẩu mới">
          <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Nhập lại" autoComplete="new-password" />
        </Row>
        <div className="pt-2">
          <Button onClick={changePassword} loading={saving} disabled={!next || !confirm}>
            Cập nhật mật khẩu
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Xác thực hai lớp (2FA)"
        description="Thêm một lớp bảo vệ bằng ứng dụng authenticator."
      >
        <Row label="Trạng thái 2FA">
          <div className="flex items-center gap-3">
            <Toggle
              checked={twoFA}
              disabled
              onChange={() => {}}
              label="2FA"
            />
            <Badge tone={twoFA ? "good" : "neutral"}>{twoFA ? "Đang bật" : "Chưa bật"}</Badge>
          </div>
        </Row>
        <div className="text-[11px] text-slate-500 leading-relaxed">
          Tính năng 2FA yêu cầu cấu hình thư viện TOTP phía máy chủ. Hạ tầng cơ sở dữ liệu đã sẵn sàng
          (<span className="font-mono text-slate-400">two_factor_enabled</span>,{" "}
          <span className="font-mono text-slate-400">two_factor_secret</span>) để kích hoạt khi triển khai.
        </div>
      </SettingsSection>

      <SettingsSection title="Nhật ký hoạt động" description="30 hoạt động bảo mật gần nhất trên tài khoản.">
        {logs.length === 0 ? (
          <div className="text-sm text-slate-500 italic py-4 text-center">Chưa có hoạt động nào được ghi nhận.</div>
        ) : (
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {logs.map((l) => (
              <div
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-[#1a3558]/70 bg-[#0a1d33]/50 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm text-slate-200">{ACTION_LABELS[l.action] ?? l.action}</div>
                  <div className="text-[10px] font-mono text-slate-500 truncate">
                    {l.ipAddress ?? "—"} · {(l.userAgent ?? "").slice(0, 48)}
                  </div>
                </div>
                <div className="text-[10px] font-mono text-slate-500 shrink-0">
                  {new Date(l.createdAt).toLocaleString("vi-VN")}
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
