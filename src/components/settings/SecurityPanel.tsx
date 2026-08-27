"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import {
  SettingsSection,
  Row,
  TextInput,
  Button,
  Badge,
  Toggle,
} from "./primitives";

import { useToast } from "./Toast";

interface AuditLog {
  id: string;
  action: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

interface TwoFactorSetup {
  secret: string;
  otpauthUri: string;
  qrCodeDataUrl: string;
}

const ACTION_LABELS: Record<
  string,
  string
> = {
  login: "Đăng nhập",
  logout: "Đăng xuất",
  register: "Tạo tài khoản",
  change_password: "Đổi mật khẩu",
  update_profile: "Cập nhật hồ sơ",
  update_preferences: "Đổi cài đặt",
  revoke_session: "Đăng xuất thiết bị",
  revoke_other_sessions:
    "Đăng xuất các thiết bị khác",
  export_data: "Xuất dữ liệu",
  delete_account: "Xoá tài khoản",

  link_google: "Liên kết Google",

  "2fa_setup_started":
    "Bắt đầu thiết lập 2FA",
  "2fa_verify_failed":
    "Xác nhận 2FA thất bại",
  "2fa_enabled": "Bật 2FA",
  "2fa_disable_failed":
    "Tắt 2FA thất bại",
  "2fa_disabled": "Tắt 2FA",
};

export function SecurityPanel() {
  const { push } = useToast();

  const [current, setCurrent] =
    useState("");
  const [next, setNext] =
    useState("");
  const [confirm, setConfirm] =
    useState("");

  const [saving, setSaving] =
    useState(false);

  const [logs, setLogs] =
    useState<AuditLog[]>([]);

  const [twoFA, setTwoFA] =
    useState(false);

  const [twoFASetup, setTwoFASetup] =
    useState<TwoFactorSetup | null>(
      null,
    );

  const [twoFACode, setTwoFACode] =
    useState("");

  const [twoFAActionLoading, setTwoFAActionLoading] =
    useState(false);

  const [disableCode, setDisableCode] =
    useState("");

  const [showDisable, setShowDisable] =
    useState(false);

  const loadSecurityData =
    async () => {
      try {
        const [
          logsResponse,
          userResponse,
        ] = await Promise.all([
          fetch(
            "/api/v1/users/audit-logs?limit=30",
          ),
          fetch("/api/v1/users/me"),
        ]);

        const logsJson =
          await logsResponse.json();

        const userJson =
          await userResponse.json();

        setLogs(
          logsJson.data?.logs ?? [],
        );

        setTwoFA(
          !!userJson.data?.user
            ?.twoFactorEnabled,
        );
      } catch {
        // Keep existing UI state.
      }
    };

  useEffect(() => {
    queueMicrotask(() => void loadSecurityData());
  }, []);

  const changePassword =
    async () => {
      if (next !== confirm) {
        push(
          "error",
          "Mật khẩu xác nhận không khớp",
        );
        return;
      }

      if (next.length < 6) {
        push(
          "error",
          "Mật khẩu mới phải có ít nhất 6 ký tự",
        );
        return;
      }

      setSaving(true);

      try {
        const res = await fetch(
          "/api/v1/users/change-password",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              currentPassword: current,
              newPassword: next,
              confirmPassword: confirm,
            }),
          },
        );

        const j = await res.json();

        if (!res.ok) {
          throw new Error(
            j.error ??
              "Đổi mật khẩu thất bại",
          );
        }

        setCurrent("");
        setNext("");
        setConfirm("");

        push(
          "success",
          `Đã đổi mật khẩu. Đăng xuất ${
            j.data?.revokedSessions ??
            0
          } thiết bị khác.`,
        );

        await loadSecurityData();
      } catch (e) {
        push(
          "error",
          e instanceof Error
            ? e.message
            : "Đổi mật khẩu thất bại",
        );
      } finally {
        setSaving(false);
      }
    };

  const startTwoFASetup =
    async () => {
      setTwoFAActionLoading(true);

      try {
        const res = await fetch(
          "/api/v1/users/2fa/setup",
          {
            method: "POST",
          },
        );

        const j = await res.json();

        if (!res.ok) {
          throw new Error(
            j.error ??
              "Không thể khởi tạo 2FA",
          );
        }

        setTwoFASetup(
          j.data as TwoFactorSetup,
        );

        setTwoFACode("");

        push(
          "success",
          "Đã tạo cấu hình 2FA. Hãy quét QR bằng ứng dụng Authenticator.",
        );
      } catch (e) {
        push(
          "error",
          e instanceof Error
            ? e.message
            : "Không thể khởi tạo 2FA",
        );
      } finally {
        setTwoFAActionLoading(false);
      }
    };

  const verifyTwoFA =
    async () => {
      const code =
        twoFACode
          .replace(/\s/g, "")
          .trim();

      if (!/^\d{6}$/.test(code)) {
        push(
          "error",
          "Mã xác thực phải gồm 6 chữ số",
        );
        return;
      }

      setTwoFAActionLoading(true);

      try {
        const res = await fetch(
          "/api/v1/users/2fa/verify",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              code,
            }),
          },
        );

        const j = await res.json();

        if (!res.ok) {
          throw new Error(
            j.error ??
              "Mã xác thực không đúng",
          );
        }

        setTwoFA(true);
        setTwoFASetup(null);
        setTwoFACode("");

        push(
          "success",
          "Đã bật xác thực hai lớp thành công.",
        );

        await loadSecurityData();
      } catch (e) {
        push(
          "error",
          e instanceof Error
            ? e.message
            : "Không thể xác nhận 2FA",
        );
      } finally {
        setTwoFAActionLoading(false);
      }
    };

  const disableTwoFA =
    async () => {
      const code =
        disableCode
          .replace(/\s/g, "")
          .trim();

      if (!/^\d{6}$/.test(code)) {
        push(
          "error",
          "Mã xác thực phải gồm 6 chữ số",
        );
        return;
      }

      setTwoFAActionLoading(true);

      try {
        const res = await fetch(
          "/api/v1/users/2fa/disable",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              code,
            }),
          },
        );

        const j = await res.json();

        if (!res.ok) {
          throw new Error(
            j.error ??
              "Không thể tắt 2FA",
          );
        }

        setTwoFA(false);
        setDisableCode("");
        setShowDisable(false);
        setTwoFASetup(null);

        push(
          "success",
          "Đã tắt xác thực hai lớp.",
        );

        await loadSecurityData();
      } catch (e) {
        push(
          "error",
          e instanceof Error
            ? e.message
            : "Không thể tắt 2FA",
        );
      } finally {
        setTwoFAActionLoading(false);
      }
    };

  return (
    <div className="space-y-5">
      <SettingsSection
        title="Đổi mật khẩu"
        description="Sau khi đổi mật khẩu, tất cả thiết bị khác sẽ tự động bị đăng xuất."
      >
        <Row
          label="Mật khẩu hiện tại"
          hint="Bỏ trống nếu tài khoản Google chưa đặt mật khẩu."
        >
          <TextInput
            type="password"
            value={current}
            onChange={(e) =>
              setCurrent(e.target.value)
            }
            placeholder="••••••"
            autoComplete="current-password"
          />
        </Row>

        <Row label="Mật khẩu mới">
          <TextInput
            type="password"
            value={next}
            onChange={(e) =>
              setNext(e.target.value)
            }
            placeholder="Tối thiểu 6 ký tự"
            autoComplete="new-password"
          />
        </Row>

        <Row label="Xác nhận mật khẩu mới">
          <TextInput
            type="password"
            value={confirm}
            onChange={(e) =>
              setConfirm(e.target.value)
            }
            placeholder="Nhập lại"
            autoComplete="new-password"
          />
        </Row>

        <div className="pt-2">
          <Button
            onClick={changePassword}
            loading={saving}
            disabled={
              !next || !confirm
            }
          >
            Cập nhật mật khẩu
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Xác thực hai lớp (2FA)"
        description="Bảo vệ tài khoản ORCA bằng mã xác thực 6 số từ ứng dụng Authenticator."
      >
        <Row label="Trạng thái 2FA">
          <div className="flex items-center gap-3">
            <Toggle
              checked={twoFA}
              disabled
              onChange={() => {}}
              label="2FA"
            />

            <Badge
              tone={
                twoFA
                  ? "good"
                  : "neutral"
              }
            >
              {twoFA
                ? "Đang bật"
                : "Chưa bật"}
            </Badge>
          </div>
        </Row>

        {!twoFA &&
          !twoFASetup && (
            <div className="rounded-lg border border-[#1a3558] bg-[#071a2c] p-4 space-y-3">
              <div className="text-sm text-slate-300">
                Khi bật 2FA, bạn sẽ sử dụng Google
                Authenticator, Microsoft Authenticator,
                Authy hoặc ứng dụng TOTP tương thích
                để tạo mã đăng nhập.
              </div>

              <Button
                onClick={startTwoFASetup}
                loading={
                  twoFAActionLoading
                }
              >
                Thiết lập 2FA
              </Button>
            </div>
          )}

        {!twoFA &&
          twoFASetup && (
            <div className="rounded-xl border border-[#1a3558] bg-[#071a2c] p-5 space-y-5">
              <div>
                <div className="text-base font-semibold text-white">
                  Bước 1 — Quét QR Code
                </div>

                <div className="text-xs text-slate-400 mt-1">
                  Mở ứng dụng Authenticator trên điện thoại
                  và quét mã QR bên dưới.
                </div>
              </div>

              <div className="flex justify-center">
                <div className="bg-white rounded-xl p-3">
                  <Image
                    src={twoFASetup.qrCodeDataUrl}
                    alt="QR Code thiết lập 2FA"
                    width={256}
                    height={256}
                    unoptimized
                    className="h-64 w-64"
                  />
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-400 mb-2">
                  Nếu không thể quét QR, nhập Secret thủ công:
                </div>

                <div className="rounded-lg border border-[#1a3558] bg-[#061525] p-3 font-mono text-xs text-[#00d4ff] break-all select-all">
                  {twoFASetup.secret}
                </div>
              </div>

              <div className="border-t border-[#1a3558] pt-5">
                <div className="text-base font-semibold text-white">
                  Bước 2 — Xác nhận mã
                </div>

                <div className="text-xs text-slate-400 mt-1 mb-3">
                  Nhập mã 6 số đang hiển thị trong ứng dụng Authenticator.
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <TextInput
                    value={twoFACode}
                    onChange={(e) =>
                      setTwoFACode(
                        e.target.value
                          .replace(
                            /\D/g,
                            "",
                          )
                          .slice(0, 6),
                      )
                    }
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    className="font-mono tracking-[0.35em]"
                  />

                  <Button
                    onClick={verifyTwoFA}
                    loading={
                      twoFAActionLoading
                    }
                    disabled={
                      twoFACode.length !==
                      6
                    }
                  >
                    Xác nhận & bật 2FA
                  </Button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setTwoFASetup(null);
                  setTwoFACode("");
                }}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                Hủy thiết lập
              </button>
            </div>
          )}

        {twoFA && (
          <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-4 space-y-4">
            <div className="text-sm text-emerald-300">
              ✓ Tài khoản đang được bảo vệ bằng 2FA.
            </div>

            {!showDisable ? (
              <button
                type="button"
                onClick={() =>
                  setShowDisable(true)
                }
                className="text-xs text-rose-400 hover:text-rose-300"
              >
                Tắt xác thực hai lớp
              </button>
            ) : (
              <div className="space-y-3">
                <div className="text-sm text-slate-300">
                  Nhập mã 2FA hiện tại để xác nhận tắt 2FA.
                </div>

                <TextInput
                  value={disableCode}
                  onChange={(e) =>
                    setDisableCode(
                      e.target.value
                        .replace(
                          /\D/g,
                          "",
                        )
                        .slice(0, 6),
                    )
                  }
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  className="font-mono tracking-[0.35em]"
                />

                <div className="flex gap-2">
                  <Button
                    onClick={disableTwoFA}
                    loading={
                      twoFAActionLoading
                    }
                    disabled={
                      disableCode.length !==
                      6
                    }
                  >
                    Xác nhận tắt 2FA
                  </Button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowDisable(
                        false,
                      );
                      setDisableCode("");
                    }}
                    className="px-4 py-2 text-xs text-slate-400 hover:text-white"
                  >
                    Hủy
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="text-[11px] text-slate-500 leading-relaxed">
          Secret TOTP được mã hóa trước khi lưu vào database.
          Mã xác thực thay đổi theo chu kỳ 30 giây.
        </div>
      </SettingsSection>

      <SettingsSection
        title="Nhật ký hoạt động"
        description="30 hoạt động bảo mật gần nhất trên tài khoản."
      >
        {logs.length === 0 ? (
          <div className="text-sm text-slate-500 italic py-4 text-center">
            Chưa có hoạt động nào được ghi nhận.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {logs.map((l) => (
              <div
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-[#1a3558]/70 bg-[#0a1d33]/50 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm text-slate-200">
                    {ACTION_LABELS[
                      l.action
                    ] ?? l.action}
                  </div>

                  <div className="text-[10px] font-mono text-slate-500 truncate">
                    {l.ipAddress ?? "—"} ·{" "}
                    {(l.userAgent ?? "").slice(
                      0,
                      48,
                    )}
                  </div>
                </div>

                <div className="text-[10px] font-mono text-slate-500 shrink-0">
                  {new Date(
                    l.createdAt,
                  ).toLocaleString(
                    "vi-VN",
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
