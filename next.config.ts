import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@xeet/core"],
  devIndicators: false,
  // The desktop app ships the self-contained standalone server (desktop/scripts/stage-server.mjs).
  output: process.env.DUMP_STANDALONE ? "standalone" : undefined,
};

export default nextConfig;
