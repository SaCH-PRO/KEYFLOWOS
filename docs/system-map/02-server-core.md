# Server core & bootstrap

> Everything the NestJS API is made of before any feature exists: the boot
> sequence that validates the environment and installs the tenant provider, the
> single `AppModule` that wires 122 Nest modules together, the authentication
> middleware and the guards routes opt into, the AsyncLocalStorage tenant scope
> that feeds the Prisma isolation extension in `packages/db`, the global
> interceptors and exception filter, Redis, Prisma, the connector framework, and
> the crypto/redaction helpers everything else borrows. If a request reaches a
> feature module at all, it got there through this code.

## How it works

Boot begins in [main.ts](apps/server/src/main.ts), which is deliberately
ordered. It loads `../../.env` relative to `apps/server`, then calls
`ensureValidServerEnv()` from [env.ts](apps/server/src/core/config/env.ts) —
`DATABASE_URL`, `NODE_ENV` and `PORT` are hard requirements and anything missing
prints a list and `process.exit(1)`; roughly a dozen more (Supabase, AI keys,
`REDIS_URL`, the public URLs) only warn. `assertNoDevAuthBypass()` then throws in
*every* environment if `KEYFLOW_DEV_AUTH_BYPASS` is still set, because the code
path it named was deleted. A third check is inline: when
`AUTH_REQUIRE_EMAIL_VERIFICATION` is on (or unset in production) the process
refuses to start without `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` and
`EMAIL_FROM_ADDRESS`. Only after all of that is `./app.module` **dynamically
imported** — the import is deferred so a bad env fails before a hundred modules'
module-level side effects run.

Immediately before `NestFactory.create`, `main.ts` calls
`setTenantContextProvider({ getCurrentBusinessId })`, handing
[tenant-context.ts](apps/server/src/core/tenant/tenant-context.ts)'s
AsyncLocalStorage reader to
[packages/db/src/client.ts](packages/db/src/client.ts). This is the switch that
turns the tenant isolation extension on: `tenantOperationAllowed(model)` is
`!!activeBusinessId() && BUSINESS_ID_MODELS.has(model)`, and without a provider
`activeBusinessId()` is permanently `undefined`. The app is then created with
`rawBody: true` (consumed by the Stripe/PayPal/LiveKit/Twilio webhook handlers in
feature modules), `configureNestApp(app)` runs, shutdown hooks are enabled, and
the server listens on `::` so both IPv4 and IPv6 localhost resolve.

[app-bootstrap.ts](apps/server/src/app-bootstrap.ts) is the whole Express-level
stack, and its order is registration order — it runs before `app.listen()`, so
everything it registers sits *in front of* Nest's own body-parser and module
middleware. In sequence: `trust proxy` (from `TRUST_PROXY`, default 1) →
`compression()` → the global exception filter and a `ValidationPipe({ whitelist:
true, transform: true })` → `helmet()` with an explicit CSP → `enableCors()` with
the allow-list from
[runtime-urls.ts](apps/server/src/core/config/runtime-urls.ts) (wide open when
`NODE_ENV !== 'production'`) → `express-rate-limit` (200 req/min default,
skipping `/healthz` and `/readyz`) → a hand-rolled middleware that stamps
`Access-Control-Allow-Origin: *` on five public prefixes → socket timeouts
(60s/65s/66s). Nest's own middleware, configured in `AppModule.configure()`,
runs after all of that: `CorrelationIdMiddleware` on `*`, then `AuthMiddleware`
on `*` excluding `healthz` and `readyz`.

Authentication is *attach-only*.
[auth.middleware.ts](apps/server/src/core/auth/auth.middleware.ts) reads
`Authorization: Bearer`, verifies it through
[supabase-auth.service.ts](apps/server/src/core/auth/supabase-auth.service.ts)
(local HS256 verification when `SUPABASE_JWT_SECRET` is present, otherwise a
`supabase.auth.getUser()` round-trip), falls back to the HMAC admin token in
[admin-token.util.ts](apps/server/src/core/auth/admin-token.util.ts), and sets
`req.user = { id, email, role }` — role read from the local Prisma `User` row so
demotions take effect immediately. Failure is silent: no token, a bad token, a
banned/deleted user or a Redis revocation marker all just leave `req.user`
unset and call `next()`. Nothing in this layer rejects anything. **There is no
`APP_GUARD`** — `grep -rn APP_GUARD apps/server/src` returns exactly one hit, and
it is a comment inside
[public-surface.spec.ts](apps/server/src/core/auth/public-surface.spec.ts).
Enforcement is entirely opt-in via `@UseGuards(...)`, so the default for a new
route is public.

Tenant scope is established one layer further in, by
[tenant.interceptor.ts](apps/server/src/core/tenant/tenant.interceptor.ts),
registered last of the three `APP_INTERCEPTOR`s and therefore innermost — closest
to the handler. It reads `req.user?.id` and
`params.businessId || body.businessId || query.businessId`, and if both are
present wraps `next.handle().subscribe(...)` inside `runWithTenant()`. Everything
downstream of the handler invocation — including all Prisma calls — then sees a
populated `AsyncLocalStorage` store, which is what `packages/db` reads. The
extension intercepts **fifteen** operations: twelve through `$allModels`
(`findUnique`, `findUniqueOrThrow`, `findFirst`, `findFirstOrThrow`, `findMany`,
`count`, `update`, `updateMany`, `delete`, `deleteMany`, `aggregate`, `groupBy`)
and three per-model (`create`, `createMany`, `upsert`) built from
`BUSINESS_ID_MODELS`, because Prisma 6.19's `$allModels` type has no `create` key
and `$allOperations` — measured — added ~11s to boot and stopped it completing.

The event bus is `@nestjs/event-emitter` v3, in-process only, configured in
[event-bus.module.ts](apps/server/src/core/event-bus/event-bus.module.ts) with
`wildcard: true`, `delimiter: '.'` and `maxListeners: 50`. There is no broker,
no queue, and no persistence at this layer — a payload is a JS object passed
synchronously to listeners in the same process, and a thrown listener does not
roll back the emitter. There are 352 `@OnEvent` handlers and 444 emit call sites
across `apps/server/src`; the typed contract lives in
[events.types.ts](apps/server/src/core/event-bus/events.types.ts) (92 payload
classes, 91 entries in `KeyFlowEventMap`), but nothing enforces that an emit uses
it — `EventEmitter2.emit()` takes any string.

The connector framework under `core/connectors` is the one genuinely large
subsystem living outside `modules/`. `ConnectorModule` is `@Global`, registers 22
`IConnector` implementations plus a registry, an activity logger, a credentials
vault, a health monitor and a nightly sync scheduler.
[connector-initializer.service.ts](apps/server/src/core/connectors/connector-initializer.service.ts)
injects all 22 and registers them on `onModuleInit`. Credentials are AES-256-GCM
blobs inside `ConnectorStatus.metadata.encryptedCredentials`; the health monitor
and the scheduler are `setInterval` loops (15 min / 5 min polling for a 02:00 UTC
window) that sweep **every business**, which means they run with no HTTP request
and therefore no tenant context — the Prisma extension is inert on those paths by
design and `where: { businessId }` is their only scope.

Finally, `core` carries a set of small cross-cutting helpers other slices
consume: `enc:v1:` token crypto, deep redaction of secret-shaped keys, a
`Business` secret-column stripper, constant-time comparison, HTML/SQL string
sanitizers, a visitor-cookie reader, S3 object storage, and a `CircuitBreaker`
that nothing uses.

## Entry points

| Kind | Entry | File | Notes |
|---|---|---|---|
| http | `GET /` | [app.controller.ts](apps/server/src/app.controller.ts) | No guard. Returns the literal string `KeyFlow Server is running!`. |
| http | `GET /healthz` | [app.controller.ts](apps/server/src/app.controller.ts) | No guard, excluded from `AuthMiddleware` and from the rate limiter. Uptime + commit + node version. |
| http | `GET /readyz` | [app.controller.ts](apps/server/src/app.controller.ts) | No guard, excluded from both. Calls `PrismaService.isHealthy()`; throws 503 when the DB is unreachable. |
| http | `GET /healthz/events` | [app.controller.ts](apps/server/src/app.controller.ts) | No guard. Injects `BusinessEventQueueService` from `modules/business-events`. **Not** excluded from `AuthMiddleware`/rate limiting — only the two bare paths are. |
| http | `GET /connectors/businesses/:businessId/dashboard` | [connector.controller.ts](apps/server/src/core/connectors/connector.controller.ts) | Class-level `@UseGuards(AuthGuard, BusinessGuard)` covers all 19 handlers. |
| http | `GET /connectors/businesses/:businessId/list` · `/statuses` · `/health/:type` · `/needs-attention` · `/inbox-config/:type` · `/credentials/:type` · `/webhook-info/:type` · `/activity` | [connector.controller.ts](apps/server/src/core/connectors/connector.controller.ts) | Guarded. `/credentials/:type` returns masked `•••• last4` only. |
| http | `POST /connectors/businesses/:businessId/{sync,disconnect,authenticate,reconnect,test,smoke,health-check/run,credentials}/:type` | [connector.controller.ts](apps/server/src/core/connectors/connector.controller.ts) | Guarded. |
| http | `PATCH /connectors/businesses/:businessId/inbox-config/:type` · `DELETE .../credentials/:type` | [connector.controller.ts](apps/server/src/core/connectors/connector.controller.ts) | Guarded. |
| http | `POST /connect/google-suite/businesses/:businessId/auth-url` | [google-suite.controller.ts](apps/server/src/core/connectors/google-suite.controller.ts) | Per-handler `@UseGuards(AuthGuard, BusinessGuard)`. |
| http | `GET /connect/google-suite/callback` | [google-suite.controller.ts](apps/server/src/core/connectors/google-suite.controller.ts) | **Unauthenticated by design** (browser redirect). Authenticated by an HMAC-signed `state` verified in `GoogleSuiteService.handleCallback`, keyed on `GOOGLE_STATE_SECRET`. |
| webhook | `POST /webhooks/forms/:businessId/:type` | [form-webhook.controller.ts](apps/server/src/core/connectors/form-webhook.controller.ts) | **Unauthenticated by design.** Guarded by a per-business HMAC secret in `x-keyflow-signature`, compared with `timingSafeStringEqual`. Only `typeform`, `jotform`, `webhook_form` accepted. Covered by the `/webhooks` wildcard-CORS prefix. |
| trpc | `ALL /trpc` | [trpc.module.ts](apps/server/src/trpc.module.ts) | Mounted with `forRoutes({ path: '/trpc', method: RequestMethod.ALL })` — **exact path only**, so all 80 procedures in `packages/api/src/routers` are unreachable. See *Wiring reality*. |
| event | `@OnEvent('connector.connected' \| 'connector.disconnected' \| 'connector.synced' \| 'connector.error')` | [connector-activity.service.ts](apps/server/src/core/connectors/connector-activity.service.ts) | Writes `ConnectorActivityLog`. |
| cron | `setInterval` every 15 min (first run +60s) | [connector-health-monitor.service.ts](apps/server/src/core/connectors/connector-health-monitor.service.ts) | `tick()` — cross-tenant sweep of `ConnectorStatus`, re-tests each connector, flips status, notifies. No `@Cron`; a raw timer under `OnModuleInit`/`OnModuleDestroy`. |
| cron | `setInterval` every 5 min, acts once per day at 02:00 UTC | [connector-sync-scheduler.service.ts](apps/server/src/core/connectors/connector-sync-scheduler.service.ts) | `runNightlySync()` — cross-tenant sweep, calls `registry.syncConnector` per (business, connector). |
| import | `OnApplicationBootstrap` | [seed.service.ts](apps/server/src/core/seed/seed.service.ts) | Seeds business templates, courses, cohorts, document taxonomy; promotes `keyflowos.tt@gmail.com` to `SUPER_ADMIN`; creates a dev user in `NODE_ENV=development`. Runs on **every** boot. |
| import | `PrismaService` | [prisma.service.ts](apps/server/src/core/prisma/prisma.service.ts) | `@Global` — injected by 643 files. The single DB handle for the whole server. |
| import | `REDIS_CLIENT` / `RedisService` | [redis.module.ts](apps/server/src/core/redis/redis.module.ts) | `@Global`, but only reachable because four feature modules import `RedisModule`. |
| import | `SupabaseAuthService`, `SupabaseAdminService`, `AuthGuard`, `BusinessGuard`, `OptionalAuthGuard`, `ModuleScopeGuard` | [auth.module.ts](apps/server/src/core/auth/auth.module.ts) | `@Global`. Note `AdminGuard`, `GenomeGateGuard`, `HoneypotGuard`, `RateLimitGuard`, `PublicRateLimitGuard` are **not** here — Nest instantiates them from the importing module's injector. |
| import | `ConnectorRegistryService`, `ConnectorCredentialsService`, `EntityResolutionService`, `WebhookIngressLoggerService`, `GoogleSuiteService`, 14 connectors | [connector.module.ts](apps/server/src/core/connectors/connector.module.ts) | `@Global`, exported to feature modules (`crm`, `social`, `whatsapp`, `payments`, `commerce`, `ingestion`, `shopify`, `email-marketing`, `communications`). |

### How a route opts into authentication

There are eight guards. Each is attached per-controller or per-handler; none is global.

| Guard | File | What it checks | Attachments (`.controller.ts` imports) |
|---|---|---|---|
| `AuthGuard` | [auth.guard.ts](apps/server/src/core/auth/auth.guard.ts) | `req.user` truthy, else 401. That is its entire body (12 lines). | 164 files |
| `BusinessGuard` | [business.guard.ts](apps/server/src/core/auth/business.guard.ts) | `SUPER_ADMIN` short-circuits; otherwise resolves `businessId` from `params ‖ body ‖ query` and requires a `Business` row owned by, or with a `Membership` for, `user.id`. | 160 files |
| `ModuleScopeGuard` | [module-scope.guard.ts](apps/server/src/core/auth/module-scope.guard.ts) | Reads `@RequireModuleScope(module, level)`; **no metadata ⇒ returns true**. Otherwise reads `Membership.permissionScopes`, falling back to `DEFAULT_SCOPES` by role. | 45 files |
| `RateLimitGuard` | [rate-limit.guard.ts](apps/server/src/core/guards/rate-limit.guard.ts) | Reads `@RateLimit(limit, windowMs)`; **no metadata ⇒ returns true**. Redis sorted-set window keyed `ip:businessId:handler`. Fails **closed** (503) on Redis error — including a per-command pipeline error, which the comment documents as a bug that was correct by accident for months. | 12 files |
| `PublicRateLimitGuard` | [public-rate-limit.guard.ts](apps/server/src/core/guards/public-rate-limit.guard.ts) | Same shape via `@PublicRateLimit`, keyed `ip:handler:route` (no tenant). Fails closed. Does **not** check the pipeline error slot — the defect fixed in `RateLimitGuard` is still present here. | 10 files |
| `AdminGuard` | [admin.guard.ts](apps/server/src/core/auth/admin.guard.ts) | `user.role === 'SUPER_ADMIN'`, else 403. | 4 files |
| `GenomeGateGuard` | [genome-gate.guard.ts](apps/server/src/core/auth/genome-gate.guard.ts) | Calls `BlueprintService.calculateGenomeIntegrity(businessId)`; 403 `GENOME_GATE_BLOCKED` unless the Three-Pillar Minimum is met. | 5 files |
| `HoneypotGuard` | [honeypot.guard.ts](apps/server/src/core/guards/honeypot.guard.ts) | Rejects when `_hp`/`website_url`/`company_url` is non-empty, or the form was submitted <1500 ms after render (`_t`). | 3 files |
| `OptionalAuthGuard` | [optional-auth.guard.ts](apps/server/src/core/auth/optional-auth.guard.ts) | `return true`. A marker that documents "public but reads `req.user` if present". | 2 files |

**Measured 2026-08-23, re-derived from source, not quoted:**

- 168 `*.controller.ts` files, **2,177 route handlers**, 1,140 `@UseGuards(` attachments.
- **227 handlers (10.4%)** across **54 controllers** are reachable with no `AuthGuard` — the exact figure the `ACKNOWLEDGED_PUBLIC` ledger in `public-surface.spec.ts` pins.
- A looser count that accepts *any* `@UseGuards` finds **150** handlers with no guard decorator at all. The 77-handler gap is routes carrying `PublicRateLimitGuard`/`HoneypotGuard`/`AdminGuard`/`RateLimitGuard` without `AuthGuard`.
- Of the 227, four are in this slice: `GET /`, `GET /healthz`, `GET /readyz`, `GET /healthz/events`, plus `POST /webhooks/forms/:businessId/:type` and `GET /connect/google-suite/callback`.

## Files

### Root (`apps/server/src`)

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [main.ts](apps/server/src/main.ts) | 97 | Boot sequence: dotenv → `ensureValidServerEnv` → `assertNoDevAuthBypass` → email-verification env gate → dynamic `import('./app.module')` → `setTenantContextProvider` → `NestFactory.create({rawBody:true})` → `configureNestApp` → `enableShutdownHooks` → `listen(port,'::')`. Installs `uncaughtException`/`unhandledRejection` handlers that `process.exit(1)`. | `core/config/env.ts`, `app-bootstrap.ts`, `core/tenant/tenant-context.ts`, `@keyflow/db` (`setTenantContextProvider`), `@keyflow/shared/release-version` |
| [app-bootstrap.ts](apps/server/src/app-bootstrap.ts) | 129 | `configureNestApp()`: trust-proxy, compression, global filter + `ValidationPipe`, helmet CSP, CORS allow-list, `express-rate-limit`, public-prefix CORS override, HTTP socket timeouts. | `core/filters/http-exception.filter.ts`, `core/config/runtime-urls.ts`, `compression`, `helmet`, `express-rate-limit` |
| [app.module.ts](apps/server/src/app.module.ts) | 283 | The single root module. 115 module-class imports (107 feature-module files + 8 core: Prisma, EventBus, Auth, Trpc, Connector, Seed, Sentry, GrowthBook) plus `ScheduleModule.forRoot()`. Registers 3 `APP_INTERCEPTOR`s and applies 2 middlewares. | every `*.module.ts` in the graph; `core/tenant/tenant.interceptor.ts`, `core/interceptors/logging.interceptor.ts`, `modules/business-events/business-event.interceptor.ts`, `core/auth/auth.middleware.ts`, `core/middleware/correlation-id.middleware.ts` |
| [app.controller.ts](apps/server/src/app.controller.ts) | 73 | `/`, `/healthz`, `/readyz`, `/healthz/events`. No guards. | injects `AppService`, `PrismaService`, `BusinessEventQueueService` |
| [app.service.ts](apps/server/src/app.service.ts) | 7 | `getHello()` returns a fixed string. | — |
| [trpc.module.ts](apps/server/src/trpc.module.ts) | 37 | Mounts `@trpc/server` express middleware at exact path `/trpc`, building `AppContext` from `db`, `req.user`, `req.business`, `EventEmitter2`, `DiagnosticsService`. | `@keyflow/api` (`appRouter`), `@keyflow/db`, `modules/diagnostics` |
| [test-meta.ts](apps/server/src/test-meta.ts) | 12 | A scratch script that prints `design:paramtypes` for a two-class fixture. Zero importers; not referenced by any vitest config. | `reflect-metadata` |
| [types/pdf-parse.d.ts](apps/server/src/types/pdf-parse.d.ts) | 15 | Ambient module declaration for `pdf-parse`. | consumed by `tsc` only |
| [types/twilio.d.ts](apps/server/src/types/twilio.d.ts) | 6 | `declare module 'twilio'` → `any`. Used by KEY Cortex phone service. | `tsc` only |
| [types/xlsx.d.ts](apps/server/src/types/xlsx.d.ts) | 6 | `declare module 'xlsx'` → `any`. | `tsc` only |

### `core/auth`

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [auth.module.ts](apps/server/src/core/auth/auth.module.ts) | 28 | `@Global`; provides+exports `SupabaseAuthService`, `SupabaseAdminService`, `AuthGuard`, `BusinessGuard`, `OptionalAuthGuard`, `ModuleScopeGuard`. Imported explicitly by 14 feature modules despite being global. | all four guards, both Supabase services |
| [auth.middleware.ts](apps/server/src/core/auth/auth.middleware.ts) | 168 | Attaches `req.user` or does nothing. Three-state local-user resolution (absent row ⇒ attach as `USER`; deleted/banned ⇒ reject; Redis revocation marker ⇒ reject, checked first). Fails closed on lookup error. | injects `SupabaseAuthService`, `PrismaService`, `REDIS_CLIENT`; calls `verifyAdminToken`; reads `User.role/deletedAt/bannedAt` |
| [auth.guard.ts](apps/server/src/core/auth/auth.guard.ts) | 12 | `req.user` present ⇒ true, else `UnauthorizedException`. | attached by 164 controllers |
| [business.guard.ts](apps/server/src/core/auth/business.guard.ts) | 56 | Membership/ownership check against `Business`. `SUPER_ADMIN` bypasses. | injects `PrismaService`; reads `Business`, `Membership` |
| [module-scope.guard.ts](apps/server/src/core/auth/module-scope.guard.ts) | 87 | `@RequireModuleScope` + `Membership.permissionScopes` with role defaults for OWNER/ADMIN/STAFF over 13 module keys. | injects `PrismaService`, `Reflector`; reads `Membership` |
| [optional-auth.guard.ts](apps/server/src/core/auth/optional-auth.guard.ts) | 15 | Always true. | `community.controller.ts`, `identity.controller.ts` |
| [admin.guard.ts](apps/server/src/core/auth/admin.guard.ts) | 23 | `role === 'SUPER_ADMIN'`. | 4 admin controllers |
| [genome-gate.guard.ts](apps/server/src/core/auth/genome-gate.guard.ts) | 32 | Three-Pillar Minimum gate. | injects `BlueprintService` (`modules/blueprint`) |
| [admin-token.util.ts](apps/server/src/core/auth/admin-token.util.ts) | 82 | HMAC-SHA256 JWT-shaped admin token: `buildAdminToken` / `verifyAdminToken`. `exp`/`iat` are **milliseconds**, not JWT seconds — documented, and the comparison matches. Checks Redis `admin:jti:*` and `admin:user:*:revokedAt`. | `ADMIN_JWT_SECRET`, `ioredis`; used by `auth.middleware.ts`, `modules/admin-auth`, `modules/key-cortex/key-cortex-ws-auth.service.ts` |
| [supabase-auth.service.ts](apps/server/src/core/auth/supabase-auth.service.ts) | 163 | Local HS256 verify when `SUPABASE_JWT_SECRET` is set, else `supabase.auth.getUser(token)`. Returns null (never throws) when unconfigured. | `@supabase/supabase-js`, `SUPABASE_URL`/`SUPABASE_ANON_KEY` |
| [supabase-admin.service.ts](apps/server/src/core/auth/supabase-admin.service.ts) | 233 | Service-role admin ops: `createUser`, `signOut`, `deleteUser`, `generateSignupLink`, `generateConfirmationLink`, `findUserByEmail`; `SupabaseAdminError`. | `SUPABASE_SERVICE_ROLE_KEY`; injected by `seed.service.ts`, `modules/identity`, `modules/risc` |
| [system-actor.ts](apps/server/src/core/auth/system-actor.ts) | 53 | `KEY_SYSTEM_ACTOR_ID = 'key_ai'` and `isSystemActor()`. Contract: recognise the system actor only where `businessId` is present and enforced. | `modules/ai/flow-orchestrator.service.ts`, `modules/commerce/commerce.service.ts` |

### `core/config`

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [env.ts](apps/server/src/core/config/env.ts) | 216 | Zod schemas for required vs recommended env; S3 group validation (all-or-nothing); OAuth pair warnings; `KEYFLOW_SKIP_ENV_VALIDATION` escape; `ensureValidServerEnv`, `assertNoDevAuthBypass`. | called only from `main.ts` |
| [runtime-urls.ts](apps/server/src/core/config/runtime-urls.ts) | 114 | `appUrl()`, `apiUrl()`, `oauthRedirectBase()`, `appLink()`, `apiLink()`, `oauthRedirect()`, `allowedCorsOrigins()`. Precedence: explicit var → `PUBLIC_BASE_URL` → localhost. | `app-bootstrap.ts` + 14 feature files (bookings, calendar, commerce, conversion, …) |

### `core/tenant` + `core/prisma`

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [tenant-context.ts](apps/server/src/core/tenant/tenant-context.ts) | 28 | The AsyncLocalStorage store: `runWithTenant`, `getTenantContext`, `getCurrentBusinessId`, `getCurrentUserId`. | `tenant.interceptor.ts`, `main.ts`. **`getCurrentUserId` and `getTenantContext` have zero callers.** |
| [tenant.interceptor.ts](apps/server/src/core/tenant/tenant.interceptor.ts) | 32 | Third `APP_INTERCEPTOR`; wraps the handler subscription in `runWithTenant(businessId, userId)` when both are resolvable. | `tenant-context.ts`; feeds `packages/db` |
| [prisma.module.ts](apps/server/src/core/prisma/prisma.module.ts) | 9 | `@Global`, provides+exports `PrismaService`. Still explicitly imported by 52 feature modules. | — |
| [prisma.service.ts](apps/server/src/core/prisma/prisma.service.ts) | 53 | Holds `readonly client = db`. `onModuleInit` retries `dbHealth()` 5× with exponential backoff and **continues booting on failure**; `onModuleDestroy` disconnects; `isHealthy()` backs `/readyz`. | `@keyflow/db` (`db`, `dbHealth`); injected by 643 files |

### `core/interceptors`, `core/filters`, `core/middleware`, `core/decorators`

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [logging.interceptor.ts](apps/server/src/core/interceptors/logging.interceptor.ts) | 38 | First `APP_INTERCEPTOR`. `method url status ms [correlationId]` at debug, `SLOW` warn above 1000 ms, `ERR` on throw. | `req.correlationId` from `CorrelationIdMiddleware` |
| [team-audit.interceptor.ts](apps/server/src/core/interceptors/team-audit.interceptor.ts) | 61 | Opt-in via `@AuditAction(module, action, entityType)`. Writes `TeamActivityLog` on successful POST/PATCH/PUT/DELETE that have both `user.id` and `params.businessId`. Fire-and-forget. | injects `PrismaService`, `Reflector`; attached in `commerce` (×2 files), `crm`, `expenses` (×3 files) |
| [idempotency.interceptor.ts](apps/server/src/core/interceptors/idempotency.interceptor.ts) | 144 | Redis-backed `Idempotency-Key` dedup with a 30 s lock and 24 h response cache. **Zero importers — never registered anywhere.** | would inject `REDIS_CLIENT` |
| [request-timeout.interceptor.ts](apps/server/src/core/interceptors/request-timeout.interceptor.ts) | 46 | 30 s (120 s multipart) RxJS timeout → 503. **Zero importers — never registered anywhere.** | — |
| [http-exception.filter.ts](apps/server/src/core/filters/http-exception.filter.ts) | 88 | `@Catch()` catch-all applied via `useGlobalFilters`. Normalises to `{statusCode, code, message, error, timestamp, path, correlationId, details?}`; maps 8 status codes to string codes; preserves non-reserved fields (e.g. `missingPillars`) into `details`. Logs a stack for non-`HttpException`. | `request.correlationId` |
| [correlation-id.middleware.ts](apps/server/src/core/middleware/correlation-id.middleware.ts) | 22 | Reads `x-request-id` or mints a UUID; sets `req.correlationId` and the `X-Request-ID` response header. Applied to `*`. | augments the Express `Request` type globally |
| [current-user.decorator.ts](apps/server/src/core/decorators/current-user.decorator.ts) | 14 | `@CurrentUser()` param decorator returning `req.user`. | 5 controllers (`admin-auth`, `ai/flow`, `identity`, `risc-admin`, `time-tracking`) |
| [rate-limit.decorator.ts](apps/server/src/core/decorators/rate-limit.decorator.ts) | 11 | `@RateLimit(limit, windowMs)` → `SetMetadata(RATE_LIMIT_KEY)`. | read by `RateLimitGuard`; used by 12 controllers |

### `core/guards`

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [rate-limit.guard.ts](apps/server/src/core/guards/rate-limit.guard.ts) | 92 | Sliding-window Redis zset per `ip:businessId:handler`. Reads every pipeline result slot for errors before trusting `count`; throws `ServiceUnavailableException` on any Redis fault. | `Reflector`, `REDIS_CLIENT`, `rate-limit.decorator.ts` |
| [public-rate-limit.guard.ts](apps/server/src/core/guards/public-rate-limit.guard.ts) | 61 | Same mechanism for unauthenticated routes, keyed `ip:handler:route`; declares its own `@PublicRateLimit` decorator inline. | `Reflector`, `REDIS_CLIENT` |
| [honeypot.guard.ts](apps/server/src/core/guards/honeypot.guard.ts) | 39 | `@Honeypot(...fields)` decorator + submit-speed check. Always 400 on trip. | `Reflector`; `bookings`, `lead-forms`, `site` controllers |

### `core/redis`, `core/event-bus`, `core/growthbook`, `core/sentry`, `core/seed`

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [redis.constants.ts](apps/server/src/core/redis/redis.constants.ts) | 1 | `export const REDIS_CLIENT = Symbol('REDIS_CLIENT')`. | 13 injection sites |
| [redis.module.ts](apps/server/src/core/redis/redis.module.ts) | 152 | `@Global` factory for an `ioredis` client with `lazyConnect`, `maxRetriesPerRequest: null` and — critically — `enableOfflineQueue: false`, so commands *reject* instead of never settling when Redis is down. Throttled error logging (1/min). Defaults to `redis://localhost:6379` with a warning. | `ioredis`; consumed by `auth.middleware`, both rate-limit guards, `admin-auth`, `ai/queue`, `business-events`, `crm-cache`, `identity`, `key-cortex`, `temporal-flow` |
| [redis.service.ts](apps/server/src/core/redis/redis.service.ts) | 60 | Thin `get/set/setex/keys/del/getJson/setJson` wrapper; quits the client on destroy. | injects `REDIS_CLIENT`; used by 16 feature files |
| [event-bus.module.ts](apps/server/src/core/event-bus/event-bus.module.ts) | 18 | `@Global`; `EventEmitterModule.forRoot({ wildcard:true, delimiter:'.', maxListeners:50 })`. In-process only. | every `@OnEvent`/`emit` in the server |
| [events.types.ts](apps/server/src/core/event-bus/events.types.ts) | 785 | 92 payload classes and a 91-entry `KeyFlowEventMap`. Advisory only — nothing forces an emit to use it. | imported by 36 feature files; imports `ConnectorType` |
| [growthbook.module.ts](apps/server/src/core/growthbook/growthbook.module.ts) | 13 | `@Global`; provides+exports `GrowthBookService`. | `app.module.ts` |
| [growthbook.service.ts](apps/server/src/core/growthbook/growthbook.service.ts) | 122 | `GrowthBookClient`, dark-by-default on missing `GROWTHBOOK_CLIENT_KEY`; `isEnabled(key,ctx,fallback)`, `getValue(...)`. **Zero injectors outside its own module and spec.** | `@growthbook/growthbook` |
| [sentry.module.ts](apps/server/src/core/sentry/sentry.module.ts) | 43 | Calls `Sentry.init` at module-import time when `SENTRY_DSN` is set, with `integrations: []` and a `beforeSend` that strips `authorization`/`x-api-key`/`cookie` and redacts `password`/`token` in the body. Provides and exports nothing. | `@sentry/nestjs` (hoisted root dep) |
| [seed.module.ts](apps/server/src/core/seed/seed.module.ts) | 10 | Imports `PrismaModule`, `IdentityModule`; provides `SeedService`. | — |
| [seed.service.ts](apps/server/src/core/seed/seed.service.ts) | 584 | `onApplicationBootstrap` → templates, courses, cohorts, document taxonomy, super-admin promotion, dev user. Each step is count-gated and wrapped in try/catch. `seedImpactRules` exists but is only reached from inside `seedDocumentTaxonomy`. | injects `PrismaService`, `SupabaseAdminService`, `IdentityService`; writes `BusinessTemplate`, `Course`, `Cohort`, `DocumentCategory`, `DocumentType`, `ImpactRule`, `User` |

### `core/crypto`, `core/security`, `core/utils`, `core/object-storage`

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [token-crypto.ts](apps/server/src/core/crypto/token-crypto.ts) | 69 | `encryptToken`/`decryptToken`/`isTokenEncrypted`. AES-256-GCM, random 16-byte IV, `enc:v1:` + base64(iv‖tag‖ct). Key = `scryptSync(secret, 'keyflow-token-salt-v1', 32)` over `CONNECTOR_CREDENTIALS_KEY ‖ CREDENTIALS_ENCRYPTION_KEY ‖ DRIVE_TOKEN_ENCRYPTION_SECRET ‖ JWT_SECRET`; throws in production when all are unset. Decrypt passes unprefixed input through unchanged (legacy plaintext). | only `modules/whatsapp/whatsapp.service.ts` |
| [redaction.ts](apps/server/src/core/security/redaction.ts) | 76 | 20 case-insensitive substring patterns; `deepRedact` (in-place) and `safeRedactedSnapshot` (clone + redact). | `modules/business-events/business-event.interceptor.ts` |
| [sanitize-business.ts](apps/server/src/core/security/sanitize-business.ts) | 52 | Strips 14 OAuth token columns off a `Business` record before it crosses a transport boundary. | `modules/identity/identity.service.ts` — **one caller** |
| [timing-safe-equal.ts](apps/server/src/core/security/timing-safe-equal.ts) | 19 | `timingSafeStringEqual` — length check then `crypto.timingSafeEqual`. | `form-webhook.controller.ts`, `google-suite.service.ts`, `bookings/calendar`, `commerce/gmail`, `connect/microsoft-oauth`, `crm-google`, `email-marketing`, `google-drive` |
| [sanitize.ts](apps/server/src/core/utils/sanitize.ts) | 51 | Regex tag-stripping + script/SQL-pattern removal + trim + length cap. `sanitize`, `sanitizeString`, `sanitizeRequired`, `sanitizeObject`. | 17 feature files (DTOs, `crm.service`, `commerce.controller`, …) |
| [visitor-cookie.ts](apps/server/src/core/utils/visitor-cookie.ts) | 30 | Reads `x-visitor-id` header then the `kf_vid` cookie, capped at 100 chars. | `commerce.controller.ts`, `site.controller.ts` |
| [circuit-breaker.ts](apps/server/src/core/utils/circuit-breaker.ts) | 114 | CLOSED/OPEN/HALF_OPEN breaker with `CircuitBreakerError`. **Zero importers.** | — |
| [object-storage/index.ts](apps/server/src/core/object-storage/index.ts) | 18 | Re-exports `ObjectStorageService`, `ObjectNotFoundError`, and the entire ACL surface. | `modules/ai/flow-orchestrator`, `modules/crm/privacy/contact-privacy`, `modules/finance/finance.controller`, `modules/uploads/uploads.service` |
| [object-storage/objectStorage.ts](apps/server/src/core/object-storage/objectStorage.ts) | 450 | S3 client (cached per config), `getObjectEntityUploadURL`, `uploadBuffer`, `getReadSignedUrl`, `downloadObject`, `getObjectEntityFile/Buffer`, `normalizeObjectEntityPath`, `searchPublicObject`, plus two ACL passthroughs. Env: `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`/`AWS_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`/`AWS_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PUBLIC_URL`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`. | `@aws-sdk/client-s3`, `objectAcl.ts` |
| [object-storage/objectAcl.ts](apps/server/src/core/object-storage/objectAcl.ts) | 128 | ACL policy stored in S3 object metadata (`acl-policy`). `setObjectAclPolicy`, `getObjectAclPolicy`, `canAccessObject`. `ObjectAccessGroupType` is an **empty enum** and `createObjectAccessGroup` has only a `default:` branch that throws. | `objectStorage.ts` only |

### `core/connectors`

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [connector.module.ts](apps/server/src/core/connectors/connector.module.ts) | 108 | `@Global`. 3 controllers, 31 providers, 22 exports. Imports `NotificationsModule` and `KeyInboxModule`. | everything below; `modules/notifications`, `modules/key-inbox` |
| [connector.interface.ts](apps/server/src/core/connectors/connector.interface.ts) | 267 | `ConnectorType` (23 members), `ConnectorCategory`, `ConnectorStatus`, `ConnectorMeta`, `ConnectorHealth`, `ConnectorSyncResult`, `IConnector`, `IngestionItemInput`, `ConnectorEvent`, `ConnectorSmokeResult`. | imported by 39 files |
| [connector.controller.ts](apps/server/src/core/connectors/connector.controller.ts) | 334 | 19 handlers under `/connectors`, class-guarded. Credential reads are masked. | `ConnectorRegistryService`, `ConnectorCredentialsService`, `ConnectorActivityService`, `ConnectorHealthMonitorService`, `PrismaService`, `runtime-urls` |
| [connector-registry.service.ts](apps/server/src/core/connectors/connector-registry.service.ts) | 286 | In-memory `Map<ConnectorType, IConnector>`; `register/get/list/listByCategory`, `getHealth`, `getStatuses`, `getDashboard`, `syncConnector`, `disconnectConnector`, `authenticateConnector`, `testConnector`, `smokeTestConnector`, `reconnectConnector`. Emits `connector.synced`, `connector.error`, `connector.disconnected`, `connector.connected`, `connector.tested`, `connector.smoke_tested`. | `PrismaService` (`ConnectorStatus`), `EventEmitter2` |
| [connector-initializer.service.ts](apps/server/src/core/connectors/connector-initializer.service.ts) | 87 | Injects all 22 connectors and registers them in `onModuleInit`. | `ConnectorRegistryService`, `implementations/index.ts` |
| [connector-credentials.service.ts](apps/server/src/core/connectors/connector-credentials.service.ts) | 212 | AES-256-GCM `enc:v1:` blob in `ConnectorStatus.metadata.encryptedCredentials`; `setCredentials`, `getCredentials`, `getMaskedCredentials`, `deleteCredentials`, legacy `Business.metaData` fallback. Key salt: `'connector-credentials-salt'`. | `PrismaService`; used by 11 connectors + `modules/shopify` |
| [connector-activity.service.ts](apps/server/src/core/connectors/connector-activity.service.ts) | 131 | `record()` / `list()` on `ConnectorActivityLog`; four `@OnEvent` handlers for the connector lifecycle. Deterministic ordering by `[createdAt desc, id desc]`. | `PrismaService`, event bus |
| [connector-health-monitor.service.ts](apps/server/src/core/connectors/connector-health-monitor.service.ts) | 303 | `setInterval` sweep across all businesses; `tick`, `tickBusiness`, `checkOne`, `shouldRenotify` (24 h), `createAlert`, `needsAttention`. Skips connector types with no registry entry. | `PrismaService`, `ConnectorRegistryService`, `ConnectorActivityService`, `NotificationsService`; writes `ConnectorStatus`, `Notification` |
| [connector-sync-scheduler.service.ts](apps/server/src/core/connectors/connector-sync-scheduler.service.ts) | 153 | Polls every 5 min, runs once/day at 02:00 UTC; `runNightlySync()` returns `{businesses, attempted, synced, skipped, failed}`. `result.unsupported` is counted as skipped, not failed. | `PrismaService`, `ConnectorRegistryService`, `ConnectorActivityService` |
| [connector-sync-modes.ts](apps/server/src/core/connectors/connector-sync-modes.ts) | 91 | `ConnectorSyncMode` enum, `CONNECTOR_SYNC_MODES` (22 entries), `REGISTERED_CONNECTOR_TYPES` (22), `getSyncModes()`. Documents that almost every `sync()` is `STATUS_ONLY`. | **only its own spec imports it** |
| [entity-resolution.service.ts](apps/server/src/core/connectors/entity-resolution.service.ts) | 377 | The dedupe core for all inbound connector data: `resolveContact` (external-id map → email → phone), `resolvePayment`, `resolveBooking`, `resolveInvoice`, `resolveCompany`, `findContactIdByMatch`, plus `ContactExternalMapping` storage and field-precedence merge rules. Emits `contact.created`. | `PrismaService` (`Contact`, `ContactExternalMapping`, `Payment`, `Booking`, `Invoice`, `Account`), `EventEmitter2`; used by 22 connectors and 11 feature files |
| [form-webhook.controller.ts](apps/server/src/core/connectors/form-webhook.controller.ts) | 229 | `POST /webhooks/forms/:businessId/:type`. Per-business HMAC via `x-keyflow-signature`; normalises Typeform/Jotform payloads into `ingestSubmission`. | `ConnectorRegistryService`, `ConnectorCredentialsService`, `WebhookIngressLoggerService`, `timingSafeStringEqual` |
| [webhook-ingress-logger.service.ts](apps/server/src/core/connectors/webhook-ingress-logger.service.ts) | 75 | Writes `WebhookDeliveryLog` rows for inbound provider webhooks, with secret redaction. | `PrismaService`; used by `form-webhook.controller`, `social.controller`, `whatsapp.controller` |
| [google-suite.controller.ts](apps/server/src/core/connectors/google-suite.controller.ts) | 65 | `POST .../auth-url` (guarded) and `GET /connect/google-suite/callback` (public, HMAC state). | `GoogleSuiteService` |
| [google-suite.service.ts](apps/server/src/core/connectors/google-suite.service.ts) | 425 | One Google OAuth consent covering 6 services; per-service scope sets, HMAC-signed `state` (`GOOGLE_STATE_SECRET`), token exchange, per-service enablement based on granted scopes, writes tokens onto `Business`. | `PrismaService` (`Business`), `ConnectorRegistryService`, `ConnectorActivityService`, `timingSafeStringEqual`; env `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_SUITE_REDIRECT_URI` |
| [payment-gateway.interface.ts](apps/server/src/core/connectors/payment-gateway.interface.ts) | 69 | `IPaymentGateway` contract implemented by the Stripe/PayPal/WiPay connectors. | `payments-ops.service.ts` |

### `core/connectors/implementations`

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [index.ts](apps/server/src/core/connectors/implementations/index.ts) | 26 | Barrel for all 22 connectors + 2 ingestion services. | `connector.module.ts`, `connector-initializer.service.ts`, `form-webhook.controller.ts` |
| [form-platform.base.ts](apps/server/src/core/connectors/implementations/form-platform.base.ts) | 358 | Shared base for Typeform/Jotform/generic webhook forms: per-business secret mint/rotate, `ingestSubmission`, contact resolution, `LeadFormSubmission` write, emits `form.submitted` / `lead_form.submitted` / `entity.resolved`. `sync()` returns `PULL_SYNC_NOT_IMPLEMENTED`. | `PrismaService`, `ConnectorCredentialsService`, `EntityResolutionService`, `EventEmitter2` |
| [social-platform.base.ts](apps/server/src/core/connectors/implementations/social-platform.base.ts) | 217 | Shared base for LinkedIn/TikTok/Twitter: publish outbound, `sync()` explicitly unsupported. Emits `entity.resolved`. | `PrismaService`, `EntityResolutionService`, `EventEmitter2` |
| [gmail.connector.ts](apps/server/src/core/connectors/implementations/gmail.connector.ts) | 269 | Gmail `IConnector`; ingestion on OAuth callback. Emits `entity.resolved`, `message.received`. | `GmailIngestionService`, `EntityResolutionService`, `PrismaService` |
| [gmail-ingestion.service.ts](apps/server/src/core/connectors/implementations/gmail-ingestion.service.ts) | 529 | Backfill + thread parsing → `KeyInboxMessage`/contacts. | `PrismaService`, `EntityResolutionService`, `KeyInbox*` |
| [google-calendar.connector.ts](apps/server/src/core/connectors/implementations/google-calendar.connector.ts) | 284 | Push bookings to Google Calendar; `sync()` counts local bookings. | `PrismaService`, `EntityResolutionService`; used by `modules/bookings/calendar.service.ts` |
| [google-drive.connector.ts](apps/server/src/core/connectors/implementations/google-drive.connector.ts) | 244 | Drive file listing/ingest; `sync()` counts local `DocumentInstance`. | `PrismaService`; used by `modules/google-drive` |
| [google-forms.connector.ts](apps/server/src/core/connectors/implementations/google-forms.connector.ts) | 163 | Google Forms connector shell. | `GoogleFormsIngestionService` |
| [google-forms-ingestion.service.ts](apps/server/src/core/connectors/implementations/google-forms-ingestion.service.ts) | 337 | Response polling/mapping → contacts + lead-form submissions. | `PrismaService`, `EntityResolutionService` |
| [google-contacts.connector.ts](apps/server/src/core/connectors/implementations/google-contacts.connector.ts) | 173 | People API contact sync; `sync()` counts local rows. | `PrismaService` |
| [google-business-profile.connector.ts](apps/server/src/core/connectors/implementations/google-business-profile.connector.ts) | 198 | GBP connector; `sync()` returns `itemsSynced: 0`. | `PrismaService` |
| [outlook-contacts.connector.ts](apps/server/src/core/connectors/implementations/outlook-contacts.connector.ts) | 185 | Microsoft Graph contacts; `sync()` counts local rows. | `PrismaService` |
| [whatsapp.connector.ts](apps/server/src/core/connectors/implementations/whatsapp.connector.ts) | 274 | WhatsApp Cloud API send + webhook ingest; emits `entity.resolved`, `message.received`. | `PrismaService`, `EntityResolutionService` |
| [meta-social.connector.ts](apps/server/src/core/connectors/implementations/meta-social.connector.ts) | 302 | Facebook/Instagram publish + webhook ingest. | `EntityResolutionService`; used by `modules/social/social.service.ts` |
| [linkedin.connector.ts](apps/server/src/core/connectors/implementations/linkedin.connector.ts) | 51 | Thin subclass of `SocialPlatformConnector`. | base class |
| [tiktok.connector.ts](apps/server/src/core/connectors/implementations/tiktok.connector.ts) | 55 | Thin subclass. | base class |
| [twitter.connector.ts](apps/server/src/core/connectors/implementations/twitter.connector.ts) | 51 | Thin subclass. | base class |
| [typeform.connector.ts](apps/server/src/core/connectors/implementations/typeform.connector.ts) | 67 | Thin subclass of `FormPlatformConnector`. | base class, `ConnectorCredentialsService` |
| [jotform.connector.ts](apps/server/src/core/connectors/implementations/jotform.connector.ts) | 68 | Thin subclass. | base class |
| [webhook-form.connector.ts](apps/server/src/core/connectors/implementations/webhook-form.connector.ts) | 82 | Generic inbound form webhook. | base class |
| [stripe.connector.ts](apps/server/src/core/connectors/implementations/stripe.connector.ts) | 491 | `IPaymentGateway` + `IConnector`; checkout, refunds, webhook verification. `sync()` counts local `Payment` rows and returns `PULL_SYNC_NOT_IMPLEMENTED`. | `PrismaService`, `EntityResolutionService`, `payment-gateway.interface`; used by `modules/payments`, `modules/webhooks` |
| [paypal.connector.ts](apps/server/src/core/connectors/implementations/paypal.connector.ts) | 382 | Same shape for PayPal. | as above |
| [wipay.connector.ts](apps/server/src/core/connectors/implementations/wipay.connector.ts) | 276 | Same shape for WiPay (Caribbean gateway). | as above |
| [quickbooks.connector.ts](apps/server/src/core/connectors/implementations/quickbooks.connector.ts) | 427 | QuickBooks OAuth + entity push; `sync()` counts local invoices/payments/expenses. | `ConnectorCredentialsService`, `EntityResolutionService`; used by `modules/commerce/accounting.controller.ts` |
| [xero.connector.ts](apps/server/src/core/connectors/implementations/xero.connector.ts) | 380 | Same shape for Xero. | as above |
| [mailchimp.connector.ts](apps/server/src/core/connectors/implementations/mailchimp.connector.ts) | 319 | Audience/campaign push; `sync()` counts local campaigns. | `ConnectorCredentialsService`, `EntityResolutionService`; `modules/email-marketing` |
| [klaviyo.connector.ts](apps/server/src/core/connectors/implementations/klaviyo.connector.ts) | 340 | Same shape for Klaviyo. | as above |

## Data model

The slice owns very little and reads a lot. Models it **writes**:

| Model | Written by | Ownership |
|---|---|---|
| `ConnectorStatus` | `connector-credentials.service.ts`, `connector-registry.service.ts`, `connector-health-monitor.service.ts`, `google-suite.service.ts`, most connectors | **Exclusively owned by this slice** apart from `modules/shopify`, which writes its own `connectorType: 'shopify'` rows directly. 75 of the slice's Prisma references touch it. |
| `ConnectorActivityLog` | `connector-activity.service.ts` | **Exclusively owned.** |
| `WebhookDeliveryLog` | `webhook-ingress-logger.service.ts` | **Exclusively owned** (also written from `social`/`whatsapp` controllers *through* this service). |
| `ContactExternalMapping` | `entity-resolution.service.ts` | **Exclusively owned.** |
| `Business` | `google-suite.service.ts` (OAuth token columns), `business.guard.ts` (read) | Shared with `modules/identity`. |
| `Contact`, `Account`, `Payment`, `Booking`, `Invoice` | `entity-resolution.service.ts` (resolve-or-create) | Shared with `crm`, `commerce`, `bookings`, `payments`. |
| `User` | `auth.middleware.ts` (read), `seed.service.ts` (role promotion) | Shared with `modules/identity`. |
| `Membership` | `business.guard.ts`, `module-scope.guard.ts` (read only) | Owned by `modules/identity`. |
| `TeamActivityLog` | `team-audit.interceptor.ts` | Shared with `modules/governance`. |
| `Notification` | `connector-health-monitor.service.ts` (via `NotificationsService`) | Owned by `modules/notifications`. |
| `BusinessTemplate`, `Course`, `Cohort`, `DocumentCategory`, `DocumentType`, `ImpactRule` | `seed.service.ts` | Seed-only; owned by `templates`/`education`/`documents`. |
| `LeadForm`, `LeadFormSubmission`, `KeyInboxMessage`, `SocialConnection`, `CalendarSyncConflict` | connector implementations | Owned by `lead-forms`, `key-inbox`, `social`, `calendar`. |

**The tenant isolation surface this slice governs (re-derived from `schema.prisma` and `client.ts` on 2026-08-23):**

- 440 models in `schema.prisma`.
- 348 of them declare a `businessId` scalar.
- `BUSINESS_ID_MODELS` names **303**; 0 name a non-existent model, and 0 name a model without the column (both gated by [tenant-model-list.spec.ts](apps/server/src/core/prisma/tenant-model-list.spec.ts)).
- **45 tenant-bearing models are unscoped**: `AiMemory`, `ApiKey`, `AuthorityGrant`, `BusinessReputation`, `CalendarSyncConflict`, `CampaignBriefing`, `ChannelConnection`, `ChannelDestination`, `CognitionSession`, `ContactChannelStat`, `ContactExportJob`, `ContactExternalMapping`, `ContactForgetRequest`, `ContactInsightSnapshot`, `ConversationAIInsight`, `Course`, `DriveIntakeFile`, `FinanceActionItem`, `FlowRun`, `FlowSession`, `GenomeDepartment`, `GenomeGrowthChannel`, `IngestionItem`, `IntegrationConnection`, `IntegrationSyncRun`, `InventoryStock`, `KeyCallSession`, `MarketplaceOrder`, `Membership`, `MessageIntake`, `Payment`, `PortalAccess`, `PresenceInsightSnapshot`, `PromoCode`, `PushSubscription`, `SeoKeyword`, `SeoPage`, `SitePageDraft`, `SocialConnection`, `SupplierConnection`, `SyncJob`, `ValueConstraint`, `VoiceSession`, `WebhookEvent`, `WhatsAppMessage`. Three (`Payment`, `MarketplaceOrder`, `WebhookEvent`) are in `NEVER_SCOPE` — they are resolved by global provider keys in webhooks that have no tenant context, and scoping them would turn a taken payment into a silent `null`. The other 42 are a shrink-only debt ledger.
- Note that **`ContactExternalMapping`, which this slice exclusively owns, is on the unscoped list.**

## External services

| Service | SDK / transport | Configured by | Where |
|---|---|---|---|
| PostgreSQL | `@prisma/client` 6.19 + `@prisma/adapter-pg` (`pg` Pool, max 20) | `DATABASE_URL` | `packages/db/src/client.ts` via `PrismaService` |
| Redis | `ioredis` 5 | `REDIS_URL` (defaults to `redis://localhost:6379` with a warning) | `redis.module.ts` |
| Supabase Auth | `@supabase/supabase-js` 2 | `SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_ANON_KEY`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` | `supabase-auth.service.ts`, `supabase-admin.service.ts` |
| Sentry | `@sentry/nestjs` 10 (root-hoisted dep, **not** in `apps/server/package.json`) | `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_PROFILES_SAMPLE_RATE` | `sentry.module.ts` |
| GrowthBook | `@growthbook/growthbook` 1.6 | `GROWTHBOOK_CLIENT_KEY`, `GROWTHBOOK_API_HOST` | `growthbook.service.ts` |
| S3 / S3-compatible | `@aws-sdk/client-s3` | `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`/`AWS_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`/`AWS_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PUBLIC_URL`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS` | `objectStorage.ts` |
| Google (Gmail, Calendar, Drive, Forms, Contacts, Business Profile) | REST via `fetch` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_STATE_SECRET`, `GOOGLE_SUITE_REDIRECT_URI`/`GOOGLE_REDIRECT_URI` | `google-suite.service.ts` + Google connectors |
| Microsoft Graph | REST | via `ConnectorCredentialsService` / `modules/connect` | `outlook-contacts.connector.ts` |
| Stripe / PayPal / WiPay | REST | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, WiPay creds via the credential vault | `stripe/paypal/wipay.connector.ts` |
| QuickBooks / Xero | REST | per-business credentials in `ConnectorStatus.metadata` | `quickbooks/xero.connector.ts` |
| Mailchimp / Klaviyo | REST | per-business credentials | `mailchimp/klaviyo.connector.ts` |
| Meta (Facebook/Instagram), LinkedIn, TikTok, Twitter | REST | per-business credentials | social connectors |
| WhatsApp Cloud API | REST | per-business credentials | `whatsapp.connector.ts` |
| Typeform / Jotform | inbound webhooks only | per-business HMAC secret minted by `FormPlatformConnector` | `form-webhook.controller.ts` |

### The `enc:v1:` scheme and its key schedules

Five files write the prefix `enc:v1:` and every one of them uses AES-256-GCM with
a random 16-byte IV and the layout `enc:v1:` + base64(`iv‖tag‖ciphertext`). The
prefix carries **no key identifier**, so a ciphertext cannot be attributed to the
key that produced it. There are **four distinct key schedules** behind it:

| Salt | Secret precedence | Files |
|---|---|---|
| `keyflow-token-salt-v1` | `CONNECTOR_CREDENTIALS_KEY` → `CREDENTIALS_ENCRYPTION_KEY` → `DRIVE_TOKEN_ENCRYPTION_SECRET` → `JWT_SECRET` | [token-crypto.ts](apps/server/src/core/crypto/token-crypto.ts) (throws in production if unset) |
| `keyflow-token-salt-v1` | `CONNECTOR_CREDENTIALS_KEY` → `CREDENTIALS_ENCRYPTION_KEY` → `JWT_SECRET` — **no `DRIVE_TOKEN_ENCRYPTION_SECRET`** | [packages/db/src/middleware/token-encryption.ts](packages/db/src/middleware/token-encryption.ts) — and this one **silently falls back to the literal dev key in production**; it has no production guard |
| `connector-credentials-salt` | `CONNECTOR_CREDENTIALS_KEY` → `CREDENTIALS_ENCRYPTION_KEY` → `JWT_SECRET` | [connector-credentials.service.ts](apps/server/src/core/connectors/connector-credentials.service.ts) (throws in production) |
| `supplier-credentials-salt` | same three | `apps/server/src/modules/supplier/credentials.util.ts`, `packages/api/src/lib/credentials.ts` |

A fifth AES-256-GCM scheme with salt `keyflowos-byok-salt` exists in
`modules/ai/model-gateway.service.ts` but does **not** use the `enc:v1:` prefix.

The Prisma-level extension in `packages/db` transparently encrypts/decrypts
`Business` (16 OAuth token columns), `SocialConnection` (`token`,
`refreshToken`), `ChannelConnection` (`token`, `refreshToken`) and
`Webhook.secret`. `PortalAccess.token`, `PaymentLink.token` and
`ContactExportJob.token` are deliberately excluded because they are looked up by
value and a random IV would break equality lookups silently.

## Wiring reality

Most of this slice is genuinely reachable, and I verified the module graph
mechanically rather than by reading the import list: a script walks
`app.module.ts`, resolves each name in every `@Module({ imports: [...] })` back
to a file, and follows it transitively (including `X.forRoot()` forms).

**Module graph — reachable.** 123 `*.module.ts` files exist under
`apps/server/src`; **122 are reachable** from `AppModule`. 110 directories exist
under `apps/server/src/modules`; **109** contribute at least one reachable
module. `app.module.ts` imports 106 of those directories directly (107 files —
`business-genome` contributes both `business-genome.module.ts` and
`document-pack/genome-document-pack.module.ts`). Three more are reachable only
transitively, all three through `modules/ai/ai.module.ts:99`: **`mcp`
(`McpModule`), `payroll` (`PayrollModule`), `staff-performance`
(`StaffPerformanceModule`)**.

### Dead or unreachable

**1. `GamificationModule` is the only module never imported.**
`apps/server/src/modules/gamification/gamification.module.ts:12` declares it;
`grep -rn "GamificationModule" apps/server/src` returns hits only inside that
file. Its own header says `// @keyflow:dormant`. Consequence:
`GamificationController` is never mounted, `GamificationService` is never
constructed, and `GamificationListener`'s `@OnEvent` handlers never subscribe.
Note that `public-surface.spec.ts` still carries
`'modules/gamification/gamification.controller.ts': 1` in `ACKNOWLEDGED_PUBLIC`
— it is counting a handler that does not exist at runtime.

**2. The entire tRPC surface is unreachable.**
`trpc.module.ts:35` mounts the router with
`.forRoutes({ path: '/trpc', method: RequestMethod.ALL })`, which in Nest matches
that path **exactly** and nothing below it. `packages/api/src/routers` contains
12 routers with 80 `publicProcedure`/`protectedProcedure` definitions; every
`POST /trpc/<router>.<procedure>` 404s before reaching tRPC. Independently:
`grep -rln trpc apps/web/src` returns **nothing** — no web client calls it
either. [trpc.module.spec.ts](apps/server/src/trpc.module.spec.ts) documents that
a routing fix to a wildcard would immediately expose
`social.listConnections`, which takes a client-supplied `businessId` with no
access check, on a path where the `TenantInterceptor` cannot run (Nest
interceptors need a controller) and where `SocialConnection` is not in
`BUSINESS_ID_MODELS` — while `token-encryption.ts` decrypts the OAuth tokens on
read.

**3. Two protective interceptors are written and never registered.**
`grep -rn "IdempotencyInterceptor" apps` returns 4 hits: 2 in
`idempotency.interceptor.ts` itself and 2 inside
`core/config/unreachable-provider.spec.ts`'s acknowledgement ledger.
`RequestTimeoutInterceptor` is identical (4 hits, same split). Neither is an
`APP_INTERCEPTOR` in `app.module.ts:271-276`, neither is attached with
`@UseInterceptors`, neither is injected. So **no HTTP-level request timeout and
no HTTP-level idempotency exists** — the only request ceiling is the 60 s socket
timeout set at `app-bootstrap.ts:126`.

**4. `GrowthBookService` is built on every boot and nothing asks it anything.**
`growthbook.module.ts` is `@Global`, provides and exports the service, and
`app.module.ts:196` imports it. But
`grep -rn "GrowthBookService" apps/server/src` returns hits **only** in
`growthbook.service.ts`, `growthbook.service.spec.ts` and `growthbook.module.ts`.
There is not one `isEnabled(...)` or `getValue(...)` call site in the server. It
escapes `unreachable-provider.spec.ts` because that gate skips any class matching
`OnModuleInit`, and this one has one. The docstring's promise ("as each new
plugin integration phase lands each new one ships behind a flag here") is not
kept anywhere.

**5. Sentry receives nothing.** `sentry.module.ts` calls `Sentry.init` with
`integrations: []`, which in Sentry v8+ **replaces** the default integration set
— including the global uncaught-exception/unhandled-rejection handlers and the
HTTP instrumentation. `SentryModule.forRoot()` from `@sentry/nestjs` is not in
`app.module.ts`'s imports and `SentryGlobalFilter` is not registered as an
`APP_FILTER`. `GlobalHttpExceptionFilter` is `@Catch()` (catch-everything) and
only logs. And `grep -rn "captureException" apps/server/src` returns **zero**
hits. So the module initialises a client, scrubs headers in a `beforeSend` that
will never fire, and reports nothing. The DSN being unset in most environments
has been hiding this.

**6. `CircuitBreaker` has zero importers.**
`apps/server/src/core/utils/circuit-breaker.ts:25` exports a complete
CLOSED/OPEN/HALF_OPEN implementation with a usage example in its docstring
(`new CircuitBreaker('openai', …)`). Nothing imports the file. Two feature
services grew their own inline versions instead:
`modules/ai/model-gateway.service.ts:566` (`interface CircuitBreakerState`) and
`modules/business-events/resilient-emitter.service.ts:7`
(`interface CircuitBreakerConfig`).

**7. The object-storage ACL layer cannot succeed.**
`objectAcl.ts:12` declares `export enum ObjectAccessGroupType {}` — an **empty**
enum — and `createObjectAccessGroup` (`objectAcl.ts:54`) has only a `default:`
branch that throws `Unknown access group type`. Therefore any policy with a
non-empty `aclRules` makes `canAccessObject` throw at `objectAcl.ts:118`. It does
not matter yet, because `ObjectStorageService.canAccessObjectEntity`
(`objectStorage.ts:435`) and `trySetObjectEntityAclPolicy` (`objectStorage.ts:422`)
have **no callers outside the module** — the four consumers of
`core/object-storage` use only `getObjectEntityUploadURL`,
`normalizeObjectEntityPath`, `uploadBuffer`, `getReadSignedUrl` and
`getObjectEntityBuffer`. Uploaded objects are governed by bucket policy alone.

**8. `connector-sync-modes.ts` is documentation with no runtime reader.** Its
only importer is `connector-sync-modes.spec.ts`. `getSyncModes()` is called
nowhere; `REGISTERED_CONNECTOR_TYPES` is a hand-maintained parallel list to
`ConnectorInitializerService`'s 22 injections, checked only by that spec.

**9. `'shopify'` is a `ConnectorType` with no connector.**
`connector.interface.ts:24` includes it in the union, `CONNECTOR_SYNC_MODES` has
no entry for it (the object is written `as Record<ConnectorType, …>`, so `tsc`
does not complain), and `ConnectorInitializerService` never registers one.
`modules/shopify` writes `ConnectorStatus` rows with
`connectorType: 'shopify'` at `shopify.controller.ts:32` and
`shopify.service.ts:88`. Both sweeps then silently skip them:
`connector-health-monitor.service.ts:170` (`if (!this.registry.get(type)) return false;`)
and `connector-sync-scheduler.service.ts:105` (`if (!this.registry.get(type)) continue;`).
A Shopify connection therefore never gets a health check and never gets a
nightly sync, and nothing logs that.

**10. Two emits with no listeners.** `connector-registry.service.ts:187` emits
`connector.tested` and `:260` emits `connector.smoke_tested`. Neither name
appears in any `@OnEvent` anywhere in `apps/server/src`, and neither is in
`KeyFlowEventMap`. (This is the mirror of the dead-listener class the
`event-wiring` gate covers; that gate only checks listeners, so a dead emit is
invisible to it.)

**11. Ten listeners still have no emitter.** Re-running
`analyseEventWiring()` from `apps/server/scripts/event-wiring.ts` on 2026-08-23:
`live: 146, dead: 10, unverified: 2, dynamic: 9, unresolvedListeners: 0`. Dead:
`booking.deleted`, `key.alert`, `key.approval.requested`,
`key.approval.resolved`, `key.health.update`, `key.insight.generated`,
`key.reasoning.chunk`, `key.stats.requested`, `key.suggestion`,
`storefront.order_created`.

**12. `test-meta.ts` is a scratch file in the source tree.**
`apps/server/src/test-meta.ts` has zero importers, is not matched by any vitest
config (it is not `*.spec.ts`), and `console.log`s `design:paramtypes` for two
throwaway classes. It compiles into `dist/` on every build.

**13. Dead exports in `tenant-context.ts`.** `getCurrentUserId` and
`getTenantContext` (`tenant-context.ts:10,26`) have no callers;
only `getCurrentBusinessId` (handed to `packages/db` in `main.ts:67`) and
`runWithTenant` (used by `tenant.interceptor.ts:23`) are live.

### Where the tenant boundary leaks

- **Anything not on an HTTP request is unscoped.** `TenantInterceptor` is an
  `APP_INTERCEPTOR`, and Nest interceptors only run for controller-routed
  requests. The two `setInterval` sweeps in this slice
  (`connector-health-monitor`, `connector-sync-scheduler`), every `@Cron` in the
  27 across the server, BullMQ workers, WebSocket gateways, provider webhooks and
  `/trpc` all run with `activeBusinessId() === undefined`, so all 15 intercepted
  operations pass through untouched. Several of those sweeps iterate every tenant
  deliberately; explicit `where: { businessId }` is their only control.
- **`create` with a nested relation is not scoped.** `withBusinessId` in
  `packages/db/src/client.ts` returns `data` untouched when it contains a
  `business` key, because a nested `connect` and a scalar `businessId` are
  mutually exclusive in Prisma. Three call sites use the relation form.
- **`createManyAndReturn` is not hooked at all.**
- **Body-supplied tenant.** Both `TenantInterceptor` and `BusinessGuard` resolve
  `params ‖ body ‖ query`, so on a route that has no `:businessId` path param a
  client-supplied body value sets the ALS scope. Scoping is restrictive rather
  than expansive, so this narrows rather than widens reads — but see
  [tenant-body-override.spec.ts](apps/server/src/core/auth/tenant-body-override.spec.ts)
  for the write-side version of the same precedence, where `{ businessId,
  ...body }` let the body win over the guard-validated path param at 25 sites.
- **`ContactExternalMapping`**, owned by this slice, is one of the 45
  tenant-bearing models the extension does not scope.

### Order-of-registration mismatch in `app-bootstrap.ts`

The public-widget CORS middleware at `app-bootstrap.ts:101-121` carries the
comment *"This middleware runs before the global CORS"*. It does not — it is
registered **after** `app.enableCors()` at line 64. For simple requests this is
harmless (it overwrites the header afterwards). For **preflights it is dead
code**: `cors@2.8.6`'s middleware ends an `OPTIONS` request itself
(`node_modules/.pnpm/cors@2.8.6/.../lib/index.js:163-178`, `preflightContinue`
defaults to false), and `applyHeaders` skips a header whose value is `false`
(line 152). So in production a third-party origin preflighting
`/site/storefront/public`, `/bookings/public`, `/payments/create-checkout`,
`/webhooks` or `/widgets` receives a 204 with **no**
`Access-Control-Allow-Origin`, and the embedded widget's request is blocked by
the browser before the permissive middleware ever runs. In development the CORS
origin callback returns `true` for everything, which hides it.

### Confirmed-live things worth stating

- All three `APP_INTERCEPTOR`s (`LoggingInterceptor`, `BusinessEventInterceptor`,
  `TenantInterceptor`) and both middlewares (`CorrelationIdMiddleware`,
  `AuthMiddleware`) are registered in `app.module.ts:271-286`.
- `GlobalHttpExceptionFilter` and the `ValidationPipe` are applied globally in
  `configureNestApp` (`app-bootstrap.ts:26-33`).
- Guards not listed in `AuthModule`'s providers (`AdminGuard`, `GenomeGateGuard`,
  `HoneypotGuard`, `RateLimitGuard`, `PublicRateLimitGuard`) still resolve:
  `Reflector` is a core provider and `REDIS_CLIENT` comes from the `@Global`
  `RedisModule`, which is reachable because `admin-auth`, `ai`, `key-cortex` and
  `temporal-flow` import it. `GenomeGateGuard` needs `BlueprintService`, and all
  five controllers that attach it live in modules that import `BlueprintModule`
  (`blueprint`, `business-genesis:24`, `business-genome:14`).
- Every connector route the web calls exists: `apps/web/src/app/app/key-connect/**`
  calls `/connectors/businesses/:businessId/{dashboard,credentials,webhook-info,test,reconnect,disconnect}/…`,
  which match `@Controller('connectors')` exactly. There is **no** `setGlobalPrefix`
  anywhere in `apps/server`, so controller prefixes are the full path.

## Tests

26 spec files sit in this slice (`apps/server/src`, outside `modules/`), plus
several `apps/server/test/*` files that exercise it. Most are **gates on
architecture**, not unit tests — they read source and assert a ledger only
shrinks.

| Spec | Asserts |
|---|---|
| [public-surface.spec.ts](apps/server/src/core/auth/public-surface.spec.ts) | The full set of handlers reachable without `AuthGuard` is enumerated in `ACKNOWLEDGED_PUBLIC` and may only shrink. Pins two parser canaries (key-cortex = 0 open of 72; phone-voice = exactly 1 of 2) *before* trusting the count. Re-run 2026-08-23: 2,177 handlers, 227 open, 54 controllers. |
| [tenant-model-list.spec.ts](apps/server/src/core/prisma/tenant-model-list.spec.ts) | Every name in `BUSINESS_ID_MODELS` is a real model with a `businessId String` column; every new tenant-bearing model is either scoped, in `ACKNOWLEDGED_UNSCOPED`, or in `NEVER_SCOPE`; the two ledgers are disjoint and name no ghosts. |
| [unreachable-provider.spec.ts](apps/server/src/core/config/unreachable-provider.spec.ts) | No `@Injectable` is constructed every boot and reachable by none of injection / framework decorator / `@UseGuards`-style attachment. Ledger: `ChaserService`, `KeyCortexSagaExecutorService`, `KeyAuditorService`, `KeyPlannerService`, `KnowledgeIngestionService`, `SlackService`, `RequestTimeoutInterceptor`, `IdempotencyInterceptor`. Pins `AuthGuard`/`BusinessGuard`/`PlanLimitGuard` as not-dead to catch parser regressions. |
| [event-wiring.spec.ts](apps/server/src/core/event-bus/event-wiring.spec.ts) | No new `@OnEvent` without an emitter; every `@OnEvent` resolves to a readable event name; the known-dead list may only shrink; the analyser still resolves wrapper/template emit shapes (`invoice.sent`, `content_request.submitted`, `purchaseOrder.received`). |
| [gate-vacuity.spec.ts](apps/server/src/core/config/gate-vacuity.spec.ts) | Any spec that builds a list from source and asserts it empty must also assert its input was non-empty. Opt out with `@vacuity-ok`. |
| [tenant-body-override.spec.ts](apps/server/src/core/auth/tenant-body-override.spec.ts) | No `{ businessId, ...body }` spread — tenant-authoritative values go after the spread. |
| [rate-limit.guard.spec.ts](apps/server/src/core/guards/rate-limit.guard.spec.ts) | The guard reads the pipeline error slot and fails closed with 503 rather than silently treating an unavailable count as zero. |
| [redis-degrades.spec.ts](apps/server/src/core/redis/redis-degrades.spec.ts) | `enableOfflineQueue: false` stays set, so commands reject instead of never settling when Redis is down. |
| [token-crypto.spec.ts](apps/server/src/core/crypto/token-crypto.spec.ts) | Round-trip, idempotent re-encryption, legacy plaintext passthrough, tamper detection. |
| [redaction.spec.ts](apps/server/src/core/security/redaction.spec.ts) · [timing-safe-equal.spec.ts](apps/server/src/core/security/timing-safe-equal.spec.ts) | Deep/nested redaction by key pattern; length-mismatch returns false without throwing. |
| [auth.middleware.spec.ts](apps/server/src/core/auth/auth.middleware.spec.ts) | The three local-user states: absent row attaches as `USER` (so signup→bootstrap works), deleted/banned rejects, revocation marker rejects even with no row. |
| [admin-token.util.spec.ts](apps/server/src/core/auth/admin-token.util.spec.ts) | HMAC verify, `type: 'admin'`, millisecond `exp`, `jti` and per-user revocation. |
| [genome-gate.guard.spec.ts](apps/server/src/core/auth/genome-gate.guard.spec.ts) | Allow/deny on the Three-Pillar Minimum, the `missingPillars` payload, `business_id` param fallback. |
| [connector-health-monitor.service.spec.ts](apps/server/src/core/connectors/connector-health-monitor.service.spec.ts) · [connector-sync-scheduler.service.spec.ts](apps/server/src/core/connectors/connector-sync-scheduler.service.spec.ts) | Status flips, 24 h renotify window, per-connector failure isolation, `unsupported` counted as skipped. |
| [connector-sync-not-implemented.spec.ts](apps/server/src/core/connectors/connector-sync-not-implemented.spec.ts) · [connector-sync-modes.spec.ts](apps/server/src/core/connectors/connector-sync-modes.spec.ts) | Every connector whose `sync()` makes no provider call returns `PULL_SYNC_NOT_IMPLEMENTED` rather than `success: true`; the mode table covers every registered type. |
| [trpc.module.spec.ts](apps/server/src/trpc.module.spec.ts) | Every tRPC procedure taking a `businessId` checks entitlement — so that fixing the mount path later is safe. |
| [schema-migration-coverage.spec.ts](apps/server/src/schema-migration-coverage.spec.ts) | Every model in `schema.prisma` is created by some migration, and migrations apply cleanly in lexicographic order from empty. |
| [cast-call-integrity.spec.ts](apps/server/src/core/config/cast-call-integrity.spec.ts) | `(x as any).method()` names a method that exists. |
| [test-config-coverage.spec.ts](apps/server/src/core/config/test-config-coverage.spec.ts) · [test-coverage-gating.spec.ts](apps/server/src/core/config/test-coverage-gating.spec.ts) · [fixture-cleanup-integrity.spec.ts](apps/server/src/core/config/fixture-cleanup-integrity.spec.ts) | Every test file is claimed by at least one vitest config; the named configs cover the default one; fixtures clean up after themselves. |
| [env.guard.spec.ts](apps/server/src/core/config/env.guard.spec.ts) | `assertNoDevAuthBypass` throws on `'true'`/`'1'` and not otherwise. |
| [growthbook.service.spec.ts](apps/server/src/core/growthbook/growthbook.service.spec.ts) | Dark-by-default fallbacks and per-business bucketing — the only exercise this service gets anywhere. |
| `test/app-module-boots.integration.test.ts` | The **built** server actually reaches "listening" in a child process — the only check that `AppModule`'s 122 modules compose. |
| `test/tenant-scope-extension.integration.test.ts` | The extension against a real Postgres: injected `where`, the `__skipTenantIsolation` escape hatch, and Prisma's silent-null behaviour for an extra scalar in a `WhereUniqueInput`. |
| `test/business.guard.test.ts` | `BusinessGuard` allow/deny against a mocked Prisma. |
| `test/commonjs-compat.test.ts` | Every dependency the server imports can be `require()`d under CommonJS + Node <20.19. |
| `test/connector-credentials-attack.integration.test.ts`, `connector-routes-attack.integration.test.ts`, `form-webhook-tenancy-attack.integration.test.ts`, `webhook-ingress-secret-redaction.integration.test.ts`, `business-token-disclosure.integration.test.ts`, `token-encryption-coverage.integration.test.ts`, `tenant-membership-boundary.integration.test.ts` | Real-DB attacks on this slice's boundaries: cross-tenant credential reads, connector route tenancy, form-webhook signature bypass, secret leakage into `WebhookDeliveryLog`, `Business` token columns crossing the API boundary. |

**What has no test at all in this slice:** `app-bootstrap.ts` (the entire
middleware stack — CORS, helmet, rate limit, trust proxy, the public-prefix
override), `main.ts`'s boot ordering, `http-exception.filter.ts`,
`logging.interceptor.ts`, `correlation-id.middleware.ts`,
`team-audit.interceptor.ts`, `honeypot.guard.ts`, `public-rate-limit.guard.ts`
(despite `rate-limit.guard.ts` having a dedicated spec for the exact defect
`public-rate-limit.guard.ts` still contains), `module-scope.guard.ts`,
`admin.guard.ts`, `optional-auth.guard.ts`, `seed.service.ts`,
`object-storage/*` (including the ACL layer), `circuit-breaker.ts`,
`sanitize.ts`, `visitor-cookie.ts`, `sanitize-business.ts`, `runtime-urls.ts`,
`entity-resolution.service.ts`, `google-suite.service.ts`,
`connector-credentials.service.ts` (unit level — only the real-DB attack test
touches it), and `app.controller.ts`.

## Open questions

1. **Is `GET /healthz/events` meant to be public and rate-limited?** It is
   excluded from neither `AuthMiddleware` (`app.module.ts:284` excludes only
   `'healthz'` and `'readyz'`, not `'healthz/events'`) nor the
   `express-rate-limit` skip (`app-bootstrap.ts:93` compares `req.path` for
   exact equality). It has no guard, so it is public but counted against the
   200/min ceiling. Deliberate or an oversight?
2. **Was `integrations: []` in `sentry.module.ts` intended to disable everything,
   or was it copied as a "no extra integrations" idiom?** The answer decides
   whether the fix is `SentryModule.forRoot()` + `SentryGlobalFilter`, or
   deleting the module.
3. **Is `GrowthBookService` a landing pad for work not yet done, or abandoned?**
   Nothing in the repo indicates which flags were meant to exist.
4. **Why does `packages/db/src/middleware/token-encryption.ts` omit
   `DRIVE_TOKEN_ENCRYPTION_SECRET` from its precedence chain while
   `core/crypto/token-crypto.ts` includes it?** If any deployment sets only that
   variable, tokens written through Prisma and tokens written through
   `token-crypto` use different keys under an identical `enc:v1:` prefix, and
   neither can tell which produced a given ciphertext.
5. **Should the public-widget CORS middleware move above `enableCors()`?** That
   would fix preflights for embedded widgets, but it also means those five
   prefixes stop honouring the allow-list entirely. I could not find a test or a
   deployed widget to confirm which behaviour is wanted.
6. **`'shopify'` in `ConnectorType`:** is `modules/shopify` intended to grow an
   `IConnector`, or should its `ConnectorStatus` rows be excluded from the
   registry-driven sweeps explicitly rather than by accident?
7. **`connector-sync-modes.ts` and `REGISTERED_CONNECTOR_TYPES`** duplicate
   `ConnectorInitializerService`'s registration list by hand. Should the
   initializer read from it (making the table load-bearing) or should the table
   be derived from the registry at runtime?
8. **The 42 remaining `ACKNOWLEDGED_UNSCOPED` models** — is there an owner and a
   sequence for retiring them, or is the ledger now steady-state?
