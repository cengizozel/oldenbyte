import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Baseline protective headers for every response: no MIME sniffing (a
  // proxied or uploaded body is only ever treated as its declared type), no
  // framing by other sites, and no full URLs leaked as Referer.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  experimental: {
    proxyClientMaxBodySize: 100 * 1024 * 1024, // 100MB
  },
};

export default nextConfig;
