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

### One command: `pnpm test:local`

`bash scripts/test-local.sh` (or `pnpm test:local -- <options>`) runs, in
order: resource admission, `docker compose up -d db redis`, `pnpm db:generate`,
the workspace package builds, `pnpm db:deploy`, `pnpm --filter server build`
and the selected vitest run. `--plan` prints those steps and runs nothing.

```bash
pnpm test:local -- --plan                      # what would run, in order
pnpm test:local -- --suite release0            # every proof manifest, judged at HEAD (default)
pnpm test:local -- --suite server              # the whole server suite (test:ci)
pnpm test:local -- --suite test/release0-journey.integration.test.ts
pnpm test:local -- --packet R0-16 --no-compose # in a worktree; services already up
```

Admission comes first and cannot be skipped; when it refuses, nothing else
runs. It is `scripts/proof-admission/admit-resources.mjs`: in a worktree with
`--packet <id>` it admits only the packet's own database `kf_wt_<id>` and
Redis index (provisioned by `bash scripts/worktree-resources.sh provision <id>`
from the main tree), in CI it uses `scripts/proof-admission/manifests/ci-resources.json`,
and in a main checkout the same local-only rules without the CI identity. A
non-local `DATABASE_URL`, `DIRECT_URL` or `REDIS_URL` is refused. Values come
from the shell, else from the repo-root `.env`; an exported value wins.
`--skip compose,generate,workspace,deploy,build` drops steps you have already
done. CI runs `bash scripts/ci/test-local.selftest.sh`, which drives the
script in a sandbox with stand-ins for docker and pnpm.

### Proof manifests

A green aggregate cannot show that a required case ran: a skipped, renamed
or deleted case leaves `test:ci` green. Each packet's proof is a case
manifest in `scripts/proof-admission/manifests/`: its `requiredCases` (full
vitest titles), `allowAdditionalCases`, `requireReportSuccess`, and the
`suites` it binds, as paths relative to `apps/server` (an entry may be
`{ "path": ..., "needsDist": true }` for a suite that spawns `dist/main.js`).
A manifest without `suites` binds the files of the `npx vitest run` command
in its description; one with neither is rejected `KF_PROOF_MANIFEST_UNBOUND`.

`pnpm --filter server proof:manifests` (`scripts/proof-admission/run-manifests.mjs`)
reads every manifest, skips the resource manifests by type, unions the
suites, builds the server when a suite needs it, runs vitest once over the
union with the JSON reporter, and judges every manifest against that one
report with `scripts/proof-admission/evaluate.mjs --expect-head <HEAD>`. It
prints one line per manifest and exits non-zero unless every one is
SATISFIED. Every check is scoped to the manifest's own suites, so a case of a
suite another manifest binds is not "unexpected", and a verdict for a
different head is `KF_PROOF_HEAD_MISMATCH`. `--only <a.json,b.json>` judges a
subset, `--plan` prints the union without running it, and `--report <file>`
judges an existing report.

CI runs it after the server tests. **To bind a new suite, add one manifest;
do not edit the workflow.**

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
  `pnpm --filter server test:ci`, judges every proof manifest at the exact
  head (`scripts/proof-admission/run-manifests.mjs`), self-tests the local
  runner, and runs the web unit suite.
- Integration failures block merges. There is no non-blocking test tier.
