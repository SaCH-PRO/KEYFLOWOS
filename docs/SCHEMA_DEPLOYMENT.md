# Schema deployment — the actual state, and how it was fixed

Written 2026-08-03 while investigating "migration drift". The drift turned out
to be a symptom. This is the disease, and the cure.

---

## 0. Correction to the first version of this document

The first version of this file claimed:

```
models in schema.prisma ............ 430
tables created by migrations/ ....... 11        <-- WRONG
```

**That number was wrong.** It came from a broken extraction that collapsed the
list of `CREATE TABLE` statements. It is preserved here rather than quietly
deleted because it was committed (`1f2bd678`) and acted on.

The real numbers, each verified directly:

| Measure | Value | How |
|---|---|---|
| Distinct tables the 19 migrations *contain* DDL for | **404** | `grep -o` over every `migration.sql`, deduplicated |
| Tables `prisma migrate deploy` actually *produces* on an empty database | **1** | ran it; see below |
| Tables `schema.prisma` needs | **433** | 430 models + 3 implicit m-n join tables |
| Tables in `schema.prisma` that **no** migration creates | **29** | set difference |

So the original claim was wrong in both directions at once. The migrations
directory is far *richer* than reported — 404 tables, not 11 — and far *more
broken*, because none of that DDL ever runs.

## 1. `prisma migrate deploy` could not build a database at all

This is the finding that matters, and it is worse than incompleteness.

```
$ DATABASE_URL=<virgin db> npx prisma migrate deploy
19 migrations found in prisma/migrations
Applying migration `20250626_add_key_connector_fields`
Error: P3018
Database error code: 42P01
ERROR: relation "integration_connections" does not exist
```

**It died on migration 1 of 19 and produced one table** (`_prisma_migrations`).

The cause is ordering. Migrations apply in lexicographic order of directory
name, so `20250626_add_key_connector_fields` (June) runs *first* — but it does
`ALTER TABLE "integration_connections"`, and that table is created by
`20251128000000_baseline_full_schema` (November), five months later in name
order. The migration is written with `ADD COLUMN IF NOT EXISTS` throughout,
which is why it looked safe; `IF NOT EXISTS` guards the *column*, not the
*table*.

Every environment therefore got its schema from `prisma db push`, which writes
no migration — which is exactly how the history drifted this far without
anyone noticing.

## 2. There is still no schema deployment step in production

Verified directly, and **not yet fixed**:

| Where | Schema step |
|---|---|
| `render.yaml` `buildCommand` | `db:generate` only — that builds the Prisma **client**, not the database |
| `scripts/start-prod.sh` | none |
| `.github/workflows/ci-cd.yml` | none, and the deploy job is commented out |
| `scripts/start-cloud-app.sh` | `pnpm db:push` — but this is the **local dev** orchestrator (tmux, `ensure_local_postgres`) |

Adding a model or a column reaches production only if a human runs something by
hand. This is not theoretical: the `flow_sessions.user_id` column added for
session privacy (`18d599ae`) is a **security fix**, and no automated process
applies it.

Now that §3 gives `migrate deploy` a working path, adding that step is finally
a safe change. It was not safe before — it would have failed on migration 1.

## 3. What was done: the baseline was adopted

`prisma/migrations/` now contains exactly one migration, `0_baseline`,
generated from `schema.prisma` with:

```bash
prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

with `CREATE EXTENSION IF NOT EXISTS "vector";` prepended by hand — `migrate
diff` does not emit it, and `AiMemoryEmbedding.embedding` is
`Unsupported("vector(1536)")`, so the baseline fails on a virgin database
without it. (`docker-compose.yml` was also corrected from `postgres:16-alpine`,
which ships no pgvector, to `pgvector/pgvector:pg16`.)

The 19 previous migrations moved to `prisma/migrations-archive/`. **Order
mattered**: `0_baseline` sorts lexicographically before `20250626…`, so
installing it alongside the old folders would have created all 433 tables and
then aborted with 42P07 on the first duplicate. They had to be archived in the
same change, not after it.

Verified on a virgin `pgvector/pgvector:pg16` database:

```
$ npx prisma migrate deploy
Applying migration `0_baseline`
All migrations have been successfully applied.        exit 0

tables: 433
$ npx prisma migrate status      -> Database schema is up to date!
$ npx prisma migrate diff --from-url <that db> --to-schema-datamodel prisma/schema.prisma
                                 -> No difference detected.
```

An independent adversarial audit of the generated SQL (10 agents, one per
dimension) found the translation exact: 430 models to 433 tables with the gap
fully explained by 3 implicit m-n join tables, enums 16/16 including member
*ordering*, defaults 1641/1641 with zero missing or extra, unique indexes
179/179 name-for-name, and **534/534 foreign keys with zero `onDelete` or
`onUpdate` mismatches**.

### Existing databases

`0_baseline` describes a database that already exists, so it must be recorded
as applied rather than run:

```bash
pnpm --filter @keyflow/db exec prisma migrate resolve --applied 0_baseline
```

This writes one bookkeeping row and executes no DDL. **Skipping it on a
populated database means the next `migrate deploy` tries to create 433 tables
that are already there.** Done for local dev; **still required on production**.

## 4. The orphans — twelve, not four, and five held data

Tables that existed in the local database with no model in `schema.prisma`, no
Prisma client accessor, and no raw SQL reference anywhere in `apps/` or
`packages/`. They came from commit `c7ab974a` ("Phase 5: payroll MVP") on a
branch that never merged.

The earlier draft of this document said there were four and that they were
empty. There were **eleven tables plus one column**, and **five held a row
each** — all one business, all 2026-07-22, all self-identified as test data
(`payroll_runs.notes = 'verification run'`, `support_ticket_messages.id =
'p11_msg_1'`). Re-checking immediately before dropping is what caught it.

Everything was dumped **with data** to
`prisma/migrations-archive/ORPHAN_TABLES.sql` (restore verified against a real
database, not assumed) before anything was removed. Worth keeping rather than
deleting: `pay_rates`, `payroll_items`, `payroll_runs` and
`staff_performance_snapshots` are the data layer for people/HR, the next organ
scheduled to be built, and they reference `org_assignments`, which is live.

One piece is **not yet applied** — `prisma/migrations-archive/CLOSE_LOCAL_DRIFT.sql`
removes an `org_assignments` row named 'Test Payroll Clerk' plus the dead
"contact-only assignment" columns. It matters because `schema.prisma` declares
`org_assignments.membership_id` and `.user_id` NOT NULL while a contact-only
row has both null — so while that row exists, the real schema cannot be applied
to that database.

## 5. From here

- Schema changes go through `prisma migrate dev`, which now works.
- **Production still needs `migrate resolve --applied 0_baseline` once**, then a
  `prisma migrate deploy` step in the deploy path (§2).
- `db push` should no longer be used outside throwaway databases. It drops
  columns and tables `schema.prisma` no longer declares, and this repo has
  already demonstrated a database holding twelve such objects.
