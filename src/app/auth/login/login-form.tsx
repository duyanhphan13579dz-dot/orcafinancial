"use client";

import {
  useEffect,
  useState,
} from "react";

import Link from "next/link";
import {
  useRouter,
  useSearchParams,
} from "next/navigation";

import { api } from "@/lib/client";
import { useAuth } from "@/lib/auth/context";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const {
    refreshUser,
    isLoggedIn,
    loading: authLoading,
  } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState("");

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] =
    useState(false);

  /*
   * Already signed in?
   */
  useEffect(() => {
    if (!authLoading && isLoggedIn) {
      router.replace("/");
    }
  }, [
    authLoading,
    isLoggedIn,
    router,
  ]);

  /*
   * Read OAuth error returned from
   * /api/v1/auth/google/callback
   */
  useEffect(() => {
    const oauthError =
      searchParams.get("error");

    if (oauthError) {
      try {
        setError(
          decodeURIComponent(oauthError),
        );
      } catch {
        setError(oauthError);
      }
    }
  }, [searchParams]);

  /*
   * Email / password login
   */
  const handleSubmit = async (
    e: React.FormEvent<HTMLFormElement>,
  ) => {
    e.preventDefault();

    setError("");
    setLoading(true);

    try {
      await api("/auth/login", {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      /*
       * Pull the new session into AuthProvider
       * BEFORE navigating.
       */
      await refreshUser();

      router.push("/");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Đăng nhập thất bại",
      );
    } finally {
      setLoading(false);
    }
  };

  /*
   * Google OAuth login
   */
  const handleGoogleLogin = () => {
    if (loading || googleLoading) {
      return;
    }

    setError("");
    setGoogleLoading(true);

    /*
     * Browser navigation is intentional.
     *
     * The server creates the signed OAuth state,
     * stores it in an httpOnly cookie,
     * then redirects to Google.
     */
    window.location.href =
      "/api/v1/auth/google?mode=login";
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md panel p-8">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="h-12 w-12 rounded bg-gradient-to-br from-[#00d4ff] to-[#0073a8] flex items-center justify-center text-2xl mx-auto mb-3">
            🐋
          </div>

          <h1 className="text-2xl font-bold text-white">
            Đăng nhập
          </h1>

          <p className="text-sm text-slate-400 mt-1">
            Chào mừng trở lại với ORCA
            FINANCIAL
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded bg-rose-950/30 border border-rose-700 text-sm text-rose-300">
            {error}
          </div>
        )}

        {/* Google */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={
            loading || googleLoading
          }
          className="w-full flex items-center justify-center gap-3 rounded-lg border border-[#1a3558] bg-white text-slate-800 font-semibold py-3 min-h-[48px] hover:bg-slate-100 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {googleLoading ? (
            <>
              <span className="h-5 w-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />

              Đang kết nối Google...
            </>
          ) : (
            <>
              <span className="text-lg font-bold">
                G
              </span>

              Tiếp tục với Google
            </>
          )}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 my-6">
          <div className="h-px flex-1 bg-[#1a3558]" />

          <span className="text-xs text-slate-500">
            HOẶC
          </span>

          <div className="h-px flex-1 bg-[#1a3558]" />
        </div>

        {/* Email / password */}
        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >
          {/* Email */}
          <div>
            <label className="block text-sm text-slate-300 mb-1">
              Email
            </label>

            <input
              type="email"
              value={email}
              onChange={(e) =>
                setEmail(e.target.value)
              }
              className="w-full bg-[#0e2e4f] border border-[#1a3558] rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:border-[#00d4ff] focus:outline-none min-h-[44px]"
              placeholder="your@email.com"
              autoComplete="email"
              required
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm text-slate-300 mb-1">
              Mật khẩu
            </label>

            <input
              type="password"
              value={password}
              onChange={(e) =>
                setPassword(e.target.value)
              }
              className="w-full bg-[#0e2e4f] border border-[#1a3558] rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:border-[#00d4ff] focus:outline-none min-h-[44px]"
              placeholder="••••••"
              autoComplete="current-password"
              required
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={
              loading || googleLoading
            }
            className="w-full btn-orca py-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? "Đang đăng nhập..."
              : "Đăng nhập"}
          </button>
        </form>

        {/* Register */}
        <div className="mt-6 text-center text-sm text-slate-400">
          Chưa có tài khoản?{" "}

          <Link
            href="/auth/register"
            className="text-[#00d4ff] hover:underline"
          >
            Đăng ký
          </Link>
        </div>

        {/* Back */}
        <div className="mt-6 pt-6 border-t border-[#1a3558] text-center">
          <Link
            href="/"
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            ← Quay lại trang chủ
          </Link>
        </div>
      </div>
    </div>
  );
}
