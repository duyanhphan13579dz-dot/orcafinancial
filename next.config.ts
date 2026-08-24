import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Removes the `X-Powered-By: Next.js` response header (saves a few bytes
  // per response and avoids leaking framework info).
  poweredByHeader: false,

  // Gzip/Brotli-compress responses at the Node server level. No-op on
  // platforms that already compress at the edge (e.g. Vercel), but a real
  // win on self-hosted Docker deployments (see docker-compose.yml).
  compress: true,

  // Tree-shakes these libraries down to only the submodules actually
  // imported, instead of bundling the whole package. `recharts` and
  // `lightweight-charts` are the two heaviest client deps in this repo
  // (candle-chart.tsx, fundamental-charts.tsx, financial-health-detail.tsx)
  // and are currently imported barrel-style with no code-splitting.
  experimental: {
    optimizePackageImports: ["recharts", "lightweight-charts"],
  },

  images: {
    // Crypto/company logos and user avatars are loaded from external CDNs.
    // coingecko: crypto logos (crypto/page.tsx, crypto/[symbol]/page.tsx).
    // googleusercontent: Google OAuth profile pictures (UserMenu,
    // settings/AccountPanel) — added so those two now use next/image too.
    //
    // Deliberately NOT whitelisting news RSS image hosts (CafeF/Vietstock/
    // VnExpress) here: those imageUrl values come straight from whatever
    // <img> tag each RSS article embeds, so the actual CDN host varies per
    // article and isn't a small fixed set — next/image 400s on any host
    // not listed here, so DashboardHome's and news/page.tsx's news
    // thumbnails intentionally stay plain <img> until the real CDN
    // hostnames in use are confirmed from production data.
    remotePatterns: [
      { protocol: "https", hostname: "**.coingecko.com" },
      { protocol: "https", hostname: "**.githubusercontent.com" },
      { protocol: "https", hostname: "**.googleusercontent.com" },
    ],
    formats: ["image/avif", "image/webp"],
  },

  // Long-cache the immutable Next.js build output (hashed filenames) and
  // the service worker; API responses are handled per-route (see
  // src/lib/api.ts) since their cacheability varies by endpoint.
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
