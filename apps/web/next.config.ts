import path from "node:path";
import type { NextConfig } from "next";

const repoRoot = path.resolve(__dirname, "../../");

/**
 * Allowed dev origins for Next.js' anti-CSRF in dev mode.
 * Reads `NEXT_PUBLIC_DEV_ORIGINS` (comma-separated host names) so the same
 * codebase works on Replit, plain localhost, Docker, or any custom proxy
 * without editing this file. The Replit dev domain is auto-included if set.
 */
function buildAllowedDevOrigins(): string[] {
  const fromEnv = (process.env.NEXT_PUBLIC_DEV_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const replitDev = process.env.REPLIT_DEV_DOMAIN?.trim();

  return Array.from(
    new Set([
      ...fromEnv,
      ...(replitDev ? [replitDev] : []),
      "127.0.0.1",
      "localhost",
    ]),
  );
}

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  transpilePackages: ["@keyflow/ui"],
  turbopack: {
    root: repoRoot,
    resolveAlias: {
      "@keyflow/ui": "../../packages/ui/src/index.ts",
    },
  },
  allowedDevOrigins: buildAllowedDevOrigins(),
  async headers() {
    if (isProd) {
      return [];
    }
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
