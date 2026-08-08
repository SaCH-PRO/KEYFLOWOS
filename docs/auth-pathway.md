# Auth Pathway — KeyFlowOS

This is the end-to-end map of every sign-in / sign-up code path the
product currently supports. It exists so the next person on call (you,
probably) can navigate the auth surface in minutes instead of hours.

## High-level diagram

```
Browser (Next.js, apps/web)                NestJS API (apps/server)            Supabase
─────────────────────────────              ─────────────────────────           ────────
/auth/signup ── POST /identity/signup ──── IdentityController.signup ──────── auth.admin.createUser
                                            └─ AuthSecurityService.enforce  └─ generateLink (signup)
                                            └─ IdentitySignupService          + Resend.sendTransactional
                                                ├─ PasswordPolicy.validate
                                                └─ (auto-confirm OR send link)
/auth/login ── POST /identity/login ────── IdentityController.login ────────  auth.signInWithPassword
                                            └─ AuthSecurityService.enforce  (anon-key client)
                                            └─ signInWithPassword             returns session
/auth/login (Resend) ─ POST /identity/resend-verification ── magiclink ───── generateLink (magiclink)
/auth/callback (Google) ── direct PKCE → Supabase → returns to /auth/callback#access_token
/auth/reset-password ── PUT  $SUPABASE_URL/auth/v1/user (Bearer recovery token)
```

## Frontend pages

| Path | Purpose | Notable behaviour |
|------|---------|-------------------|
| `apps/web/src/app/auth/start/page.tsx` | Choice screen (sign in / sign up) | Pure links; no state. |
| `apps/web/src/app/auth/signup/page.tsx` | Email/password signup form | Posts to `/identity/signup`; on `verification_sent` shows "check your email" screen; on `authenticated` stores token + bootstraps workspace. |
| `apps/web/src/app/auth/login/page.tsx` | Email/password sign-in + forgot-password + Google OAuth | Posts to `/identity/login`. Surfaces banners for `?verified=1` (after email-confirm) and `?reset=1` (after password reset). Maps `email_not_confirmed` errors to a Resend affordance. Forgot-password uses Supabase `recover` directly (no rate-limit budget on the API). |
| `apps/web/src/app/auth/callback/page.tsx` | OAuth (Google) PKCE landing | Reads `#access_token` from the URL fragment, calls Supabase `/auth/v1/user` for profile, derives names via `deriveOAuthName()` (pure helper, unit-tested), then calls `/identity/bootstrap` and routes to `/app`. |
| `apps/web/src/app/auth/reset-password/page.tsx` | Set new password from reset email | Parses `#access_token` + `type=recovery` via `parseRecoveryHash()` (pure, tested). Submits PUT to Supabase user endpoint with the recovery bearer. On success, redirects to `/auth/login?reset=1`. |
| `apps/web/src/components/require-auth.tsx` | Client-side gate around `/app/*` | Requires a token; on 401 from API it `clearStoredBusinessId()` and routes to `/auth/login?from=…` (see `apps/web/src/lib/api.ts`). |
| `apps/web/src/app/app/layout.tsx` | Authenticated app shell | Sign-out is `handleLogout()` — clears workspace + token cookie via `clearStoredBusinessId()`, then routes to `/auth/login`. |

## Backend endpoints

All live in `apps/server/src/modules/identity/identity.controller.ts`.

| Method + path | Auth | Purpose | Stable error codes |
|---|---|---|---|
| `POST /identity/signup` | none | Create Supabase user; auto-confirm or send verification email | `weak_password`, `email_taken`, `email_send_failed`, `signup_unavailable`, `rate_limited` |
| `POST /identity/login` | none | Exchange email + password for an access/refresh token | `invalid_credentials`, `email_not_confirmed`, `signin_failed`, `signin_unavailable`, `rate_limited` |
| `POST /identity/resend-verification` | none | Re-send the verification email | (always 200; throttled at 60s/email + AuthSecurity rate rule) |
| `GET  /identity/me` | Bearer | Return the authenticated user | 401 when no/invalid token |
| `POST /identity/bootstrap` | Bearer | Idempotently create the user + default business | 401, 400 |
| `GET  /identity/admin/auth-audit` | Bearer + `SUPER_ADMIN` | Read the AuthAuditLog | 401 |

### Rate limiting

`AuthSecurityService` (`auth-security.service.ts`) enforces sliding-window
rules backed by Postgres (`auth_rate_limits` table). Both IP-scoped and
email-scoped buckets apply for every signup / login / resend call.
Defaults:

| Rule | Limit | Window |
|---|---|---|
| `LOGIN_IP`     | 10 | 15 min |
| `LOGIN_EMAIL`  |  8 | 15 min |
| `SIGNUP_IP`    |  5 | 60 min |
| `SIGNUP_EMAIL` |  3 | 60 min |
| `RESEND_IP`    | 10 | 60 min |
| `RESEND_EMAIL` |  5 | 60 min |

Over-limit responses are HTTP `429` with `{ code: "rate_limited" }`.

### Audit log

Every signup, login (success / failure), resend, and rate-limit decision
writes a row to `AuthAuditLog`. Surfaced to admins via the
`/identity/admin/auth-audit` endpoint and the Security Settings page.

## Required environment variables

The full set of env vars the auth pathway depends on (server-side
unless noted):

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) | Supabase project URL — used by both the admin client (signup/generateLink) and the anon client (signInWithPassword). |
| `SUPABASE_SERVICE_ROLE_KEY` | Required for admin actions: `auth.admin.createUser`, `generateLink`. Without it `/identity/signup` returns `signup_unavailable`. |
| `SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | Anon key used by the password sign-in client. Frontend reads `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the recovery PUT call too. |
| `SUPABASE_JWT_SECRET` | Optional; lets the auth middleware verify tokens locally instead of round-tripping `getUser()`. Recommended in production. |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | `"true"`/`"1"` to require verification, `"false"`/`"0"` to auto-confirm. Defaults to ON in production. |
| `RESEND_API_KEY` | Required when verification is on — sends the actual verification email via Resend. |
| `EMAIL_FROM_ADDRESS` | The `From` address on auth emails (e.g. `no-reply@keyflow.os`). |
| `EMAIL_FROM_NAME` | Display name on auth emails. Defaults to `Keyflow`. |
| `APP_URL` (or `NEXT_PUBLIC_SITE_URL`) | Used to build email-verify and password-reset callback URLs (`/auth/callback`, `/auth/reset-password`). |
| `NEXT_PUBLIC_API_BASE_URL` | Frontend → backend base path (`/__api` in dev). All `/identity/*` calls go through this. |
| `KEYFLOW_DEV_AUTH_BYPASS` | **Must be unset.** The legacy dev escape hatch was removed by Task #194; `main.ts` hard-fails at boot if this is set. Task #297 did not touch this path. |

## Auth middleware

`apps/server/src/core/auth/auth.middleware.ts` runs on every request:
extracts `Authorization: Bearer <token>`, verifies with Supabase, and
attaches `req.user = { id, email, role }` (role from our Prisma `User`
table — JWT role claims are intentionally ignored). On any failure the
header is dropped silently; downstream `AuthGuard` returns 401 to routes
that require auth.

The legacy `KEYFLOW_DEV_AUTH_BYPASS` escape hatch was removed in Tier 2
auth hardening; the boot path in `apps/server/src/main.ts` hard-fails if
the env var is still set so we can never silently re-enable it.

## Tests

Backend (`apps/server/pnpm test`):

- `test/identity-signup.service.test.ts` — full verification path, link
  generation, rollback on failure, resend cooldown, `resolveSiteUrl`
  origin trust.
- `test/identity-signup.e2e.test.ts` — controller wiring for
  `signup`, `resend-verification`, **and `login`** (success,
  `invalid_credentials`, `email_not_confirmed`, DTO validation).
- `test/identity.e2e.test.ts` — business CRUD endpoints under `RequireAuth`.

Frontend (`apps/web/e2e/auth-helpers.spec.ts` — Playwright runs the
pure helpers in node):

- `deriveOAuthName()` — Google IdP fields, full_name fallback, mononyms,
  missing metadata, whitespace trimming.
- `parseRecoveryHash()` — happy path, missing token, wrong `type`,
  `error_description` decoding, empty/null fragments.

## Operational checklist

1. `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL` must be set in
   every environment for the full flow.
2. `AUTH_REQUIRE_EMAIL_VERIFICATION=true` in prod (default; set to
   `false` only for local dev to skip the mail loop).
3. `KEYFLOW_DEV_AUTH_BYPASS` must NOT be set in prod — boot guard will
   refuse to start the server otherwise (intentional).
4. Trust-proxy is set in `app-bootstrap.ts` from `TRUST_PROXY` so
   `req.ip` is correct behind the load balancer; the rate limiter
   depends on this.

## Google OAuth (Supabase)

The Google sign-in button at `apps/web/src/app/auth/login/page.tsx`
redirects the browser to
`${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${NEXT_PUBLIC_SITE_URL}/auth/callback`.
Supabase performs the OAuth handshake with Google and bounces the
browser back to `<SITE_URL>/auth/callback#access_token=…`. The callback
page at `apps/web/src/app/auth/callback/page.tsx` reads the access
token from the URL fragment, calls Supabase `/auth/v1/user` to enrich
profile fields, then `POST`s `/identity/bootstrap` against our NestJS
API with `Authorization: Bearer <supabase token>`. `AuthMiddleware`
verifies the token via `SupabaseAuthService`, attaches `{ id, email,
role }` to the request, and `IdentityService.bootstrapUser` either
reuses the local `User` row, reconciles a row that already exists with
the same email under a different id (see task #308 —
`reconcileUserId`), or creates a fresh row, then ensures a default
`Business` + `Membership` exist.

### Required dashboard configuration

Both registrations must be in place or the handshake breaks before our
code ever runs. None of these are secrets, only URIs.

| Where | Setting | Value |
|-------|---------|-------|
| Google Cloud Console → OAuth 2.0 Client | Authorized redirect URI | `<SUPABASE_URL>/auth/v1/callback` |
| Supabase → Authentication → URL Configuration | Site URL | `<NEXT_PUBLIC_SITE_URL>` |
| Supabase → Authentication → URL Configuration | Additional redirect URLs | `<NEXT_PUBLIC_SITE_URL>/auth/callback` |
| Supabase → Authentication → Providers → Google | Enabled + client id/secret from Google Cloud | (managed in dashboard) |

### Required env var names (values live in Replit Secrets)

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `NEXT_PUBLIC_SITE_URL` — used by the browser for the redirect and
  the Supabase user-info call.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — used server-side by
  `SupabaseAuthService` to verify tokens.

### Failure modes worth knowing

- `400 redirect_uri_mismatch` from Google ⇒ the Cloud Console redirect
  URI does not exactly match `<SUPABASE_URL>/auth/v1/callback`.
- Callback page renders "Internal Server Error" after "Signing you
  in…" ⇒ historically this was the email-collision 500 fixed in task
  #308 (`bootstrapUser` now reconciles by email before creating).
- `AuthMiddleware` log `Token provided but Supabase verification
  failed` ⇒ the access token is expired or signed by a different
  Supabase project than `SUPABASE_URL` points at.

## Cross-Account Protection (RISC)

Google can push security event tokens to `POST /webhooks/risc`. The
endpoint is public (Google has no KeyFlowOS bearer token); token
authenticity is verified with Google's JWKS inside `RiscService`.

- Google `sub` → local user mapping is stored in `UserIdentity` during
  OAuth bootstrap (`/identity/bootstrap`).
- `sessions-revoked` / `tokens-revoked` / `account-disabled` trigger
  local session deletion + a Supabase global sign-out.
- Every event is deduplicated by `jti` and written to `risc_events`
  and `auth_audit_logs`.

See `docs/development/risc-setup.md` for GCP configuration and the
`pnpm configure:risc` registration script.
