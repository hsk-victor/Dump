import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@xeet/core"],
  devIndicators: false,
};

export default nextConfig;
