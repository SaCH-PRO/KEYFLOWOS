# MAINTENANCE — KeyflowOS

Plain-language operator guide for keeping KeyflowOS up and running. If
something is broken, start at [Quick triage](#quick-triage). If you need
to ship code or a config change, see [Deploy & rollback](#deploy--rollback).

> Stack: NestJS server (`apps/server`, port **3001**) + Next.js 16 web
> (`apps/web`, port **5000**), Prisma 6 against Postgres, pnpm 10
> workspaces.

---

## Quick triage

Run this **first**, no matter the symptom — it answers "is anything alive?":

```bash
pnpm verify:up
```

You should see four `PASS` lines:

```
PASS  api.healthz   200  ...  http://localhost:3001/healthz
PASS  api.readyz    200  ...  http://localhost:3001/readyz
PASS  web.healthz   200  ...  http://localhost:5000/api/healthz
PASS  web.root      200  ...  http://localhost:5000/
```

What each check means:

| Check         | What it proves                                                    |
| ------------- | ----------------------------------------------------------------- |
| `api.healthz` | API process is up and the event loop responds.                    |
| `api.readyz`  | API can reach the database (`SELECT 1`). 503 = DB unreachable.    |
| `web.healthz` | Web process is up **and** can reach the API at `apiBase`.         |
| `web.root`    | Next.js can render the marketing root without throwing.           |

`web.healthz` returns the field `apiReachable: false` when the server is
down — that is your single best smoke signal in production.

---

## Health endpoints (what to curl)

These exist in **every** environment, including production:

```bash
# API liveness — never touches the DB. Should always 200 if the process is up.
curl -fsS http://localhost:3001/healthz

# API readiness — pings Prisma. 200 ready / 503 not ready.
curl -fsS http://localhost:3001/readyz

# Web wrapper — also probes the API for you and reports apiReachable.
curl -fsS http://localhost:5000/api/healthz
```

Useful response fields:

- `commit` — git SHA the running process was built from (set
  `RENDER_GIT_COMMIT`, `VERCEL_GIT_COMMIT_SHA`, or `GIT_COMMIT` at
  deploy time to populate this).
- `uptimeSec` — restart detector. Sudden drop = process restarted.
- `db.latencyMs` (`/readyz`) — DB round-trip ms.
- `apiReachable`, `apiLatencyMs`, `apiStatus` (web `/api/healthz`) —
  cross-service reachability from the web edge.
- `env`, `envError` (web `/api/healthz`) — `"ok"` means env validation
  passed; otherwise a one-line summary.

Both API endpoints are **excluded from the auth middleware and rate
limiter**, so dashboards and uptime monitors can poll them freely.

---

## Environment variables

Both apps **fail fast** at startup with a one-line summary if required
env is missing or malformed. The schemas are the source of truth:

- Server: [`apps/server/src/core/config/env.ts`](apps/server/src/core/config/env.ts)
- Web:    [`apps/web/src/lib/env.ts`](apps/web/src/lib/env.ts)

Each variable is one of:

| Tier            | Behavior on missing                                       |
| --------------- | --------------------------------------------------------- |
| **required**    | Process refuses to boot. Fix it.                          |
| **recommended** | Process boots but logs `[env] Recommended config issues`. |
| **grouped**     | All-or-none (e.g. S3, OAuth pairs). Partial = error.      |

If you see `[FATAL] Environment validation failed:` in the logs, look at
the bullet list right below it — that is the exact list of variables to
set.

The canonical example file is `.env.example`. Keep it in sync when adding
new variables.

---

## Workflows (development)

The two long-running processes that drive local dev:

| Workflow      | Command                  | Port | Health probe              |
| ------------- | ------------------------ | ---- | ------------------------- |
| Backend API   | `cd apps/server && pnpm dev` | 3001 | `GET /healthz`            |
| Web Frontend  | `cd apps/web && pnpm dev`    | 5000 | `GET /api/healthz`        |

Both run via `tsx` / `next dev` and reload on file change. To reset
state, restart the workflow from the workspace UI.

---

## Deploy & rollback

Deployments are **autoscale** with this configuration (set via
`deployConfig`):

```text
build = pnpm install --frozen-lockfile && pnpm --filter @keyflow/db run db:generate && pnpm --filter web build
run   = bash scripts/start-prod.sh
```

`scripts/start-prod.sh` is a tiny supervisor that:

1. Boots the API (`tsx apps/server/src/main.ts`) on `PORT=3001` in the
   background.
2. Boots the web (`pnpm --filter web start`) on `PORT=5000` in the
   foreground.
3. Forwards `SIGTERM`/`SIGINT` to both children.
4. **Exits non-zero if either child dies**, so the platform restarts the
   whole replica instead of running with one half missing.

To deploy:

1. Merge the change into the main app.
2. From the workspace, **Publish** the latest version. Autoscale builds
   and rolls out.
3. After rollout, hit `https://<your-domain>/api/healthz` from a
   browser. `apiReachable: true` and `env: "ok"` = green.

To roll back: redeploy the last known-good version from the deployment
history. There is **no separate database migration step** — Prisma
schema is reconciled by `scripts/post-merge.sh` (see below).

---

## Database — schema, drift, migrations

The Prisma schema lives at `packages/db/prisma/schema.prisma`.

After a code merge, [`scripts/post-merge.sh`](scripts/post-merge.sh)
runs automatically and:

1. Installs deps (`pnpm install --frozen-lockfile`, falls back to
   non-frozen if the lockfile drifted).
2. Regenerates the Prisma client (`pnpm --filter @keyflow/db run db:generate`).
3. **Detects schema drift** with `prisma migrate diff` and prints a
   one-line summary of what would change.
4. Applies the schema with `prisma db push --skip-generate`.

Failure policy:

- In **non-development** environments (`NODE_ENV != development`), real
  drift causes the script to exit non-zero. The deploy is blocked.
- In dev, drift logs a warning and continues so you can iterate fast.
- Override knobs (use sparingly):
  - `POST_MERGE_SKIP_DB_PUSH=1` — skip steps 3 and 4 entirely.
  - `POST_MERGE_ALLOW_DB_DRIFT=1` — downgrade drift to a warning
    everywhere.

To force a manual reconcile from the shell:

```bash
bash scripts/post-merge.sh
```

To inspect drift without applying:

```bash
pnpm --filter @keyflow/db exec prisma migrate diff \
  --from-schema-datasource packages/db/prisma/schema.prisma \
  --to-schema-datamodel    packages/db/prisma/schema.prisma \
  --exit-code
```

Exit `0` = clean, `2` = drift, anything else = something else broke.

---

## Common failures & fixes

### `verify:up` shows `web.healthz FAIL` with `apiReachable: false`

The web process is up but it cannot reach the API.

1. `curl http://localhost:3001/healthz` — is the API actually up?
2. Check the `Backend API` workflow logs for an env validation FATAL.
3. Make sure `NEXT_PUBLIC_API_BASE_URL` in `.env` matches the API port
   (default `http://localhost:3001`). The Next process must be
   restarted after changing it.

### `[FATAL] Environment validation failed: NEXT_PUBLIC_API_BASE_URL`

`next.config.ts` runs **before** Next.js loads `.env`, so it manually
preloads dotenv. If you removed `dotenv` from the workspace or the
required vars are genuinely missing, restore them in `.env` and restart
the `Web Frontend` workflow.

### `/readyz` returns 503

`db.ok = false`. Check `DATABASE_URL`, network reachability to
Postgres, and connection pool exhaustion. Check the API log for the raw
Prisma error around the same timestamp.

### Deployed app boots but one half is missing

`start-prod.sh` is supposed to crash the whole replica if either child
dies — if you see only the API or only the web responding, look in the
deploy logs for `[start-prod] <name> exited` and fix the underlying
crash.

### Schema drift in production

Either:

- A migration was hand-applied directly to the database, or
- A `schema.prisma` change was merged without regenerating the lockfile.

Run `prisma migrate diff` (above) locally against the production
database URL to see what changed. Resolve by either updating
`schema.prisma` to match production, or rerunning `prisma db push`
(after a backup).

---

## File map (where things live)

```
apps/server/src/main.ts                       # bootstrap, env validation, /healthz wiring
apps/server/src/app.controller.ts             # / , /healthz, /readyz
apps/server/src/app.module.ts                 # auth-middleware exclusions for health routes
apps/server/src/core/config/env.ts            # Zod schema for server env

apps/web/next.config.ts                       # build-time env validation
apps/web/src/lib/env.ts                       # Zod schema for web env
apps/web/src/lib/api.ts                       # one-shot warnUnreachable()
apps/web/src/app/api/healthz/route.ts         # web health endpoint

scripts/start-prod.sh                         # production process supervisor
scripts/verify-up.sh                          # one-command smoke test
scripts/post-merge.sh                         # post-merge db sync + drift gate
.env / .env.example                           # env config + template
```

---

## Final verification matrix (Task #242)

Captured on the most recent run of the launch-hardening pass. Reproduce
any time with the commands shown.

| # | Check | Command | Expected | Result |
|---|-------|---------|----------|--------|
| 1 | Server typecheck | `pnpm --filter server exec tsc --noEmit` | exit 0, no output | PASS |
| 2 | Web typecheck | `pnpm --filter web exec tsc --noEmit` | exit 0, no output | PASS |
| 3 | DB package typecheck | `pnpm --filter @keyflow/db exec tsc --noEmit` | exit 0, no output | PASS |
| 4 | Full build | `pnpm -r build` | all packages "Done" | PASS |
| 5 | API liveness | `curl -fsS localhost:3001/healthz` | `{"status":"ok",...}` 200 | PASS |
| 6 | API readiness | `curl -fsS localhost:3001/readyz` | `{"status":"ready","db":{"ok":true,...}}` 200 | PASS |
| 7 | Web health | `curl -fsS localhost:5000/api/healthz` | `apiReachable:true, env:"ok"` 200 | PASS |
| 8 | Web root renders | `curl -fsS localhost:5000/` | 200 | PASS |
| 9 | One-command verifier | `pnpm verify:up` | `Passed: 4    Failed: 0` | PASS |
| 10 | Post-merge — clean DB | `bash scripts/post-merge.sh` | "no drift", exit 0 | PASS |
| 11 | Env-validation gate (web) | unset `NEXT_PUBLIC_API_BASE_URL` & start web | `[FATAL] Environment validation failed` then exit | PASS |
| 12 | Env-validation gate (server) | unset `DATABASE_URL` & start API | `[FATAL] Environment validation failed` then exit | PASS |
| 13 | Health routes bypass auth | `curl -i localhost:3001/healthz` from logged-out | 200 (no 401) | PASS |
| 14 | Health routes bypass rate-limit | 100x `curl localhost:3001/healthz` in a tight loop | every response 200 | PASS |
| 15 | Deploy run command shape | `replit deployment` config | `run = bash scripts/start-prod.sh` | PASS |

Items 11 and 12 are negative tests — they were exercised during
development by deliberately unsetting the variable, observing the FATAL,
and restoring it. The validation logic lives in
`apps/server/src/core/config/env.ts` and `apps/web/src/lib/env.ts`.
