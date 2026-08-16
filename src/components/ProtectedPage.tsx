"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth/context";

interface ProtectedPageProps {
  children: React.ReactNode;
  featureName?: string;
}

export function ProtectedPage({ children, featureName = "tính năng này" }: ProtectedPageProps) {
  const { isLoggedIn, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 border-2 border-[#00d4ff] border-t-transparent rounded-full animate-spin" />
          <div className="mt-3 text-slate-400 text-sm">Đang kiểm tra đăng nhập...</div>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="panel p-8 max-w-md w-full text-center">
          <div className="h-16 w-16 rounded-full bg-[#00d4ff]/10 flex items-center justify-center text-3xl mx-auto mb-4">🔐</div>
          <h2 className="text-xl font-bold text-white">Yêu cầu đăng nhập</h2>
          <p className="text-slate-400 mt-3 text-sm">
            Bạn cần đăng nhập để xem {featureName}. Vui lòng đăng nhập hoặc đăng ký tài khoản để tiếp tục.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Link href="/auth/login" className="btn-orca py-3">
              Đăng nhập
            </Link>
            <Link href="/auth/register" className="btn-orca-outline py-3">
              Đăng ký miễn phí
            </Link>
            <Link href="/" className="text-xs text-slate-500 hover:text-slate-300 mt-2">
              ← Quay lại trang chủ
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
