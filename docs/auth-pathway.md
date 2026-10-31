# Auth Pathway — KeyFlowOS

This is the end-to-end map of every sign-in / sign-up code path the
product currently supports. It exists so the next person on call (you,
probably) can navigate the auth surface in minutes instead of hours.

## Release 0 sign-in: hosted Supabase free tier (D-02)

References are `path:line` on the packet base, source commit `e60a6ed1`
(this packet changes no source file). Prefixes: `S/` is `apps/server/src/`,
`W/` is `apps/web/src/`, `T/` is `apps/server/test/`. Supabase platform facts
were read from the Supabase documentation on 2026-10-31 and are linked.
Re-check them when you configure a project: Supabase can change free-tier
terms without any change in this repository.

### Ruling and scope

- **D-02**, ruled 2026-10-31 by the owner: Release 0 sign-in uses a hosted
  Supabase project on the Free plan (option C of D-02 in
  `docs/reconstruction/BUILD-MAP-001.md`).
- No identity code changes for Release 0: no local token issuer and no
  self-hosted GoTrue. Sign-up, login and refresh need network access to the
  project. Today every authenticated request does too (see the `verifyLocal`
  caveat below).
- The live sign-up leg runs only where a Supabase project is configured (last
  subsection). CI and the real-database suites never contact Supabase.

### Free-tier project configuration

1. Create a project on the Free plan. An owner or administrator gets two free
   projects across all organisations; paused projects do not count
   ([billing](https://supabase.com/docs/guides/platform/billing-on-supabase)).
2. **Project Settings → API.** Copy the Project URL into `SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_URL` (same value); the `anon` key into
   `SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (same value); the
   `service_role` key into `SUPABASE_SERVICE_ROLE_KEY`, server only, never in a
   `NEXT_PUBLIC_` variable. Use the legacy JWT-based `anon` and `service_role`
   keys. The code hands these values to `createClient`
   (`S/core/auth/supabase-admin.service.ts:64`,
   `S/core/auth/supabase-auth.service.ts:34`) and sends them as a raw `apikey`
   header (`S/modules/identity/identity-signup.service.ts:317-319`, `:393-395`;
   `W/app/auth/callback/page.tsx:101-106`, `:153-157`). No path here has been
   exercised with the newer `sb_publishable_…` / `sb_secret_…` keys.
3. **Project Settings → JWT.** The legacy JWT secret can go into
   `SUPABASE_JWT_SECRET`. It is optional, and with a hosted project it does not
   currently take effect (see the `verifyLocal` caveat).
4. **Authentication → URL Configuration.** Site URL = `NEXT_PUBLIC_SITE_URL`.
   Allow these redirect URLs: `<site>/auth/callback` (Google sign-in),
   `<site>/auth/login` (verification links land on `/auth/login?verified=1`,
   built at `S/modules/identity/identity-signup.service.ts:67-74`) and
   `<site>/auth/reset-password` (recovery links,
   `S/modules/identity/identity.controller.ts:426`).
5. **Authentication → Emails / SMTP.** Supabase sends only the
   password-recovery mail (`S/core/auth/supabase-admin.service.ts:237-240`).
   Sign-up verification mail does not go through Supabase (see "Email
   verification" below). Without custom SMTP, Supabase's built-in sender
   delivers only to members of the project's organisation team
   ([custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)). Password
   recovery therefore reaches real customers only after custom SMTP is
   configured in the dashboard.
6. Optional: the Google provider, see "Google OAuth (Supabase)" below.
7. Set `AUTH_REQUIRE_EMAIL_VERIFICATION` explicitly (see "Email verification").

### Environment variables (server and web)

"R0" is what Release 0 email/password sign-in needs. "Required" means the
sign-up, login or bootstrap leg fails without it.

| Variable | Read at | R0 | Used for |
|---|---|---|---|
| `SUPABASE_URL` (falls back to `NEXT_PUBLIC_SUPABASE_URL`) | `S/core/auth/supabase-admin.service.ts:45-48`; `S/modules/identity/identity-signup.service.ts:307`, `:383`; `S/core/auth/supabase-auth.service.ts:26`, `:91` | Required | Admin client, the password and refresh grants, the `getUser` fallback, the issuer check in `verifyLocal` |
| `SUPABASE_ANON_KEY` (falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | `S/modules/identity/identity-signup.service.ts:308`, `:384`; `S/core/auth/supabase-auth.service.ts:27` | Required | `apikey` for the password and refresh grants; the anon client behind the `getUser` fallback |
| `SUPABASE_SERVICE_ROLE_KEY` | `S/core/auth/supabase-admin.service.ts:50-53` | Required | `auth.admin.createUser`, `generateLink`, `listUsers`, `signOut`, recovery mail. Needed for every sign-up, with verification on **or off** |
| `SUPABASE_JWT_SECRET` | `S/core/auth/supabase-auth.service.ts:38-42` | Optional | Local HS256 verification; see the caveat below |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | `S/modules/identity/identity-signup.service.ts:20-25`; `S/main.ts:29-52` | Set it explicitly | On by default when `NODE_ENV=production` |
| `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` | `S/modules/notifications/system-email.service.ts:18-24`, `:41-55` | Only with verification on | Sending the verification mail |
| `SITE_URL`, else `APP_URL`, else `NEXT_PUBLIC_SITE_URL` | `S/modules/identity/identity-signup.service.ts:53-55`; `S/core/config/runtime-urls.ts:32-38` | Recommended | Where verification links point |
| `HIBP_DISABLED` | `S/modules/identity/password-policy.service.ts:59` | Recommended `true` | Otherwise each sign-up makes one outbound call to the Pwned Passwords API (`:55`), which fails open (`:145`). The build map sets `HIBP_DISABLED=true` for Release 0 |
| `NEXT_PUBLIC_API_BASE_URL` (web) | `W/lib/client.ts:2908` (`identitySignup`), `:2948-2953` (`identityLogin`) | Required | Every `/identity/*` call from the browser |
| `NEXT_PUBLIC_SUPABASE_URL` (web) | `W/app/auth/signup/page.tsx:39-42`; `W/app/auth/login/login-form.tsx:34-39`; `W/app/auth/callback/page.tsx:101`, `:153`; `W/lib/env.ts:34`, `:73-74` | Required for Google sign-in and the forgot-password button | Email/password sign-up and login never call Supabase from the browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (web) | `W/app/auth/login/login-form.tsx:35-39`; `W/app/auth/callback/page.tsx:106`, `:157` | As above | PKCE token exchange and the user-info call after Google sign-in |
| `NEXT_PUBLIC_SITE_URL` (web) | `W/app/auth/signup/page.tsx:40`; `W/app/auth/login/login-form.tsx:36` | Required for Google sign-in | OAuth `redirect_to` |

`NEXT_PUBLIC_*` values are inlined into the web bundle at build time, so
changing them needs a web rebuild.

### How sign-up, login, refresh and bootstrap use them

**Sign-up**, `POST /identity/signup` (`S/modules/identity/identity.controller.ts:127-189`):

1. Charges the `SIGNUP_IP` and `SIGNUP_EMAIL` buckets in Postgres (`:136-142`).
2. `IdentitySignupService.signup` (`S/modules/identity/identity-signup.service.ts:87-195`)
   refuses with `server_misconfigured` unless the URL and the service-role key
   are present (`:98-106`). It then runs the password policy and the HIBP
   check (`:113`) and calls `auth.admin.createUser` with
   `email_confirm = !requireVerification` (`:130-135`;
   `S/core/auth/supabase-admin.service.ts:76-97`).
3. Verification off: the server signs the new user in through the password
   grant (`:144-154`) and answers 201 `{status:'authenticated', accessToken, refreshToken}`
   (controller `:165-174`).
4. Verification on: the server generates a `signup` link (`:159-175`) and
   sends it through Resend (`:177-192`). If either step fails, it deletes the
   half-created user and answers `email_send_failed`. On success it answers
   201 `{status:'verification_sent'}` (controller `:175-180`).
5. Every outcome writes an `AuthAuditLog` row (controller `:156-164`, `:185`).

**Login**, `POST /identity/login` (controller `:197-238`): charges `LOGIN_IP`
and `LOGIN_EMAIL`, then calls `signInWithPassword`. That is a raw
`POST ${SUPABASE_URL}/auth/v1/token?grant_type=password`, with the anon key as
`apikey` and a 10 s timeout (`S/modules/identity/identity-signup.service.ts:306-367`).
Supabase errors map to stable codes at `:342-365`. On success the server
clears the user's Redis revocation marker (controller `:217-223`).

**Refresh**, `POST /identity/refresh` (controller `:348-381`): charges
`REFRESH_IP`, then calls `grant_type=refresh_token`
(`S/modules/identity/identity-signup.service.ts:382-425`). Every Supabase
failure becomes one 401 `refresh_failed`.

**Bootstrap**, `POST /identity/bootstrap` (controller `:897-915`), sits behind
`AuthGuard`, so `AuthMiddleware` must accept the bearer token first. It never
calls Supabase. `IdentityService.bootstrapUser`
(`S/modules/identity/identity.service.ts:912`) finds or creates the local
`User`. The default `Business` and `OWNER` membership are created in a
Serializable transaction (`ensureBootstrapWorkspace`, `:1068-1107`). A
verified user with no local row is attached with role `USER` so it can reach
bootstrap (`S/core/auth/auth.middleware.ts:125-135`, `:192-193`). The web calls
bootstrap right after an authenticated sign-up
(`W/app/auth/signup/page.tsx:180-199`) and after every login
(`W/app/auth/login/login-form.tsx:150-170`).

**Every authenticated request**: `AuthMiddleware` (`S/core/auth/auth.middleware.ts:48-97`)
calls `SupabaseAuthService.getUserFromToken` (`S/core/auth/supabase-auth.service.ts:132-162`).
That tries `verifyLocal` first (`:136-139`). If `verifyLocal` returns nothing,
it calls `supabase.auth.getUser(token)` with the anon client (`:142-145`), a
network round trip to the project. If both fail, the middleware tries the
admin-token fallback (`auth.middleware.ts:79-90`) and otherwise leaves
`req.user` unset, and `AuthGuard` answers 401.

### Local HS256 verification (`verifyLocal`)

`S/core/auth/supabase-auth.service.ts:44-108` accepts a token only when all of
these hold:

- `SUPABASE_JWT_SECRET` is set (`:45-46`);
- the header `alg` is `HS256` (`:57-60`);
- the HMAC-SHA256 signature matches, compared in constant time (`:62-71`);
- `exp` has not passed, `nbf` is not in the future, and `iat` is at most 60 s
  ahead (`:77-90`);
- if `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) is set and the token has
  an `iss`, then `iss` equals that URL exactly (`:91-95`);
- `aud`, when present, is `authenticated` (`:97-101`).

On success the user comes from the `sub` and `email` claims (`:110-120`). The
role used for authorisation still comes from the local `User` row
(`S/core/auth/auth.middleware.ts:182-193`).

**Caveat, measured on this base.** Hosted Supabase access tokens carry
`iss = https://<ref>.supabase.co/auth/v1`
([JWT claims](https://supabase.com/docs/guides/auth/jwt-fields)). The check at
`:91-95` compares `iss` with `SUPABASE_URL`, which has no `/auth/v1` suffix.
A scratch run of `verifyLocal` with `SUPABASE_JWT_SECRET` set and
`SUPABASE_URL=https://example-ref.supabase.co` gave these results:

| Token | Result |
|---|---|
| No `iss` | accepted |
| `iss` = `SUPABASE_URL` | accepted |
| `iss` = `SUPABASE_URL` + `/auth/v1` (the hosted shape) | **rejected** |
| `alg` = `ES256` | rejected |
| `aud` = `service_role` | rejected |

So against a hosted project, local verification never accepts a real access
token, and every authenticated request falls back to the `getUser` round trip
(`:142-145`). Sign-in still works, but the project must be reachable on every
request, and `SUPABASE_JWT_SECRET` currently does nothing. The same fallback
applies when a project signs with asymmetric JWT signing keys (ES256/RS256,
[signing keys](https://supabase.com/docs/guides/auth/signing-keys)), because
`:57` accepts only HS256. The boot warning about the secret
(`S/core/config/env.ts:162-164`) fires only when the secret is missing; it says
nothing about the issuer mismatch. Fixing the comparison is a code change,
outside this documentation-only packet.

### What happens when the variables are absent

Measured on this base with a scratch harness. It ran the real
`IdentityController`, `IdentitySignupService`, `SupabaseAdminService`,
`SystemEmailService` and `PasswordPolicyService` under `configureNestApp`, so
the real `GlobalHttpExceptionFilter` shaped each body. `AuthSecurityService`
was stubbed, every `SUPABASE_*` variable was unset, and no outbound request
was made. Rows marked "code" are read from source rather than measured.

| Leg | Needs | Behaviour when absent | Where |
|---|---|---|---|
| `POST /identity/signup` | URL + `SUPABASE_SERVICE_ROLE_KEY` | **400 `server_misconfigured`**, body below. The rate-limit buckets are still charged, and an audit row `{event:'signup', outcome:'failure', reason:'server_misconfigured'}` is written. The password policy and HIBP check do not run. | `S/modules/identity/identity-signup.service.ts:98-106`; controller `:136-188` |
| Sign-up with verification off, service-role key set, anon key missing (code) | anon key | The Supabase user **is created**, then 400 `signin_unavailable` | `:144-146`, `:306-314` |
| `POST /identity/login` | URL + anon key | 400 `{"statusCode":400,"code":"signin_unavailable","message":"Account created, but automatic sign-in is unavailable. Please sign in.","error":"BadRequestException",…}`. The message was written for the sign-up case and is shown on the login page as is. Nothing leaves the server. | `:306-314` |
| Login with the URL set but unreachable (code) | network | 400 `signin_unreachable` once the fetch fails or the 10 s timeout fires | `:315-330` |
| `POST /identity/refresh` | URL + anon key | 400 `refresh_unavailable`, "Session refresh is unavailable." | `:382-390` |
| `POST /identity/resend-verification` | URL + service-role key | 201 `{"status":"ok","verificationRequired":false}`. The answer claims success; only a server log line warns | `:221-226`; controller `:262-270` |
| `POST /identity/forgot-password` (code) | admin client | 201 `{status:'sent'}` regardless; the admin-client error is logged and swallowed. A 400 is returned only when neither `APP_URL` nor `NEXT_PUBLIC_SITE_URL` gives an allowed origin | controller `:415-439`; `S/modules/identity/identity-password.service.ts:51-60` |
| Bearer token on any route | `SUPABASE_JWT_SECRET`, or URL + anon key | With neither, `getUserFromToken` returns `null` after logging "Supabase env vars missing; auth will be treated as optional.", and guarded routes (`/identity/me`, `/identity/bootstrap`, …) answer 401 | `S/core/auth/supabase-auth.service.ts:29-31`, `:142-143` |
| Boot with verification on (set to true, or unset with `NODE_ENV=production`) (code) | `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS` | `[FATAL] AUTH_REQUIRE_EMAIL_VERIFICATION is on but required env vars are missing: … Refusing to start.`, then exit 1. `SUPABASE_URL` is not checked here | `S/main.ts:29-46` |
| Boot with verification off (code) | `SUPABASE_SERVICE_ROLE_KEY` | Warning only: `[WARN] SUPABASE_SERVICE_ROLE_KEY is not set. POST /identity/signup will return server_misconfigured until this is configured.` | `S/main.ts:47-52` |
| Boot, any mode (code) | `SUPABASE_URL`, `SUPABASE_JWT_SECRET` | Warnings from the env check; boot is never blocked | `S/core/config/env.ts:159-164` |
| Web built without `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY`, or with the `your-project` placeholder (code) | — | The Google buttons are hidden. Forgot-password shows "Email password reset isn't configured yet — ask your admin for a password reset." Email/password sign-up and login still post to the API and get the answers above. `W/lib/env.ts` logs a warning | `W/app/auth/signup/page.tsx:42`, `:570`; `W/app/auth/login/login-form.tsx:38-39`, `:140`, `:413`; `W/lib/env.ts:73-74` |

The sign-up body, exactly as measured (`timestamp` varies, and `path` is the
URL the server saw):

```json
{"statusCode":400,"code":"server_misconfigured","message":"Sign up is temporarily unavailable. The server is missing required configuration.","error":"BadRequestException","timestamp":"…","path":"/identity/signup","details":{"detail":"SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY"}}
```

`details.detail` lists only the variables that are missing
(`S/core/auth/supabase-admin.service.ts:38-43`). The envelope comes from
`S/core/filters/http-exception.filter.ts:39-99`, and the web declares the code
at `W/lib/client.ts:2897`.

### Email verification and the Resend dependency

- **The flag.** `AUTH_REQUIRE_EMAIL_VERIFICATION`: `true`/`1` means on and
  `false`/`0` means off. Unset means on only when `NODE_ENV=production`
  (`S/modules/identity/identity-signup.service.ts:20-25`). `S/main.ts:29-33`
  repeats the same rule for the boot check.
- **On.** Supabase does not send the verification mail. The server generates
  the confirmation link with the service-role key (`generateLink` type
  `signup`, `S/core/auth/supabase-admin.service.ts:150-166`) and sends it
  through Resend via `SystemEmailService`
  (`S/modules/identity/identity-signup.service.ts:273-293`). Resend is then a
  required provider:
  - boot refuses to start without `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS`
    (`S/main.ts:34-46`);
  - a failed send deletes the new Supabase user and answers `email_send_failed`
    (`:177-192`);
  - resend-verification sends a `magiclink` link the same way (`:246-268`).
- **Off.** The user is created already confirmed and signed in at once, with
  no mail and no Resend (`:144-154`). In production the flag must be set to
  `false` explicitly, because unset means on.
- **Choosing for Release 0 is an operator decision.** Off keeps Release 0 at a
  single external provider (Supabase) but does not prove the user owns the
  address. On adds Resend: an account, `RESEND_API_KEY`, and an
  `EMAIL_FROM_ADDRESS` Resend will send from. This packet does not choose;
  `.env.example` keeps `false`.
- **Password recovery is separate.** Supabase's own mailer sends it
  (`S/core/auth/supabase-admin.service.ts:237-240`), not Resend, so it follows
  the project's SMTP settings (next section).

### Free-tier limits that matter for Release 0

Sources: the linked Supabase pages, read 2026-10-31. The per-hour numbers in
Supabase's rate-limit table are rendered from live configuration and are not
copied here; read them on the project's **Authentication → Rate Limits** page.

| Limit | Why it matters here |
|---|---|
| **Pausing.** Supabase pauses a Free project with low activity over 7 days, after a warning email. It can be restored for 90 days ([pausing](https://supabase.com/docs/guides/platform/free-project-pausing)) | A paused project fails every sign-up, login and refresh. Because of the `verifyLocal` caveat, it also fails every authenticated request. Application data lives at `DATABASE_URL`, which need not be this project, so app traffic may not count as activity |
| **Projects.** Two free projects per owner or administrator, across organisations ([billing](https://supabase.com/docs/guides/platform/billing-on-supabase)) | Enough for staging plus one spare |
| **Monthly active users.** 50,000 MAU, counting users who log in or refresh in the billing cycle. Going over on Free brings a notification and a grace period ([MAU](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users)) | Far above Release 0 needs |
| **Database and egress.** 500 MB database per project; 5 GB egress ([billing](https://supabase.com/docs/guides/platform/billing-on-supabase)) | Only the `auth` schema lives there, unless `DATABASE_URL` points at the same project. Then 500 MB is the whole application database |
| **Auth rate limits.** A per-IP token bucket with capacity 30 on `/auth/v1/token` (password and refresh grants) and `/auth/v1/verify`. Supabase answers 429 when it is exhausted ([rate limits](https://supabase.com/docs/guides/auth/rate-limits)) | The API server calls login, refresh and the auto-confirm sign-in (`S/modules/identity/identity-signup.service.ts:317`, `:393`), so every user of a deployment shares the server's egress-IP bucket. The code sends no `Sb-Forwarded-For` header (none appears in `apps/server/src`), and Supabase honours that header only with `sb_secret_…` keys and forwarding enabled. A Supabase 429 surfaces as `signin_failed` on login (`:361-364`) and as `refresh_failed` on refresh (`:409-418`). Keyflow's own limits (`S/modules/identity/auth-security.service.ts:86-121`) are applied first |
| **Built-in SMTP.** It delivers only to the organisation's team addresses, has a low hourly cap, and has no SLA ([custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)) | It affects password recovery only, because Supabase sends that mail. Sign-up verification goes through Resend |
| **JWT signing.** Supabase calls the legacy HS256 secret "no longer recommended" and offers asymmetric signing keys ([signing keys](https://supabase.com/docs/guides/auth/signing-keys)) | With either choice, today's code falls back to `getUser` (the `verifyLocal` caveat) |

### How the real-database tests mint tokens without a project

No suite contacts Supabase. There are two patterns.

1. **Spawned-server suites:** `T/identity-boundary.integration.test.ts`,
   `T/release0-journey.integration.test.ts` and
   `T/onboarding-manual-complete.integration.test.ts`.
   - The child server gets a test-only `SUPABASE_JWT_SECRET`
     (identity-boundary `:408`, release0-journey `:266`,
     onboarding-manual-complete `:320`).
   - Every Supabase and provider key is pinned to `''` (identity-boundary
     `:133-136`, release0-journey `:88-95`, onboarding-manual-complete
     `:97-99`). The child loads the repo-root `.env` with dotenv, which never
     overrides a key that is already present, so pinning keeps a developer's
     real keys out.
   - The test mints HS256 tokens with `node:crypto` `createHmac`, carrying
     `{sub, email, aud:'authenticated', role:'authenticated', iat, exp}` and
     **no `iss`** (identity-boundary `:219-240`, release0-journey `:139-147`,
     onboarding-manual-complete `:162-170`).
   - With `SUPABASE_URL` empty, the issuer check is skipped, and the real
     `AuthMiddleware` accepts these tokens through `verifyLocal`.
   - The `User` row and business come from the real `POST /identity/bootstrap`.
     `POST /identity/signup` is not exercised (release0-journey `:36-49`).
2. **In-process suites**, for example `T/contacts-visibility.integration.test.ts`,
   use no token at all. A test middleware reads `x-test-user`, loads the
   seeded `User` row and attaches it (`:236-248`).

So CI proves everything after token verification. It does not prove Supabase
sign-up, login or refresh, and it does not prove the hosted-token issuer path,
because no test mints a token with `iss`.

### Where the live sign-up leg runs

- Only where a Supabase project is configured: the operator-authorised staging
  run (#186 step B). The Release 0 Playwright journey (R0-25) starts at
  `/auth/signup`. Under D-02 option C it records the substitution when no
  project is configured (`docs/reconstruction/BUILD-MAP-001.md`, review
  disposition row 2).
- The minimum environment for that run:
  - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`;
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`;
  - `NEXT_PUBLIC_API_BASE_URL`, and `NEXT_PUBLIC_SITE_URL` or `APP_URL`;
  - an explicit `AUTH_REQUIRE_EMAIL_VERIFICATION`, plus the Resend variables
    when it is on;
  - `HIBP_DISABLED=true` if the run must make no other outbound call.
- Expected results:
  1. `POST /identity/signup` answers 201: `authenticated` with verification
     off, `verification_sent` with it on.
  2. `POST /identity/bootstrap` with the returned token creates the `User`,
     the `Business` and the `OWNER` membership.
  3. `GET /identity/me` answers 200.
- Never point a local or CI run at the staging project. The spawned-server
  suites pin the keys empty for exactly that reason.

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
/auth/login (forgot) ── POST /identity/forgot-password ── resetPasswordForEmail (Supabase sends the mail)
/auth/reset-password ── POST /identity/reset-password ── server verifies the recovery token, then sets the password
```

## Frontend pages

| Path | Purpose | Notable behaviour |
|------|---------|-------------------|
| `apps/web/src/app/auth/start/page.tsx` | Choice screen (sign in / sign up) | Pure links; no state. |
| `apps/web/src/app/auth/signup/page.tsx` | Email/password signup form | Posts to `/identity/signup`; on `verification_sent` shows "check your email" screen; on `authenticated` stores token + bootstraps workspace. |
| `apps/web/src/app/auth/login/page.tsx` | Email/password sign-in + forgot-password + Google OAuth | Posts to `/identity/login`. Surfaces banners for `?verified=1` (after email-confirm) and `?reset=1` (after password reset). Maps `email_not_confirmed` errors to a Resend affordance. The form lives in `login-form.tsx`. Forgot-password posts to `/identity/forgot-password` (rate-limited and audited), and the server asks Supabase to send the recovery mail. |
| `apps/web/src/app/auth/callback/page.tsx` | OAuth (Google) PKCE landing | Reads `#access_token` from the URL fragment, calls Supabase `/auth/v1/user` for profile, derives names via `deriveOAuthName()` (pure helper, unit-tested), then calls `/identity/bootstrap` and routes to `/app`. |
| `apps/web/src/app/auth/reset-password/page.tsx` | Set new password from reset email | Parses `#access_token` + `type=recovery` via `parseRecoveryHash()` (pure, tested). Submits to `/identity/reset-password` with the recovery token. On success, redirects to `/auth/login?reset=1`. |
| `apps/web/src/components/require-auth.tsx` | Client-side gate around `/app/*` | Requires a token; on 401 from API it `clearStoredBusinessId()` and routes to `/auth/login?from=…` (see `apps/web/src/lib/api.ts`). |
| `apps/web/src/app/app/layout.tsx` | Authenticated app shell | Sign-out is `handleLogout()` — clears workspace + token cookie via `clearStoredBusinessId()`, then routes to `/auth/login`. |

## Backend endpoints

All live in `apps/server/src/modules/identity/identity.controller.ts`.

| Method + path | Auth | Purpose | Stable error codes |
|---|---|---|---|
| `POST /identity/signup` | none | Create Supabase user; auto-confirm or send verification email | `weak_password`, `email_taken`, `invalid_email`, `email_send_failed`, `signup_failed`, `server_misconfigured` (no Supabase admin config; see "What happens when the variables are absent"), `rate_limited` |
| `POST /identity/login` | none | Exchange email + password for an access/refresh token | `invalid_credentials`, `email_not_confirmed`, `signin_failed`, `signin_unavailable`, `signin_unreachable`, `rate_limited` |
| `POST /identity/refresh` | none (refresh token in body) | Exchange a refresh token for a new session | `refresh_unavailable`, `refresh_unreachable`, `refresh_failed` (401), `rate_limited` |
| `POST /identity/resend-verification` | none | Re-send the verification email | (always 201; throttled at 60s/email + AuthSecurity rate rule) |
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
| `SUPABASE_SERVICE_ROLE_KEY` | Required for admin actions: `auth.admin.createUser`, `generateLink`. Without it `/identity/signup` answers 400 `server_misconfigured`, whether verification is on or off. |
| `SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | Anon key used for the password and refresh grants and the `getUser()` fallback. The frontend reads `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the Google PKCE exchange and user-info call. |
| `SUPABASE_JWT_SECRET` | Optional; meant to let the auth middleware verify tokens locally instead of round-tripping `getUser()`. With a hosted project it does not take effect today: see the `verifyLocal` caveat above. |
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

### Required env var names (values live in the deployment's secret store)

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `NEXT_PUBLIC_SITE_URL` — used by the browser for the redirect and
  the Supabase user-info call.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — used server-side by
  `SupabaseAuthService` to verify tokens (`getUser()` fallback);
  `SUPABASE_SERVICE_ROLE_KEY` — used by `SupabaseAdminService` for
  sign-up and recovery.

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
