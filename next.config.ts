import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    proxyClientMaxBodySize: 100 * 1024 * 1024, // 100MB
  },
};

export default nextConfig;
