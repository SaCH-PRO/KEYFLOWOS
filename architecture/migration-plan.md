# Migration Plan

This document tracks the planned migration from the current architecture to the `target-architecture.md` state. It is a living document: append a dated changelog entry after each completed phase.

## Current Baseline (as of 2026-08-09)

- 109 NestJS feature modules; `key-cortex` is the largest at ~248 files.
- Heavy `forwardRef` cycles between AI/Cortex/Autonomy/Commerce/CRM.
- Tenant isolation via Prisma extension; `create`/`upsert`/`aggregate`/`groupBy` not intercepted.
- Web API layer split between new `src/lib/api/*` wrappers and legacy `src/lib/client.ts`.
- 224 `/app/**` routes, 157 orphaned.
- 276 events, 111 published-only, 30 listened-only.

## Phases

### Phase 1 — Map and Stabilize (in progress)

**Goal:** Establish accurate architecture memory and stop further architectural debt.

- [x] Create `codebase-architect` skill package.
- [x] Seed `/architecture/` baseline documents.
- [x] Add deterministic scanners (`inventory.py`, `dependency_scan.py`).
- [x] Append Codebase Architect Policy to `AGENTS.md`.
- [ ] Enforce map-before-modifying in agent runs.
- [ ] Add CI check that runs `inventory.py` and `dependency_scan.py` on PRs and fails on unexpected diffs.

**Verification:**

- `python .agents/skills/codebase-architect/scripts/inventory.py` runs without errors.
- `python .agents/skills/codebase-architect/scripts/dependency_scan.py` runs without errors.
- All `/architecture/*.md` files are present and non-empty.

### Phase 2 — Tenant Isolation Hardening

**Goal:** Remove tenant isolation blind spots.

1. Audit every service that calls `create`, `createMany`, `upsert`, `aggregate`, or `groupBy` on tenant models.
2. Add `businessId` validation helper and migrate the top 20 write paths.
3. Provide `runWithTenant` wrapper for BullMQ workers and cron jobs.
4. Add integration tests that fail if a cross-tenant read/write succeeds.

**Affected files:** `packages/db/src/client.ts`, `apps/server/src/core/tenant/*`, many `*.service.ts` files.

**Verification:**

- New integration test suite for tenant isolation passes.
- `architecture-risks.md` R3 and R4 severity reduced to Low.

### Phase 3 — AI / Cortex Decoupling

**Goal:** Reduce `key-cortex` size and break circular dependencies.

1. Extract `key-context` service that defines a stable read-only context contract.
2. Move LLM gateway and tool registry to a new `ai-platform` domain folder.
3. Replace direct service imports from domain modules into `key-cortex` with event-driven commands.
4. Split `key-cortex` into `key-agent`, `key-reasoning`, `key-insight`.

**Affected files:** `apps/server/src/modules/ai/*`, `apps/server/src/modules/key-cortex/*`, dependent domain modules.

**Verification:**

- `key-cortex` file count below 180.
- Zero new `forwardRef` cycles; existing cycles reduced.
- All AI-affected tests pass.

### Phase 4 — Web API Layer Consolidation

**Goal:** Retire `apps/web/src/lib/client.ts`.

1. Inventory all `client.ts` imports.
2. For each domain, create or expand `src/lib/api/<domain>.ts`.
3. Migrate consumers one domain at a time.
4. Delete `client.ts` once imports reach zero.

**Affected files:** `apps/web/src/lib/client.ts`, `apps/web/src/lib/api/*`, many page/component files.

**Verification:**

- `grep -r "from '@/lib/client'" apps/web/src` returns no results.
- Typecheck and e2e tests pass.

### Phase 5 — Dead Code and Route Cleanup

**Goal:** Reduce noise and maintenance surface.

1. Review 157 orphaned routes; remove or add nav/launcher entries.
2. Audit 111 published-only and 30 listened-only events; remove dead events or add listeners.
3. Remove confirmed dead code (`packages/api/src/context.ts` if unused, stub routers if superseded).

**Affected files:** `apps/web/src/app/app/**/*`, `packages/api/src/routers/*`, `core/event-bus/events.types.ts`.

**Verification:**

- Orphaned routes below 100.
- Event registry count stable or reduced.
- CI build/lint/test pass.

### Phase 6 — Data Model Consolidation

**Goal:** Clarify the Prisma schema.

1. Identify legacy/experimental models.
2. Rename or remove unused models in a migration-safe way.
3. Introduce projections for heavy dashboard queries where needed.

**Affected files:** `packages/db/prisma/schema.prisma`, migrations, query services.

**Verification:**

- `prisma migrate dev` succeeds.
- Integration tests pass.

### Phase 2B — End-to-End Feature Hardening (new)

**Goal:** Move all user-facing features from "implemented / partially working" to verifiable end-to-end working.

**Source document:** `docs/development/e2e-hardening-plan.md`

**Priority order:**

1. P0 stop-the-line fixes (admin auth, unguarded endpoints, token encryption/tenant isolation gaps).
2. P1 core journey fixes (onboarding durability, AI provider, CRM sequence dispatch, finance correctness, booking validation).
3. P2 feature completeness (projects, documents/evidence/content ops, integrations, marketing polish).
4. P3 polish and architecture (dead code, build/test CI, database hygiene, AI/Cortex decoupling).

**Verification:** Each deliverable in `docs/development/e2e-hardening-plan.md` has explicit acceptance criteria and file references.

### Platform & Workflow Convergence — successor programme (INACTIVE)

**Goal:** Reach the "Platform, Data-Plane and Delivery Target" in `target-architecture.md`.

**Source documents:** `docs/development/KEYFLOWOS_PLATFORM_CONVERGENCE_PROGRAMME.md`
(narrative, gates, completion contract) and `docs/development/KEYFLOWOS_PLATFORM_DAG.yaml`
(63 packets with explicit dependency edges; the executable order). This section is a
summary; the DAG is authoritative for ordering.

**Status:** not started and not authorized. It activates only on a ChatGPT `DIRECTIVE` on
issue #80 carrying `programme: KEYFLOWOS_PLATFORM_CONVERGENCE` and
`programme_action: ACTIVATE`, and it does not displace the application convergence
programme or any hold on it.

| Group | Scope | Packets |
|---|---|---|
| P0 | activate the successor safely; Copilot disposition as admission input | KF-PLAT-AUTO-001..003 |
| P1 | canonical Vercel frontend, domain cutover, Hetzner web retirement | KF-INFRA-001..005 |
| P2 | Supabase lineage, identity boundary, one application database | KF-DATA-001..005 |
| P3 | isolated staging; previews cannot mutate production | KF-STAGE-001..006 |
| P4 | GHCR images, pull-by-SHA deploy, rollback, promotion | KF-DEPLOY-001..006 |
| P5 | backups, PITR, object storage, restore drill | KF-RESILIENCE-001..005 |
| P6 | Sentry, release identity, logs, OpenTelemetry, alerting | KF-OBS-001..006 |
| P7 | rulesets, CODEOWNERS, merge queue, CI, supply-chain security | KF-GOV-001..003, KF-CI-001..002, KF-SEC-001..003 |
| P8 | env schema, secret inventory, secrets platform, drift proof | KF-CONFIG-001..005 |
| P9 | worktree isolation, claims, conflict admission, unattended launch | KF-AGENT-001..007 |
| P10 | infrastructure as code and clean-machine rebuild | KF-IAC-001..004 |
| P11 | whole-stack reassessment, failure matrix, final checkpoint | KF-QUAL-001..003 |

**Human gates:** production deploy/release, production mutation, production data
mutation, DNS/domain cutover, destructive data/schema action, paid resources,
secret/OAuth entry without a safe connected writer, unauthorized provider traffic,
major architecture override, and any gate weakening; plus every `never_automatic`
effect of `AGENT_AUTOPILOT_POLICY.yaml`, inherited unchanged.

**Verification:** `node scripts/agent-control/validate-platform-dag.mjs` and
`scripts/agent-control/tests/platform-dag.spec.mjs`; per packet, the programme's
completion contract.

## Changelog

### 2026-10-05 — Reviewed re-anchor of the programme checkpoint at RECOVERY-021

- KF-META-STATE-REDUCER-LIVE-001 (PR #120), RECOVERY-021. `.agent-control/programme-state.yaml`
  is re-derived whole and anchored to RECOVERY-021 (5993146604, generation 87), past the
  malformed RULING-020 (5985754624) that stopped the fold for every packet. The programme
  it records is unchanged. No code changes: the parser, the fold, `orchestrate.mjs` and
  `lib/state.mjs` are as FINAL-CORRECTION-020 left them, with no new module, export or
  import edge.
- `fixtures/reducer-recovery-truth.json` now records the 205 real #80 comments through the
  new anchor, and the recovery tests replay the previous checkpoint stopping at RULING-020.
- No application runtime, schema, deployment or production change.

### 2026-10-04 — An invalid checkpoint is not journaled onto, and its holds are not rendered

- KF-META-STATE-REDUCER-LIVE-001 (PR #120), FINAL-CORRECTION-020. Two bounded corrections
  to readers of a checkpoint the state contract rejects, with no new module, no new
  export and no new import edge:
  - K1, `orchestrate.mjs`: `--apply` runs `validateState()` on the stored checkpoint before
    the journal step. An invalid one is not journaled onto and nothing is written; the
    output keeps the `REPORT_DRIFT` decision and adds `apply_refused`
    (`CHECKPOINT_INVALID`, with the contract problems). The exit code is 0.
  - K2, `lib/state.mjs`: `activeHolds()` reads `holds`, its entries and the legacy `hold`
    only when they are mappings, so `holds: none` or `hold: text` gives no hold entry in
    a decision or in `status.mjs`.
- No application runtime, schema, deployment or production change.

### 2026-10-04 — Checkpoint shape, refused-hold audit and string identities

- KF-META-STATE-REDUCER-LIVE-001 (PR #120), CONVERGED-CORRECTIONS-018. Three bounded
  corrections to the control plane, with no new module and no new import edge:
  - K1, `lib/events.mjs`: a claimed HOLD or RESUME that is refused because it is not
    authority records the reason in `wake_refused`, beside `authority.problems`.
  - K2, `lib/state.mjs`: `normalizeState()` defaults an absent container only. One that is
    present with the wrong structural type is left as written and `validateState()`
    rejects it (`CHECKPOINT_SHAPE_INVALID`), so `holds: []` no longer loads as `{}`.
    New export `shapeProblems()`.
  - K3, `lib/admission.mjs`: a packet id or branch binds only as a string
    (`packet_id_not_a_string`); `1` and `"1"` are not one identity.
- `status.mjs` reads the checkpoint's lists only when they are lists, so an invalid
  checkpoint is rendered as drift.
- No application runtime, schema, deployment or production change.

### 2026-10-04 — The reviewed checkpoint is validated before the fold

- KF-META-STATE-REDUCER-LIVE-001 (PR #120), CHECKPOINT-VALIDATION-017.
  `reduceAuthority()` checks the checkpoint with `validateState()` once its anchor is
  found. A checkpoint the state contract rejects is never folded from, with zero or more
  newer messages (`CHECKPOINT_INVALID`), and `reconcile()` reports `DERIVED_STATE_INVALID`,
  so `decide()` returns REPORT_DRIFT (`execution-paths.md` §12). Before this an invalid
  checkpoint whose anchor was the newest authority reached `decide()` unchecked.
- New import edge: `lib/reconcile.mjs` → `lib/state.mjs` (`validateState`). No cycle;
  `state.mjs` imports neither.
- The checkpoint, the parser, the effects and the per-step validation are unchanged. No
  application runtime, schema, deployment or production change.

### 2026-10-04 — Typed HOLD and RESUME comments wake orchestration

- KF-META-STATE-REDUCER-LIVE-001 (PR #120), RULING-012 R12-K1. `lib/events.mjs` adds HOLD
  and RESUME to the #80 wake types. Such a comment wakes only as valid authority that
  declares its own effect (`HOLD_SET` on a HOLD, `HOLD_CLEAR` on a RESUME) in a created,
  unedited comment (`execution-paths.md` §12). Before this a hold or release changed the
  projection but dispatched nothing until some other event ran the autopilot.
- New import edge: `lib/events.mjs` → `lib/authority-effects.mjs` (`readEffect`). No cycle;
  `authority-effects.mjs` does not import `events.mjs`.
- The local worker selector, the workflow file and the wake rules of the other message
  types are unchanged. No application runtime, schema, deployment or production change.
- RECOVERY-REANCHOR-015 and EXACT-BINDING-016: `.agent-control/programme-state.yaml` is
  re-derived whole and anchored to EXACT-BINDING-016 (5982685256), past a malformed REVIEW
  for another packet (5982337036) that stopped the fold. The parser and the fold are
  unchanged, and `fixtures/reducer-recovery-truth.json` now records the real #80 comments
  through the new anchor.
- EXACT-BINDING-016: `lib/admission.mjs` compares an artifact's packet id and branch with
  the PR exactly; surrounding whitespace no longer matches.

### 2026-10-03 — Live typed-authority reducer integrated into the control plane

- KF-META-STATE-REDUCER-LIVE-001 (PR #120). `.agent-control/programme-state.yaml` is now a
  reviewed checkpoint, and `scripts/agent-control/lib/authority-effects.mjs` folds every
  newer issue #80 authority message that declares `control_effect:` over it.
  `orchestrate.mjs` and `status.mjs --verify` decide on that effective projection
  (`execution-paths.md` §12). The projection is never written back.
- New import edges, in one direction: `lib/truth.mjs` → `lib/reconcile.mjs` →
  `lib/authority-effects.mjs` → `lib/control-envelope.mjs`, `lib/state-machine.mjs` and
  `lib/state.mjs` (`dependency-map.md`, "Agent Control Plane: Authority Fold").
- The exact-head merge path stays separate from the projection. `lib/admission.mjs` now
  binds both control artifacts to the PR being admitted (packet, `implementation_branch`
  against the PR `head_ref`, and PR number) before it reads anything else from them.
- `lib/yaml.mjs` defines every mapping key as an own property and quotes any key its
  parser would not read back as the same key, so holds keyed by any non-blank packet id
  survive a checkpoint save and reload.
- `inventory.py` and `dependency_scan.py` now record `meta.root` as `.` instead of the
  absolute path of the checkout that ran them, so the generated maps are the same in
  every checkout of the same tree. Both scanners were re-run, and
  `architecture/inventory.json` and `architecture/dependencies.json` regenerated.
- No application runtime, schema, deployment or production change. The platform
  convergence programme stays inactive.

### 2026-09-25 — Successor platform programme recorded (inactive)

- Recorded the platform/workflow convergence successor programme (PR #93) in
  `target-architecture.md` and this plan so the architecture memory has one target.
- Added validation-only control-plane code: `scripts/agent-control/lib/platform-dag.mjs`
  (DAG gate/activation contract validator and a pure activation-state evaluator), the
  `validate-platform-dag.mjs` CLI and `tests/platform-dag.spec.mjs`. None of it is wired
  into the orchestrator, worker or selector.
- No application runtime, schema, deployment or production change; the programme is
  inactive.
- Re-ran `inventory.py` and `dependency_scan.py` so the new documents and validator
  appear in `architecture/inventory.json` and `architecture/dependencies.json`.

### 2026-08-30 — Deep scan and E2E hardening plan

- Ran deterministic scanners (`inventory.py`, `dependency_scan.py`) and refreshed `architecture/inventory.json` and `architecture/dependencies.json`.
- Performed read-only deep scans of 15 domains via parallel agents.
- Wrote `docs/development/e2e-hardening-plan.md` with P0–P3 priorities, sprint schedule, and verification criteria.
- Added Phase 2B to the migration plan referencing the new hardening document.

### 2026-08-09 — Baseline seeded

- Created `codebase-architect` skill package.
- Seeded `/architecture/` with system overview, repository map, dependency map, execution paths, data model, module registry, risks, target architecture, and migration plan.
- Added deterministic `inventory.py` and `dependency_scan.py` scripts.
- Updated `AGENTS.md` with Codebase Architect Policy.
