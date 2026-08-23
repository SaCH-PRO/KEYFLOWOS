# KEYFlowOS Testing Guide

How tests are organized, how to run them, and how to categorize new ones.
Every command and path in this document is checked by
`apps/server/src/core/config/doc-debt-ledger.spec.ts` — if you rename a
script, this file fails the build until the prose follows.

---

## Test categories (apps/server)

| Category | Pattern | Config | Run |
|----------|---------|--------|-----|
| Unit / controller / service | `src/**/*.spec.ts` | `vitest.unit.config.ts` | `pnpm --filter server test:unit` |
| Smoke | `test/*.smoke.test.ts` | `vitest.smoke.config.ts` | `pnpm --filter server test:smoke` |
| Integration / e2e | `test/*.integration.test.ts` | `vitest.integration.config.ts` | `pnpm --filter server test:integration` |
| Everything (what CI runs) | all of the above + plain `test/*.test.ts` | default `vitest.config.ts` (no include filter) | `pnpm --filter server test:ci` |

There is **no flaky/quarantine suite**. A previous version of this document
described one (`vitest.flaky.config.ts`, `test:flaky`, three quarantined
files); none of it ever existed in-tree. A flaky test gets fixed or deleted,
not parked: order-dependence is actively hunted — the unit config runs with
`sequence.shuffle: true`, and a shuffled failure is reproducible by the seed
vitest prints (`--sequence.seed=<n>`; quote the seed when reporting one).

`test-config-coverage.spec.ts` asserts every test file is claimed by at least
one config, and `test-coverage-gating.spec.ts` asserts `test:ci` stays
unfiltered — a new suffix or directory cannot silently drop out of CI.

## Web tests (apps/web)

Vitest unit/structural specs (jsdom): `pnpm --filter web test:unit`.
Playwright e2e (not in CI): `pnpm --filter web test:e2e`.
The structural gates in `apps/web/src/lib/__tests__/` (nav-reachability,
no-fabricated-screens, tool-routes, …) run in the unit suite.

---

## Running tests

```bash
# What CI runs for the server (needs Postgres + Redis for integration files)
pnpm --filter server test:ci

# Fast local loop (src specs only, isolate:false + shuffle, ~41s)
pnpm --filter server test:unit

# Web
pnpm --filter web test:unit
```

A vitest **skip is a failure**: a thrown `beforeAll` reports as "skipped",
so a green run with skips may have run nothing. `0 skipped` is part of the
pass criterion everywhere in this repo.

---

## Adding a new test

1. Decide the category first; use the matching suffix and directory.
2. Keep unit tests deterministic — no live network or DB.
3. Structural gates (specs that read the tree and enforce an invariant) live
   in `apps/server/src/core/config/` and must satisfy
   `gate-vacuity.spec.ts`: a gate that finds nothing must prove it looked
   (assert your input list was non-empty).
4. Shrink-only ledgers follow the pattern in
   `apps/server/src/core/prisma/tenant-model-list.spec.ts`: ledger constant,
   no-new, no-ghosts, no-stale, and a negative control on every removal.

---

## CI expectations

- The `test` job in `.github/workflows/ci-cd.yml` provisions Postgres
  (pgvector) + Redis, applies migrations via `db:deploy`, then runs
  `pnpm --filter server test:ci` and the web unit suite.
- Integration failures block merges. There is no non-blocking test tier.
