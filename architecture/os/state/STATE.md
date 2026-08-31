---
kind: state
writers: [truth-cycle]           # §Runtime rows: audit-cycle
derived: 2026-08-31
baseline: architecture/VERIFIED_STATE_2026-08-11.md
---

# Living state

Rows are machine-re-derived; never copy a value into this file — run its
command. If a value here disagrees with a snapshot, this file wins for "now"
and the snapshot wins for "why". A blank Value means "not yet re-derived on
this date", which is an honest state; a copied value would be a lie with a
timestamp.

## Shape

| Measure | Value | Prev (2026-08-30) | Command |
|---|---:|---:|---|
| Prisma models | 441 | 440 | `grep -c '^model ' packages/db/prisma/schema.prisma` |
| Server modules | 110 | 110 | `ls apps/server/src/modules \| wc -l` |
| `@Injectable` services | 724 | 723 | `grep -rl '@Injectable()' apps/server/src --include=*.ts \| grep -v spec \| wc -l` |
| KEY tools | 286 | 286 | `node scripts/os/count-flow-tools.mjs` |
| Web pages | 251 | 251 | `find apps/web/src/app -name page.tsx \| wc -l` |
| Migrations | 21 | 20 | `find packages/db/prisma/migrations -name migration.sql \| wc -l` |
| Spec/test files (server) | **428** | 416 | `find apps/server/src apps/server/test -name '*.spec.ts' -o -name '*.test.ts' \| wc -l` |
| Server tests passing | **3,658 in 373 files, 0 skipped** (unit config) | 3,520 in 361 files, 0 skipped | `cd apps/server && pnpm test:unit` (= `vitest -c vitest.unit.config.ts`; do NOT run bare `npx vitest run` — needs DB, false-reds as skips, see truth.md); seed `1788160858337` |
| Web tests passing | **210 in 22 files** | 201 in 20 files | `cd apps/web && npx vitest run` |
| Tests in `packages/*` | **12 in 2 files** (db 7, api 5) | 12 in 2 files (db 7, api 5) | `pnpm --filter @keyflow/db --filter @keyflow/api test:unit` |
| Routes mapped at boot | — | — | `docker logs keyflowos-api-1 \| grep -c 'Mapped {'` (runtime only; not derivable in this sandbox — no docker) |
| `@Cron` jobs | 28 | 28 | `grep -r '@Cron(' apps/server/src \| wc -l` |
| `setInterval` schedulers | 36 | 36 | `grep -r 'setInterval(' apps/server/src \| wc -l` |

## Tenant isolation partition

**Stale by design, this row only:** `never_scope` below is frozen at its
2026-08-30 value (a `fixed`-direction ledger, see next section) pending human
review in issue #71 — the code's actual current partition is
326 + 13 + 10 = 349 (441 models, 349 carry `businessId`), which
`tenant-model-list.spec.ts` confirms still holds as a partition. The table
below intentionally does **not** display that reconciled total, since
`never_scope`'s displayed Value has not been allowed to move.

| Set | Value | Prev | Command |
|---|---:|---:|---|
| Scoped (`BUSINESS_ID_MODELS`) | 326 | 303 | `node scripts/os/ledger-sizes.mjs` → `tenant.business_id_models` |
| Acknowledged unscoped (debt) | 13 | 42 | → `tenant.acknowledged_unscoped` |
| Never scope (deliberate) | **3** (frozen — actual 10, see issue #71) | 3 | → `tenant.never_scope` |

## Ledger cardinalities (monotonicity — see OS.md §Defense in depth)

All rows derive from one command: `node scripts/os/ledger-sizes.mjs`.
`shrink` may only fall, `grow` may only rise, `fixed` may not move without a
human decision. Any wrong-direction move: do NOT update the row; open a
`gate-integrity` issue and attribute via `git log -- <gate file>`.

| Ledger | Gate/source file | Direction | Value | Prev |
|---|---|---|---:|---:|
| tenant.acknowledged_unscoped | apps/server/src/core/prisma/tenant-model-list.spec.ts | shrink | 13 | 42 |
| tenant.never_scope | apps/server/src/core/prisma/tenant-model-list.spec.ts | fixed | **3 (frozen — actual 10)** | 3 |
| tenant.business_id_models | packages/db/src/client.ts | grow | 326 | 303 |
| events.known_dead | apps/server/src/core/event-bus/event-wiring.spec.ts | shrink | 10 | 10 |
| providers.unreachable | apps/server/src/core/config/unreachable-provider.spec.ts | shrink | 8 | 8 |
| billing.unpriced | apps/server/src/modules/subscriptions/plans.ts | shrink | 43 | 43 |
| billing.unenforced_limits | apps/server/src/modules/subscriptions/plan-limit-enforcement.spec.ts | shrink | 19 | 19 |
| auth.public_handlers | apps/server/src/core/auth/public-surface.spec.ts | shrink | **219 (frozen — actual 223)** | 219 |
| auth.public_controllers | apps/server/src/core/auth/public-surface.spec.ts | shrink | 53 | 53 |
| web.known_fabricated | apps/web/src/lib/__tests__/no-fabricated-screens.spec.ts | shrink | 0 | 1 |
| trpc.unchecked | apps/server/src/trpc.module.spec.ts | shrink | 0 | 0 |
| ai.handler_coverage_floor_pct | apps/server/src/modules/ai/handler-coverage-ratchet.spec.ts | grow | 39 | 39 |
| docs.debt | architecture/os/state/DOC_DEBT.md | shrink | 2 | 2 |
| routes.parity_absent | architecture/os/state/ROUTE_PARITY.md | shrink | 6 | 6 |

12 of 14 rows re-derived cleanly (3 changed value in the allowed direction, 9
unchanged). **2 rows frozen this cycle** — `node scripts/os/ledger-sizes.mjs`
(2026-08-31) reports `tenant.never_scope` at 10 (a `fixed` ledger moving) and
`auth.public_handlers` at 223 (a `shrink` ledger rising). Both gate files were
also touched exclusively by agent-trailer commits since the last truth-cycle
commit (`3aaed896`), independently triggering step 7's attribution check.
Filed: [#71](https://github.com/SaCH-PRO/KEYFLOWOS/issues/71) (`tenant.never_scope`),
[#72](https://github.com/SaCH-PRO/KEYFLOWOS/issues/72) (`auth.public_handlers`).
Both rows above keep their pre-cycle Value/Prev (3/3, 219/219) rather than
adopting the new numbers, per truth.md step 6.

## Generated artifacts freshness

| Artifact | Generator | Last generated |
|---|---|---|
| architecture/{module,route,event,capability,data-ownership}-registry.yaml | `node scripts/architecture/generate-registries.js` | 2026-08-31 (real drift, not just a date bump — 49 commits landed since the 2026-08-30 cycle: `module-registry.yaml` ingestion module services 5→6; `data-ownership.yaml` models 440→441, new model `ProjectDeliverable` (owner `projects`, 6 refs — from `feat(projects): deliverables are stored`), one model's owner reassigned `projects`→`ai`, and ~15 `referenceCount`/`topConsumers` shifts across bookings/crm/ai/finance/projects; `capability-registry.yaml`, `event-registry.yaml`, `route-registry.yaml` — only `generated:` date changed, totals identical) |
| docs/architecture/capability-map/* + apps/server/src/modules/ai/capability-map/capability-map.seed.ts | `node docs/architecture/capability-map/generate.js` | 2026-08-31 (byte-identical output to 2026-08-30 — no drift; 286 flowTools, 207 cortexCapabilities unchanged) |
| architecture/inventory.json | `python3 .agents/skills/codebase-architect/scripts/inventory.py > architecture/inventory.json` | 2026-08-31 (real code churn across 49 commits: total_files 4159→4266 (+107), total_lines 1,081,390→1,038,623 (−42,767 net — plausible given this window's volume of deletions alongside additions, e.g. `9ba2cd48` retiring the dead mobile bottom-nav v1 and `be343706` removing an unused guard; not verified file-by-file this cycle) — matches dependencies.json's independently-derived growth below, so this reflects real tree change, not a scanner artifact) |
| architecture/dependencies.json | `python3 .agents/skills/codebase-architect/scripts/dependency_scan.py > architecture/dependencies.json` | 2026-08-31 (nodes 3717→3770 (+53), edges 15244→15415 (+171) — consistent with 49 commits of real module/import growth; `root` path in the file's own `meta` differs only because it was last generated on a different machine, not a code signal) |

## Runtime (written by audit cycle only)

| Check | Last result | At | Command |
|---|---|---|---|
| /healthz.commit == origin/main HEAD | `info` — still RESOLVED. Most recent completed `deploy-drift.yml` run: 33301063267 (2026-08-30T08:13:37Z, `success`, ~23h11m old — within the 26h staleness window) — prod current/within threshold. Issue #69 remains open for human close. Direct egress still blocked (403 on CONNECT keyflowos.com:443, 30th consecutive audit) | 2026-08-31T07:24Z | `gh run list --repo SaCH-PRO/KEYFLOWOS --workflow deploy-drift.yml --limit 3 --json conclusion,status,createdAt` |
| /readyz | `info` `prod.health.via-ci` — recovered from the prior cycle's `uptime-monitor.stale`. Most recent completed uptime-monitor run (33366497619) succeeded at 2026-08-31T07:00:33Z, ~24m before this audit — within the 30-min freshness window. Prod healthy, confirmed indirectly. Direct egress still blocked | 2026-08-31T07:24Z | `gh run list --repo SaCH-PRO/KEYFLOWOS --workflow uptime-monitor.yml --limit 5 --json conclusion,status,createdAt,databaseId` |
| /healthz/events queue depth | unavailable — CI fallback exposes no queue metrics; direct egress still blocked | 2026-08-31T07:24Z | `curl -s $PROD/api/healthz/events` |
| route-parity oracle (6 ledgered paths) | skipped — CI-fallback path has no route-parity substitute (oracle needs direct egress); not filed as blind this run, per playbook | 2026-08-31T07:24Z | `node scripts/os/probe-routes.mjs --base $PROD/api --routes <ledger-paths>` |
