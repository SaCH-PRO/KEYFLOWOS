import path from "node:path";
import { existsSync } from "node:fs";
import type { NextConfig } from "next";
import { ensureValidWebEnv } from "./src/lib/env";

const repoRoot = path.resolve(__dirname, "../../");

// Next.js loads .env files itself, but only AFTER next.config.ts is
// evaluated. Manually preload the repo-root .env(s) so the env validator
// below sees them. Best-effort: never throw if dotenv isn't installed.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dotenv = require("dotenv");
  for (const p of [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(__dirname, ".env.local"),
    path.join(__dirname, ".env"),
  ]) {
    if (existsSync(p)) {
      dotenv.config({ path: p, override: false });
    }
  }
} catch {
  // dotenv missing — Next.js will still load .env at runtime; the in-app
  // server-side validator (apps/web/src/app/api/healthz/route.ts) will
  // surface any problems then.
}

// Fail fast on missing/malformed env at build time. Skipped for `next lint`
// or other tooling that doesn't actually serve traffic via env-skip flag.
ensureValidWebEnv(process.env);

/**
 * Allowed dev origins for Next.js' anti-CSRF in dev mode.
 * Reads `NEXT_PUBLIC_DEV_ORIGINS` (comma-separated host names) so developers
 * can add their own tunnel domains (ngrok, cloudflare, etc.) without editing
 * this file. Localhost is always permitted.
 */
function buildAllowedDevOrigins(): string[] {
  const fromEnv = (process.env.NEXT_PUBLIC_DEV_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return Array.from(
    new Set([
      ...fromEnv,
      "127.0.0.1",
      "localhost",
    ]),
  );
}

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  output: "standalone",
  // `@keyflow/ui` is a workspace package whose package.json `exports` already
  // points at its TypeScript source. `transpilePackages` is sufficient on its
  // own to consume it. Do NOT add a `turbopack.resolveAlias` entry for it —
  // a relative alias is resolved per-importer by Turbopack and will duplicate
  // the module graph, which causes the recurring "module factory is not
  // available" HMR error on Next 16 + React 19. See apps/web/README.md
  // (Troubleshooting → Turbopack HMR) and Task #226 for the full root cause.
  transpilePackages: ["@keyflow/ui", "@keyflow/shared"],
  turbopack: {
    root: repoRoot,
  },
  allowedDevOrigins: buildAllowedDevOrigins(),
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "sonner",
      "recharts",
      "@tiptap/starter-kit",
      "@tiptap/react",
      "@tiptap/extension-underline",
      "@tiptap/extension-link",
      "@tiptap/extension-text-align",
      "@tiptap/extension-placeholder",
    ],
  },
  /**
   * Same-origin API proxy. Browsers running inside an iframe / behind a
   * preview proxy (ngrok, custom hosting) cannot
   * reach `http://localhost:3001` directly because "localhost" resolves
   * to the *user's* machine, not the dev container. We rewrite every
   * request hitting `/__api/*` on the Next dev/prod server through to
   * the NestJS backend so the client only ever issues same-origin
   * requests. The browser bundle then sets `NEXT_PUBLIC_API_BASE_URL=/__api`
   * (see `apps/web` workflow command + `.env.example`) and stays
   * host-agnostic.
   *
   * The upstream is read from `KEYFLOW_API_INTERNAL_URL` so deploys
   * with a side-car backend on a different host can override it; falls
   * back to localhost:3001 for the standard local dev setup.
   */
  async redirects() {
    // KEYFLOW unification (Task #292): the legacy "Control Tower" surface
    // is now the KEY mainstay dashboard at /app/keyflow-command. Permanent
    // 308 so external links and bookmarks survive.
    return [
      {
        source: "/app/control-tower",
        destination: "/app/keyflow-command",
        permanent: true,
      },
      {
        source: "/app/control-tower/:path*",
        destination: "/app/keyflow-command",
        permanent: true,
      },
      {
        source: "/app/payments",
        destination: "/app/commerce?tab=payments",
        permanent: true,
      },
      {
        source: "/app/payments/:path*",
        destination: "/app/commerce?tab=payments",
        permanent: true,
      },
      // Financial Flow unification: old finance cockpit sub-routes now live
      // under their own top-level Financial Flow pages.
      {
        source: "/app/finance/revenue",
        destination: "/app/commerce",
        permanent: true,
      },
      {
        source: "/app/finance/revenue/:path*",
        destination: "/app/commerce",
        permanent: true,
      },
      {
        source: "/app/finance/expenses",
        destination: "/app/expenses",
        permanent: true,
      },
      {
        source: "/app/finance/expenses/:path*",
        destination: "/app/expenses",
        permanent: true,
      },
      {
        source: "/app/finance/reports",
        destination: "/app/reports",
        permanent: true,
      },
      {
        source: "/app/finance/reports/:path*",
        destination: "/app/reports",
        permanent: true,
      },
      {
        source: "/app/finance/actions",
        destination: "/app/money",
        permanent: true,
      },
      {
        source: "/app/finance/actions/:path*",
        destination: "/app/money",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    const upstream = process.env.KEYFLOW_API_INTERNAL_URL?.trim() || "http://localhost:3001";
    return [
      {
        source: "/__api/:path*",
        destination: `${upstream}/:path*`,
      },
    ];
  },
  async headers() {
    const securityHeaders = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];

    // Production: long-cache /_next/static so repeat-visit performance
    // doesn't regress (ported from develop 1c7e6f93).
    if (isProd) {
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
          source: "/(.*)",
          headers: securityHeaders,
        },
      ];
    }

    // Dev: do NOT override Cache-Control on /_next/static — Next.js owns
    // those headers for HMR module identity, and overriding them prints
    // "Custom Cache-Control headers detected" and destabilizes Turbopack.
    return [
      {
        source: "/((?!_next/static).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          ...securityHeaders,
        ],
      },
    ];
  },
};

export default nextConfig;
