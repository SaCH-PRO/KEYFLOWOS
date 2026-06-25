# Prisma Migration History Repair

## Context

The migration chain in `packages/db/prisma/migrations/` had become broken: later
migrations assumed tables existed that were created by earlier migrations which
were no longer present or were skipped on a fresh database. This caused:

- `prisma migrate dev` to fail with `P3006` / `P1014` (missing `invoices` table).
- `prisma migrate deploy` to fail on a fresh database at
  `20260413000000_add_mission2_commerce_supplier_architecture` because
  `marketplace_listings` did not exist.

## Resolution

We performed a **baseline reset**:

1. Generated a single baseline migration that represents the full current schema.
2. Archived all previous incremental migrations outside the `migrations/`
   directory so Prisma no longer scans them.
3. Added the `vector` extension creation to the baseline migration and
   schema-qualified the embedding column (`public.vector(1536)`).
4. Verified `prisma migrate deploy` succeeds on a fresh database.
5. Verified `prisma migrate dev` reports "Already in sync" on both the local
   development database and a fresh schema.

## New migration layout

```text
packages/db/prisma/migrations/
└── 20251128000000_baseline_full_schema/
    └── migration.sql

packages/db/prisma/migrations-archived/
└── <all previous migrations, preserved for forensic reference>
```

Only the baseline migration is active. All previous migrations are archived but
kept in the repo for reference.

## Requirements

- PostgreSQL 15+ with the **pgvector** extension installed.
- For local development, pgvector should also be available in `template1` (or
  database creation templates), because `prisma migrate dev` creates ephemeral
  shadow databases. If it is not pre-installed in templates, `migrate dev` can
  fail with `type "vector" does not exist` on the shadow database.

### Quick local setup

```bash
# Connect to template1 and enable pgvector so shadow DBs inherit it.
psql -h localhost -U keyflow -d template1 -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

If you do not have `psql`, use any PostgreSQL client or run the equivalent SQL
against `template1`.

## Applying to an existing database

If your local database predates this repair, it is likely out of sync with the
new baseline. The safest path is to reset it:

```bash
cd packages/db
npx prisma migrate reset --schema prisma/schema.prisma --skip-seed --force
```

**This drops all data in the database.** Only do this in development.

For production databases (e.g., Supabase), use `prisma migrate deploy` after the
baseline has been marked as applied:

```bash
npx prisma migrate resolve --applied 20251128000000_baseline_full_schema --schema prisma/schema.prisma
npx prisma migrate deploy --schema prisma/schema.prisma
```

## Verification commands

```bash
# 1. Status should report the database is up to date.
npx prisma migrate status --schema prisma/schema.prisma

# 2. migrate dev should report "Already in sync".
npx prisma migrate dev --schema prisma/schema.prisma --name noop --skip-generate

# 3. deploy should succeed on a fresh database/schema.
DATABASE_URL="postgresql://keyflow:keyflow@localhost:5432/keyflow?schema=fresh_test" \
  npx prisma migrate deploy --schema prisma/schema.prisma
```

## When to add new migrations

After this repair, normal migration workflow resumes:

1. Edit `packages/db/prisma/schema.prisma`.
2. Run `npx prisma migrate dev --schema prisma/schema.prisma --name <descriptive_name>`.
3. Commit the generated migration folder.

Do not un-archive the old migrations or move them back into `migrations/`.
