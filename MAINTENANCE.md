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

## Uptime monitoring

The health endpoints above are useful only if **something polls them
without you**. We run an external uptime monitor against the deployed
URL so an outage pages an operator before customers notice.

### What gets probed

| Probe          | URL                                  | Pass criteria                                  |
| -------------- | ------------------------------------ | ---------------------------------------------- |
| `web.healthz`  | `https://<your-domain>/api/healthz`  | `HTTP 200` AND body contains `"apiReachable":true` |
| `api.readyz`   | `https://<your-domain>/readyz`       | `HTTP 200` AND body contains `"ok":true` (the `db.ok` field) |

> **HTTP-status checks alone are not enough.** Both endpoints can return
> `200 OK` with a "degraded" body (e.g. `apiReachable:false` or
> `db.ok:false`). Always configure keyword/JSON-content matching on the
> response body, not just the status code.

Pager rule: **two consecutive failures** (~2 minutes at the recommended
1-minute interval). Single transient blips do not page.

### Option A — UptimeRobot (recommended, free tier covers this)

1. Sign up at <https://uptimerobot.com> and create a new monitor for
   each URL above.
2. **Monitor type:** `Keyword` (not `HTTP(s)`).
3. **Keyword exists:** for `/api/healthz` use `"apiReachable":true`; for
   `/readyz` use `"ok":true`.
4. **Monitoring interval:** `1 minute`.
5. **Alert contacts:** add at least one email + a Slack webhook (or
   phone/SMS on a paid plan).
6. **Alert when:** *down for `2` consecutive minutes* — this matches our
   "fail twice in a row" rule.
7. After saving, paste the **public status-page URL** into
   [Configured monitors](#configured-monitors) below.

### Option B — BetterStack / Pingdom / Datadog Synthetics

Same idea, different UI. The only non-obvious settings:

- **Request method:** `GET`
- **Assertion:** body contains `"apiReachable":true` (web) /
  `"ok":true` (api)
- **Locations:** at least 2 regions to avoid one-region false positives
- **Retry policy:** 1 retry after 30 s before alerting (equivalent to our
  "2 consecutive failures" rule)

### Option C — Self-hosted (no third-party account)

A dependency-free shell monitor lives at
[`scripts/uptime-monitor.sh`](scripts/uptime-monitor.sh) and is exposed
as `pnpm monitor:uptime`. It implements the exact same semantics as the
hosted options:

- HTTP 200 + JSON-keyword assertion on each probe
- Persistent counter so it pages **only on the 2nd consecutive failure**
- Recovery notification when the counter resets
- Pluggable notification channels: Slack webhook, generic JSON webhook
  (PagerDuty Events v2 / Opsgenie compatible), and `mail(1)` if present

Run it once by hand to verify wiring:

```bash
BASE_URL=https://app.keyflowos.com \
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... \
pnpm monitor:uptime
```

A turnkey schedule is committed at
[`.github/workflows/uptime-monitor.yml`](.github/workflows/uptime-monitor.yml).
It runs every 5 minutes (the GitHub Actions cron minimum) and persists
the failure-counter state via `actions/cache`. To enable it:

1. In GitHub → **Settings → Secrets and variables → Actions**:
   - Add **variable** `PROD_BASE_URL` = `https://app.keyflowos.com`
   - (Optional) **variable** `PROD_API_BASE_URL` if the API is on a
     different host
   - (Optional) **secret** `UPTIME_SLACK_WEBHOOK_URL`
   - (Optional) **secret** `UPTIME_ALERT_WEBHOOK_URL`
2. Trigger the **Uptime monitor** workflow once via "Run workflow" to
   confirm it's green.

For sub-minute polling, pair the GitHub Actions schedule with one of
Options A or B — the GHA workflow then becomes an independent secondary
monitor running from a different network, which protects you from
single-vendor outages.

### Configured monitors

Update this section when a monitor is created or moved:

| Probe         | Service              | Dashboard / status URL                          | Owner |
| ------------- | -------------------- | ----------------------------------------------- | ----- |
| `web.healthz` | _TBD — set up via Option A above_ | `https://stats.uptimerobot.com/<id>` | _ops_ |
| `api.readyz`  | _TBD — set up via Option A above_ | `https://stats.uptimerobot.com/<id>` | _ops_ |
| Both (backup) | GitHub Actions       | `https://github.com/<org>/<repo>/actions/workflows/uptime-monitor.yml` | _ops_ |

When a real monitor is wired up, replace the `TBD` rows with the actual
service name, dashboard URL, and the on-call rotation that receives the
alert.

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
history. There is **no separate database migration step** —
`scripts/post-merge.sh` applies the committed migrations with
`prisma migrate deploy` (see below). Rolling the code back does not roll
back a migration that has already been applied.

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
4. Applies the committed migrations in `packages/db/prisma/migrations`
   with `prisma migrate deploy` (owner ruling D-62), then checks that both
   partial contact identity uniques of V1-17 exist
   (`scripts/assert-contact-identity-uniques.sql`).

Failure policy:

- In **non-development** environments (`NODE_ENV != development`), real
  drift causes the script to exit non-zero. The deploy is blocked.
- In dev, drift logs a warning and continues so you can iterate fast.
- A failed `prisma migrate deploy` exits non-zero in every environment.
- So does a missing `contacts_business_id_email_normalized_live_key` or
  `contacts_business_id_phone_normalized_live_key` after deploy.
- Override knobs (use sparingly):
  - `POST_MERGE_SKIP_DB_PUSH=1` — skip steps 3 and 4 entirely (the name
    predates `migrate deploy` and is kept so operator settings still work).
  - `POST_MERGE_ALLOW_DB_DRIFT=1` — downgrade drift to a warning
    everywhere.

To apply migrations manually from the shell:

```bash
bash scripts/post-merge.sh
```

`scripts/start-cloud-app.sh` (the local cloud dev stack) applies them the
same way, with `pnpm db:deploy`, and runs the same index check.

To inspect drift without applying:

```bash
pnpm --filter @keyflow/db exec prisma migrate diff \
  --from-schema-datasource packages/db/prisma/schema.prisma \
  --to-schema-datamodel    packages/db/prisma/schema.prisma \
  --exit-code
```

Exit `0` = clean, `2` = drift, anything else = something else broke.
It compares the database with `schema.prisma` only, so it cannot see what
only a migration declares: the partial contact identity uniques of V1-17
and `bank_transactions_account_external_id_key`. It answers "No difference
detected" on a database that has none of them.

### Why not `prisma db push`

Both scripts used `prisma db push` until V1-83 and no longer do. It
reconciles a database with `schema.prisma` alone, so it cannot create what
only a migration declares. Since V1-17
(`20261101000000_contact_partial_identity_uniques`) the contact identity
uniques are partial indexes (`WHERE deleted_at IS NULL`) that Prisma cannot
declare. On a database that has not applied that migration yet, it drops
the old full uniques and creates nothing in their place, so two live
contacts of one business could share an email or a phone.
Never run `prisma db push` (`pnpm db:push`) against a database you keep;
it is for throwaway databases only.

### Adopting a database built without migrations

Every environment built before V1-83 got its schema from `db push`, not from
migrations ([docs/SCHEMA_DEPLOYMENT.md](docs/SCHEMA_DEPLOYMENT.md) §1), and
the old post-merge kept it in sync with `schema.prisma` the same way, not
through migrations. Such a database already holds the schema of most
migrations, but `_prisma_migrations` does not record them, so
`prisma migrate deploy` refuses it:

- **P3005** ("The database schema is not empty"): there is no
  `_prisma_migrations` table, or it is empty.
- **P3018** ending in "already exists" (SQLSTATE 42701, 42P07 or 42710):
  `0_baseline` is recorded but the later migrations are not, so deploy
  runs their DDL again. The failed migration rolls back and nothing
  changes, but every later run stops with **P3009** (a failed migration
  is recorded).

Post-merge and `start-cloud-app.sh` stop with a `[FATAL]` that points
here; neither records a migration by itself. **Recording `0_baseline`
alone is not enough**: running only
`pnpm --filter @keyflow/db exec prisma migrate resolve --applied 0_baseline`
is exactly what produces the P3018. Once per such database, with
`DATABASE_URL` and `DIRECT_URL` pointing at it:

1. Back it up.
2. Check which contact identity uniques it has. `prisma migrate diff`
   cannot tell you (see above); ask Postgres:

   ```sql
   SELECT indexname FROM pg_indexes
    WHERE tablename = 'contacts'
      AND indexname IN ('contacts_business_id_email_normalized_key',
                        'contacts_business_id_phone_normalized_key',
                        'contacts_business_id_email_normalized_live_key',
                        'contacts_business_id_phone_normalized_live_key');
   ```

   A database synced from a `schema.prisma` older than V1-17 shows the two
   full `*_key` indexes, which still keep live duplicates out. One synced
   since V1-17 shows none of the four: nothing stops two live contacts of
   one business from sharing an email or a phone until step 5 creates the
   `*_live_key` indexes.
3. Run the duplicate scan of
   `20261101000000_contact_partial_identity_uniques`. Both queries must
   return no rows; resolve any duplicates first, or that migration fails
   (it then rolls back, and post-merge names the fix):

   ```sql
   SELECT business_id, email_normalized, count(*) FROM contacts
    WHERE deleted_at IS NULL AND email_normalized IS NOT NULL
    GROUP BY 1, 2 HAVING count(*) > 1;
   SELECT business_id, phone_normalized, count(*) FROM contacts
    WHERE deleted_at IS NULL AND phone_normalized IS NOT NULL
    GROUP BY 1, 2 HAVING count(*) > 1;
   ```

4. Record as applied `0_baseline` and every migration whose schema the
   database already holds, from the repository root. A migration that is
   already recorded answers P3008, which is harmless; one that failed
   (P3009) is recorded as applied by the same command.

   ```bash
   for m in \
       0_baseline \
       20260720181801_org_assignment_contact_delegation \
       20260720191350_approval_item_approver_routing \
       20260721044726_support_ticket_messages \
       20260722004808_payroll_mvp \
       20260722005135_payroll_mvp \
       20260722011345_staff_performance_snapshots \
       20260722224337_contract_clause_analysis \
       20260726160935_add_risc_user_identity \
       20260726161845_add_user_metadata \
       20260803190000_flow_session_user_scope \
       20260806120000_merge_omnichannel_inboxes \
       20260806130000_retire_conversation_store \
       20260809170000_add_user_deleted_at_banned_at \
       20260810020000_command_item_obligations \
       20260810230000_due_index_on_kind \
       20260811030000_ai_usage_billable \
       20260811040000_add_booking_waitlist \
       20260823170000_business_id_indexes \
       20260830220000_add_project_deliverables \
       20260918060000_outbound_delivery_effect_certainty \
       20260919223000_flow_run_tenant_idempotency \
       20261005170000_key_action_boundary_clearance
   do
     pnpm --filter @keyflow/db exec prisma migrate resolve --applied "$m"
   done
   ```

   Two migrations are deliberately not on the list, because they create
   what Prisma cannot declare and such a database therefore lacks:
   `20260808140000_bank_transaction_external_id_unique` (an expression
   partial unique index; its SQL is `IF NOT EXISTS`) and
   `20261101000000_contact_partial_identity_uniques` (V1-17). Migrate
   deploy runs both in step 5. **Never record
   `20261101000000_contact_partial_identity_uniques` as applied unless
   step 2 shows both `*_live_key` indexes.** Recorded without them, it
   leaves no contact identity unique at all, `migrate status` and
   `migrate diff` stay silent, and post-merge stops at its index check.
5. Run `bash scripts/post-merge.sh`. Deploy applies the two migrations
   above (and any later ones), and step [4/4] confirms both `*_live_key`
   indexes. Rerun the step 2 query to see them.

If deploy then stops with P3018 "already exists" on a migration newer
than `20261101000000`, the database was synced past it before V1-83
landed: check that it creates nothing Prisma cannot declare, then record it
as applied as in step 4.

Recording a migration as applied skips its data steps too. On such a
database the `UPDATE`s of `20260806130000_retire_conversation_store`
(clears dangling `message_intakes.thread_id`) and
`20260811030000_ai_usage_billable` (marks internal AI features
`billable = false`) never ran; run them from their `migration.sql` by hand
if that data matters.

If post-merge stops at the [4/4] index check (every migration recorded,
a `*_live_key` index missing), V1-17 was recorded without running. Run the
duplicate scan (step 3), resolve any duplicates, then run its SQL once and
rerun post-merge:

```bash
pnpm --filter @keyflow/db exec prisma db execute --schema=./prisma/schema.prisma \
  --file ./prisma/migrations/20261101000000_contact_partial_identity_uniques/migration.sql
```

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
database URL to see what changed. Resolve with a reviewed migration
(`prisma migrate dev --create-only`, then `prisma migrate deploy`) or by
updating `schema.prisma` to match production. Do not use `prisma db push`
to close drift: it drops what `schema.prisma` does not declare, such as the
partial contact uniques of V1-17.

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
scripts/post-merge.sh                         # post-merge drift gate + prisma migrate deploy
scripts/uptime-monitor.sh                     # self-hosted uptime poller (Option C)
.github/workflows/uptime-monitor.yml          # GHA schedule for uptime-monitor.sh
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
