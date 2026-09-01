---
kind: state
writers: [truth-cycle]           # §Runtime rows: audit-cycle
derived: 2026-09-01
baseline: architecture/VERIFIED_STATE_2026-08-11.md
---

# Living state

Rows are machine-re-derived; never copy a value into this file — run its
command. If a value here disagrees with a snapshot, this file wins for "now"
and the snapshot wins for "why". A blank Value means "not yet re-derived on
this date", which is an honest state; a copied value would be a lie with a
timestamp.

## Shape

| Measure | Value | Prev (2026-08-31) | Command |
|---|---:|---:|---|
| Prisma models | 441 | 441 | `grep -c '^model ' packages/db/prisma/schema.prisma` |
| Server modules | 110 | 110 | `ls apps/server/src/modules \| wc -l` |
| `@Injectable` services | 724 | 724 | `grep -rl '@Injectable()' apps/server/src --include=*.ts \| grep -v spec \| wc -l` |
| KEY tools | 286 | 286 | `node scripts/os/count-flow-tools.mjs` |
| Web pages | 251 | 251 | `find apps/web/src/app -name page.tsx \| wc -l` |
| Migrations | 21 | 21 | `find packages/db/prisma/migrations -name migration.sql \| wc -l` |
| Spec/test files (server) | 428 | 428 | `find apps/server/src apps/server/test -name '*.spec.ts' -o -name '*.test.ts' \| wc -l` |
| Server tests passing | **3,658 in 373 files, 0 skipped** (unit config) | 3,658 in 373 files, 0 skipped | `cd apps/server && pnpm test:unit` (= `vitest -c vitest.unit.config.ts`; do NOT run bare `npx vitest run` — needs DB, false-reds as skips, see truth.md); seed `1788247147306` |
| Web tests passing | **210 in 22 files** | 210 in 22 files | `cd apps/web && npx vitest run` |
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
| tenant.acknowledged_unscoped | apps/server/src/core/prisma/tenant-model-list.spec.ts | shrink | 13 | 13 |
| tenant.never_scope | apps/server/src/core/prisma/tenant-model-list.spec.ts | fixed | **3 (frozen — actual 10)** | 3 |
| tenant.business_id_models | packages/db/src/client.ts | grow | 326 | 326 |
| events.known_dead | apps/server/src/core/event-bus/event-wiring.spec.ts | shrink | 10 | 10 |
| providers.unreachable | apps/server/src/core/config/unreachable-provider.spec.ts | shrink | 8 | 8 |
| billing.unpriced | apps/server/src/modules/subscriptions/plans.ts | shrink | 43 | 43 |
| billing.unenforced_limits | apps/server/src/modules/subscriptions/plan-limit-enforcement.spec.ts | shrink | 19 | 19 |
| auth.public_handlers | apps/server/src/core/auth/public-surface.spec.ts | shrink | **219 (frozen — actual 223)** | 219 |
| auth.public_controllers | apps/server/src/core/auth/public-surface.spec.ts | shrink | 53 | 53 |
| web.known_fabricated | apps/web/src/lib/__tests__/no-fabricated-screens.spec.ts | shrink | 0 | 0 |
| trpc.unchecked | apps/server/src/trpc.module.spec.ts | shrink | 0 | 0 |
| ai.handler_coverage_floor_pct | apps/server/src/modules/ai/handler-coverage-ratchet.spec.ts | grow | 39 | 39 |
| docs.debt | architecture/os/state/DOC_DEBT.md | shrink | 2 | 2 |
| routes.parity_absent | architecture/os/state/ROUTE_PARITY.md | shrink | 6 | 6 |

14 of 14 rows re-derived; all 14 displayed Values are unchanged from Prev
(12 because their real re-derived count matched last cycle exactly; 2 because
they stay frozen regardless of the real count underneath). **2 rows remain
frozen** from 2026-08-31 —
`node scripts/os/ledger-sizes.mjs` (2026-09-01) again reports
`tenant.never_scope` at 10 (a `fixed` ledger, still diverged from its frozen
3) and `auth.public_handlers` at 223 (a `shrink` ledger, still diverged from
its frozen 219) — **identical to last cycle's real values, no further
movement**. `git diff --name-only 7a42b5c..HEAD` (last truth commit → this
run's start) touched zero `*.spec.ts`/`*.test.ts` files, so step 7's
attribution check has nothing new to flag and no additional gate-integrity
issue was opened. The existing issues,
[#71](https://github.com/SaCH-PRO/KEYFLOWOS/issues/71) (`tenant.never_scope`)
and [#72](https://github.com/SaCH-PRO/KEYFLOWOS/issues/72)
(`auth.public_handlers`), were checked this cycle and remain **open**,
awaiting human review. Both rows above keep their frozen Value/Prev (3/3,
219/219) rather than adopting the real numbers, per truth.md step 6.

## Generated artifacts freshness

| Artifact | Generator | Last generated |
|---|---|---|
| architecture/{module,route,event,capability,data-ownership}-registry.yaml | `node scripts/architecture/generate-registries.js` | 2026-09-01 (no real drift — only `generated:` date changed on all five files; totals identical to 2026-08-31: modules 110, routes 209, events 280, capabilities 286, models 441) |
| docs/architecture/capability-map/* + apps/server/src/modules/ai/capability-map/capability-map.seed.ts | `node docs/architecture/capability-map/generate.js` | 2026-09-01 (byte-identical output to 2026-08-31 — no drift; 286 flowTools, 207 cortexCapabilities unchanged) |
| architecture/inventory.json | `python3 .agents/skills/codebase-architect/scripts/inventory.py > architecture/inventory.json` | 2026-09-01 (small, fully-attributable delta: total_files 4266→4272 (+6), total_lines 1,038,623→1,039,102 (+479) — accounted for by the 6 audit/truth journal files the 2026-08-31→2026-09-01 `git pull` brought in (465 lines) plus STATE.md's own growth (+14 lines from the 2026-08-31 cycle), net of one retired journal-adjacent line; separately the scan also picked up a one-file swap of `.claude/coordination/sessions/<uuid>.json` — that's this run's own session-coordination bookkeeping, not a code signal, and is not counted as drift) |
| architecture/dependencies.json | `python3 .agents/skills/codebase-architect/scripts/dependency_scan.py > architecture/dependencies.json` | 2026-09-01 (byte-identical to 2026-08-31 — nodes 3770, edges 15415 unchanged; `git diff` reports no change at all, including `meta.root`, so no drift and no cross-machine artifact this time) |

## Runtime (written by audit cycle only)

| Check | Last result | At | Command |
|---|---|---|---|
| /healthz.commit == origin/main HEAD | `info` `commit-drift` — still RESOLVED, and freshly reconfirmed: most recent completed `deploy-drift.yml` run is now 33486212863 (2026-09-01T08:16:42Z, `success`) — a NEW run since the 07:05Z audit (which had cited stale run 33372254273 from 2026-08-31T08:17:58Z, unchanged across 4 consecutive prior audits). ~5h14m old, within the 26h staleness window. Prod current/within threshold. Issue #69 remains open for human close. Direct egress still blocked (403 on CONNECT keyflowos.com:443, 35th consecutive audit) | 2026-09-01T13:31Z | `gh run list --repo SaCH-PRO/KEYFLOWOS --workflow deploy-drift.yml --limit 3 --json conclusion,status,createdAt` |
| /readyz | `info` `prod.health.via-ci`. Most recent completed uptime-monitor run (33513203653) succeeded at 2026-09-01T13:24:40Z, ~6m25s before this audit — within the 30-min freshness window. Prod healthy, confirmed indirectly. Direct egress still blocked | 2026-09-01T13:31Z | `gh run list --repo SaCH-PRO/KEYFLOWOS --workflow uptime-monitor.yml --limit 5 --json conclusion,status,createdAt,databaseId` |
| /healthz/events queue depth | unavailable — CI fallback exposes no queue metrics; direct egress still blocked | 2026-09-01T13:31Z | `curl -s $PROD/api/healthz/events` |
| route-parity oracle (6 ledgered paths) | skipped — CI-fallback path has no route-parity substitute (oracle needs direct egress); not filed as blind this run, per playbook | 2026-09-01T13:31Z | `node scripts/os/probe-routes.mjs --base $PROD/api --routes <ledger-paths>` |
