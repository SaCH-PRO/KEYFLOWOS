# Schema deployment — the actual state, and how to fix it

Written 2026-08-03 while investigating "migration drift". The drift turned out
to be a symptom. This is the disease.

---

## 1. There is no schema deployment step in production

Verified directly:

| Where | Schema step |
|---|---|
| `render.yaml` `buildCommand` | `db:generate` only — that builds the Prisma **client**, not the database |
| `scripts/start-prod.sh` | none |
| `.github/workflows/ci-cd.yml` | none, and the deploy job is commented out |
| `scripts/start-cloud-app.sh` | `pnpm db:push` — but this is the **local dev** orchestrator (tmux sessions, `ensure_local_postgres`) |

**Nothing applies schema changes to production.** Adding a model or a column to
`schema.prisma` reaches production only if a human runs something by hand.

This is not theoretical. The `flow_sessions.user_id` column added for session
privacy (`18d599ae`) is a security fix, and no automated process will apply it.

## 2. The migrations directory is vestigial

```
models in schema.prisma ............ 430
tables created by migrations/ ....... 11
```

`prisma migrate deploy` against an empty database produces **11 tables**, not
430. The migration history was abandoned early and the schema has been kept in
sync by `prisma db push` ever since — which writes no migration.

Consequences that have already bitten:

- Nine migrations existed in the local database with no files on disk. They came
  from commit `c7ab974a` ("Phase 5: payroll MVP") on a branch that **never
  merged to main**. Someone ran them locally; the branch was abandoned; the
  tables stayed.
- `OrgAssignment` and `DelegationRule` are live models queried by
  `structure.service.ts`, and **no migration creates them**. On any freshly
  migrated database that code fails at runtime.
- Four tables exist in the local dev database (`payroll_runs`,
  `staff_performance_snapshots`, `support_ticket_messages`, and contract-clause
  tables) whose models are **not in `schema.prisma`**. All are empty.

## 3. What was fixed on 2026-08-03

`prisma migrate status` now reports **"Database schema is up to date"**. Two
migrations were reconciled with `migrate resolve --applied`, which writes
bookkeeping rows only and runs no DDL:

- `20250626_add_key_connector_fields` — its three columns and the
  `connector_audit_logs` table were already present, and the SQL is written with
  `IF NOT EXISTS` throughout, so it was already effectively applied.
- `20260803180000_flow_session_user_scope` — applied by hand
  (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) precisely because `migrate dev`
  would have seen the drift above and offered to reset the database.

That makes the status output honest. It does **not** make the migrations
directory able to build a database.

## 4. An accurate baseline is ready, and is NOT yet installed

`packages/db/prisma/baseline/schema-baseline.sql` — 13,589 lines, **433
`CREATE TABLE` statements**, generated with:

```bash
pnpm --filter @keyflow/db exec prisma migrate diff \
  --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

It is staged rather than installed, because adopting it changes migration
history for **every** developer and every environment. That is a decision for
the repo owner, not a side effect of a bug investigation.

### To adopt it

1. Move the existing 19 migration folders to `prisma/migrations-archive/`
   (they remain in git history regardless — do not delete them).
2. Move `baseline/schema-baseline.sql` to
   `prisma/migrations/0_baseline/migration.sql`.
3. On **every existing database**, including production:
   ```bash
   pnpm --filter @keyflow/db exec prisma migrate resolve --applied 0_baseline
   ```
   This records the baseline as applied without running it. Skipping this on a
   populated database means the next `migrate deploy` tries to create 433 tables
   that already exist.
4. From then on, schema changes go through `prisma migrate dev`, and deployment
   gains a `prisma migrate deploy` step.

### Before adopting, decide about the four orphan tables

`payroll_runs`, `staff_performance_snapshots`, `support_ticket_messages` and the
contract-clause tables exist in databases that ran the abandoned branch, and are
absent from `schema.prisma`. They are empty locally. After baselining, any
`prisma db push` will want to drop them and will refuse without
`--accept-data-loss`, which can block a deploy. Either restore the models or
drop the tables deliberately — do not let a deploy discover this.

## 5. Until then

`db push` remains the only working mechanism. It is genuinely risky in
production: it drops columns and tables that `schema.prisma` no longer declares,
and this repo has already demonstrated a database holding tables the schema does
not know about.

If a schema change must reach production before baselining, apply it by hand as
additive SQL — `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` — the
way `20260803180000_flow_session_user_scope` was applied, and commit the
matching migration file so the eventual baseline includes it.
