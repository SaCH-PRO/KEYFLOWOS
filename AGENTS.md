# Agent Guidance for KEYFLOWOS

## Launch Procedure (One Command)

When the user says "launch the app", "start dev", or similar, run:

```bash
bash scripts/launch-dev.sh
```

This handles port cleanup, stale-cache clearing, env guards, DB checks, build validation, and starts both servers.

**Ports:** API runs on `3001`, Web runs on `5000`.
**Bundler:** The launcher starts the web app with `--webpack` to avoid a recurring Next.js 16 + Turbopack cold-start crash (missing `routes-manifest.json` / `middleware-manifest.json` and SST compaction errors after a full `.next` wipe).
**If the script doesn't exist:** `pnpm dev` from repo root (but be aware of the gotchas below).

### Known Gotchas (already fixed — do not re-fix)
- `reflect-metadata` must be imported in `main.ts` before NestJS decorators evaluate. Already present.
- `KEYFLOW_DEV_AUTH_BYPASS=true` causes a fatal boot exit. The launcher unsets it.
- Missing module providers (e.g. `CrmCacheService`) have been registered in their respective modules.
- Circular module deps exist in the codebase but are handled via `forwardRef()`.
- **Business Genesis (Patch 1):** `BusinessBlueprint` now includes Genesis sections (legal, registration, tax, projections, risk, compliance, execution roadmap). `/app/onboarding` is the Genesis intake flow and feeds these sections into KEY's prompt context.

### Manual Recovery (if launcher fails)
```bash
# 1. Kill stale processes
npx kill-port 3001 5000

# 2. Clear stale caches (fixes Turbopack chunk/HMR crashes)
#    Do NOT wipe the whole apps/web/.next folder on Next.js 16; that triggers
#    the Turbopack cold-start manifest/SST bug.  Remove only the layers that
#    can actually go stale.
rm -rf .turbo/cache \
       apps/web/.next/dev \
       apps/web/.next/cache/turbopack
mkdir -p apps/web/.next/cache/webpack

# 3. Ensure DB is up
npx prisma migrate dev --schema packages/db/prisma/schema.prisma

# 4. Build check
cd apps/server && pnpm build && cd ../..

# 5. Launch with webpack dev (avoids the Turbopack cold-start bug)
cd apps/web && pnpm dev --webpack
# In another terminal:
cd apps/server && pnpm dev
```

## Repository Hygiene

### `.turbo/cache/` — NEVER COMMIT
The `.turbo/cache/` directory contains `*.tar.zst` files that routinely exceed GitHub's 100MB file-size limit. If these are accidentally committed, the push to `origin` will fail.

**Prevention:**
- `.turbo/cache/` is already in `.gitignore`.

**Recovery (if already committed):**
```bash
git rm --cached -r .turbo/cache/
git commit --amend --no-edit
```

## Environment

- **Node:** 20.x (see `.nvmrc`)
- **Package Manager:** pnpm 9.15.0
- **Monorepo:** pnpm workspaces with Turborepo

## Key Conventions

- **Server:** NestJS (`apps/server/`). Use `vitest` for tests.
- **Web:** Next.js App Router (`apps/web/`). Prefer Server Components; mark Client Components with `"use client"` only when necessary.
- **Database:** PostgreSQL via Prisma (`packages/db/`).
- **Auth:** Dual stack — Supabase JWT (primary) and local HMAC-JWT admin tokens (fallback in `AuthMiddleware`).
