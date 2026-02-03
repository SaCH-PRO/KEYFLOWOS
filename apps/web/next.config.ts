import path from "node:path";
import type { NextConfig } from "next";

const repoRoot = path.resolve(__dirname, "../../");

const nextConfig: NextConfig = {
  transpilePackages: ["@keyflow/ui"],
  turbopack: {
    root: repoRoot,
    resolveAlias: {
      "@keyflow/ui": "../../packages/ui/src/index.ts",
    },
  },
  allowedDevOrigins: ["d9c92da4-0dde-44b6-a1ad-551bf4dfbe2c-00-39zpddgeqea4v.worf.replit.dev", "127.0.0.1", "localhost"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
