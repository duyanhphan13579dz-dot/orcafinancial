"use client";

import { useEffect, useState } from "react";
import { SettingsSection, Row, TextInput, Button, Badge } from "./primitives";
import { useToast } from "./Toast";
import { useAuth } from "@/lib/auth/context";

interface Profile {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  phoneNumber: string | null;
  provider: string;
  emailVerified: boolean;
  createdAt: string;
}

export function AccountPanel() {
  const { push } = useToast();
  const { refreshUser } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatar, setAvatar] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/v1/users/me")
      .then((r) => r.json())
      .then((j) => {
        const u = j.data?.user;
        if (u) {
          setProfile(u);
          setName(u.name ?? "");
          setPhone(u.phoneNumber ?? "");
          setAvatar(u.avatarUrl ?? "");
        }
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/v1/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phoneNumber: phone, avatarUrl: avatar }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Cập nhật thất bại");
      setProfile(j.data.user);
      await refreshUser();
      push("success", "Đã cập nhật hồ sơ");
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Cập nhật thất bại");
    } finally {
      setSaving(false);
    }
  };

  if (!profile) {
    return (
      <div className="panel p-8 text-center text-slate-500 text-sm">
        <div className="inline-block h-5 w-5 border-2 border-[#00d4ff] border-t-transparent rounded-full animate-spin" />
        <div className="mt-2">Đang tải hồ sơ…</div>
      </div>
    );
  }

  const initials = (profile.name ?? profile.email).slice(0, 2).toUpperCase();

  return (
    <div className="space-y-5">
      <SettingsSection title="Thông tin cá nhân" description="Thông tin hiển thị trong tài khoản ORCA của bạn.">
        <div className="flex items-center gap-4 pb-2">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="h-16 w-16 rounded-full object-cover border-2 border-[#1a3558]" />
          ) : (
            <div className="h-16 w-16 rounded-full bg-gradient-to-br from-[#00d4ff] to-[#0073a8] flex items-center justify-center text-xl font-bold text-[#0A2540]">
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-white font-semibold truncate">{profile.name || "Chưa đặt tên"}</div>
            <div className="text-xs text-slate-400 truncate">{profile.email}</div>
            <div className="mt-1 flex gap-2">
              <Badge tone={profile.provider === "google" ? "good" : "neutral"}>
                {profile.provider === "google" ? "Google" : "Email"}
              </Badge>
              <Badge tone={profile.emailVerified ? "good" : "warn"}>
                {profile.emailVerified ? "Đã xác thực" : "Chưa xác thực"}
              </Badge>
            </div>
          </div>
        </div>

        <Row label="Họ tên">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Nguyễn Văn A" maxLength={255} />
        </Row>
        <Row label="Email" hint="Email đăng nhập không thể thay đổi trực tiếp.">
          <TextInput value={profile.email} disabled />
        </Row>
        <Row label="Số điện thoại">
          <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09xx xxx xxx" />
        </Row>
        <Row label="Ảnh đại diện (URL)" hint="Dán liên kết ảnh công khai.">
          <TextInput value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="https://…" />
        </Row>

        <div className="pt-2">
          <Button onClick={save} loading={saving}>
            Lưu thay đổi
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection title="Liên kết tài khoản" description="Quản lý phương thức đăng nhập.">
        <Row label="Google" hint={profile.provider === "google" ? "Tài khoản đang dùng Google để đăng nhập." : "Chưa liên kết."}>
          <Badge tone={profile.provider === "google" ? "good" : "neutral"}>
            {profile.provider === "google" ? "Đã liên kết" : "Chưa liên kết"}
          </Badge>
        </Row>
        <div className="text-[11px] text-slate-500">
          Liên kết/hủy liên kết Google sẽ khả dụng khi cấu hình biến môi trường{" "}
          <span className="font-mono text-slate-400">GOOGLE_CLIENT_ID</span>.
        </div>
      </SettingsSection>

      <SettingsSection title="Thông tin tài khoản">
        <Row label="Mã tài khoản">
          <span className="font-mono text-xs text-slate-400 break-all">{profile.id}</span>
        </Row>
        <Row label="Ngày tạo">
          <span className="text-sm text-slate-300">
            {new Date(profile.createdAt).toLocaleString("vi-VN")}
          </span>
        </Row>
      </SettingsSection>
    </div>
  );
}
