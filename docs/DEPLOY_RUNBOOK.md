# Deploy runbook — the baseline cutover

Every command and outcome below was rehearsed on 2026-08-03 against a throwaway
PostgreSQL container built to match production exactly: all 433 tables present,
`_prisma_migrations` listing the 19 archived migrations, and no `0_baseline`
row. Nothing here is inferred.

---

## The one rule

**Run step 1 before you push.** `git push` auto-deploys (`render.yaml` sets
`branch: main` and does not disable `autoDeploy`), and the deploy now runs
`prisma migrate deploy` as a pre-deploy step.

There are 27 unpushed commits sitting on `main` right now.

## Step 1 — tell production it already has the baseline

`0_baseline` describes a database that already exists. Production must record it
as applied rather than run it.

**This must run from your local machine, not Render's Shell.** `migrate resolve`
requires the migration folder to exist on disk (it fails with P3017 otherwise),
and Render's Shell runs the *currently deployed* code — which still has the old
migrations directory and no `0_baseline`. Your local checkout is the only place
that folder exists until the deploy succeeds.

Get the production connection string from the Render dashboard
(keyflowos service → Environment → `DATABASE_URL`), then:

```bash
cd packages/db

# Use the PRODUCTION url here, not your local one.
DATABASE_URL="postgresql://…production…" \
  npx prisma migrate resolve --applied 0_baseline
```

Expected output:

```
Migration 0_baseline marked as applied.
```

This writes **one bookkeeping row** and executes no DDL. Your data is untouched.

Verify before moving on:

```bash
DATABASE_URL="postgresql://…production…" npx prisma migrate status
#  -> Database schema is up to date!
```

### You do NOT need to delete the 19 old rows

Rehearsed: with `0_baseline` recorded and all 19 stale rows still present (21
rows total), `migrate status` reports **"Database schema is up to date!"** and
`migrate deploy` exits 0. Prisma only applies migrations found on disk; rows
describing folders that no longer exist are inert. Leave them.

## Step 2 — push

```bash
git push origin main
```

Render builds, then runs the pre-deploy command. Rehearsed outcome once step 1
is done:

```
1 migration found in prisma/migrations
No pending migrations to apply.          exit 0
```

The deploy proceeds normally. 433 tables, untouched.

---

## If you push first by mistake

Rehearsed, so you know exactly what you are looking at.

**Your data and schema are safe.** Prisma runs a migration in a transaction, so
the failed attempt rolls back cleanly — the rehearsal confirmed 433 tables still
present and unmodified afterwards. Render keeps the old version serving traffic
because the pre-deploy step failed.

What you will see in the deploy log:

```
Applying migration `0_baseline`
Error: P3018
Database error code: 42710
ERROR: type "InvoiceStatus" already exists
```

(42710 rather than the duplicate-table 42P07, because `CREATE TYPE` comes before
the first `CREATE TABLE` in the baseline.)

**The catch:** the failure is recorded, and it is sticky. Every later deploy
fails with a *different* error until you clear it:

```
Error: P3009
migrate found failed migrations in the target database, new migrations
will not be applied.
```

Recovery — again from your local machine, against the production URL:

```bash
cd packages/db
export DATABASE_URL="postgresql://…production…"

npx prisma migrate resolve --rolled-back 0_baseline   # clear the failure marker
npx prisma migrate resolve --applied     0_baseline   # record it properly
npx prisma migrate status                             # -> up to date
```

Then redeploy from the Render dashboard. Rehearsed end to end: exit 0, 433
tables intact.

---

## Local dev database

Separate from the above and not urgent. `packages/db/prisma/migrations-archive/CLOSE_LOCAL_DRIFT.sql`
removes the last local-only drift — an `org_assignments` row named
'Test Payroll Clerk' and the dead contact-only columns from abandoned branch
`c7ab974a`. It matters because `schema.prisma` declares
`org_assignments.membership_id` and `.user_id` NOT NULL while that row has both
null, so the real schema cannot be applied while it exists.

```bash
docker exec -i keyflowos-db-1 psql -U keyflow -d keyflow \
  -v ON_ERROR_STOP=1 < packages/db/prisma/migrations-archive/CLOSE_LOCAL_DRIFT.sql
```

Everything it removes is backed up with data in `ORPHAN_TABLES.sql` in the same
directory, restore verified. Afterwards:

```bash
cd packages/db
npx prisma migrate diff --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma
#  -> No difference detected.
```

### Also worth doing locally, eventually

The running container `keyflowos-db-1` is still on `postgres:16-alpine`.
`docker-compose.yml` now specifies `pgvector/pgvector:pg16` — the alpine image
ships no pgvector, and `AiMemoryEmbedding.embedding` is
`Unsupported("vector(1536)")`. The current container works only because its
volume already carries the extension from some earlier image. A colleague
starting fresh on the old image would get a database that cannot host the
schema. Pick it up whenever convenient:

```bash
docker compose up -d --force-recreate db
```

Same PostgreSQL major version, so the existing data directory keeps working.
