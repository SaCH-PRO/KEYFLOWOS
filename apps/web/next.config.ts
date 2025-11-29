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
};

export default nextConfig;
