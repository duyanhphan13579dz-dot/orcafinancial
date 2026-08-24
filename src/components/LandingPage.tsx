import Link from "next/link";

const FEATURES = [
  { icon: "🔍", title: "Bộ lọc cổ phiếu", desc: "CANSLIM, Minervini, Wyckoff, Elliott Wave với ngưỡng điểm tùy chỉnh" },
  { icon: "📦", title: "Hàng hóa", desc: "31 loại hàng hóa ảnh hưởng thị trường Việt Nam, quy đổi VND" },
  { icon: "📰", title: "Báo cáo tự động", desc: "Morning Brief 07:30 & Market Summary 15:15 mỗi ngày giao dịch" },
  { icon: "🤖", title: "AI Agent", desc: "Phân tích thông minh, chỉ dùng dữ liệu thật từ Data Engine" },
  { icon: "📊", title: "Phân tích kỹ thuật", desc: "RSI, MACD, mẫu hình nến, vùng hỗ trợ/kháng cự" },
  { icon: "🩺", title: "Sức khỏe tài chính", desc: "Chấm điểm 6 trụ cột, DuPont, DCF, Graham Number" },
];

/**
 * Marketing landing page for logged-out visitors.
 *
 * Server-rendered (no "use client", no hooks) so it can be returned
 * directly from the `/` Server Component without a client round-trip —
 * see src/app/page.tsx for the auth branch that picks this vs DashboardHome.
 */
export function LandingPage() {
  return (
    <div className="-mx-4">
      {/* Hero */}
      <section className="relative overflow-hidden px-4 py-16 md:py-28">
        <div className="absolute inset-0 bg-gradient-to-br from-[#00d4ff]/10 via-transparent to-[#0073a8]/10" />
        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#00d4ff]/10 border border-[#00d4ff]/30 text-[#00d4ff] text-xs md:text-sm font-medium mb-6">
            🐋 ORCA FINANCIAL
          </div>
          <h1 className="display-xl text-4xl md:text-6xl lg:text-7xl text-white leading-tight">
            Intelligent
            <span className="text-[#00d4ff]"> Investment</span>
          </h1>
          <p className="mt-5 md:mt-6 text-base md:text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Nền tảng phân tích tài chính AI với dữ liệu thị trường thật, bộ lọc cổ phiếu chuyên sâu và báo cáo tự động
            hàng ngày.
          </p>
          <div className="mt-8 md:mt-10 flex flex-col sm:flex-row justify-center gap-3">
            <Link
              href="/auth/register"
              className="rounded-lg bg-gradient-to-r from-[#00d4ff] to-[#0073a8] px-8 py-4 text-base font-bold text-[#0A2540] active:scale-95 transition-transform min-h-[44px] flex items-center justify-center"
            >
              Đăng ký miễn phí →
            </Link>
            <Link
              href="/auth/login"
              className="rounded-lg border border-[#00d4ff] px-8 py-4 text-base font-semibold text-[#00d4ff] hover:bg-[#00d4ff]/10 transition-colors min-h-[44px] flex items-center justify-center"
            >
              Đăng nhập
            </Link>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Cần tài khoản để xem dữ liệu chi tiết: tổng quan, hàng hóa, báo cáo, bộ lọc, tin tức và AI Agent.
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="px-4 py-14 md:py-20 bg-[#0e2e4f]/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10 md:mb-14">
            <h2 className="font-display text-2xl md:text-4xl font-bold text-white">Tính năng nổi bật</h2>
            <p className="mt-3 text-slate-400 max-w-2xl mx-auto text-sm md:text-base">
              Tất cả công cụ bạn cần để ra quyết định đầu tư thông minh
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="panel p-5 md:p-6 hover:border-[#00d4ff]/50 transition-all group">
                <div className="text-3xl md:text-4xl mb-3">{f.icon}</div>
                <h3 className="text-lg font-bold text-white group-hover:text-[#00d4ff] transition-colors">{f.title}</h3>
                <p className="mt-2 text-sm text-slate-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 py-14 md:py-20">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-display text-2xl md:text-4xl font-bold text-white">Sẵn sàng bắt đầu?</h2>
          <p className="mt-3 text-slate-400 text-sm md:text-lg">
            Đăng ký để mở khóa toàn bộ nội dung phân tích chuyên sâu
          </p>
          <div className="mt-7">
            <Link
              href="/auth/register"
              className="inline-flex rounded-lg bg-gradient-to-r from-[#00d4ff] to-[#0073a8] px-8 py-4 text-base font-bold text-[#0A2540] active:scale-95 transition-transform min-h-[44px] items-center justify-center"
            >
              Tạo tài khoản miễn phí
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
