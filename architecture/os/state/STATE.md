---
kind: state
writers: [truth-cycle]           # §Runtime rows: audit-cycle
derived: 2026-09-11
baseline: architecture/VERIFIED_STATE_2026-08-11.md
---

# Living state

Rows are machine-re-derived; never copy a value into this file — run its
command. If a value here disagrees with a snapshot, this file wins for "now"
and the snapshot wins for "why". A blank Value means "not yet re-derived on
this date", which is an honest state; a copied value would be a lie with a
timestamp.

## Shape

| Measure | Value | Prev (2026-09-10) | Command |
|---|---:|---:|---|
| Prisma models | 441 | 441 | `grep -c '^model ' packages/db/prisma/schema.prisma` |
| Server modules | 110 | 110 | `ls apps/server/src/modules \| wc -l` |
| `@Injectable` services | 724 | 724 | `grep -rl '@Injectable()' apps/server/src --include=*.ts \| grep -v spec \| wc -l` |
| KEY tools | 286 | 286 | `node scripts/os/count-flow-tools.mjs` |
| Web pages | 251 | 251 | `find apps/web/src/app -name page.tsx \| wc -l` |
| Migrations | 21 | 21 | `find packages/db/prisma/migrations -name migration.sql \| wc -l` |
| Spec/test files (server) | 428 | 428 | `find apps/server/src apps/server/test -name '*.spec.ts' -o -name '*.test.ts' \| wc -l` |
| Server tests passing | **3,658 in 373 files, 0 skipped** (unit config) | 3,658 in 373 files, 0 skipped | `cd apps/server && pnpm test:unit` (= `vitest -c vitest.unit.config.ts`; do NOT run bare `npx vitest run` — needs DB, false-reds as skips, see truth.md); seed `1789024589364` |
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
| Scoped (`BUSINESS_ID_MODELS`) | 326 | 326 | `node scripts/os/ledger-sizes.mjs` → `tenant.business_id_models` |
| Acknowledged unscoped (debt) | 13 | 13 | → `tenant.acknowledged_unscoped` |
| Never scope (deliberate) | **3** (frozen — actual 10, still open in #71) | 3 | → `tenant.never_scope` |

## Ledger cardinalities (monotonicity — see OS.md §Defense in depth)

All rows derive from one command: `node scripts/os/ledger-sizes.mjs`.
`shrink` may only fall, `grow` may only rise, `fixed` may not move without a
human decision. Any wrong-direction move: do NOT update the row; open a
`gate-integrity` issue and attribute via `git log -- <gate file>`.

| Ledger | Gate/source file | Direction | Value | Prev |
|---|---|---|---:|---:|
| tenant.acknowledged_unscoped | apps/server/src/core/prisma/tenant-model-list.spec.ts | shrink | 13 | 13 |
| tenant.never_scope | apps/server/src/core/prisma/tenant-model-list.spec.ts | fixed | **3 (frozen — actual 10, #71 open)** | 3 |
| tenant.business_id_models | packages/db/src/client.ts | grow | 326 | 326 |
| events.known_dead | apps/server/src/core/event-bus/event-wiring.spec.ts | shrink | 10 | 10 |
| providers.unreachable | apps/server/src/core/config/unreachable-provider.spec.ts | shrink | 8 | 8 |
| billing.unpriced | apps/server/src/modules/subscriptions/plans.ts | shrink | 43 | 43 |
| billing.unenforced_limits | apps/server/src/modules/subscriptions/plan-limit-enforcement.spec.ts | shrink | 19 | 19 |
| auth.public_handlers | apps/server/src/core/auth/public-surface.spec.ts | shrink | **219 (frozen — actual 223, #72 open)** | 219 |
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
`node scripts/os/ledger-sizes.mjs` (2026-09-11) again reports
`tenant.never_scope` at 10 (a `fixed` ledger, still diverged from its frozen
3) and `auth.public_handlers` at 223 (a `shrink` ledger, still diverged from
its frozen 219) — **identical to last cycle's real values, no further
movement**. `git diff --name-only d3185b0..HEAD` (last truth commit →
this run's start) touched zero `*.spec.ts`/`*.test.ts` files, so step 7's
attribution check has nothing to flag and no gate-integrity issue was opened.
The existing issues,
[#71](https://github.com/SaCH-PRO/KEYFLOWOS/issues/71) (`tenant.never_scope`)
and [#72](https://github.com/SaCH-PRO/KEYFLOWOS/issues/72)
(`auth.public_handlers`), were checked this cycle and remain **open**,
awaiting human review, no new activity since 2026-08-31. Both rows above keep
their frozen Value/Prev (3/3, 219/219) rather than adopting the real numbers,
per truth.md step 6.

## Generated artifacts freshness

| Artifact | Generator | Last generated |
|---|---|---|
| architecture/{module,route,event,capability,data-ownership}-registry.yaml | `node scripts/architecture/generate-registries.js` | 2026-09-11 (no real drift — only `generated:` date changed on all five files; `git diff` confirms zero non-date-line changes) |
| docs/architecture/capability-map/* + apps/server/src/modules/ai/capability-map/capability-map.seed.ts | `node docs/architecture/capability-map/generate.js` | 2026-09-11 (byte-identical output to 2026-09-10 — no drift; 286 flowTools, 207 cortexCapabilities, 12 domains, 32 targets (15 active/17 planned) unchanged) |
| architecture/inventory.json | `python3 .agents/skills/codebase-architect/scripts/inventory.py > architecture/inventory.json` | 2026-09-11 (small, fully-attributable delta: total_files 4318→4323 (+5), total_lines 1,042,883→1,043,270 (+387) — the real accumulated diff since the last truth commit `d3185b0` is exactly 5 new journal files: `2026-09-10-audit-13.md` (71), `2026-09-10-audit-19.md` (74), `2026-09-10-truth.md` (102, the prior cycle's own journal, written after that cycle's registry regeneration), `2026-09-11-audit-01.md` (71), `2026-09-11-audit-07.md` (69) = 387 lines / 5 files, verified line-by-line against `d3185b0`'s committed inventory.json; the `.claude/coordination/sessions/<uuid>.json` rename is a net-zero swap (one session file for another, same shape); no unexplained movement) |
| architecture/dependencies.json | `python3 .agents/skills/codebase-architect/scripts/dependency_scan.py > architecture/dependencies.json` | 2026-09-11 (byte-identical to the committed 2026-09-10 file — no drift from this run) |

## Runtime (written by audit cycle only)

| Check | Last result | At | Command |
|---|---|---|---|
| /healthz.commit == origin/main HEAD | `warn` `commit-drift`, **escalated to issue [#73](https://github.com/SaCH-PRO/KEYFLOWOS/issues/73)** — most recent completed `deploy-drift.yml` run is still 34578300288 (2026-09-11T08:15:36Z, `failure`; no newer run has fired, it's a daily workflow) — prod=`2c3da5d4569e` is 44 commits / ~8 days behind main (oldest missing commit 2026-09-03T06:32:39Z), over the 7-day `DRIFT_DAYS` threshold. 2nd consecutive audit run reading this unresolved condition (1st at 13:02Z) → escalated per the 2-consecutive-run rule. Open issue #69 tracks an earlier, since-resolved drift episode (2026-08-25, prod `ea9a21fc6dca`) — not a duplicate. Direct egress still blocked (403/connect_rejected on CONNECT keyflowos.com:443; 76th consecutive audit) | 2026-09-11T19:02Z | `gh run list --repo SaCH-PRO/KEYFLOWOS --workflow deploy-drift.yml --limit 3 --json conclusion,status,createdAt` |
| /readyz | `info` `prod.health.via-ci` — most recent completed uptime-monitor run (34636220272) succeeded at 2026-09-11T18:57:53Z, ~4m old — well within the 30-min freshness window, against head_sha `ac4bc027` (current origin/main HEAD, exact match). Prod healthy, confirmed indirectly | 2026-09-11T19:02Z | `gh run list --repo SaCH-PRO/KEYFLOWOS --workflow uptime-monitor.yml --limit 5 --json conclusion,status,createdAt,databaseId` |
| /healthz/events queue depth | unavailable — CI fallback exposes no queue metrics; direct egress still blocked | 2026-09-11T19:02Z | `curl -s $PROD/api/healthz/events` |
| route-parity oracle (6 ledgered paths) | skipped — CI-fallback path has no route-parity substitute (oracle needs direct egress); not filed as blind this run, per playbook | 2026-09-11T19:02Z | `node scripts/os/probe-routes.mjs --base $PROD/api --routes <ledger-paths>` |
