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
      // Wildcard hosts so any Replit preview URL works on mobile devices
      // without "Invalid Host" errors (ported from develop e91d037a).
      "*.replit.dev",
      "*.worf.replit.dev",
      "*.repl.co",
      "127.0.0.1",
      "localhost",
    ]),
  );
}

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // `@keyflow/ui` is a workspace package whose package.json `exports` already
  // points at its TypeScript source. `transpilePackages` is sufficient on its
  // own to consume it. Do NOT add a `turbopack.resolveAlias` entry for it —
  // a relative alias is resolved per-importer by Turbopack and will duplicate
  // the module graph, which causes the recurring "module factory is not
  // available" HMR error on Next 16 + React 19. See apps/web/README.md
  // (Troubleshooting → Turbopack HMR) and Task #226 for the full root cause.
  transpilePackages: ["@keyflow/ui"],
  turbopack: {
    root: repoRoot,
  },
  allowedDevOrigins: buildAllowedDevOrigins(),
  /**
   * Same-origin API proxy. Browsers running inside an iframe / behind a
   * preview proxy (Replit dev domain, ngrok, custom hosting) cannot
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
      ];
    }

    // Dev: do NOT override Cache-Control on /_next/static — Next.js owns
    // those headers for HMR module identity, and overriding them prints
    // "Custom Cache-Control headers detected" and destabilizes Turbopack
    // (workspace-root inference fails on the next config-change restart).
    // Apply no-cache only to non-static routes so iframe previews see
    // fresh code without breaking the dev pipeline.
    return [
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
