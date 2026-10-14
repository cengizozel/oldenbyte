import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // No X-Powered-By: Next.js header.
  poweredByHeader: false,
  // The app never uses next/image, so turn the optimizer off: /_next/image
  // is otherwise an unauthenticated endpoint with its own CVE history.
  images: { unoptimized: true },
  // Baseline protective headers for every response: no MIME sniffing (a
  // proxied or uploaded body is only ever treated as its declared type), no
  // framing by other sites, no plugins, no <base> or form-target hijacking, and
  // no full URLs leaked as Referer.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
          },
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
