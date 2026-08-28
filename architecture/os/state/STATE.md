---
kind: state
writers: [truth-cycle]           # §Runtime rows: audit-cycle
derived: 2026-08-28
baseline: architecture/VERIFIED_STATE_2026-08-11.md
---

# Living state

Rows are machine-re-derived; never copy a value into this file — run its
command. If a value here disagrees with a snapshot, this file wins for "now"
and the snapshot wins for "why". A blank Value means "not yet re-derived on
this date", which is an honest state; a copied value would be a lie with a
timestamp.

## Shape

| Measure | Value | Prev (2026-08-27) | Command |
|---|---:|---:|---|
| Prisma models | 440 | 440 | `grep -c '^model ' packages/db/prisma/schema.prisma` |
| Server modules | 110 | 110 | `ls apps/server/src/modules \| wc -l` |
| `@Injectable` services | 723 | 723 | `grep -rl '@Injectable()' apps/server/src --include=*.ts \| grep -v spec \| wc -l` |
| KEY tools | 286 | 286 | `node scripts/os/count-flow-tools.mjs` |
| Web pages | 251 | 251 | `find apps/web/src/app -name page.tsx \| wc -l` |
| Migrations | 20 | 20 | `find packages/db/prisma/migrations -name migration.sql \| wc -l` |
| Spec/test files (server) | **416** | 416 | `find apps/server/src apps/server/test -name '*.spec.ts' -o -name '*.test.ts' \| wc -l` |
| Server tests passing | **3,520 in 361 files, 0 skipped** (unit config) | 3,520 in 361 files, 0 skipped | `cd apps/server && pnpm test:unit` (= `vitest -c vitest.unit.config.ts`; do NOT run bare `npx vitest run` — needs DB, false-reds as skips, see truth.md) |
| Web tests passing | **201 in 20 files** | 201 in 20 files | `cd apps/web && npx vitest run` |
| Tests in `packages/*` | **12 in 2 files** (db 7, api 5) | 12 in 2 files (db 7, api 5) | `pnpm --filter @keyflow/db --filter @keyflow/api test:unit` |
| Routes mapped at boot | — | 2,179 | `docker logs keyflowos-api-1 \| grep -c 'Mapped {'` (runtime only; not derivable in this sandbox — no docker) |
| `@Cron` jobs | 28 | 28 | `grep -r '@Cron(' apps/server/src \| wc -l` |
| `setInterval` schedulers | 36 | 36 | `grep -r 'setInterval(' apps/server/src \| wc -l` |

## Tenant isolation partition

303 + 42 + 3 = 348 exactly; `tenant-model-list.spec.ts` fails the build if
this stops being a partition.

| Set | Value | Prev | Command |
|---|---:|---:|---|
| Scoped (`BUSINESS_ID_MODELS`) | 303 | 303 | `node scripts/os/ledger-sizes.mjs` → `tenant.business_id_models` |
| Acknowledged unscoped (debt) | 42 | 42 | → `tenant.acknowledged_unscoped` |
| Never scope (deliberate) | 3 | 3 | → `tenant.never_scope` |

## Ledger cardinalities (monotonicity — see OS.md §Defense in depth)

All rows derive from one command: `node scripts/os/ledger-sizes.mjs`.
`shrink` may only fall, `grow` may only rise, `fixed` may not move without a
human decision. Any wrong-direction move: do NOT update the row; open a
`gate-integrity` issue and attribute via `git log -- <gate file>`.

| Ledger | Gate/source file | Direction | Value | Prev |
|---|---|---|---:|---:|
| tenant.acknowledged_unscoped | apps/server/src/core/prisma/tenant-model-list.spec.ts | shrink | 42 | 42 |
| tenant.never_scope | apps/server/src/core/prisma/tenant-model-list.spec.ts | fixed | 3 | 3 |
| tenant.business_id_models | packages/db/src/client.ts | grow | 303 | 303 |
| events.known_dead | apps/server/src/core/event-bus/event-wiring.spec.ts | shrink | 10 | 10 |
| providers.unreachable | apps/server/src/core/config/unreachable-provider.spec.ts | shrink | 8 | 8 |
| billing.unpriced | apps/server/src/modules/subscriptions/plans.ts | shrink | 43 | 43 |
| billing.unenforced_limits | apps/server/src/modules/subscriptions/plan-limit-enforcement.spec.ts | shrink | 19 | 19 |
| auth.public_handlers | apps/server/src/core/auth/public-surface.spec.ts | shrink | 219 | 219 |
| auth.public_controllers | apps/server/src/core/auth/public-surface.spec.ts | shrink | 53 | 53 |
| web.known_fabricated | apps/web/src/lib/__tests__/no-fabricated-screens.spec.ts | shrink | 1 | 1 |
| trpc.unchecked | apps/server/src/trpc.module.spec.ts | shrink | 0 | 0 |
| ai.handler_coverage_floor_pct | apps/server/src/modules/ai/handler-coverage-ratchet.spec.ts | grow | 39 | 39 |
| docs.debt | architecture/os/state/DOC_DEBT.md | shrink | 2 | 2 |
| routes.parity_absent | architecture/os/state/ROUTE_PARITY.md | shrink | 6 | 6 |

All 14 rows unmoved vs Prev — zero ledger drift this cycle (`node scripts/os/ledger-sizes.mjs`, 2026-08-28).

## Generated artifacts freshness

| Artifact | Generator | Last generated |
|---|---|---|
| architecture/{module,route,event,capability,data-ownership}-registry.yaml | `node scripts/architecture/generate-registries.js` | 2026-08-28 (only `generated:` date changed — totals identical to 2026-08-27) |
| docs/architecture/capability-map/* + apps/server/src/modules/ai/capability-map/capability-map.seed.ts | `node docs/architecture/capability-map/generate.js` | 2026-08-28 (byte-identical to 2026-08-27 output — no drift) |
| architecture/inventory.json | `python3 .agents/skills/codebase-architect/scripts/inventory.py > architecture/inventory.json` | 2026-08-28 (totals shifted from new journal files landed since 2026-08-27 plus the merged `fix(web)` commit (0ac8e539) touching layout.tsx/use-onboarding.ts/use-genome-gate.ts: total_files 4218→4223, total_lines 1,031,163→1,031,529; no undocumented code drift — matches `git diff 30e711f4..HEAD --stat`) |
| architecture/dependencies.json | `python3 .agents/skills/codebase-architect/scripts/dependency_scan.py > architecture/dependencies.json` | 2026-08-28 (byte-identical to 2026-08-27 output — no drift) |

## Runtime (written by audit cycle only)

| Check | Last result | At | Command |
|---|---|---|---|
| /healthz.commit == origin/main HEAD | No new `deploy-drift.yml` run since the prior audit — still run 33067311510 (2026-08-27T11:25:36Z, `failure`); next run expected ~2026-08-28T08:00Z (daily cron). prod (`ea9a21fc6dca`) still 75 commits / ~15 days behind main (oldest missing commit 2026-08-12T00:38:24Z), over the 7-day threshold → `warn` `commit-drift`, now unresolved across 12 consecutive audit cycles (2026-08-25 13:03Z, 19:02Z; 2026-08-26 01:02Z, 07:04Z, 13:33Z, 19:02Z; 2026-08-27 01:04Z, 07:03Z, 13:04Z, 19:02Z; 2026-08-28 01:02Z, 07:03Z) → already escalated to open issue #69, no new issue filed. Direct egress still blocked (403 on CONNECT keyflowos.com:443, 18th consecutive audit) | 2026-08-28T07:03Z | `gh run list --repo SaCH-PRO/KEYFLOWOS --workflow deploy-drift.yml --limit 3 --json conclusion,status,createdAt` |
| /readyz | `warn` `uptime-monitor.stale` — most recent completed uptime-monitor run (33143145784) succeeded at 2026-08-28T04:54:01Z, 2h9m before this audit — past the 30-min freshness window despite the `*/5 * * * *` cron. Recurrence: prior two audits (2026-08-28 01:02Z, 2026-08-27 19:02Z) were also stale — 3rd consecutive occurrence in the current streak. Issue #70 is still open and already covers this check id — no new issue filed. Direct egress still blocked | 2026-08-28T07:03Z | `curl -s -o /dev/null -w '%{http_code}' $PROD/api/readyz` |
| /healthz/events queue depth | unavailable — CI fallback exposes no queue metrics; direct egress still blocked | 2026-08-28T07:03Z | `curl -s $PROD/api/healthz/events` |
| route-parity oracle (6 ledgered paths) | skipped — CI-fallback path has no route-parity substitute (oracle needs direct egress); not filed as blind this run, per playbook | 2026-08-28T07:03Z | `node scripts/os/probe-routes.mjs --base $PROD/api --routes <ledger-paths>` |
