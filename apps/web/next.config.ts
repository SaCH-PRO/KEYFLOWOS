import path from "node:path";
import type { NextConfig } from "next";

const repoRoot = path.resolve(__dirname, "../../");
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const backendProxyTarget = process.env.BACKEND_PROXY_TARGET ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  transpilePackages: ["@keyflow/ui"],
  env: {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
  },
  turbopack: {
    root: repoRoot,
    resolveAlias: {
      "@keyflow/ui": "../../packages/ui/src/index.ts",
    },
  },
  allowedDevOrigins: [
    "*.tunnelmole.net",
    "*.replit.dev",
    "*.worf.replit.dev",
    "*.repl.co",
    "d9c92da4-0dde-44b6-a1ad-551bf4dfbe2c-00-39zpddgeqea4v.worf.replit.dev",
    "nn0a4a-ip-18-216-70-93.tunnelmole.net",
    "127.0.0.1",
    "localhost",
  ],
  async rewrites() {
    return [
      {
        source: "/backend/:path*",
        destination: `${backendProxyTarget}/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/_next/static/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/((?!_next/static).*)",
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
