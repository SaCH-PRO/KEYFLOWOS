# What production actually is

Measured 2026-08-03 against the live Supabase database. Read this before
planning any deploy. **Nothing in this document has been acted on** — production
was inspected read-only and not modified.

---

## The headline

**Production cannot run this codebase.** It has 29 tables. `schema.prisma`
needs 433.

| | Production | This repo |
|---|---|---|
| Tables in `public` | **29** | **433** |
| Migration history | 2 migrations, both from 2025-11-30 | `0_baseline` + 1 |
| Schema last changed | **2025-11-30** | today |

Production's `public` schema has been frozen for **eight months**. The codebase
has not.

## Why the health check says everything is fine

```
GET https://api.keyflowos.com/readyz
{"status":"ready","db":{"ok":true,"latencyMs":1}}
```

`readyz` proves the process can reach Postgres. It does not ask whether the
tables the application needs exist. They mostly do not — so the service reports
healthy while almost every feature would fail on its first query.

## Production's migration history is a different lineage

```
20251130133442_crm_overhaul
20251130135312_crm_quote_invoice_status
```

Neither exists in this repo — not in `prisma/migrations/`, not in
`prisma/migrations-archive/`. They are not older versions of anything here. That
database was built from a branch that no longer exists.

This is why `migrate resolve --applied 0_baseline` would have been a serious
mistake. It asserts "the 433 tables are already here" and writes no DDL. On this
database that assertion is false 404 times over, and Prisma would have believed
it permanently — `migrate deploy` would then report nothing pending forever
while the schema stayed at 29 tables.

`scripts/prepare-production-db.ps1` refuses to proceed here, which is what the
schema-comparison gate exists for.

## The 29 tables, and what is in them

```
_ServiceToStaffMember  automations  availabilities  bookings  businesses
contact_events  contact_notes  contact_tasks  contacts  invoice_items
invoices  memberships  payments  products  project_tasks  project_templates
projects  quote_items  quotes  services  sessions  sites  social_connections
social_posts  staff_members  user_profile_history  user_profiles  users
```

Every one is empty except:

| Table | Rows | What |
|---|---|---|
| `businesses` | 3 | all owner-created workspaces (`sachdookie@gmail.com`, `sachdookie.pro@gmail.com`), Dec 2025 – Jan 2026 |
| `memberships` | 2 | matching |
| `users` | 2 | matching |

**There is no customer data to protect in `public`.**

Note `user_profiles` and `user_profile_history` are in neither `schema.prisma`
nor `0_baseline` — they belong to the abandoned lineage.
`user_profile_history` carries a foreign key into `auth.users`, which is why
`prisma migrate diff --from-url` fails against this database with **P4002**
(cross-schema reference; `auth` is not in the datasource `schemas`).

## What must NOT be touched

Supabase owns several schemas here: `auth`, `storage`, `realtime`, `vault`,
`graphql`, `graphql_public`, `extensions`.

**`auth` holds 19 real accounts, one of which signed in on 2026-08-03.** Those
are live logins and are entirely separate from the 3 workspaces above. Any
rebuild of `public` must leave `auth` alone.

Checked and confirmed: there are **no custom triggers** wiring `auth.users` to
anything in `public`, so rebuilding `public` does not break authentication.

## What a real deploy would therefore involve

Not the baseline-resolve path. That was designed for a database that already had
the 433 tables. This one does not, so the shape is different:

1. Decide the fate of the 3 owner workspaces — almost certainly disposable,
   but that is the owner's call, not an assumption.
2. Drop the 29 `public` tables (or start a clean database), leaving every
   Supabase-managed schema untouched.
3. Let `0_baseline` **actually run**, creating all 433 tables, followed by
   `20260803190000_flow_session_user_scope`.
4. Point `DATABASE_URL`/`DIRECT_URL` at it and deploy.

Step 3 is already proven: on a virgin `pgvector/pgvector:pg16` database
`migrate deploy` produces 433 tables at exit 0 with `migrate diff` reporting
"No difference detected".

**One caveat to check first:** Supabase must have the `vector` extension
available, since `AiMemoryEmbedding.embedding` is `Unsupported("vector(1536)")`
and `0_baseline` opens with `CREATE EXTENSION IF NOT EXISTS "vector"`. Supabase
ships pgvector, so this is expected to work, but confirm before relying on it.

## Credentials

The connection strings were supplied in chat to perform this inspection. The
database password is therefore in a conversation transcript and **should be
rotated** in the Supabase dashboard (Settings → Database → Reset password) when
convenient. No credential is stored in this repository.
