import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { SearchBar } from "@/components/search-bar";
import { MobileHeader, MobileBottomNav } from "@/components/MobileNav";
import { DesktopNav } from "@/components/DesktopNav";
import { NavigationProgress } from "@/components/NavigationProgress";
import { UserMenu } from "@/components/UserMenu";
import { AppearanceLoader } from "@/components/AppearanceLoader";
import { AuthProvider } from "@/lib/auth/context";
import "./globals.css";

const display = Bricolage_Grotesque({
  weight: ["400", "600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

const sans = Inter({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const mono = JetBrains_Mono({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

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
          <NavigationProgress />
          <MobileHeader />

          <header className="hidden lg:block sticky top-0 z-40 border-b border-[#1a3558] bg-[#0A2540]/98 backdrop-blur-md">
            <div className="mx-auto max-w-7xl px-4">
              <div className="flex items-center gap-4 py-2.5 min-w-0">
                <Link
                  href="/"
                  prefetch
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

              <DesktopNav />
            </div>
          </header>

          <main className="mx-auto max-w-7xl w-full min-w-0 px-3 sm:px-4 py-4 md:py-6 overflow-x-hidden contain-layout">
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
        </AuthProvider>
      </body>
    </html>
  );
}
