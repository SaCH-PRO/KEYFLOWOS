# Verified state — 2026-08-11

Every number here was re-derived from the tree on this date, and every row
carries the command that produced it. Nothing is copied from another document.

**Why this file exists.** Numbers in this repository drift faster than the prose
around them, and the drift is not harmless: `architecture-risks.md` rates
"tenant isolation covers ~23% of business-scoped tables" as **Critical** and
advises backfilling `Payment` and `MarketplaceOrder` — a recommendation that
would today cause an outage, against a figure that is now 87%. A stale number in
a risk register is worse than no number, because it is acted on.

**Re-derive rather than quote.** If you are about to cite a figure from here in
a plan, run its command first. Four separate documents in this repo were found
wrong on their headline numbers this week, and in three cases the *first*
re-measurement was wrong too — see "How to measure this codebase" at the bottom,
which is the part most likely to save you time.

---

## Shape

| Measure | Value | Command |
|---|---:|---|
| Prisma models | **440** | `grep -c '^model ' packages/db/prisma/schema.prisma` |
| Server modules | **110** | `ls apps/server/src/modules \| wc -l` |
| `@Injectable` services | **722** | `grep -rl '@Injectable()' apps/server/src --include=*.ts \| grep -v spec \| wc -l` |
| KEY tools | **286** | parse `name:` out of `flow-tool-registry.ts` (do **not** grep-count) |
| Web pages | **251** | `find apps/web/src/app -name page.tsx \| wc -l` |
| Migrations | **19** | `find packages/db/prisma/migrations -name migration.sql \| wc -l` |
| Spec/test files | **400** | `find apps/server/{src,test} -name '*.spec.ts' -o -name '*.test.ts'` |
| Server tests | **3,652**, 0 skipped | `cd apps/server && npx vitest run` |
| Web tests | **180** in 17 files | `cd apps/web && npx vitest run` |
| Tests in `packages/*` | **0** | none of the four packages has a test script |
| Routes mapped at boot | **2,179** | `docker logs keyflowos-api-1 \| grep -c 'Mapped {'` |
| `@Cron` jobs | **27** | `grep -r '@Cron(' apps/server/src` |
| `setInterval` schedulers | **52** | `grep -r 'setInterval(' apps/server/src` |

`CAPABILITY_MAP_2026-08-09.md` says 245 tools and 439 models. Both have moved.

## Tenant isolation — the number most often quoted wrong

| | Value |
|---|---:|
| Models carrying `businessId` | **348** |
| Scoped by the extension | **303 (87%)** |
| Acknowledged unscoped (debt, shrink-only) | **42** |
| Never to be scoped (deliberate) | **3** |

303 + 42 + 3 = 348 exactly, and `tenant-model-list.spec.ts` fails the build if
that stops being a partition. It also fails when a new `businessId` model
appears in neither ledger, which is the case nothing caught before.

**`Payment`, `MarketplaceOrder` and `WebhookEvent` must never be scoped.** Each
is resolved by a global provider key in a webhook with no tenant context, and
Prisma 6.19 accepts an extra scalar in a `WhereUniqueInput` rather than
rejecting it — so scoping them returns `null` silently: no error, no log, no
provider retry. A taken payment, unrecorded.

## The tRPC surface is mounted but unreachable

`packages/api` is 2,154 lines and 82 procedures, wired into `AppModule` as
`TrpcModule`. None of it can be called. The middleware is mounted with
`.forRoutes({ path: '/trpc', method: RequestMethod.ALL })`, which matches that
path exactly and nothing beneath it. Measured against production:

| Request | Response |
|---|---|
| `GET /trpc` | tRPC's own `No "query"-procedure on path "trpc"` |
| `GET /trpc/social.listConnections` | Nest 404 — never reaches tRPC |

The first proves the handler is installed; the second proves no procedure is
addressable. `packages/*` has **no test script at all**, so nothing said so.

**This mattered.** `social.listConnections` took a client-supplied `businessId`
and ran `findMany` on it with no access check — and none of the usual protection
applies on this path: the tenant AsyncLocalStorage is filled by an
`APP_INTERCEPTOR`, which needs a controller, and `/trpc` is middleware;
`SocialConnection` is not in `BUSINESS_ID_MODELS`; and `token-encryption.ts`
*decrypts* on `findMany`. Any authenticated user naming any business would have
received its live Facebook, Instagram, LinkedIn and Twitter tokens. The only
thing preventing it was the broken mount — so a routing fix, by someone with no
reason to think they were touching security, would have shipped it.

Fixed, and `trpc.module.spec.ts` now fails if any procedure takes a `businessId`
without `assertBusinessAccess`. Mounting the router is still a product decision;
the gate is what makes it a safe one.

Ten more procedures (all of `key-connector.ts`) call `assertBusinessRole`, which
reads `ctx.business` — populated from `req.business`, which nothing in
`apps/server` assigns. They fail closed for every caller.

## The web client calls API paths that do not exist

Nothing checks that the paths in `apps/web/src/lib` match the server's routes.
They are strings on both sides, so a renamed resource or a dropped controller
prefix compiles, ships, and 404s.

Confirmed against production by probing unauthenticated — **401 means the route
exists and wants a token, 404 means there is no such route**. Controls behaved
correctly (`/webhooks/health` → 200, `/definitely/not/a/route` → 404):

| Client called | Result | Server actually serves |
|---|:--:|---|
| `/businesses/:id/call-tasks` | 404 | `/businesses/:id/calls` |
| `/businesses/:id/webhooks` | 404 | `/webhooks/businesses/:id/webhooks` |
| `/ai/businesses/:id/agent-config` | 404 | `/ai/businesses/:id/ai/agent-config` |

Those three clusters — 16 client calls, the whole webhook settings UI, the KEY
agent config screen and every call-task action — are fixed. Each corrected path
was re-probed and now returns 401.

A second pass resolved seven more the same way — every one turned out to be a
controller prefix the client had never carried, not a missing feature:

| Client called | Server serves |
|---|---|
| `/businesses/:id/team` | `/identity/businesses/:id/team` |
| `/flow/businesses/:id/{cockpit,activity,search,cross-module-workflows}` | `/api/flows/businesses/:id/…` |
| `/flow/businesses/:id/flow/execute-plan/:planId` | `/ai/businesses/:id/flow/…` |
| `/device/businesses/:id/voice-{sessions,preferences}` | `/api/device/businesses/:id/…` |

There are **two** flow controllers — `modules/flow` at `api/flows` and
`modules/ai/flow.controller.ts` at `ai` — so a single find-and-replace over
`/flow/businesses/` would have sent the chat family to the wrong one. The `team`
call was wrong in exactly one file; every other call site already had the prefix.

22 client calls fixed across both passes; the unmatched set went 41 → 19.

**The remaining 19 were classified individually.** Eleven are artefacts of the
comparison, not defects: a client path with a literal where the server has a
parameter (`/businesses/me/providers`, `/businesses/system/templates`), or a
variable provider segment (`/connect/businesses/:id/${apiPrefix}/status`, where
`apiPrefix` is `contacts` or `outlook-contacts` — both confirmed 401). Two are
POST/PATCH-only and cannot be settled by probe.

**Six are real, and they are missing features rather than wrong paths.** The
WhatsApp manage drawer
(`app/app/key-connect/components/whatsapp/whatsapp-manage-drawer.tsx`) calls
`/status`, `/conversations`, `/conversations/:id`, `/templates` and `/messages`.
The server's WhatsApp controller has only `config`, `send`, `test` and webhooks
— so the entire drawer is inert. `/messages` is not `/send` under another name:
the client posts `{to, body, scheduledAt}` and `/send` takes `{to, message}`
with no scheduling. Also missing:
`/commerce/businesses/:id/recurring-invoices/:id/history`.

Building those endpoints is a product decision, so nothing here was changed for
them.

One caveat on method: probing only proves GET routes. A POST-only route answers
404 to a GET whether or not it exists, so `execute-plan` was resolved from source
and confirmed through a GET sibling under the same controller.

**No gate ships for this.** The static comparison reached 27 remaining
candidates, and probing showed 5 of 18 were false alarms — a client path with a
literal in a dynamic position (`/businesses/me/providers`,
`/businesses/system/templates`) does not match the server's `:businessId`. A
28% false-positive rate would get the gate disabled inside a week, and a
disabled gate is worse than none. The measurement lives in the session
scratchpad; making it trustworthy means resolving literal-vs-parameter segments,
not lowering the bar.

## How the server is entered

| Entry point | Count | Tenant context? |
|---|---:|---|
| `@Controller` classes | 170 | — |
| HTTP route handlers | 2,177 | yes, via `TenantInterceptor` |
| `@OnEvent` listeners | 352 | **no** |
| `setInterval` timers | 52 | **no** |
| `@Cron` jobs | 27 | **no** |
| tRPC procedures | 82 | **no** — and unreachable, see above |
| BullMQ `@Processor` | 0 | queues are used, but not via that decorator |

431 of those entry points are off the HTTP path, where `activeBusinessId()` is
undefined and the Prisma extension is inert. Every one of them must pass an
explicit `where: { businessId }`.

**There is no `APP_GUARD`.** `grep APP_GUARD apps/server/src` returns nothing:
authentication is opted into per controller or per handler, 1,025 times. The
default for a new route is public, and forgetting the decorator produces a
working endpoint and no warning. 227 of 2,177 handlers (10.4%) across 54
controllers have no `AuthGuard`; each is deliberate and leans on something else
— a webhook signature, a one-time execution token, an opaque share token, an
inline super-admin assertion. `public-surface.spec.ts` holds that set so the
228th arrives as a failing test.

That is the shape the one real vulnerability took:
`POST /api/v1/cortex/phone/inbound` was live and unauthenticated because its
controller guarded one of its two handlers and the other trusted a Twilio
signature check that returned `true` when no signing key was configured — which
was the case in production.

**Count handlers, not files.** "Does this controller mention AuthGuard" reports
phone-voice as guarded, and would have missed that. Getting this number right
took four attempts — 87, 298, 1,153, 227 — and each intermediate answer looked
plausible. The 1,153 came from a regex that had picked up a literal backspace
character during an edit, so it matched nothing and every controller read as
unguarded. The spec now pins key-cortex at 0 and phone-voice at 1 before
trusting its own output.

## One `enc:v1:` marker, four key schedules

| Implementation | Salt | Refuses to run in prod without a key |
|---|---|:--:|
| `core/crypto/token-crypto.ts` | `keyflow-token-salt-v1` | yes |
| `packages/db/.../token-encryption.ts` | `keyflow-token-salt-v1` | **no** |
| `core/connectors/connector-credentials.service.ts` | `connector-credentials-salt` | yes |
| `modules/supplier/credentials.util.ts` | `supplier-credentials-salt` | yes |
| `packages/api/src/lib/credentials.ts` | `supplier-credentials-salt` | yes |

Separate salts for separate data is fine. Separate salts behind **one** version
marker is not: a stored value starting `enc:v1:` cannot be attributed to the key
that produced it, and the only reason the scheme works is that each
implementation happens to own storage no other one touches. Nothing asserted
that, and it had already been broken once —
`modules/google-drive/token-crypto.util.ts` encrypted `Business.driveAccessToken`
under a *fifth* salt while `packages/db` encrypted the same column under its own.
Verified by running the compiled modules against each other: the reader throws
`Unsupported state or unable to authenticate data`, which names neither the salt
nor the file. It was dead code — its last importer went in `736bafdf` — so it was
deleted. `token-crypto.spec.ts` now fails if a new implementation appears or a
salt moves.

Two things are recorded rather than changed, both needing a decision:

- **`packages/db` has no production guard.** With none of
  `CONNECTOR_CREDENTIALS_KEY` / `CREDENTIALS_ENCRYPTION_KEY` / `JWT_SECRET` set,
  it encrypts under a key derived from a string in this repository. The other
  four refuse to start. Adding the throw turns a silent weakness into a failed
  boot, so it needs a deploy that sets the key first.
- **`core/crypto` reads `DRIVE_TOKEN_ENCRYPTION_SECRET`; `packages/db` does
  not**, though they share a salt and are meant to agree. Set that variable
  alone and they derive different keys — confirmed by execution. They do not
  collide today because `core/crypto`'s only caller (whatsapp) encrypts fields
  inside a JSON blob while the extension handles scalar columns.

## Money and cost

| | Value |
|---|---:|
| Plan limits declared | **25** |
| Plan limits actually enforced | **6** |
| AI credits recorded (production, all time) | 503 |
| AI spend (production, all time) | $0.4889 |
| Share of cost from `flow_chat_stream` | **73%** (4% of credits) |
| Share of credits from `semantic_embedding` | **74%** (0% of cost) |
| Tool schemas per turn, unfiltered | ~32,000 tokens |
| Tool schemas after crew filter + 128 cap | ~14,000 tokens |

Enforcement happens **three** ways — a direct plan read, a `checkLimit` call,
and the `@RequirePlanLimit` decorator — and any count is wrong until all three
are found. See `plan-limit-enforcement.spec.ts`.

## Known-dead, and deliberately so

| Thing | Count | Gate |
|---|---:|---|
| Dead event listeners | 10 | `event-wiring.spec.ts` |
| Unreachable `@Injectable` providers | 8 | `unreachable-provider.spec.ts` |
| Unpriced AI features | 43 | `ai-credit-billing.integration.test.ts` |
| Unenforced plan limits | 19 | `plan-limit-enforcement.spec.ts` |

Each has a shrink-only ledger. None of these lists says the items are
acceptable; they say a **new** one cannot be added silently.

Two of the eight unreachable providers are safety middleware that never runs:
`RequestTimeoutInterceptor` (no request timeout is enforced anywhere) and
`IdempotencyInterceptor` (no HTTP-level replay protection). Wiring either
changes live behaviour and is a product decision.

## Build and test

| | Before | After |
|---|---:|---:|
| Unit suite wall time | 232s | **41s** |
| `collect` (aggregate) | 1,134s | 149s |

`pool: 'threads'` was measured at **452s — twice as slow** as the baseline on 8
cores and Windows. It is the first optimisation everyone tries; do not retry it
without measuring.

CI runs `vitest run` against the default config, so the speedup is local only
until the pipeline splits `test:unit` from `test:integration`.

**Two spec files depend on execution order** and pass only because the default
file order suits them: `calendar.controller.spec.ts` and
`storefront-intelligence.service.spec.ts`. They fail under `sequence.shuffle`
with isolation on or off, and pass alone.

---

## How to measure this codebase

The part worth reading. Eight measurements were wrong on the first attempt this
week, in both directions, and every one looked plausible.

1. **Parse, do not grep-count.** `grep -c` over identifiers matched every
   variable named `contacts` and reported 13 of 25 plan limits enforced; the
   real figure was 6. A pattern for `/call_|voice|phone|dial/` returned
   `commerce_create_invoice`, because "in**voice**" contains "voice". Anchor the
   pattern (`/^call_/`) and parse structure where you can.

   This file shipped with the same bug in its own migration count. `ls
   migrations | grep -c '^2'` returned 18, because it filtered on the timestamp
   prefix and `0_baseline` does not have one. Prisma said 19. Count the thing
   that defines the item — `migration.sql` — not the names that usually look
   right.

2. **Find every mechanism before counting.** Plan limits are enforced three
   ways; provider reachability has four (injection, framework decorators,
   `@UseGuards` attachment, global `APP_INTERCEPTOR`). A count is wrong until
   all are known, and there is no signal telling you that you are done. A
   reachability check missing the third reported `AuthGuard` — 1,026 decorator
   uses — as dead.

3. **A green gate may be measuring nothing.** Five gates here were passing while
   blind: the honesty sweep could not see a braceless handler, the tenant gate
   could not see an unscoped model, the event-wiring gate could not see
   `@OnEvent(CONSTANT)`, the cost meter reported $0 for 80% of calls, and
   `check-tool-routes` proved parity with the wrong evidence.
   `gate-vacuity.spec.ts` now fails any tree-walking gate that asserts "no
   findings" without asserting its input was non-empty.

4. **Run the negative control.** Not "does the test pass" but "does it fail on
   the defect it names, and on nothing else". Four controls this week fired on
   the wrong assertion or did not fire at all, including one where the edit
   silently failed to apply because the file uses CRLF.

5. **Separate your variables.** Two spec files appeared to prove `isolate:false`
   unsafe; running the same shuffle *with* isolation showed the order-dependence
   was already there. One more variable and a correct fix would have been
   discarded.

6. **`dist` can hang rather than fail.** A stale build was silently 18 files
   behind and the server hung before Nest printed anything — indistinguishable
   from a dependency-injection failure. Rebuild before trusting the boot gate.
