---
kind: state
writers: [truth-cycle]           # §Runtime rows: audit-cycle
derived: 2026-08-23
baseline: architecture/VERIFIED_STATE_2026-08-11.md
---

# Living state

Rows are machine-re-derived; never copy a value into this file — run its
command. If a value here disagrees with a snapshot, this file wins for "now"
and the snapshot wins for "why". A blank Value means "not yet re-derived on
this date", which is an honest state; a copied value would be a lie with a
timestamp.

## Shape

| Measure | Value | Prev (2026-08-11) | Command |
|---|---:|---:|---|
| Prisma models | 440 | 440 | `grep -c '^model ' packages/db/prisma/schema.prisma` |
| Server modules | 110 | 110 | `ls apps/server/src/modules \| wc -l` |
| `@Injectable` services | 722 | 722 | `grep -rl '@Injectable()' apps/server/src --include=*.ts \| grep -v spec \| wc -l` |
| KEY tools | 286 | 286 | `node scripts/os/count-flow-tools.mjs` |
| Web pages | 251 | 251 | `find apps/web/src/app -name page.tsx \| wc -l` |
| Migrations | 19 | 19 | `find packages/db/prisma/migrations -name migration.sql \| wc -l` |
| Spec/test files (server) | **408** | 405 | `find apps/server/src apps/server/test -name '*.spec.ts' -o -name '*.test.ts' \| wc -l` |
| Server tests passing | — (unit config: 3,388 in 353 files, 0 skipped) | 3,694 (0 skipped) | `cd apps/server && npx vitest run` (full run needs DB; skip = failure) |
| Web tests passing | **190 in 18 files** | 180 in 17 files | `cd apps/web && npx vitest run` |
| Tests in `packages/*` | **10 in 2 files** (db 7, api 3) | 0 | `pnpm --filter @keyflow/db --filter @keyflow/api test:unit` |
| Routes mapped at boot | — | 2,179 | `docker logs keyflowos-api-1 \| grep -c 'Mapped {'` (runtime only) |
| `@Cron` jobs | 27 | 27 | `grep -r '@Cron(' apps/server/src \| wc -l` |
| `setInterval` schedulers | 52 | 52 | `grep -r 'setInterval(' apps/server/src \| wc -l` |

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
| auth.public_handlers | apps/server/src/core/auth/public-surface.spec.ts | shrink | 220 | 227 (diagnostics controller guard-normalized 2026-08-23) |
| auth.public_controllers | apps/server/src/core/auth/public-surface.spec.ts | shrink | 53 | 54 |
| web.known_fabricated | apps/web/src/lib/__tests__/no-fabricated-screens.spec.ts | shrink | 1 | 1 |
| trpc.unchecked | apps/server/src/trpc.module.spec.ts | shrink | 0 | 0 |
| ai.handler_coverage_floor_pct | apps/server/src/modules/ai/handler-coverage-ratchet.spec.ts | grow | 39 | 39 |
| docs.debt | architecture/os/state/DOC_DEBT.md | shrink | 2 | 3 (docs/TESTING.md fixed 2026-08-23, the first burndown) |
| routes.parity_absent | architecture/os/state/ROUTE_PARITY.md | shrink | 6 | — (new 2026-08-23; the 6 individually-named missing endpoints of the classified 19) |

## Generated artifacts freshness

| Artifact | Generator | Last generated |
|---|---|---|
| architecture/{module,route,event,capability,data-ownership}-registry.yaml | `node scripts/architecture/generate-registries.js` | 2026-08-23 (determinism verified: two consecutive runs byte-identical) |
| docs/architecture/capability-map/* + apps/server/src/modules/ai/capability-map/capability-map.seed.ts | `node docs/architecture/capability-map/generate.js` | 2026-08-23 |
| architecture/inventory.json | `py -3 .agents/skills/codebase-architect/scripts/inventory.py > architecture/inventory.json` | 2026-08-23 |
| architecture/dependencies.json | `py -3 .agents/skills/codebase-architect/scripts/dependency_scan.py > architecture/dependencies.json` | 2026-08-23 |

## Runtime (written by audit cycle only)

| Check | Last result | At | Command |
|---|---|---|---|
| /healthz.commit == origin/main HEAD | commit-drift still attempted via `deploy-drift.yml` instead of direct compare — workflow has 0 completed runs (3rd consecutive audit cycle with no signal; first scheduled fire is 2026-08-25T08:00Z, ~58 min out) → `warn` `deploy-drift.stale`, already open as issue #67 (2nd-occurrence escalation), not re-filed. Direct egress still blocked (403 on CONNECT keyflowos.com:443) | 2026-08-25T07:02Z | `gh run list --repo SaCH-PRO/KEYFLOWOS --workflow deploy-drift.yml --limit 3 --json conclusion,status,createdAt` |
| /readyz | healthy via CI fallback — uptime-monitor run 32819157239, success at 2026-08-25T06:55:54Z (~7 min before this run); direct egress still blocked | 2026-08-25T07:02Z | `curl -s -o /dev/null -w '%{http_code}' $PROD/api/readyz` |
| /healthz/events queue depth | unavailable — CI fallback exposes no queue metrics; direct egress still blocked | 2026-08-25T07:02Z | `curl -s $PROD/api/healthz/events` |
| route-parity oracle (6 ledgered paths) | skipped — CI-fallback path has no route-parity substitute (oracle needs direct egress); not filed as blind this run, per playbook | 2026-08-25T07:02Z | `node scripts/os/probe-routes.mjs --base $PROD/api --routes <ledger-paths>` |
