import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SearchBar } from "@/components/search-bar";
import { MobileHeader, MobileBottomNav } from "@/components/MobileNav";
import { UserMenu } from "@/components/UserMenu";
import { AppearanceLoader } from "@/components/AppearanceLoader";
import { OrcaAiChatWidget } from "@/components/OrcaAiChatWidget";
import { AuthProvider } from "@/lib/auth/context";
import "./globals.css";

const display = { variable: "--font-display" };
const sans = { variable: "--font-sans" };
const mono = { variable: "--font-mono" };

export const metadata: Metadata = {
  title: "ORCA FINANCIAL — Nền tảng đầu tư thông minh",
  description:
    "Nền tảng phân tích tài chính AI — dữ liệu thị trường thật (VNDirect, Yahoo, CoinGecko, RSS), phân tích kỹ thuật, cơ bản, SWOT và trợ lý AI.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: "#0A2540",
  viewportFit: "cover",
};

const NAV = [
  { href: "/", label: "Tổng quan" },
  { href: "/heatmap", label: "Bản đồ nhiệt" },
  { href: "/sector-board", label: "Ngành" },
  { href: "/commodities", label: "Hàng hóa" },
  { href: "/crypto", label: "Crypto" },
  { href: "/forex", label: "Forex" },
  { href: "/reports", label: "Báo cáo" },
  { href: "/screener", label: "Bộ lọc" },
  { href: "/news", label: "Tin tức" },
  { href: "/watchlist", label: "Theo dõi" },
  { href: "/system", label: "Hệ thống" },
  { href: "/settings", label: "Cài đặt" },
];

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html
      lang="vi"
      className={`${display.variable} ${sans.variable} ${mono.variable} overflow-x-hidden`}
    >
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&family=JetBrains+Mono:ital,wght@0,400;0,500;0,700;1,400&display=swap"
          rel="stylesheet"
        />
      </head>

      <body className="antialiased min-h-screen overflow-x-hidden pb-20 lg:pb-0">
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[1] opacity-[0.035] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
          }}
        />

        <AuthProvider>
          <AppearanceLoader />
          <MobileHeader />

          <header className="hidden lg:block sticky top-0 z-40 border-b border-[#1a3558] bg-[#0A2540]/98 backdrop-blur-md">
            <div className="mx-auto max-w-7xl px-4">
              <div className="flex items-center gap-4 py-2.5 min-w-0">
                <Link
                  href="/"
                  className="flex items-center gap-3 shrink-0 group"
                >
                  <div className="relative h-8 w-8 rounded-md bg-gradient-to-br from-[#00d4ff] to-[#0073a8] flex items-center justify-center font-black text-[#0A2540] text-sm shadow-[0_0_12px_rgba(0,212,255,0.4)] group-hover:shadow-[0_0_20px_rgba(0,212,255,0.7)] transition-shadow">
                    🐋
                  </div>

                  <div className="leading-tight">
                    <div className="font-display font-extrabold tracking-tight text-base text-white">
                      ORCA
                      <span className="text-[#00d4ff]">FINANCIAL</span>
                    </div>
                    <div className="font-mono text-[9px] tracking-[0.25em] text-[#7aa8d4] uppercase italic">
                      Đầu tư thông minh
                    </div>
                  </div>
                </Link>

                <div className="flex-1 min-w-0 max-w-xl mx-auto">
                  <SearchBar />
                </div>

                <div className="shrink-0 relative z-50">
                  <UserMenu />
                </div>
              </div>

              <nav className="flex items-center gap-1 xl:gap-2 text-sm text-slate-400 font-display border-t border-[#1a3558]/60 -mx-4 px-4 overflow-x-auto scrollbar-hide">
                {NAV.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    className="relative shrink-0 whitespace-nowrap px-2.5 py-2 hover:text-[#00d4ff] transition-colors after:content-[''] after:absolute after:left-2.5 after:right-2.5 after:bottom-0 after:h-0.5 after:bg-[#00d4ff] after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:origin-left"
                  >
                    {n.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>

          <main className="mx-auto max-w-7xl w-full min-w-0 px-3 sm:px-4 py-4 md:py-6 overflow-x-hidden">
            {children}
          </main>

          <footer className="hidden lg:block mx-auto max-w-7xl px-4 py-6 text-xs text-slate-500 border-t border-[#1a3558]/60">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div className="font-display">
                © 2026{" "}
                <span className="text-white font-bold tracking-wide">
                  ORCA FINANCIAL
                </span>{" "}
                —{" "}
                <span className="italic font-mono text-[#7aa8d4]">
                  Đầu tư thông minh
                </span>
              </div>

            </div>
          </footer>

          <MobileBottomNav />
          <OrcaAiChatWidget />
        </AuthProvider>
      </body>
    </html>
  );
}
