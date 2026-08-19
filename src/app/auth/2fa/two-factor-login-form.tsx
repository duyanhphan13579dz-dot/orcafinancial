"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import Link from "next/link";

import {
  useAuth,
} from "@/lib/auth/context";

export default function TwoFactorLoginForm() {
  const router = useRouter();

  const {
    refreshUser,
    isLoggedIn,
    loading: authLoading,
  } = useAuth();

  const [code, setCode] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  useEffect(() => {
    /*
     * If somehow a full session already exists,
     * do not leave the user on the challenge page.
     */
    if (
      !authLoading &&
      isLoggedIn
    ) {
      router.replace("/");
    }
  }, [
    authLoading,
    isLoggedIn,
    router,
  ]);

  const submit = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    const normalized =
      code
        .replace(/\D/g, "")
        .slice(0, 6);

    if (
      normalized.length !== 6
    ) {
      setError(
        "Vui lòng nhập mã 6 chữ số.",
      );
      return;
    }

    setError("");
    setLoading(true);

    try {
      const response =
        await fetch(
          "/api/v1/auth/2fa/verify-login",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            credentials:
              "include",
            body: JSON.stringify({
              code: normalized,
            }),
          },
        );

      const json =
        await response.json();

      if (!response.ok) {
        throw new Error(
          json.error ??
            "Mã xác thực không đúng.",
        );
      }

      await refreshUser();

      router.replace("/");
      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Xác thực 2FA thất bại.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md panel p-8">

        <div className="text-center mb-8">

          <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-[#00d4ff] to-[#0073a8] flex items-center justify-center text-2xl mx-auto mb-4">
            🔐
          </div>

          <h1 className="text-2xl font-bold text-white">
            Xác thực hai lớp
          </h1>

          <p className="text-sm text-slate-400 mt-2">
            Tài khoản của bạn đã bật 2FA.
            Nhập mã từ ứng dụng Authenticator
            để hoàn tất đăng nhập.
          </p>

        </div>

        {error && (
          <div className="mb-5 p-3 rounded-lg bg-rose-950/30 border border-rose-700 text-sm text-rose-300">
            {error}
          </div>
        )}

        <form
          onSubmit={submit}
          className="space-y-5"
        >
          <div>
            <label className="block text-sm text-slate-300 mb-2">
              Mã Authenticator
            </label>

            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(event) => {
                setCode(
                  event.target.value
                    .replace(/\D/g, "")
                    .slice(0, 6),
                );
              }}
              placeholder="000000"
              className="w-full bg-[#0e2e4f] border border-[#1a3558] rounded-lg px-4 py-4 text-white text-center text-2xl tracking-[0.45em] font-mono focus:border-[#00d4ff] focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={
              loading ||
              code.length !== 6
            }
            className="w-full btn-orca py-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? "Đang xác thực..."
              : "Xác nhận & đăng nhập"}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-[#1a3558] text-center">
          <Link
            href="/auth/login"
            className="text-sm text-slate-500 hover:text-slate-300"
          >
            ← Quay lại đăng nhập
          </Link>
        </div>

      </div>
    </div>
  );
}
