# KEYFLOWOS — Codebase Map

A reference for finding your way around, and for knowing what is real.

Every number here was measured on 2026-08-03, not estimated. Where a figure is
likely to drift, the command that produced it is given so you can re-run it.

> **Read the "How to tell what is real" section before trusting any subsystem in
> this repo.** The dominant failure mode here is not bugs — it is code that was
> written, registered, and never connected to anything. Several times this has
> looked exactly like a working feature.

---

## 1. Shape

| | Count |
|---|---|
| Server modules | 101 |
| Nest modules (`*.module.ts`) | 113 |
| Services (`*.service.ts`) | 584 |
| Controllers | 157 |
| HTTP routes mapped at boot | 2,125 |
| Server source files (non-spec) | 1,220 |
| Server spec files | 287 |
| Web pages (`page.tsx`) | 259 |
| Web components | 210 |
| Prisma models | 430 |
| Schema lines | 12,398 |
| Migrations on disk | 18 |
| Server source lines | ~314,900 |
| Web source lines | ~328,500 |

Ten largest server modules by line count:

```
key-cortex        66,480     ai              34,079     crm          25,320
commerce          17,458     business-genome 15,241     finance       9,939
site               7,332     communications   6,150     calendar      5,456
flow               5,409
```

## 2. Layout

```
apps/
  server/          NestJS API. Compiles to apps/server/dist/main.js (CommonJS).
  web/             Next.js app router.
packages/
  @keyflow/db      Prisma client + schema.   main -> ./dist/src/client.js
  @keyflow/shared  Shared utilities.         main -> ./dist/src/index.js
  @keyflow/api     tRPC routers.             main -> ./dist/src/root.js
  @keyflow/ui      Component library.        main -> ./src/index.ts  (TS source)
```

The first three expose **built JS**; only `@keyflow/ui` exports TypeScript
source, and only the web app consumes it. This matters for deployment — see §7.

## 3. Entry points

| Path | Entry |
|---|---|
| Server boot | `apps/server/src/main.ts` → `app-bootstrap.ts` → `app.module.ts` |
| Server start | `node dist/main.js` (all of `dev`, `start`, `start:prod`) |
| Web start | `next start -H 0.0.0.0 -p ${WEB_PORT:-5000}` |
| Production supervisor | `scripts/start-prod.sh` — runs both, API on `$PORT`… see §7 |

There is **no `setGlobalPrefix`**. Controllers carry their full paths, so
`@Controller('api/v1/cortex')` really is `/api/v1/cortex`.

## 4. Cross-cutting rules that bite

These four have each caused an outage or a silent failure. Learn them before
writing a route.

### 4.1 The global ValidationPipe strips undecorated properties

`app-bootstrap.ts` installs `ValidationPipe({ whitelist: true, transform: true })`.
`whitelist: true` **deletes every property that carries no class-validator
metadata**.

- An **undecorated DTO class** arrives at your handler as `{}`. This silently
  killed the main chat endpoint, admin login, bookings, goals, time entries,
  retainers and change orders.
- An **inline body type** (`@Body() body: { x: string }`) is *not* stripped —
  its metatype is `Object`, which the pipe skips. Verified directly.
- Guards run **before** pipes, so `BusinessGuard` sees the raw body while your
  handler sees the stripped one. That asymmetry makes the failure look like a
  client bug.

### 4.2 Tenancy is `businessId`, and the guard is not enough

`core/auth/business.guard.ts` resolves the tenant as:

```ts
req.params?.businessId || req.body?.businessId || req.query?.businessId
```

A guard establishes **who is asking**. It does not constrain **what a query
returns**. Always scope by `businessId` in the `WHERE` clause too.

⚠️ **The whitelist has been acting as accidental tenant isolation.** Several
services write caller-supplied foreign keys (`projectId`, `taskId`, `contactId`,
`invoiceId`) with no ownership check; they were only safe because the pipe
stripped those fields first. Decorating such a DTO without adding an ownership
check converts a broken endpoint into a cross-tenant write. This is real — it
was caught in review, not in production. `ChangeOrder` has no `businessId`
column at all; its tenancy runs through `project.businessId`.

### 4.3 Compilation is CommonJS

`apps/server/tsconfig.json` sets `"module": "CommonJS"` and Node is pinned to
20.18.1, which cannot `require()` an ESM-only package. An ESM-only dependency
crashes the server **before NestFactory runs**, which no unit test catches
because none of them boot the app.

Guarded by `apps/server/test/commonjs-compat.test.ts`.

### 4.4 `NODE_ENV=production` makes pnpm skip devDependencies

`typescript` and `@types/node` are devDependencies. On any host that sets
`NODE_ENV=production` before install, `tsc` is simply absent and the build fails
with confusing tsconfig errors. Use `pnpm install --prod=false` for builds.

## 5. Background work

Nothing here is triggered by a user, and all of it runs whether or not anyone
is looking.

| Mechanism | Count |
|---|---|
| `@Cron` declarations | 18 across 6 files |
| `@OnEvent` listeners | 346 across 56 files |
| `OnModuleInit` hooks | 71 files |

Heaviest listeners: `ai.listener.ts` (44), `flow.listener.ts` (24),
`crm/revenue-event.listener.ts` (23), `calendar/listeners/commerce.listener.ts`
(20), `growth-intelligence/journey-listener.service.ts` (18).

`AgentTriggerService` installs an `events.onAny(...)` firehose and matches every
emitted event against the `AgentTrigger` table — so **every event costs a query**.

## 6. The two brains

This is the single most important architectural fact in the repo, and it is not
obvious from the file layout.

```
main chat   ->  POST /ai/businesses/:id/flow/chat/stream
                FlowOrchestratorService          (fast, tool-calling, streams)

"Deep think" ->  GET /api/v1/cortex/conscious/stream
                KeyCortexConsciousnessService.processConsciously
                                                 (12 phases, 9 organs)
```

They are **separate paths**. Ordinary messages never touch the cortex.

`processConsciously` cost, measured per organ:

- **Every organ except reasoning makes ZERO model calls** — emotion, ethics,
  metacognition, temporal, intuition, interoception and endocrine are heuristic.
- All cost is in `reasonMultiModal`, which fires **one model call per reasoning
  mode** and defaults to all seven (`ALL_REASONING_MODES`).
- They run via `Promise.allSettled`, so **latency ≈ 1 call, cost ≈ 7×**.

`reasonMultiModal(query, context, availableModes?)` already accepts a mode
subset — `processConsciously` just never passes one. **Graded cognition is
supported in the signature and unused.**

## 7. Deployment

- `render.yaml` targets **`branch: main`**, plan `pro` (4 GB).
- **The server build needs ~4 GB.** Measured cold: 2048 MB OOM, 3328 MB OOM,
  3584 MB builds. `NODE_OPTIONS=--max-old-space-size=3584`.
- `scripts/start-prod.sh` runs API and web as children. **`WEB_PORT` is set to
  the same value as `PORT`, so the WEB app answers the platform's health check**,
  not the API. Health check is `/api/healthz` (a Next.js route), not `/healthz`
  (the API's).
- `NEXT_PUBLIC_API_BASE_URL` is required **at build time** — `next.config.ts`
  preloads the repo-root `.env`, which is gitignored and therefore absent on any
  build host. Without it the web build fails with `[FATAL] Environment
  validation failed`.
- ⚠️ **Live production is not on Render.** `keyflowos.com` and
  `api.keyflowos.com` both answer `Via: 1.1 Caddy`; Render would inject
  `x-render-origin-server`. The deploy target is unresolved.

## 8. How to tell what is real

Registration is not usage. Before trusting a service, check all four:

```bash
# 1. Does it exist and do real work, or is the body a stub?
grep -n "model absent from schema\|not implemented" path/to/x.service.ts

# 2. Is it registered as a provider?
grep -rn "XService" apps/server/src --include=*.module.ts

# 3. Does anything inject it?
grep -rn ": XService\|@Inject(XService)" apps/server/src --include=*.ts | grep -v spec

# 4. If it is a scheduler/listener, does it have a driver?
grep -n "@Cron\|@OnEvent\|OnModuleInit" path/to/x.service.ts
```

A service can be registered, injected, non-stubbed **and still inert** if its
only caller is itself or a spec. Check for real call sites, not just imports.

### Current health inventory (measured 2026-08-03)

| Signal | Count |
|---|---|
| Services never injected anywhere (of 584) | **36** |
| Web components never rendered (of 253) | **64** |
| `model absent from schema` markers | 17 |
| `not implemented` markers | 24 |
| Undecorated `@Body()` DTO classes | **0** (was 9+) |

Most of the 36 uninjected services are schedulers driven by `@Cron`/`@OnEvent`
and are fine. Roughly ten are registered with nothing driving *or* calling them.

### Known-inert, deliberately left alone

Documented in full at `.claude/plans/refactored-bouncing-pancake.md`. Summary:

| Service | Why not to wire it |
|---|---|
| `ChaserService` | Filters `contactTask` for `not: 'COMPLETED'`; writers set `'DONE'`. Would nag finished work forever. Duplicated by `MorningBriefingService`. |
| `EscalationService` | Creates `ApprovalRequest` with no `ApprovalStep` rows; `decideStep` rejects those. Permanently undecidable approvals, on a legacy model. |
| `KeyAuditorService` | Unregistered; duplicated by live `EvidenceService.checkTaskEvidence`. |
| `CognitionSessionService` | Duplicated by live `KeyCortexSessionService`. |
| `KeyCortexKeystoreAdapterService` | Unregistered, and the capability registry has no keystore entries, so no command can reach it. |
| `KeyCortexRealtimeService` | All 10 `@OnEvent` names have zero emitters; self-driving path gated on a stub returning `[]`. |
| `KeyCortexSagaExecutorService` | Real, but `buildCompensation` looks up dotted refs against a map keyed on bare names — compensates almost nothing. |

## 9. Testing

- `pnpm test:ci` = `test:unit && test:smoke`. **This is what CI runs.**
- Integration tests are **not** in CI and several fail locally against a live DB.
- Warning ceilings act as ratchets: server **3376**, web **44**. Both are close
  to their limits.
- Most specs construct services directly with mocks and never boot Nest, so they
  cannot catch DI, routing or boot failures. Two guards exist specifically for
  that blind spot: `test/commonjs-compat.test.ts` and the CI step that runs the
  compiled server to prove it loads.

**Convention worth keeping:** every behavioural fix in this repo should be
negative-controlled — revert the fix, confirm the test fails, restore. Several
tests here were written wrong in ways only that step exposed.

---

_Regenerate the counts in §1 and §8 with the commands shown; everything else is
narrative and should be edited by hand when it stops being true._
