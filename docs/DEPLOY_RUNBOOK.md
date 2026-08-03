# Deploy runbook — the baseline cutover

Every command below was rehearsed on 2026-08-03 against a throwaway PostgreSQL
container built to match production exactly: all 433 tables present,
`_prisma_migrations` listing the 19 archived migrations, and no `0_baseline`
row. Nothing here is inferred.

Commands are written for **PowerShell**, the shell on this machine. Bash
equivalents are given where the syntax differs — in PowerShell,
`VAR="x" command` is a parse error, not an environment variable.

---

## The one rule

**Do Part 2 before you `git push`.**

`git push` auto-deploys — `render.yaml` sets `branch: main` and does not disable
`autoDeploy` — and that deploy now runs `prisma migrate deploy` as a pre-deploy
step. There are 27 unpushed commits on `main` right now.

## What you need

- The production `DATABASE_URL`, from the Render dashboard:
  **keyflowos service → Environment → `DATABASE_URL`**.
- Your local checkout, on `main`, with `packages/db/prisma/migrations/0_baseline`
  present. (This is the only place that folder exists until a deploy succeeds —
  see the note in Part 2 on why Render's Shell cannot do this.)
- Docker running, for Part 1 only.

---

## Part 1 — Local database cleanup

Safe, reversible, and independent of production. Do it first.

### 1.1 See what is currently wrong

```powershell
cd C:\Users\sachd\Downloads\KEYFLOWOS\packages\db
$env:DATABASE_URL = "postgresql://keyflow:keyflow@localhost:5432/keyflow?schema=public"
npx prisma migrate diff --from-url "$env:DATABASE_URL" --to-schema-datamodel prisma/schema.prisma
```

Expect a report ending in:

```
[*] Changed the `org_assignments` table
  [-] Removed column `is_contact_only`   … and six more
  [*] Altered column `membership_id` (changed from Nullable to Required)
  [*] Altered column `user_id` (changed from Nullable to Required)
```

### 1.2 Apply the cleanup

```powershell
cd C:\Users\sachd\Downloads\KEYFLOWOS
Get-Content packages\db\prisma\migrations-archive\CLOSE_LOCAL_DRIFT.sql | `
  docker exec -i keyflowos-db-1 psql -U keyflow -d keyflow -v ON_ERROR_STOP=1
```

Bash: `docker exec -i keyflowos-db-1 psql -U keyflow -d keyflow -v ON_ERROR_STOP=1 < packages/db/prisma/migrations-archive/CLOSE_LOCAL_DRIFT.sql`

Expect `BEGIN … DELETE 1 … ALTER TABLE … COMMIT`. A `WARNING: database "keyflow"
has no actual collation version` line is pre-existing and harmless.

This removes an `org_assignments` row named 'Test Payroll Clerk' and the dead
"contact-only assignment" columns, both from abandoned branch `c7ab974a`. The
row is what actually blocks things: `schema.prisma` declares
`org_assignments.membership_id` and `.user_id` NOT NULL while a contact-only row
has both null, so the real schema cannot be applied while it exists.

### 1.3 Verify

```powershell
cd C:\Users\sachd\Downloads\KEYFLOWOS\packages\db
npx prisma migrate diff --from-url "$env:DATABASE_URL" --to-schema-datamodel prisma/schema.prisma
```

Expect exactly: **`No difference detected.`**

### 1.4 If you want it back

Everything removed is dumped **with data** in the same directory, restore
verified against a real database:

```powershell
Get-Content packages\db\prisma\migrations-archive\ORPHAN_TABLES.sql | `
  docker exec -i keyflowos-db-1 psql -U keyflow -d keyflow
```

---

## Part 2 — Production baseline

This is the step that must happen **before** the push.

### 2.1 Why it cannot run in Render's Shell

`migrate resolve` requires the migration folder to exist on disk — it fails with
`P3017` otherwise (verified). Render's Shell runs the **currently deployed**
code, which still has the old migrations directory and no `0_baseline`. So the
one machine that can do this is yours.

### 2.2 Set the production URL in this terminal only

```powershell
cd C:\Users\sachd\Downloads\KEYFLOWOS\packages\db
$env:DATABASE_URL = "postgresql://…paste the production url…"
```

Sanity-check you are pointed at production and not your laptop:

```powershell
npx prisma migrate status
```

Expect it to list **the 19 archived migrations as applied** and report
`0_baseline` as not yet applied. If it says "Database schema is up to date"
with 1 migration, you are still pointed at your local database — fix the URL
before continuing.

### 2.3 Record the baseline

```powershell
npx prisma migrate resolve --applied 0_baseline
```

Expect: **`Migration 0_baseline marked as applied.`**

This writes one bookkeeping row into `_prisma_migrations` and runs **no DDL**.
No table is created, altered or dropped. Your data is untouched.

### 2.4 Verify

```powershell
npx prisma migrate status
```

Expect: **`Database schema is up to date!`**

### 2.5 You do NOT need to delete the 19 old rows

Rehearsed: with `0_baseline` recorded alongside all 19 stale rows (21 rows
total), `migrate status` reports "up to date" and `migrate deploy` exits 0.
Prisma only applies migrations found on disk; rows describing folders that no
longer exist are inert. Leave them — deleting them is unnecessary risk.

### 2.6 If your production DATABASE_URL is a pooled connection

Check the URL you pasted. If it contains `:6543`, `pgbouncer=true`, or a
`-pooler` host (the Supabase convention), it is a **transaction pooler**.

Prisma Migrate cannot work through one — it takes a session-level advisory lock
— so it hangs or fails rather than applying DDL. `migrate resolve` in 2.3 is
only an INSERT and is unaffected, but the migration that runs during the deploy
is real DDL.

`render.yaml`'s pre-deploy command already handles this: it uses
`${DIRECT_URL:-$DATABASE_URL}`, so if you have `DIRECT_URL` set in Render (it is
in the documented secret list) the deploy uses the direct connection
automatically, and nothing changes if you do not.

For your own commands in 2.3, use the direct URL (`:5432`) if you have one.

### 2.7 Close the terminal, or clear the variable

```powershell
Remove-Item Env:\DATABASE_URL
```

So a later command in the same window cannot hit production by accident.

---

## Part 3 — Push and watch

```powershell
cd C:\Users\sachd\Downloads\KEYFLOWOS
git log --oneline origin/main..HEAD | Measure-Object -Line   # expect 28
git push origin main
```

Render builds (~several minutes; the server compile needs the `pro` plan's 4GB —
see the comments in `render.yaml`), then runs the pre-deploy command.

**In the deploy log, look for:**

```
2 migrations found in prisma/migrations
Applying migration `20260803190000_flow_session_user_scope`
All migrations have been successfully applied.
```

That is the rehearsed success case — exit 0, and the deploy proceeds to swap in
the new version.

`0_baseline` is skipped because Part 2 recorded it. The second migration is the
session-privacy column, and it is expected to actually run: the baseline
*declares* `flow_sessions.user_id` but `migrate resolve` executes no DDL, so on
production the column arrives here rather than there. On a database that already
has it, both statements are `IF NOT EXISTS` and the migration is a no-op.

If pre-deploy instead prints "No pending migrations to apply", the column was
never created and `sessionScope()` will fail with P2022 on every session read —
stop and check `flow_sessions` before letting the release stand.

**Then check the app:**

```powershell
curl.exe -s https://keyflowos.com/api/healthz
```

Expect `"apiReachable":true` in the body. This is the same route Render uses as
its health check (`healthCheckPath: /api/healthz`).

---

## Part 4 — If something goes wrong

### 4.1 You pushed before doing Part 2

**Your data and schema are safe.** Prisma runs a migration in a transaction, so
the failed attempt rolls back cleanly — the rehearsal confirmed 433 tables still
present and unmodified. Render keeps the **old version serving traffic** because
the pre-deploy step failed, so users see no outage.

In the deploy log:

```
Applying migration `0_baseline`
Error: P3018
Database error code: 42710
ERROR: type "InvoiceStatus" already exists
```

(42710 — a duplicate *type* — rather than the duplicate-*table* 42P07, because
`CREATE TYPE` comes before the first `CREATE TABLE` in the baseline.)

**The catch:** the failure is recorded and is sticky. Every later deploy then
fails with a *different* error until you clear it:

```
Error: P3009
migrate found failed migrations in the target database, new migrations
will not be applied.
```

**Recovery**, from your machine with the production URL set as in 2.2:

```powershell
npx prisma migrate resolve --rolled-back 0_baseline   # clear the failure marker
npx prisma migrate resolve --applied     0_baseline   # record it properly
npx prisma migrate status                             # -> up to date
```

Then redeploy from the Render dashboard (**Manual Deploy → Deploy latest
commit**). Rehearsed end to end: exit 0, 433 tables intact.

### 4.2 The pre-deploy step fails for some other reason

Render aborts the release and keeps the old version live. Read the error in the
deploy log before retrying — the pre-deploy step exists precisely so that a
schema problem blocks the release instead of shipping code against a database
that cannot serve it.

### 4.3 You want to undo the whole cutover

The 19 original migrations are in `packages/db/prisma/migrations-archive/` and
in git history — nothing was deleted. Reverting the commit restores them.
Note that they never worked: `migrate deploy` on a virgin database died on
migration 1 of 19 with `42P01`, which is what prompted the replacement.

---

## Part 5 — Housekeeping, whenever convenient

The running container `keyflowos-db-1` is still on `postgres:16-alpine`.
`docker-compose.yml` now specifies `pgvector/pgvector:pg16` — the alpine image
ships no pgvector, and `AiMemoryEmbedding.embedding` is
`Unsupported("vector(1536)")`. The current container works only because its
volume already carries the extension from some earlier image; a colleague
cloning fresh on the old image gets a database that cannot host the schema.

```powershell
cd C:\Users\sachd\Downloads\KEYFLOWOS
docker compose up -d --force-recreate db
```

Same PostgreSQL major version, so the existing data directory keeps working.

---

## After this, the normal workflow

Schema changes finally have a working path:

```powershell
# 1. edit packages/db/prisma/schema.prisma
cd C:\Users\sachd\Downloads\KEYFLOWOS\packages\db
$env:DATABASE_URL = "postgresql://keyflow:keyflow@localhost:5432/keyflow?schema=public"
npx prisma migrate dev --name describe_the_change    # writes a migration file
# 2. commit the generated folder with your code change
# 3. push — Render's pre-deploy applies it to production
```

Stop using `prisma db push` outside throwaway databases. It writes no migration,
which is how the history drifted far enough that `migrate deploy` could not
build a database at all, and it drops columns and tables `schema.prisma` no
longer declares — this repo has already demonstrated a database holding twelve
such objects.

`apps/server/src/schema-migration-coverage.spec.ts` guards the two defects that
caused this, with no database required: a model with no `CREATE TABLE`, and a
migration touching a table before an earlier migration creates it.
