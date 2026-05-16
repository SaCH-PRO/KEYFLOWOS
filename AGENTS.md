# Agent Guidance for KEYFLOWOS

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
