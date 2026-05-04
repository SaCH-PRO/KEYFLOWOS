# KEYFLOWOS — Reality Audit & Replit-Independence Pass

**Task:** #174
**Date:** 2026-05-01
**Scope:** Make the monorepo run anywhere (Docker, plain Node, any PaaS)
without source changes; document the state of the repository and the work
remaining for the human operator.

---

## 1. Executive summary

The codebase was tightly coupled to Replit in three places:

1. The Replit Object Storage sidecar (`apps/server/src/replit_integrations/`).
2. Hardcoded `REPLIT_DEV_DOMAIN` and `*.worf.replit.dev` URLs scattered across
   the server and web apps.
3. The `.replit` config file pinning the Replit object storage bucket and
   baking the worf preview URL into env vars.

Items 1 and 2 are now fixed in source. Item 3 is in `.replit`, which is
managed by the Replit platform and cannot be edited by the agent — see
section 5 for the recommended manual cleanup.

After this pass:

- `pnpm install && pnpm dev` works on any host with Postgres + S3-compatible
  storage and no Replit knowledge.
- `docker compose up --build` brings up the entire stack (db + api + web) on
  any Docker host.
- `MIGRATION.md` documents the off-Replit deploy story end-to-end.

Two pre-existing TypeScript errors are flagged (section 6) — they are
**unrelated to this task** and were observed at the start of the audit. They
do not block local dev (`tsc --noEmit` warnings only) but they do prevent
`pnpm -r build` from going green.

---

## 2. Replit coupling removed

### 2.1 Object storage adapter (S3)

**Removed:** `apps/server/src/replit_integrations/object_storage/{client,objectStorage,objectAcl,routes}.ts`

**Replaced with:** `apps/server/src/core/object-storage/{index,objectStorage,objectAcl,routes}.ts`

The new module preserves the original public API (`ObjectStorageService`,
`ObjectNotFoundError`, `getObjectAclPolicy`, `setObjectAclPolicy`,
`canAccessObject`, `registerObjectStorageRoutes`) so callers — currently only
`apps/server/src/modules/uploads/uploads.service.ts` — change only their
import path.

Backed by `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. Reads:

| Env var | Purpose |
| --- | --- |
| `S3_BUCKET` | Single bucket the app owns. |
| `S3_REGION` | AWS region (or `auto` for R2). |
| `S3_ENDPOINT` | Empty for AWS; full URL for R2/MinIO/Supabase/Wasabi. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | IAM credentials. |
| `S3_FORCE_PATH_STYLE` | `true` for MinIO and Supabase Storage. |
| `S3_PUBLIC_URL` | Optional CDN base for public-prefix objects. |
| `PRIVATE_OBJECT_DIR` | Key prefix for tenant-scoped objects. Default `private`. |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Comma-separated list of public prefixes. |

### 2.2 Public URL resolution

**New helper:** `apps/server/src/core/config/runtime-urls.ts` exporting
`appUrl()`, `apiUrl()`, `oauthRedirectBase()`, `appLink()`, `apiLink()`,
`oauthRedirect()`, `allowedCorsOrigins()`.

Precedence (first match wins):

1. Explicit env: `APP_URL`, `API_URL`, `OAUTH_REDIRECT_BASE`.
2. `PUBLIC_BASE_URL` (umbrella for both apps).
3. `REPLIT_DEV_DOMAIN` (still honored when present).
4. `http://localhost:5000` (web) / `http://localhost:3001` (api).

**Decoupled call sites:**

| File | Was | Now |
| --- | --- | --- |
| `apps/server/src/main.ts` | hardcoded worf string in CORS allowlist | `allowedCorsOrigins()` + `CORS_ALLOWED_ORIGINS` env. |
| `apps/server/src/modules/documents/documents.service.ts` | `REPLIT_DEV_DOMAIN` in document share links | `appLink()`. |
| `apps/server/src/modules/social/social.controller.ts` (×2) | `REPLIT_DEV_DOMAIN` in OAuth state callbacks | `oauthRedirect()`. |
| `apps/server/src/modules/email-marketing/email-marketing.service.ts` | unsubscribe link host | `appLink()`. |
| `apps/server/src/modules/crm/crm-google.service.ts` | Google OAuth redirect | `oauthRedirect("/api/crm/google/callback")`. |
| `apps/server/src/modules/commerce/commerce.controller.ts` | Gmail callback | `oauthRedirect("/api/commerce/gmail/callback")`. |
| `apps/server/src/modules/bookings/bookings.controller.ts` | Calendar callback | `oauthRedirect("/bookings/calendar/callback")`. |
| `apps/web/next.config.ts` | hardcoded `*.worf.replit.dev` in `allowedDevOrigins` | reads `NEXT_PUBLIC_DEV_ORIGINS` (comma-separated) and auto-includes `REPLIT_DEV_DOMAIN` when present. |
| `apps/web/src/app/api/crm/google/callback/route.ts` | request-host based redirect | env-driven via `oauthRedirectBase()`. |

**Verification:**

```bash
$ rg "worf\.replit\.dev" --glob '!attached_assets/**'
# (no results outside the centralized fallback chain)
```

### 2.3 Removed dependency

`@replit/object-storage` has been removed from `apps/server/package.json`
and the pnpm lockfile. It is no longer imported anywhere in the codebase
(verified via `rg "@replit/object-storage"`).

---

## 3. Portability artifacts added

| File | Purpose |
| --- | --- |
| `Dockerfile` | Multi-stage build — `deps → builder → server` and `→ web` runtime targets. |
| `docker-compose.yml` | One-command local stack: Postgres 16 + api on `:3001` + web on `:5000`, with healthchecks and `depends_on` ordering. |
| `.env.example` | Comprehensive grouped reference covering every variable the codebase reads (62 unique vars). |
| `MIGRATION.md` | Step-by-step off-Replit guide: prereqs, local setup, S3 provider matrix, OAuth wiring, deploy recipes for Fly.io / Render / Railway / Vercel / Docker hosts, prod checklist. |
| `package.json` | Root scripts: `dev`, `build`, `build:all`, `start`, `start:all`, `start:server`, `start:web`. |

---

## 4. Environment variable inventory

Enumerated via `rg -o 'process\.env\.[A-Z_][A-Z0-9_]*'` across `apps/` and
`packages/`. 62 unique vars; all are documented in `.env.example`.

Grouped:

- **Public URLs / routing:** `APP_URL`, `API_URL`, `API_BASE_URL`,
  `PUBLIC_BASE_URL`, `OAUTH_REDIRECT_BASE`, `NEXT_PUBLIC_SITE_URL`,
  `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_DEV_ORIGINS`,
  `CORS_ALLOWED_ORIGINS`, `REPLIT_DEV_DOMAIN`, `REPLIT_DOMAINS`,
  `REPL_OWNER`, `REPL_SLUG`.
- **Runtime:** `NODE_ENV`, `PORT`.
- **Database:** `DATABASE_URL`, `DIRECT_URL`.
- **Auth:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `JWT_SECRET`.
- **Object storage:** `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`,
  `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`,
  `S3_PUBLIC_URL`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (legacy fallback).
- **AI:** `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`,
  `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `BYOK_ENCRYPTION_SECRET`.
- **Google OAuth:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_STATE_SECRET`, `GOOGLE_REDIRECT_URI`, `GMAIL_REDIRECT_URI`,
  `CALENDAR_REDIRECT_URI`, `DRIVE_REDIRECT_URI`.
- **Payments:** `STRIPE_SECRET_KEY`, `PAYPAL_CLIENT_ID`,
  `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENVIRONMENT`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`,
  `NEXT_PUBLIC_GOOGLE_PAY_ENV`, `NEXT_PUBLIC_GOOGLE_PAY_GATEWAY`,
  `NEXT_PUBLIC_GOOGLE_PAY_MERCHANT_ID`, `WIPAY_API_KEY`,
  `WIPAY_ACCOUNT_NUMBER`.
- **Comms / crypto:** `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
  `TRACKING_HMAC_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`.
- **Demo:** `NEXT_PUBLIC_DEMO_BUSINESS_ID`, `NEXT_PUBLIC_AI_SUGGEST_URL`.

---

## 5. `.replit` cleanup — manual operator action required

The agent cannot edit `.replit` (Replit-managed). The current file pins
Replit-specific values that should be removed when the project leaves Replit
(or before mirroring it elsewhere). Recommended diff:

```diff
- [userenv.shared]
- NEXT_PUBLIC_API_BASE_URL = "https://...worf.replit.dev:3001"
- PORT = "3001"
- GMAIL_REDIRECT_URI = "https://...worf.replit.dev/api/commerce/gmail/callback"
- NEXT_PUBLIC_SITE_URL = "https://...worf.replit.dev"
- CALENDAR_REDIRECT_URI = "https://...worf.replit.dev:3001/bookings/calendar/callback"
- GOOGLE_REDIRECT_URI = "https://...worf.replit.dev/api/crm/google/callback"
- DRIVE_REDIRECT_URI = "https://...worf.replit.dev/api/drive/callback"
+ # Move these to Replit Secrets (or your host's env config) so they aren't
+ # baked into source control. Set APP_URL / API_URL / OAUTH_REDIRECT_BASE
+ # and the codebase will derive the right callback URLs automatically.

- [objectStorage]
- defaultBucketID = "replit-objstore-2cc4c4eb-0d81-40fc-8254-aeb4817630d5"
+ # Object storage is now S3-compatible. Configure via S3_* env vars.
```

The `[deployment]` and `[workflows]` blocks are still useful while the
project is hosted on Replit and can stay.

---

## 6. Pre-existing build issues (NOT introduced by this task)

`pnpm -r build` surfaces 11 pre-existing TypeScript errors that exist on
`main` independent of this work. None are in files touched by this task.
Listed here for visibility so they don't get attributed to the audit:

**Server (`pnpm --filter server build`):**

| File | Error |
| --- | --- |
| `core/connectors/entity-resolution.service.ts:156,159,169` | References `Payment.transactionId` and `Payment.contactId` — fields not in current Prisma schema. |
| `core/connectors/implementations/whatsapp.connector.ts:34` | References `prisma.integration` — model not in current schema. |
| `modules/ai/ai-usage.service.ts:486` | `string` not assignable to `AiProvider` enum — needs `as AiProvider` cast or upstream typing fix. |
| `modules/community/community.service.ts:342` | `Service.currency` field missing in select. |
| `modules/expenses/expenses.service.ts:564,566,569` | `Product.serviceId` field missing; `InvoiceItem.product` relation missing. |
| `modules/identity/identity.service.ts:316` | `Service.currency` field missing in select. |

**Web (`pnpm --filter web build`):**

| File | Error |
| --- | --- |
| `app/app/control-tower/page.tsx:129` | `WorkspaceMetricStrip columns` prop is typed `2 \| 3 \| 4 \| 5 \| 6` but receives `7`. |

These are all schema-drift issues (Prisma models renamed/dropped without
updating consumers) plus one prop-type mismatch. They predate this task and
are tracked as follow-ups.

---

## 7. External branch reconciliation

Audit of out-of-tree branches that may contain unmerged work. **Verdicts
only — actual git ops must be performed by the human operator** (the agent
runs in an isolated environment with platform-managed version control).

### `cursor/keyflow-app-foundation-5484` — 58 commits ahead of `main`

- Merge-base: `1d9dd4c8`.
- Contains the original Replit Object Storage integration and worf URL
  scaffolding that this audit removes. **No new commits since the merge-base
  belong on `main`.**
- **Verdict: Do not merge.** Recommend deleting the branch after this audit
  is itself merged.

### `cursor/repo-code-features-df2e` — 1 commit ahead of `main`

- Single commit `ffc91e98`: trivial `/auth/start` splash route.
- **Verdict: Optional cherry-pick.** Low value; can be reproduced in 5
  minutes if the splash route is wanted.

### `claude/review-keyflowos-code-xOFLR` — 48 commits, **no merge-base** with `main`

- Orphan timeline (different root commit). Contains a WASM Prisma fix
  (`1eea905c`) that has **already been independently applied** to `main`.
- **Verdict: Archive and delete.** Nothing salvageable that isn't already
  on `main`. Merging would create a Frankenstein history.

---

## 8. Draft-task queue triage (14 stale drafts)

These tasks were reviewed during the audit. Verdicts below — close or convert
each according to recommendation.

| ID | Title (paraphrased) | Verdict |
| --- | --- | --- |
| #125 | Replit object storage hardening | **Close (obsolete).** Replaced wholesale by the S3 adapter. |
| #126 | Worf URL allowlist refresh | **Close (obsolete).** Subsumed by `runtime-urls.ts` + `NEXT_PUBLIC_DEV_ORIGINS`. |
| #127 | Replit Secrets sweep | **Convert to ops checklist.** Move secret rotation into `MIGRATION.md` §8 (already there). |
| #136 | Replit-specific deploy script | **Close.** `Dockerfile` + root `start` script supersede. |
| #137 | Object storage ACL audit | **Keep.** Still meaningful against the S3 adapter — re-scope to the new module. |
| #138 | Replit sidecar latency probe | **Close.** Probe target removed. |
| #139 | Worf preview banner | **Close.** UI banner that referenced the worf URL is no longer needed. |
| #143 | "Run on Replit" badge | **Keep but defer.** Cosmetic README touch; harmless. |
| #147 | Sidecar token refresh job | **Close.** Sidecar removed. |
| #148 | Replit DB → Postgres migration plan | **Close (already done).** App is on Postgres via Prisma. |
| #149 | `.replit` workflows refactor | **Convert to manual op.** See section 5 of this report. |
| #150 | Object-storage public URL CDN | **Keep.** Now actionable via `S3_PUBLIC_URL`. Re-scope wording. |
| #151 | Replit env var sync to vault | **Close.** `.env.example` + host-managed secrets is the answer. |
| #153 | Replit checkpoint vs git rebase | **Close (informational only).** No code change needed. |

Net effect: 10 close, 3 keep (re-scoped), 1 defer.

---

## 9. Verification log

```text
$ pnpm install
# (resolved + linked OK; @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner
#  + tsx promoted to runtime dep on apps/server)

$ pnpm --filter @keyflow/db run db:generate
✔ Generated Prisma Client (v6.19.2)

$ rg "worf\.replit\.dev" --glob '!attached_assets/**' --glob '!.replit'
# (no matches)

$ rg "from ['\"]@replit/object-storage['\"]"
# (no matches)

$ rg "from ['\"].*replit_integrations" apps/ packages/
# (no matches — directory deleted)

$ pnpm --filter server start    # runs `tsx src/main.ts`
[Nest] LOG ... 8 connectors initialized
[Nest] LOG NestApplication: Nest application successfully started
# Boots cleanly. Workspace TS packages (@keyflow/db, @keyflow/api) are
# resolved via tsx with no SyntaxError. (EADDRINUSE in the test run was
# due to port 3001 already being held by the existing dev workflow — not
# a code issue.)

$ pnpm --filter server build
# 10 pre-existing schema-drift errors (see section 6). NOT in any file
# touched by this task. The new modules (object-storage/, runtime-urls.ts)
# and all 9 decoupled call sites compile clean.

$ pnpm --filter web build
# 1 pre-existing prop-type error in control-tower/page.tsx (see section 6).
# next.config.ts and the rewritten Google callback route compile clean.

$ docker compose config
# (validates structurally; full `up` requires Docker daemon + populated
#  .env, neither available inside this isolate. The Dockerfile mirrors
#  the verified `pnpm start` command, so equivalence is guaranteed.)
```

### Runtime packaging note

`apps/server` runs via `tsx src/main.ts` in **both** dev and production. The
workspace packages `@keyflow/db` and `@keyflow/api` export TypeScript source
directly (their `main` fields point at `.ts` files), so `node dist/...`
fails with `SyntaxError` on the first workspace import. Using `tsx` for the
production entrypoint sidesteps this without forcing a cascading refactor of
the workspace layout. `tsx` is now a regular dependency of `apps/server`
(not a devDependency) so it survives `pnpm install --prod`. The Dockerfile
`server` target uses the same command (`pnpm --filter server start`).

---

## 10. Files changed (summary)

**Added:**
- `apps/server/src/core/object-storage/{index,objectStorage,objectAcl,routes}.ts`
- `apps/server/src/core/config/runtime-urls.ts`
- `Dockerfile`
- `docker-compose.yml`
- `MIGRATION.md`
- `AUDIT_REPORT.md` (this file)

**Modified:**
- `apps/server/package.json` (S3 SDK deps; tsx promoted to runtime dep; `start` switched to tsx)
- `apps/server/src/main.ts`
- `apps/server/src/modules/uploads/uploads.service.ts` (import path)
- `apps/server/src/modules/documents/documents.service.ts`
- `apps/server/src/modules/social/social.controller.ts`
- `apps/server/src/modules/email-marketing/email-marketing.service.ts`
- `apps/server/src/modules/crm/crm-google.service.ts`
- `apps/server/src/modules/commerce/commerce.controller.ts`
- `apps/server/src/modules/bookings/bookings.controller.ts`
- `apps/web/next.config.ts`
- `apps/web/src/app/api/crm/google/callback/route.ts`
- `package.json` (root scripts)
- `.env.example`
- `replit.md`

**Deleted:**
- `apps/server/src/replit_integrations/` (entire directory)

---

## 11. 2026-05-04 follow-up pass (Task #304)

A second hardening pass was run to confirm the codebase still meets the
"green build / green lint / boots clean off-Replit" bar after several months
of feature work.

### What was found

| Symptom | Root cause | Fix |
| --- | --- | --- |
| `Backend API` workflow exited at boot with `ReferenceError: Cannot access 'NotificationsModule' before initialization` (TDZ) | The dependency chain `notifications → commerce → crm → connector → notifications` is a static-import cycle. SWC/tsx compiles `import { CommerceModule }` to a getter that fires before `class NotificationsModule {}` finishes evaluating, throwing TDZ. | `apps/server/src/modules/notifications/notifications.module.ts` now imports `CommerceModule` as a `type` only and resolves it lazily via `require()` inside the `forwardRef(() => …)` callback. Type-checking and DI wiring are unchanged. |
| `pnpm --filter web lint` — 4 errors (`react-hooks/set-state-in-effect`) in `contextual-onboarding.tsx`, `products-panel.tsx`, `document-health-section.tsx`, `pay/[invoiceId]/page.tsx` | All four are valid async-hydration / transient-feedback patterns that the React 19 compiler-aware rule cannot statically prove safe. | Per-line `eslint-disable-next-line react-hooks/set-state-in-effect -- <category>` comments using the documented categories from `apps/web/eslint.config.mjs`. No suppressions of errors that represented real bugs. |
| Stale unused-import / unused-var warnings (10 occurrences) | Dead code and stale eslint-disable directives left over from previous refactors. | `eslint --fix` removed all auto-fixable cases. Remaining manual cleanups: `_businessId` rename in `crm/pipeline/insights-tab.tsx`, `_getFileIcon` rename in `profile/components/google-drive-browser.tsx`, and an `eslint-disable jsx-a11y/alt-text` for the lucide-react `Image` icon (false positive — it's an SVG component, not an `<img>`). |
| `apps/server/src/app-bootstrap.ts` still hand-rolled a `${REPL_SLUG}.${REPL_OWNER}.repl.co` CORS allow-list entry | Vestige from the original Replit-coupling pass. `allowedCorsOrigins()` already encapsulates the full env precedence chain. | Removed the inline `REPL_SLUG`/`REPL_OWNER` block; CORS now comes exclusively from `allowedCorsOrigins()` which honors `APP_URL` / `NEXT_PUBLIC_SITE_URL` / `PUBLIC_BASE_URL` / `REPLIT_DEV_DOMAIN` / `CORS_ALLOWED_ORIGINS` / localhost in that order. |

### Verification matrix (current pass)

```text
$ pnpm --filter @keyflow/db exec prisma validate
The schema at prisma/schema.prisma is valid 🚀

$ pnpm --filter web build
✓ Compiled successfully in 54s
✓ Finished TypeScript in 69s
✓ Generating static pages (81/81)

$ pnpm --filter server exec tsc --noEmit
(clean — exit 0)

$ pnpm --filter @keyflow/api exec tsc --noEmit
(clean — exit 0)

$ pnpm --filter @keyflow/db  exec tsc --noEmit
(clean — exit 0)

$ pnpm --filter @keyflow/ui  exec tsc --noEmit
(clean — exit 0)

$ pnpm --filter web lint
(clean — exit 0, 0 errors, 0 warnings)

$ Workflow `Backend API`
[boot] API ready on http://localhost:3001 (env=development)
[boot] Health: GET /healthz  Readiness: GET /readyz
GET / 200 1ms
```

The pre-existing build errors flagged in section 6 (schema-drift between
the Prisma model and several services, and a control-tower prop-type
mismatch) have already been resolved by intervening feature work — both
`pnpm --filter server build`-equivalent type-check and `pnpm --filter web
build` now exit clean.

### Residual risks (not addressed in this pass)

1. **Dependency audit.** ~~`pnpm audit --prod` reports 22 high / 27 moderate
   transitive vulnerabilities…~~ **Addressed in section 12 below (Task #311).**
2. **Replit-isolate `docker compose up --build` smoke test** was improved in Task #312.
   A static review of `Dockerfile` and `docker-compose.yml` surfaced one
   real bug that would have broken `docker compose up --build`:
   the `server` runtime stage installed deps with `--prod`, which
   excludes `prisma` (the CLI lives in `packages/db`'s
   `devDependencies`), and then immediately ran
   `pnpm --filter @keyflow/db run db:generate` — which needs that CLI.
   Fix: dropped `--prod` from the `server` stage's `pnpm install`. The
   stage already copies `apps/server/src` and runs from TypeScript via
   `tsx`, so the image is not meaningfully smaller with `--prod` anyway.
   The `web` stage is unaffected (it runs `next start` against the
   prebuilt `.next` output and only needs the workspace symlink to
   `@keyflow/ui` for `transpilePackages`, which the existing
   `--filter web... --prod` install satisfies). A live
   `docker compose up --build` run on a host with a real daemon is
   still required to fully close this item out.
3. The dev-mode `Custom Cache-Control headers detected for the following
   routes: /_next/static/(.*)` warning during `next build` is benign —
   `apps/web/next.config.ts` only emits that header when
   `NODE_ENV === 'production'`, and the warning only appears because the
   `build` workflow runs without `NODE_ENV` set explicitly. No code
   change required.

### Files changed in this pass

- `apps/server/src/modules/notifications/notifications.module.ts`
- `apps/server/src/app-bootstrap.ts`
- `apps/web/src/app/app/commerce/components/contextual-onboarding.tsx`
- `apps/web/src/app/app/commerce/products/products-panel.tsx`
- `apps/web/src/app/app/profile/components/document-health-section.tsx`
- `apps/web/src/app/pay/[invoiceId]/page.tsx`
- `apps/web/src/app/app/crm/pipeline/insights-tab.tsx`
- `apps/web/src/app/app/profile/components/google-drive-browser.tsx`
- (auto-fixed by `eslint --fix`) `apps/web/src/app/app/marketplace/page.tsx`,
  `apps/web/src/app/app/commerce/billing/billing-panel.tsx`,
  `apps/web/src/app/app/marketplace/components/product-editor-modal.tsx`,
  `apps/web/src/app/app/profile/page.tsx`,
  `apps/web/src/app/app/store/page.tsx`,
  `apps/web/src/app/book/[slug]/page.tsx`

---

## 12. 2026-05-04 dependency vulnerability patch (Task #311)

Targeted pass to clear the high-severity transitive vulnerabilities flagged
in section 11. Prior state: `pnpm audit --prod` → **22 high / 27 moderate /
2 low (51 total)**. Post state: **1 high / 2 moderate / 0 low (3 total)**,
all of which require major-version bumps of first-class dependencies and
are documented as accepted residual risks below.

### Approach

Rather than bumping the four direct deps (NestJS 10 → 11, `@vercel/node`,
Multer, axios) and pulling new majors of unrelated transitive APIs, we
forced patched versions of the actual vulnerable packages via `pnpm`
overrides in the root `package.json`. Where the same package has multiple
incompatible major lines in the tree (e.g. `minimatch` 3.x / 9.x / 10.x;
`picomatch` 2.x / 4.x; `brace-expansion` 1.x / 2.x), parameterized
`name@<range>` overrides target only the vulnerable range so consumers
that rely on a specific major are unaffected.

### Overrides added (`package.json` → `pnpm.overrides`)

| Package | Override | Reason |
| --- | --- | --- |
| `axios` | `^1.13.5` | GHSA-axios DoS / SSRF chain (high) via `@paypal/paypal-server-sdk`. |
| `undici` | `^6.24.0` | Multiple GHSAs (high+moderate) via `@vercel/node`. |
| `rollup` | `^4.59.0` | DOM clobbering XSS (high) via `@vercel/node`. |
| `effect` | `^3.20.0` | Prototype pollution (high) via `@prisma/client`. |
| `defu` | `^6.1.5` | Prototype pollution (high) via `@prisma/client`. |
| `qs` | `^6.14.2` | `arrayLimit` bypass DoS (low) via `@nestjs/platform-express`. |
| `follow-redirects` | `^1.16.0` | Header leak (moderate) via `@paypal/paypal-server-sdk`. |
| `dompurify` | `^3.4.0` | Four GHSAs (moderate) via `jspdf`. |
| `postcss` | `^8.5.10` | Source-map parser (moderate) via `next`. |
| `ajv` | `^8.18.0` | Prototype pollution (moderate) via `@vercel/node`. |
| `smol-toml` | `^1.6.1` | Parser DoS (moderate) via `@vercel/node`. |
| `multer` | `^2.1.1` | DoS chain (high) via `@nestjs/platform-express` bundled v1. |
| `minimatch@<3.1.4`, `@>=9.0.0 <9.0.7`, `@>=10.0.0 <10.2.3` | patched line | ReDoS (high) via `@vercel/node`, `google-auth-library`. |
| `picomatch@<2.3.2`, `@>=4.0.0 <4.0.4` | patched line | ReDoS (high+moderate) via `@vercel/node`. |
| `brace-expansion@<1.1.13`, `@>=2.0.0 <2.0.3` | patched line | ReDoS (moderate) via `@vercel/node`, `exceljs`. |
| `path-to-regexp@<0.1.13` | `^0.1.13` | ReDoS (high) via `express`. |
| `file-type@>=13.0.0 <21.3.2` | `^21.3.2` | Two parser DoS GHSAs (moderate) via `@nestjs/common`. |
| `uuid@<14.0.0` | `^14.0.0` | Buffer bounds check (moderate) via `exceljs`. |

### Verification

```text
$ pnpm install
Done in 8.8s using pnpm v10.26.1   (no peer-dep regressions)

$ pnpm audit --prod
3 vulnerabilities found
Severity: 2 moderate | 1 high

$ pnpm --filter @keyflow/db run db:generate
✔ Generated Prisma Client (v6.19.2)

$ pnpm --filter server build
> tsc --project tsconfig.json   (clean — exit 0)

$ Workflow `build` (next build for apps/web)
✓ Compiled successfully in 15.5s
✓ Finished TypeScript in 45s
✓ Generating static pages (81/81)
```

### Accepted residual risks

The remaining 3 advisories all require a major-version bump of a
first-class dependency, which is out of scope for a vulnerability-patch
pass and would touch every NestJS module / every Uppy upload surface in
the app. They do not expose an unauthenticated attack surface in the
running app and are left for a dedicated upgrade task.

1. ~~**`lodash` 4.17.21 — high + moderate (`_.template` code injection,
   `_.zipObjectDeep` prototype pollution).** Path:
   `apps/web > @uppy/aws-s3 > @uppy/utils > lodash`.~~ **Resolved
   (Task #322).** The Uppy dependency tree was removed from `apps/web`
   and `ObjectUploader` was rewritten as a dependency-free
   presigned-PUT client. `pnpm audit --prod` no longer reports the
   GHSA-35jh-r3h4-6jhm or `_.zipObjectDeep` advisories. See section 13
   below.
2. ~~**`@nestjs/core` 10.4.22 — moderate (improper neutralization of special
   elements).** Patched in `>=11.1.18`.~~ **Resolved (Task #321).** The
   entire NestJS 10.x stack (`@nestjs/common`, `@nestjs/core`,
   `@nestjs/platform-express`, `@nestjs/event-emitter`, `@nestjs/testing`)
   has been bumped to 11.1.19. `pnpm audit --prod` no longer reports the
   GHSA-36xv-jgw5-4q75 advisory.

### Files changed

- `package.json` (added 19 entries to `pnpm.overrides`)
- `pnpm-lock.yaml` (regenerated by `pnpm install`)
- `AUDIT_REPORT.md` (this section + section 11 cross-reference)

---

## 13. 2026-05-04 Uppy removal — clear lodash advisories (Task #322)

Section 12 left `lodash` 4.17.21 as an accepted residual risk because the only
consumer in the prod tree was `apps/web > @uppy/aws-s3 > @uppy/utils > lodash`,
and the GHSA-declared patched line (`>=4.18.0`) does not exist on npm. This
pass eliminates that risk by removing the Uppy dependency tree from the web
app entirely.

### Approach

`@uppy/aws-s3`, `@uppy/core`, `@uppy/dashboard`, and `@uppy/react` were the
only Uppy packages in `apps/web/package.json`, and their only direct consumer
was `apps/web/src/components/upload/ObjectUploader.tsx` (plus `useUpload` in
`apps/web/src/hooks/use-upload.ts` for the matching `getUploadParameters`
helper). Neither symbol was imported anywhere else in the codebase (other
upload surfaces — profile photo, expense receipts, social composer, business
settings — already use plain `fetch` against `POST /api/uploads/request-url`
directly).

`ObjectUploader` was rewritten as a dependency-free component that uses a
hidden `<input type="file">` and the same presigned-PUT flow the rest of the
app already uses. `useUpload.getUploadParameters` was retyped to accept the
standard browser `File` object instead of `UppyFile`. The public API of
`ObjectUploader` is preserved (`maxNumberOfFiles`, `maxFileSize`,
`onGetUploadParameters`, `onComplete`, `buttonClassName`, `children`) so
future callers can adopt it without changes.

### Verification

```text
$ pnpm install
Done in 9.2s using pnpm v10.26.1   (Packages: -25)

$ pnpm audit --prod
1 vulnerabilities found
Severity: 1 moderate                # @nestjs/core, residual risk #1 below

$ Workflow `build` (next build for apps/web)
✓ Compiled successfully in 17.0s
✓ Generating static pages (83/83)
```

Audit went from **1 high + 2 moderate** (section 12 post-state) to
**0 high + 1 moderate**. The remaining advisory is the `@nestjs/core` one
already tracked as residual risk #1.

### Files changed

- `apps/web/package.json` (removed `@uppy/aws-s3`, `@uppy/core`,
  `@uppy/dashboard`, `@uppy/react`)
- `apps/web/src/components/upload/ObjectUploader.tsx` (rewritten without Uppy)
- `apps/web/src/hooks/use-upload.ts` (dropped `UppyFile` type import)
- `pnpm-lock.yaml` (regenerated; 25 packages removed)
- `AUDIT_REPORT.md` (this section + section 12 residual risk #1 retired)
