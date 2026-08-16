import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // instrumentation.ts is stable in Next 15+, but keep the flag on for
  // older minor versions / build environments that still gate it.
  experimental: {
    instrumentationHook: true,
  } as NextConfig["experimental"],
};

export default nextConfig;
