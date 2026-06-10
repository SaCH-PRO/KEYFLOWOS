# Agent Guidance for KEYFLOWOS

## Launch Procedure (One Command)

When the user says "launch the app", "start dev", or similar, run:

```bash
bash scripts/launch-dev.sh
```

This handles port cleanup, env guards, DB checks, build validation, and starts both servers.

**Ports:** API runs on `3001`, Web runs on `5000`.
**If the script doesn't exist:** `pnpm dev` from repo root (but be aware of the gotchas below).

### Known Gotchas (already fixed — do not re-fix)
- `reflect-metadata` must be imported in `main.ts` before NestJS decorators evaluate. Already present.
- `KEYFLOW_DEV_AUTH_BYPASS=true` causes a fatal boot exit. The launcher unsets it.
- Missing module providers (e.g. `CrmCacheService`) have been registered in their respective modules.
- Circular module deps exist in the codebase but are handled via `forwardRef()`.

### Manual Recovery (if launcher fails)
```bash
# 1. Kill stale processes
npx kill-port 3001 5000

# 2. Ensure DB is up
npx prisma migrate dev --schema packages/db/prisma/schema.prisma

# 3. Build check
cd apps/server && pnpm build && cd ../..

# 4. Launch
pnpm dev
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
