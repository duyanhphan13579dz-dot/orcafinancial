"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";
import Image from "next/image";
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
  twoFactorEnabled: boolean;
  createdAt: string;
}

export function AccountPanel() {
  const { push } = useToast();
  const { refreshUser } =
    useAuth();

  const [profile, setProfile] =
    useState<Profile | null>(null);

  const [name, setName] =
    useState("");

  const [phone, setPhone] =
    useState("");

  const [avatar, setAvatar] =
    useState("");

  const [saving, setSaving] =
    useState(false);

  const [googleLoading, setGoogleLoading] =
    useState(false);

  const [googleUnlinking, setGoogleUnlinking] =
    useState(false);

  const refreshProfile = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/users/me", { cache: "no-store" });
      const json = await response.json();
      const u = json.data?.user;
      if (u) {
        setProfile(u);
        setName(u.name ?? "");
        setPhone(u.phoneNumber ?? "");
        setAvatar(u.avatarUrl ?? "");
      }
    } catch {
      // Keep existing UI state.
    }
  }, []);

  useEffect(() => {
    fetch("/api/v1/users/me")
      .then((r) => r.json())
      .then((j) => {
        const u =
          j.data?.user;

        if (u) {
          setProfile(u);
          setName(
            u.name ?? "",
          );
          setPhone(
            u.phoneNumber ?? "",
          );
          setAvatar(
            u.avatarUrl ?? "",
          );
        }
      })
      .catch(() => {});
  }, []);

  /*
   * Handle return from Google linking.
   */
  useEffect(() => {
    const params =
      new URLSearchParams(
        window.location.search,
      );

    const linked =
      params.get("google");

    const error =
      params.get("error");

    if (linked === "linked") {
      push(
        "success",
        "Đã liên kết tài khoản Google.",
      );

      window.history.replaceState(
        {},
        "",
        "/settings?tab=account",
      );

      queueMicrotask(() => void refreshProfile());
    }

    if (error) {
      push(
        "error",
        decodeURIComponent(
          error,
        ),
      );

      window.history.replaceState(
        {},
        "",
        "/settings?tab=account",
      );
    }
  }, [refreshProfile, push]);

  const save = async () => {
    setSaving(true);

    try {
      const res =
        await fetch(
          "/api/v1/users/me",
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              name,
              phoneNumber:
                phone,
              avatarUrl:
                avatar,
            }),
          },
        );

      const j =
        await res.json();

      if (!res.ok) {
        throw new Error(
          j.error ??
            "Cập nhật thất bại",
        );
      }

      setProfile(
        j.data.user,
      );

      await refreshUser();

      push(
        "success",
        "Đã cập nhật hồ sơ",
      );
    } catch (e) {
      push(
        "error",
        e instanceof Error
          ? e.message
          : "Cập nhật thất bại",
      );
    } finally {
      setSaving(false);
    }
  };

  const linkGoogle = () => {
    setGoogleLoading(true);

    window.location.href =
      "/api/v1/auth/google?mode=link";
  };

  const unlinkGoogle =
    async () => {
      if (
        !window.confirm(
          "Bạn có chắc muốn hủy liên kết Google khỏi tài khoản ORCA?",
        )
      ) {
        return;
      }

      setGoogleUnlinking(
        true,
      );

      try {
        const response =
          await fetch(
            "/api/v1/auth/google/link",
            {
              method: "DELETE",
            },
          );

        const json =
          await response.json();

        if (!response.ok) {
          throw new Error(
            json.error ??
              "Không thể hủy liên kết Google",
          );
        }

        await refreshUser();
        await refreshProfile();

        push(
          "success",
          "Đã hủy liên kết Google.",
        );
      } catch (error) {
        push(
          "error",
          error instanceof Error
            ? error.message
            : "Không thể hủy liên kết Google",
        );
      } finally {
        setGoogleUnlinking(
          false,
        );
      }
    };

  if (!profile) {
    return (
      <div className="panel p-8 text-center text-slate-500 text-sm">
        <div className="inline-block h-5 w-5 border-2 border-[#00d4ff] border-t-transparent rounded-full animate-spin" />

        <div className="mt-2">
          Đang tải hồ sơ…
        </div>
      </div>
    );
  }

  const initials =
    (
      profile.name ??
      profile.email
    )
      .slice(0, 2)
      .toUpperCase();

  const googleLinked =
    profile.provider ===
    "google";

  return (
    <div className="space-y-5">
      {/* Personal information */}
      <SettingsSection
        title="Thông tin cá nhân"
        description="Thông tin hiển thị trong tài khoản ORCA của bạn."
      >
        <div className="flex items-center gap-4 pb-2">
          {avatar ? (
            <Image
              src={avatar}
              alt=""
              width={64}
              height={64}
              className="h-16 w-16 rounded-full object-cover border-2 border-[#1a3558]"
              unoptimized={!avatar.includes("googleusercontent.com")}
            />
          ) : (
            <div className="h-16 w-16 rounded-full bg-gradient-to-br from-[#00d4ff] to-[#0073a8] flex items-center justify-center text-xl font-bold text-[#0A2540]">
              {initials}
            </div>
          )}

          <div className="min-w-0">
            <div className="text-white font-semibold truncate">
              {profile.name ||
                "Chưa đặt tên"}
            </div>

            <div className="text-xs text-slate-400 truncate">
              {profile.email}
            </div>

            <div className="mt-1 flex gap-2 flex-wrap">
              <Badge
                tone={
                  googleLinked
                    ? "good"
                    : "neutral"
                }
              >
                {googleLinked
                  ? "Google"
                  : "Email"}
              </Badge>

              <Badge
                tone={
                  profile.emailVerified
                    ? "good"
                    : "warn"
                }
              >
                {profile.emailVerified
                  ? "Đã xác thực"
                  : "Chưa xác thực"}
              </Badge>
            </div>
          </div>
        </div>

        <Row label="Họ tên">
          <TextInput
            value={name}
            onChange={(e) =>
              setName(
                e.target.value,
              )
            }
            placeholder="Nguyễn Văn A"
            maxLength={255}
          />
        </Row>

        <Row
          label="Email"
          hint="Email đăng nhập không thể thay đổi trực tiếp."
        >
          <TextInput
            value={profile.email}
            disabled
          />
        </Row>

        <Row label="Số điện thoại">
          <TextInput
            value={phone}
            onChange={(e) =>
              setPhone(
                e.target.value,
              )
            }
            placeholder="09xx xxx xxx"
          />
        </Row>

        <Row
          label="Ảnh đại diện (URL)"
          hint="Dán liên kết ảnh công khai."
        >
          <TextInput
            value={avatar}
            onChange={(e) =>
              setAvatar(
                e.target.value,
              )
            }
            placeholder="https://…"
          />
        </Row>

        <div className="pt-2">
          <Button
            onClick={save}
            loading={saving}
          >
            Lưu thay đổi
          </Button>
        </div>
      </SettingsSection>

      {/* Google account */}
      <SettingsSection
        title="Liên kết tài khoản"
        description="Quản lý phương thức đăng nhập Google cho tài khoản ORCA của bạn."
      >
        <Row
          label="Google"
          hint={
            googleLinked
              ? "Tài khoản Google đang được liên kết và có thể dùng để đăng nhập."
              : "Liên kết Google để đăng nhập nhanh hơn."
          }
        >
          <div className="flex flex-col sm:flex-row gap-2">
            {googleLinked ? (
              <>
                <Badge tone="good">
                  ✓ Đã liên kết
                </Badge>

                <button
                  type="button"
                  onClick={
                    unlinkGoogle
                  }
                  disabled={
                    googleUnlinking
                  }
                  className="rounded-lg border border-rose-800 bg-rose-950/20 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-950/40 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {googleUnlinking
                    ? "Đang hủy..."
                    : "Hủy liên kết"}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={
                  linkGoogle
                }
                disabled={
                  googleLoading
                }
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#1a3558] bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {googleLoading ? (
                  <>
                    <span className="h-4 w-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                    Đang kết nối...
                  </>
                ) : (
                  <>
                    <span className="font-bold">
                      G
                    </span>
                    Liên kết Google
                  </>
                )}
              </button>
            )}
          </div>
        </Row>

        <div className="rounded-lg border border-[#1a3558] bg-[#0e2e4f]/40 p-3 text-[11px] text-slate-400 leading-relaxed">
          Khi liên kết Google, tài khoản ORCA hiện tại
          vẫn giữ mật khẩu email nếu đã có. Bạn có thể
          đăng nhập bằng email/mật khẩu hoặc Google.
        </div>
      </SettingsSection>

      {/* Account information */}
      <SettingsSection title="Thông tin tài khoản">
        <Row label="Mã tài khoản">
          <span className="font-mono text-xs text-slate-400 break-all">
            {profile.id}
          </span>
        </Row>

        <Row label="Ngày tạo">
          <span className="text-sm text-slate-300">
            {new Date(
              profile.createdAt,
            ).toLocaleString(
              "vi-VN",
            )}
          </span>
        </Row>
      </SettingsSection>
    </div>
  );
}
