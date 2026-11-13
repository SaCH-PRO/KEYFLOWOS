# v1 journey gate harness (GATE-HARNESS)

The v1 journeys A to L (the product audit's `core_journeys_v1`, each with its
definition of done) run here as Playwright specs, in a real browser, against a
real API, Postgres and Redis. Nothing is mocked. This folder holds the
harness; the journey specs themselves come from GATE-JOURNEYS-A-F and
GATE-JOURNEYS-G-L, and the gate run that expects them green is
GATE-JOURNEY-RUN.

| File | What it is |
|---|---|
| `harness-settings.ts` | The rules, with no Playwright runtime: variants, projects, leg tags, the production-build check, the 3G profile and budget, the KEY UI markers, the fixture prefix. Pinned by `src/__tests__/journey-harness.test.ts`. |
| `journey-helpers.ts` | The `test` journeys import (fixtures: a fresh tenant per test, signed in; the stack preflight; the off-host and 5xx watch) and the shared helpers. |
| `smoke.spec.ts` | The harness end to end: Today for a fresh owner, no KEY UI under KEY_DISABLED, nothing covering a primary button, Today's 3G load timing. |
| `../release0-live.spec.ts` | The Release 0 live journey (closedBy evidence). It runs in the journey projects unedited and must pass in every variant. |

## Two projects

`playwright.config.ts` runs every spec in this folder, and
`e2e/release0-live.spec.ts`, in two Chromium projects:

| Project | Viewport | Device |
|---|---|---|
| `phone` | 375 x 812 | touch, mobile viewport (`isMobile`), device scale 2, an Android Chrome user agent |
| `desktop` | 1440 x 900 | desktop Chrome |

The mocked `chromium` project (ci-cd.yml's e2e-mocked job) leaves this folder
alone.

## Production build only

The journeys run against `next build` output, served by the standalone server
(`E2E_WEB_COMMAND=standalone`, or an external server with `E2E_NO_SERVER=1`
and `E2E_BASE_URL`), so the dormant-feature flags take their production values
(`src/lib/feature-flags.ts`: every dormant module off when `NODE_ENV` is
production). The preflight reads the build id a page names and refuses
`next dev` (build id `development`, or a hot-reload client on the page). No
`NEXT_PUBLIC_FF_*` override may be set for the build; e2e-live.yml checks.

## Three variants (`E2E_VARIANT`)

| Variant | API | Where |
|---|---|---|
| `ai-disabled` (default) | `AI_DISABLED=1`, no AI provider key: every AI call answers the R0-07 503 `provider_not_configured`. | CI (e2e-live.yml) and locally |
| `key-disabled` | The same plus `KEY_DISABLED=1`. No KEY UI may render: no KEY bubble, no button or link naming KEY, no KEY drawer opening by itself, and Ctrl+J / Cmd+J open nothing. | CI and locally |
| `ai-on` | AI on with a capped test key. Legs tagged `@ai-on` run only here. | Staging authority only: e2e-live.yml runs it only when dispatched with `ai_on`, in the `e2e-ai-on` environment (required reviewers; the capped key as its secret `E2E_AI_ON_OPENAI_API_KEY`), under the operator's recorded authority for provider traffic. Never on a developer machine. |

Before the first journey of each worker the preflight checks that the API runs
the variant named: for `ai-disabled` no provider is configured
(`GET /ai/businesses/:id/ai/provider-health`) and an AI call is refused without
reason `key_disabled`; for `key-disabled` it is refused with reason
`key_disabled` (before anything is read or called); for `ai-on` a provider is
configured, and the preflight makes no AI call, so it spends nothing on the
capped key. An unknown `E2E_VARIANT` stops the run when the config loads.

`release0-live.spec.ts` runs unedited in every variant and must pass.

## Legs that need more than this harness

A journey leg that needs something the CI stack does not have is its own test,
tagged, and runs only where its stack does:

| Tag | Needs | Runs when |
|---|---|---|
| `@staging` | A provider sandbox on the staging stack: Supabase sign-up, email verification and password reset (journey A), WiPay (E), Gmail, web push (F, G). | `E2E_STAGING=1` (GATE-STAGING-RUN) |
| `@scheduler` | The schedulers and a controlled server clock: overdue (E), booking reminders (F), recurring invoice and expense (E, H). | `E2E_SCHEDULERS=1` (GATE-SCHEDULER-RUN) |
| `@ai-on` | AI on with a capped key (journey K, KEY-on). | `E2E_VARIANT=ai-on` |

```ts
test("the customer pays on /pay/link with WiPay", { tag: "@staging" }, async ({ page, owner }) => { ... });
```

## Limits (what this harness cannot reach)

- **No Supabase.** The API verifies the journeys' HS256 tokens locally (under
  `NODE_ENV=test`, with `SUPABASE_JWT_SECRET` = `E2E_JWT_SECRET`); nothing
  calls a Supabase project. Journey A's sign-up, email verification and
  password reset are `@staging` legs (owner ruling D-02, option C).
- **`DISABLE_SCHEDULERS=1`.** No scheduler runs; legs that need one are
  `@scheduler` legs and run in GATE-SCHEDULER-RUN. `controlledClock()` pins the
  browser's clock only; the server's clock belongs to that run.
- **No provider traffic.** Outside the `ai-on` job the API gets no provider key
  of any kind (an `env -i` allow-list), and every journey fails on a browser
  request that leaves localhost and on any 5xx (the R0-07 503
  `provider_not_configured` of an optional service is recorded, not a
  failure).
- **No production, no staging data.** The API and web must be local (the
  preflight refuses anything else).

## Helpers (`journey-helpers.ts`)

- `test`: fixtures `owner` (a fresh onboarded tenant per test; `page` starts
  signed in to it), `tenantOptions` (set per file with `test.use`), `stack`
  (the per-worker preflight) and an automatic watch that fails the test on an
  off-host request or a 5xx. Without `E2E_LIVE=1` every journey is skipped
  with that reason.
- `freshTenant(request, label, { onboard, currency, sells, timezone, businessName })`:
  a new user and business through `POST /identity/bootstrap`, then, with
  `onboard` (default), the two routes the manual onboarding form uses. Journey A
  passes `onboard: false` and drives onboarding in the browser.
- `seedBusinessType(request, tenant, "services" | "products" | "both")`: the
  onboarding answer, stored where BIZ-SETTINGS-SERVER keeps it
  (`Business.metaData.sells`) and read back.
- Currency: `currency: "TTD" | "USD"` on the tenant (TTD by default).
- `signedInContext(browser, tenant, baseURL)`: a second person (a member, a
  second tenant) in their own context.
- `controlledClock(page, at)`: pins the browser clock before the page loads.
- `recordLoadTiming(page, testInfo, label, url, ready)`: loads `url` on Chrome's
  3G preset with the cache off and records the time until `ready` holds against
  the 3 s budget (journey I). A tracked figure, never pass/fail: it goes into the
  test's annotations and an attached `journey-timing-<label>.json`, which
  GATE-JOURNEY-RUN copies into BUILD-MAP-001.md.
- `keyUiFindings(page)`, `coveredButtonFindings([...])`: what KEY UI renders,
  and what covers a primary button (elementFromPoint at its centre and 20% in
  from each side, scrolled as far into view as the page allows).

## Fixtures

Every user id, email and business name embeds `v62j_` (GATE-HARNESS, step 2 of
the v1 plan) and a per-worker stamp. As with `release0-live.spec.ts`'s
`k25a_`, the prefix is not registered in
`apps/server/test/helpers/fixture-prefixes.json`: that registry covers
`apps/server/test` suites, and its gate requires each owner to be a file there.
No server suite's cleanup pattern reaches `v62j_`. Rows are left behind on
purpose: a cleanup that runs after a failure destroys the evidence. Run against
a database made for the run (CI's service container; locally, a database of
its own).

## Running it

CI: `.github/workflows/e2e-live.yml` (manual dispatch). Each variant job
builds the server and the web, boots the API with that variant's environment,
then runs `release0-live.spec.ts` and this folder on both projects, and uploads
the traces, the timings and the API log.

Locally, with the API started as e2e-live.yml starts it (the database of its
own, `NODE_ENV=test`, `AI_DISABLED=1`, `DISABLE_SCHEDULERS=1`,
`HIBP_DISABLED=true`, `SUPABASE_JWT_SECRET=<s>`, plus `KEY_DISABLED=1` for
key-disabled) and the web built with `NEXT_PUBLIC_API_BASE_URL=<api>` and empty
Supabase and site URLs:

```sh
E2E_LIVE=1 E2E_VARIANT=key-disabled E2E_API_URL=http://localhost:<api port> E2E_JWT_SECRET=<s> \
  E2E_WEB_COMMAND=standalone \
  npx playwright test e2e/release0-live.spec.ts e2e/journeys/ --project=phone --project=desktop
```

(or `E2E_NO_SERVER=1 E2E_BASE_URL=http://127.0.0.1:<port>` for a standalone
server already running; `PW_CHROMIUM_EXECUTABLE` for a Chromium the local
Playwright did not download).

## Expected RED

`smoke.spec.ts` is red until SWP-LAYERS (the KEY bubble and the Genome banner
unmounted, one z-index layer contract) and SWP-KEY-SHELL-SMOKE (no KEY UI under
KEY_DISABLED; the drawer never opens by itself) land. The journey specs are red
until the packets that fix their steps land. A red journey is the gate's
report, not a reason to skip it.
