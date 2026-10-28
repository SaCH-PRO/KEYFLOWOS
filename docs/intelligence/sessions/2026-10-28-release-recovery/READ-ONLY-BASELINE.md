# KEYFLOWOS release recovery — read-only implementation baseline
**Observation date:** 2026-10-28 17:47 UTC (Supabase); GitHub/Vercel inspected in the same session.
**Evidence class:** VERIFIED CONNECTED SUPABASE OBSERVATION + VERSIONED SOURCE; actual production not verified; not release authority.
**Source main:** `b1948d2797e1bae3660a3d7173abb75397e05aad`
**Related issue:** #45 (KEYFLOWOS 1.0 Stabilization & Experience Program).
**Status:** WRONG-DATABASE INFERENCE CORRECTED; ACTUAL PRODUCTION SCHEMA UNKNOWN; NO CUTOVER AUTHORIZED.

## IMPORTANT CORRECTION — 2026-10-28: connected Supabase is NOT established as production

**WITHDRAWN CLAIM:** The original report presented a fresh 29-table count from a connected Supabase project as proof of a 29-table *production* database and an established production migration blocker. That inference is invalid. `docs/DEPLOY_RUNBOOK.md` carries a superseding 2026-08-08 banner: the real KEYFLOWOS production host was a Hetzner VPS using Docker Compose from `/opt/keyflowos`; a backup of its running database reportedly contained **443 tables and 24 applied migrations** on 2026-08-08. The 29-table count then was attributed to the wrong database (an old Render-era or other inactive environment). The connected Supabase project *still* has 29 public tables as observed today, but its identity as the running app database is **not verified and should not be assumed**. Both old counts are historical evidence of distinct targets, not a current VPS measurement.

**Correct release conclusion:** Current production database schema parity is UNKNOWN; it is *not established as broken*. Confirm current VPS API, Docker Compose process and attached database identity using read-only host-side evidence; then run schema/migration checks against that exact host. Do not run any migration, baseline resolve, reset, deploy or data deletion based on this connected Supabase project's schema. `docs/PRODUCTION_STATE.md` was superseded by later forensic evidence and must not be used to identify production. This correction governs every statement below.

## Why this record exists
The operator directed autonomous, cost-conscious delivery of a usable application, without losing the full Business Genome / KEY product vision. The repository's older migration and launch documents disagree, and old health checks can be green against an incompatible physical schema. This file preserves a direct, timestamped read-only observation and actionable gates, without mistaking a plan for execution.

## Verified connected Supabase evidence (NOT verified production; SELECT only)
Project: connected KEYFLOWOS Supabase project in us-east-2 (project ID deliberately omitted from this public evidence document). Server reports PostgreSQL 17.6 and `ACTIVE_HEALTHY` project status.

| Observation | Value | Evidence |
|---|---:|---|
| `public` ordinary tables | **29** | `pg_class` and `pg_namespace` catalog SELECT |
| `public` tables with RLS enabled | **2** | `pg_class.relrowsecurity` |
| `public` tables without RLS | **27** | same catalog query |
| Non-RLS `public` tables with direct SELECT/INSERT/UPDATE privilege granted to `anon` or `authenticated` | **0** | `has_table_privilege` |
| Auth users | **37** | `count(*) FROM auth.users` |
| App `public.users` rows | **2** | aggregate SELECT |
| `public.businesses` rows | **3** | aggregate SELECT |
| `public.memberships` rows | **2** | aggregate SELECT |
| Applied Prisma migrations | **2** | `public._prisma_migrations` |
| Migration lineage | `20251130133442_crm_overhaul`, `20251130135312_crm_quote_invoice_status` | migration history SELECT |
| PostgreSQL vector extension | Present | `pg_extension` |

**Precise security interpretation:** RLS coverage is low, but the direct `anon` and `authenticated` table privileges tested above are absent on the non-RLS tables. This is NOT proof of an exposed client Data API, nor proof of end-to-end tenancy safety. Test service-role, API authorization, function/view grants and websocket/connector paths separately. Do not make a public breach claim from this count.

## Versioned code evidence
- `packages/db/prisma/schema.prisma` at main above has **441 `model` declarations**, 16 `enum` declarations, and 12,864 text lines. Physical table count is not exactly Prisma-model count because of mapped/implicit join tables; 29 public tables would be incompatible if that were the production target, which is not established.
- `packages/db/prisma/migrations/` includes `0_baseline` and subsequent application migrations through `20261005170000_key_action_boundary_clearance`.
- The current `apps/server/src/app.controller.ts` `/readyz` handler calls only `PrismaService.isHealthy()`: DB connectivity can report READY when essential tables are missing. It is a liveness/dependency signal, **not schema parity evidence**.
- `scripts/verify-up.sh` checks HTTP status codes, not a real data-backed user journey. `apps/web/e2e/live-journey.spec.ts` does exist and exercises signup against an actual stack, but is skipped unless `E2E_LIVE=1`; it writes live rows and must never be run against production casually.
- `docs/PRODUCTION_STATE.md` already reported **29** public tables (2026-08-03). Today's observation confirms 29 tables in the connected Supabase project only, which is not established as the active production database; it has 37 auth users. Older row counts and migration claims are not the sole evidence for today's assessment.
- `docs/LAUNCH_GUIDE.md` says `PRODUCTION READY` (2026-06-03); treat as **historical/stale claim**, not verified by a functional production runtime test.
- `docs/SCHEMA_DEPLOYMENT.md` includes a generic `migrate resolve --applied 0_baseline` sequence for an already-complete physical schema; that does **not** apply to this 29-table database.

## Deployment evidence (do not conflate with runtime health)
- Vercel project `keyflowos-web` has a `READY` production deployment from main `b1948d27` on 2026-10-24. This proves a frontend deployment was built, not functional business journeys.
- Vercel project `keyflowos-server` shows `ERROR` on its last several August production deployments, and older successful deployment evidence. The real API may be separately hosted (repo references a VPS / `api.keyflowos.com`). **Actual authoritative API runtime is UNKNOWN.**
- Direct probing `https://api.keyflowos.com/readyz` and `https://keyflowos.com` was not possible from this session's network/web access. Do not infer the host is down from an inaccessible probe.

## Current PR and programme evidence
- PR #181 F9 merge-authority hardening was merged on 2026-10-24 (`main b1948d27`).
- PR #155 (`KF-EXEC-AUTH-FAIL-CLOSED-001`) is still OPEN/DRAFT at `c269ad93eab99a1c0bf7773d2426d7a3da459d01`. All five GitHub workflow *conclusions* at this exact head were SUCCESS; this does not establish a real HawkScan/DAST run, successful Copilot reviewer, admission, or a merge grant.
- The October 21 appraisal reported 5/35 application packets checkpointed. Packet fraction is NOT a product completeness metric.
- The intelligence foundation branch's `07-CURRENT-STATE.md` and `CURRENT-HANDOFF.md` are stale relative to main. Their historical code claims must not override current GitHub heads, actual review authority or database observations.

**Context integrity:** FAIL FOR RELEASE EXECUTION (real API/database identity not verified; active release safety obligations and out-of-date intelligence handoff). PASSED FOR BOUNDED READ-ONLY TRIAGE. Never silently rebalance these labels.

## Safe first path to a working pilot (not a production mutation directive)
1. **Identify the real VPS database first, and preserve all state:** inventory app rows, `auth.users`, Supabase managed schemas, storage and login behavior. Create, verify and restore-test backups before proposing any production schema change; preserve existing 37 auth users and every real business row. No business is presumed disposable.
2. **Determine true API host and baseline** from deployment configuration, DNS, process logs and an actual authenticated test without printing secrets. Separate `/healthz`, `/readyz`, schema parity and end-to-end behavior. Evidence can remain UNKNOWN if network access blocks probes.
3. **Use a separate disposable staging database** with pgvector and the current **full** migration chain. Apply real `0_baseline` DDL there, then subsequent migrations. Prove `prisma migrate deploy`, `prisma migrate diff`, user signup and cross-tenant isolation. No production baseline-resolve shortcut.
4. **Choose a supported, reversible cutover** after inspecting all actual database relationships and backups. Do not `DROP public`, `db push`, `migrate reset`, `migrate resolve --applied 0_baseline` on the connected 29-table Supabase project or unverified VPS database, or blind-migrate incompatible schema. Changing a production database is a separate security/backup/release decision.
5. **Complete PR #155 through the existing exact-head semantic review, admission and merge-grant process**. Do not treat draft status and five green workflow badges as proof of permission.
6. **Prove one isolated pilot tenant journey:** authenticated business creation -> contact -> service -> public booking -> invoice and test payment state -> cockpit snapshot -> KEY draft-only follow-up, plus negative second-tenant read/write tests. No provider send or paid live transaction as part of the first proof.
7. **Make the known existing checks honest:** `scripts/verify-up.sh` is network health only, Playwright `live-journey` is a real DB-writing test and must run only on staged infrastructure. A schema-compatibility release check and data-backed tests should be blocking before production promotion.
8. **Budget guard:** reuse existing registry, tests, models and connectors; measure and disable optional paid/redundant activity only with separately reviewed operational authorization. No parallel replacement AI runtime or speculative dependency expansion.

## Relevant canonical concepts and journeys
Preserve the foundation's distinction: **Business Blueprint = declared/configured facts; Business Genome = evidence-backed, evolving interpretation; Constitution = governed operating rules**. KEY supplies intelligence subject to business, human and capability authority, not unrestricted permission. Pilot touches J1 Business Birth, J3 Lead -> Cash, J4 Booking -> Service -> Payment, J2 KEY Request -> Governed Action, J17 Command Center and J19 Privacy/Exit, plus K1 tenancy/identity and K2/K3 authority. Avoid inventing a new source of truth.

## Immediate reproducible verification — connected Supabase only
The companion `READ-ONLY-POSTGRES-INSPECTION.sql` contains the precise aggregate/catalog queries used to establish today's connected Supabase schema, migration and privilege snapshot, NOT the VPS production schema. It returns no customer names, emails, credentials or row contents. Run only with authorized read-only/admin diagnostic access. Mark every unrun check as UNKNOWN; record timestamp, target project/commit (privately), evidence, exceptions, decision and rollback path before release.

**What was NOT done:** no Docker/Node stack launch (repo not checked out locally in this tool environment); no direct authenticated web/API probe; no production write; no schema migration; no backup, staging environment, payment, provider send, PR #155 transition, merge, or deployment. This document is an implementation recovery checkpoint, not a claim that the product is already running.
