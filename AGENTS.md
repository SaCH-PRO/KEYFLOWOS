# Agent Guidance for KEYFLOWOS

## Launch Procedure (One Command)

When the user says "launch the app", "start dev", or similar, run:

```bash
bash scripts/launch-dev.sh
```

This handles port cleanup, stale-cache clearing, env guards, DB checks, build validation, and starts both servers.

**Ports:** API runs on `3001`, Web runs on `5000`.
**Workspace packages:** The launcher builds `@keyflow/shared`, `@keyflow/db`, and `@keyflow/api` before the server so the runtime resolves their compiled CJS exports instead of their TypeScript source.
**Bundler:** The launcher starts the web app with `--webpack` to avoid a recurring Next.js 16 + Turbopack cold-start crash (missing `routes-manifest.json` / `middleware-manifest.json` and SST compaction errors after a full `.next` wipe).
**Server runtime:** The launcher now builds the server with `tsc` and runs the compiled `apps/server/dist/main.js`. `tsx` cannot preserve `emitDecoratorMetadata`, so NestJS dependency injection fails under `tsx src/main.ts`.
**If the script doesn't exist:** `pnpm dev` from repo root (but be aware of the gotchas below).

### Known Gotchas (already fixed — do not re-fix)
- `reflect-metadata` must be imported in `main.ts` before NestJS decorators evaluate. Already present.
- `KEYFLOW_DEV_AUTH_BYPASS=true` causes a fatal boot exit. The launcher unsets it.
- Missing module providers (e.g. `CrmCacheService`) have been registered in their respective modules.
- Circular module deps exist in the codebase but are handled via `forwardRef()`.
- **Compiled server required for dev:** `pnpm dev` in `apps/server` now runs `node dist/main.js`. Always build the workspace packages (`@keyflow/shared`, `@keyflow/db`, `@keyflow/api`) and the server before starting dev.
- **Business Genesis (Patch 1):** `BusinessBlueprint` now includes Genesis sections (legal, registration, tax, projections, risk, compliance, execution roadmap). `/app/onboarding` is the Genesis intake flow and feeds these sections into KEY's prompt context.
- **Onboarding redesign (Patch 2):** The `/app/onboarding` funnel is now a slim chat-driven experience: `welcome → intake (idea extraction) → template picker → configure (storefront/payments/contacts) → genome check (if needed) → complete`. Legacy step values `genesis` and `genome` are mapped to `intake` and `configure` respectively. The completion gate auto-redirects to `/app/command-center`, progress dots are clickable to go back, and `saveStep('complete')` is rejected — only `markOnboardingComplete` can finish onboarding. The embedded genome chat (`BlueprintOnboardingChat`) covers identity, founder profile, operating model, market profile, customer model, financials, and other core sections so users can satisfy the three-pillar Business Genome minimum inside onboarding.
- **KEY voice (LiveKit):** Full-duplex in-app voice runs on the `livekit` docker-compose service (`livekit/livekit-server:v1.9.12` — do NOT float to `latest`; 1.13.x broke agent job routing to agents-js 1.5.5) with config in `infrastructure/livekit.yaml` (redis-backed bus). The NestJS `livekit` module (`apps/server/src/modules/livekit/`) mints tokens/creates rooms/dispatches the agent; the worker is `apps/voice-agent` (`@keyflow/voice-agent`, OpenAI Realtime `gpt-realtime` — the account has no `gpt-4o-realtime-preview` access). The launcher builds and starts the worker; the web voice control lives in the KEY chat voice bar (`key-live-voice.tsx`). Agent state (listening/thinking/speaking) reaches the client via the `lk.agent.state` participant attribute. `OPENAI_API_KEY` must be overwritten from `AI_INTEGRATIONS_OPENAI_API_KEY` in the worker — a stale user-level env var shadows it.

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
#    The docker-compose `db` service uses `pgvector/pgvector:pg16`, so the
#    `vector` extension is available (enable once per database:
#      docker compose exec db psql -U keyflow -d keyflowos -c "CREATE EXTENSION IF NOT EXISTS vector;"
#    and in template1 for the ephemeral shadow DB used by `migrate dev`).
#    On an external/plain Postgres instead, `migrate dev` fails with
#    "type \"vector\" does not exist" — enable it in template1 first:
#      psql -h localhost -U keyflow -d template1 -c "CREATE EXTENSION IF NOT EXISTS vector;"
#    See docs/development/prisma-migration-repair.md for the full repair history.
npx prisma migrate dev --schema packages/db/prisma/schema.prisma

# 4. Build check
cd apps/server && pnpm build && cd ../..

# 5. Launch with webpack dev (avoids the Turbopack cold-start bug)
cd apps/web && pnpm dev --webpack
# In another terminal (build packages + server first):
pnpm --filter @keyflow/shared build
pnpm --filter @keyflow/db build
pnpm --filter @keyflow/api build
cd apps/server && pnpm build && pnpm dev
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
