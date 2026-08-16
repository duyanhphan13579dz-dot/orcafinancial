"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { useAuth } from "@/lib/auth/context";

export default function LoginPage() {
  const router = useRouter();
  const { refreshUser, isLoggedIn, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Already signed in? Skip the form entirely.
  useEffect(() => {
    if (!authLoading && isLoggedIn) router.replace("/");
  }, [authLoading, isLoggedIn, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await api("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      // Pull the new session into AuthProvider BEFORE navigating, otherwise
      // protected pages would still see isLoggedIn === false and bounce us
      // back to the login prompt.
      await refreshUser();
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đăng nhập thất bại");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md panel p-8">
        <div className="text-center mb-8">
          <div className="h-12 w-12 rounded bg-gradient-to-br from-[#00d4ff] to-[#0073a8] flex items-center justify-center text-2xl mx-auto mb-3">🐋</div>
          <h1 className="text-2xl font-bold text-white">Đăng nhập</h1>
          <p className="text-sm text-slate-400 mt-1">Chào mừng trở lại với ORCA FINANCIAL</p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded bg-rose-950/30 border border-rose-700 text-sm text-rose-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[#0e2e4f] border border-[#1a3558] rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:border-[#00d4ff] focus:outline-none min-h-[44px]"
              placeholder="your@email.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Mật khẩu</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[#0e2e4f] border border-[#1a3558] rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:border-[#00d4ff] focus:outline-none min-h-[44px]"
              placeholder="••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-orca py-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-400">
          Chưa có tài khoản?{" "}
          <Link href="/auth/register" className="text-[#00d4ff] hover:underline">
            Đăng ký
          </Link>
        </div>

        <div className="mt-6 pt-6 border-t border-[#1a3558] text-center">
          <Link href="/" className="text-xs text-slate-500 hover:text-slate-300">
            ← Quay lại trang chủ
          </Link>
        </div>
      </div>
    </div>
  );
}
