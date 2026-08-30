---
kind: state
writers: [truth-cycle]           # §Runtime rows: audit-cycle
derived: 2026-08-30
baseline: architecture/VERIFIED_STATE_2026-08-11.md
---

# Living state

Rows are machine-re-derived; never copy a value into this file — run its
command. If a value here disagrees with a snapshot, this file wins for "now"
and the snapshot wins for "why". A blank Value means "not yet re-derived on
this date", which is an honest state; a copied value would be a lie with a
timestamp.

## Shape

| Measure | Value | Prev (2026-08-29) | Command |
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
| Routes mapped at boot | — | — | `docker logs keyflowos-api-1 \| grep -c 'Mapped {'` (runtime only; not derivable in this sandbox — no docker) |
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

All 14 rows unmoved vs Prev — zero ledger drift this cycle (`node scripts/os/ledger-sizes.mjs`, 2026-08-30).

## Generated artifacts freshness

| Artifact | Generator | Last generated |
|---|---|---|
| architecture/{module,route,event,capability,data-ownership}-registry.yaml | `node scripts/architecture/generate-registries.js` | 2026-08-30 (only `generated:` date changed — totals identical to 2026-08-29) |
| docs/architecture/capability-map/* + apps/server/src/modules/ai/capability-map/capability-map.seed.ts | `node docs/architecture/capability-map/generate.js` | 2026-08-30 (byte-identical to 2026-08-29 output — no drift) |
| architecture/inventory.json | `python3 .agents/skills/codebase-architect/scripts/inventory.py > architecture/inventory.json` | 2026-08-30 (totals shifted from 5 new journal files landed since 2026-08-29 (audit-13, audit-19, truth, 08-29 audit-01, audit-07) plus one gitignored session-local file under `.claude/coordination/` (a different session's UUID swapped for this one — machine-local runtime state, not tracked by git, see `.gitignore`): total_files 4228→4233, total_lines 1,031,899→1,032,232 (excluding the file's own self-referential line count, an artifact of the `>` redirection truncating the destination before the scanner runs — see truth.md journal for detail); no undocumented code drift — dependencies.json (code-derived) is byte-identical to 2026-08-29) |
| architecture/dependencies.json | `python3 .agents/skills/codebase-architect/scripts/dependency_scan.py > architecture/dependencies.json` | 2026-08-30 (byte-identical to 2026-08-29 output — no drift) |

## Runtime (written by audit cycle only)

| Check | Last result | At | Command |
|---|---|---|---|
| /healthz.commit == origin/main HEAD | `info` — still RESOLVED. Newer `deploy-drift.yml` run since the prior audit: 33301063267 (2026-08-30T08:13:37Z, `success`, ~4h49m old — within the 26h staleness window) — prod current/within threshold. Issue #69 remains open for human close. Direct egress still blocked (403 on CONNECT keyflowos.com:443, 27th consecutive audit) | 2026-08-30T13:02Z | `gh run list --repo SaCH-PRO/KEYFLOWOS --workflow deploy-drift.yml --limit 3 --json conclusion,status,createdAt` |
| /readyz | `info` `prod.health.via-ci` — still healthy. Most recent completed uptime-monitor run (33312875662) succeeded at 2026-08-30T12:57:45Z, ~4m33s before this audit — well within the 30-min freshness window. Issue #70 remains open for human close. Direct egress still blocked | 2026-08-30T13:02Z | `curl -s -o /dev/null -w '%{http_code}' $PROD/api/readyz` |
| /healthz/events queue depth | unavailable — CI fallback exposes no queue metrics; direct egress still blocked | 2026-08-30T13:02Z | `curl -s $PROD/api/healthz/events` |
| route-parity oracle (6 ledgered paths) | skipped — CI-fallback path has no route-parity substitute (oracle needs direct egress); not filed as blind this run, per playbook | 2026-08-30T13:02Z | `node scripts/os/probe-routes.mjs --base $PROD/api --routes <ledger-paths>` |
