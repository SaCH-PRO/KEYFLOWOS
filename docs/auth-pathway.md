# Auth Pathway — KeyFlowOS

This is the end-to-end map of every sign-in / sign-up code path the
product currently supports. It exists so the next person on call (you,
probably) can navigate the auth surface in minutes instead of hours.

## Release 0 sign-in: hosted Supabase free tier (D-02)

References are `path:line` on the packet base, source commit `e60a6ed1`
(this packet changes no application source file; its review repair adds the
test `T/identity-local-auth.integration.test.ts`). Prefixes: `S/` is `apps/server/src/`,
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
- Review of this packet found two blocking defects that documentation cannot
  fix. R0-SEC-01-BOOTSTRAP-TAKEOVER fixed the first (bootstrap account
  takeover). Release 0 sign-in does not open until a code packet closes the
  second, or it is configured as described (next subsection).

### Open defects and stop conditions

Found in review of this packet. Each needs a code change, which is outside
this packet: D-02 option C rules no identity code change, and the files involved
are outside its write set. Item 1 is fixed by the code packet
R0-SEC-01-BOOTSTRAP-TAKEOVER; items 2 and 3 are open.

1. **Fixed by R0-SEC-01: `POST /identity/bootstrap` took over an account by
   email.** It was blocking. The controller passed `email: body.email ??
   user.email`, so the request body chose the email. When no local `User` had
   the token's `sub`, `bootstrapUser` looked up a `User` by that email and
   called `reconcileUserId`. That function recreated the row under the
   caller's id, copied its role (so `SUPER_ADMIN` carried over), re-pointed the
   row's memberships and `Business.ownerId` to the caller, and deleted the old
   row. Any authenticated caller who had not bootstrapped could therefore take
   any account, and every business it owned or belonged to, by naming its
   email in the body, or by holding a token whose `email` claim was that
   address.
   - Measured in review, before the fix: 201
     `{id: <attacker>, email: <victim>, role: SUPER_ADMIN}`, with the victim's
     `OWNER` membership and `businesses.owner_id` naming the attacker.
     `T/identity-local-auth.integration.test.ts` reproduced it (6 cases red on
     the unmodified source).
   - **The fix.** A local `User` is bound to the verified token subject, never
     to a client-supplied attribute (kernel K1).
     - The bootstrap email is the verified token's `email` claim
       (`S/modules/identity/identity.controller.ts:1004`). A body `email` is
       **ignored**, not refused with 400: the web sends the address the user
       typed (`W/app/auth/signup/page.tsx:185-191`), which can differ from the
       token's in case or whitespace.
     - When a `User` with a different id already holds that email,
       `bootstrapUser` answers **409 `{code: 'account_email_in_use'}`** and
       writes nothing: no `User` row, no membership, no business, and the
       holder's row, role, memberships and `Business.ownerId` are unchanged
       (`S/modules/identity/identity.service.ts:1124-1137`).
     - `reconcileUserId` is never called for an account. Its one caller is the
       team-invitation case below.
     - **Team invitations (review repair SEC01-T1, CR-1).** For an address with
       no account, `inviteTeamMember` creates a placeholder `User` (generated
       id, role `USER`, the invited address) and attaches the pending
       membership to it. The first R0-SEC-01 fix treated that row as an
       account, so an invitation to anyone without an account could never be
       accepted. It also let any signed-up user lock an address out of sign-up
       by inviting it and then removing the membership. Now:
       - `inviteTeamMember` marks the placeholder
         (`users.meta_data.invitePlaceholder = true`). Only the server writes
         `User` metadata; no route lets a caller set it.
       - Bootstrap adopts a marked row (moves it to the caller's `sub` with
         `reconcileUserId`) only while nobody has ever signed in as it: role
         `USER`, not deleted or banned, no referral code (every bootstrap sets
         one), no session, no identity link, no business owned, no `OWNER`
         membership. It re-checks this inside the move's transaction with the
         row locked (`SELECT ... FOR UPDATE`). Any other holder is an account
         and still gets 409 `account_email_in_use`.
       - A pending membership grants authority in the inviting business, so it
         moves only when the caller proves it owns the address. Proof means
         `AUTH_REQUIRE_EMAIL_VERIFICATION` is on, and the Supabase user with the
         token's `sub` (read with the service-role key, not from the token)
         holds the same address with `email_confirmed_at` set. Without proof,
         bootstrap answers **409 `{code: 'invite_email_unverified'}`** and
         writes nothing. With verification off there is no proof, because
         sign-up confirms the address without checking it. The invitee then
         gets this 409 until the inviter removes the invitation; after that
         the invitee bootstraps and can be invited again as an existing
         account.
       - A placeholder with no membership left (the invitation was removed)
         carries nothing. The owner of the address bootstraps through it
         without proof, and gets only its own new account and business.
       - A placeholder created before this repair has no marker, so it still
         gets 409 `account_email_in_use`. After confirming that nobody has
         ever signed in as that row, the operator either sets the marker on it
         (the invitation is then accepted as above) or deletes it, which also
         deletes its pending memberships.
   - **Proof.** `T/identity-local-auth.integration.test.ts`, block "R0-SEC-01",
     runs the real `IdentityController` and `IdentityService` behind the real
     `AuthMiddleware` and `AuthGuard` against Postgres. The negative controls
     are a body email naming a victim, a token whose own `email` claim is a
     victim's under another `sub`, a free body email sent with such a token,
     and repeated attempts. Each runs against a plain owner and a
     `SUPER_ADMIN`, and each victim's row, role, `OWNER` membership and
     `businesses.owner_id` are unchanged after it. The positive controls are a
     first-time caller, who gets its own business (journey step 1), and a
     returning user with the same `sub`, which is idempotent.
     `T/identity-bootstrap.service.test.ts` pins that the 409 path calls no
     write. The block "R0-SEC-01 review repair" of the same suite runs the real
     team invite and removal routes behind the real `BusinessGuard` and
     `ModuleScopeGuard`. A proven invitee gets 201 and the `STAFF` membership.
     An unproven one gets 409 `invite_email_unverified` with nothing written:
     verification off, address not confirmed, another address on the Supabase
     user, or no Supabase user. Invite-then-remove no longer blocks the real
     owner. A marked row that has been signed in as, a marked `SUPER_ADMIN`, and
     an unmarked row all stay accounts. The Supabase lookup is a recording
     stand-in, and no fetch is made.
   - **Web follow-up (not in this fix).** The OAuth callback page shows its
     "email already in use" screen only for the code `account_email_conflict`
     (`W/lib/client.ts:2865`, `W/app/auth/callback/page.tsx:214-216`).
     `account_email_in_use` and `invite_email_unverified` currently get the
     generic error screen with the server's message.
   - **Moving an account to a new subject is now a manual operator step.**
     This is the legitimate case the old reconcile handled automatically: the
     same person, but a new `sub`, for example after the deployment moves to a
     new Supabase project or a Supabase user is deleted and recreated. Until
     the step is done, that person's bootstrap answers 409
     `account_email_in_use` and writes nothing, so it is safe to retry
     afterwards.
     1. Prefer keeping the subject stable. If the auth users move to the new
        project with their ids unchanged, the token `sub` still equals the
        local `User.id`, and bootstrap finds the row by id. Nothing needs to
        move. Check the current Supabase documentation for whether your
        migration route keeps user ids.
     2. Otherwise, move one account at a time. First confirm out of band that
        the person holding the new `sub` owns the old account: they signed in
        to the new project with the address, and they confirm through a
        channel the old account already trusts. An email match alone is not
        proof; that is the defect.
     3. Read the new `sub` from the user's record in the new project (the
        `id` of the Supabase auth user). Make sure no local `User` row has
        that id yet. The 409 guarantees bootstrap created none.
     4. In one database transaction, in a window when the user is signed out:
        free the address on the old row (set a placeholder email), create the
        new row under the new `sub` with the old row's fields (role included),
        re-point every column that holds the old id, then delete the old row.
        Do not rely on `reconcileUserId`'s list of references. It re-points
        memberships, sessions, the AI log, approval and plan rows,
        `businesses.owner_id` and `team_activity_logs.user_id`. It misses
        `user_identities`, `contact_shares` and `push_subscriptions` (deleted
        with the old row by cascade), `support_tickets.assigned_to_id` and
        `users.referred_by_user_id` (set to null), and user-id columns that
        have no foreign key. Find them in `packages/db/prisma/schema.prisma`
        before the run.
     5. Have the user sign in. Bootstrap then finds the row by id and answers
        201 with their existing business.
   - The stop condition this defect set (Release 0 sign-in does not open,
     and the live sign-up leg does not run against a database holding other
     accounts) is lifted for this defect. Defect 2 keeps its own stop
     condition.
2. **`SUPABASE_JWT_SECRET` is a live acceptance path, not an inert setting.
   Blocking until configured as below.** `verifyLocal` accepts any HS256
   token signed with the secret whose `iss` is absent or equals `SUPABASE_URL`
   (`S/core/auth/supabase-auth.service.ts:91-95`). Hosted projects issue
   neither shape. So with a hosted project the secret verifies no real token,
   but it lets anyone who holds it mint tokens the API accepts as any `sub` and
   `email`. Together with defect 1, anyone who knows the value can take over a
   victim's account by naming its email, without any Supabase account. Until this
   repair, `.env.example` carried the public placeholder
   `your-supabase-jwt-signing-secret` as the value, and boot does not reject
   a placeholder (`S/core/config/env.ts:50`). It is also the legacy key that
   signs `service_role` JWTs for the project, so keeping it on the API server
   widens the damage of a leak and buys nothing today.
   - **Release 0 rule.** Leave `SUPABASE_JWT_SECRET` empty (`.env.example`
     now leaves it blank) and never deploy a placeholder in it. Before
     emptying it, give `GOOGLE_STATE_SECRET` its own long random value, never
     the `.env.example` placeholder. The marketing unsubscribe-token HMAC uses
     `GOOGLE_STATE_SECRET` and falls back to `SUPABASE_JWT_SECRET`
     (`S/modules/email-marketing/email-marketing.service.ts:108-115`). With
     both unset, building an unsubscribe link throws `Server
     misconfiguration: unsubscribe token secret is not set`. If links were
     already sent signed with `SUPABASE_JWT_SECRET`, changing the effective
     secret invalidates them. The boot warning `SUPABASE_JWT_SECRET: not set —
     local JWT verification unavailable` (`S/core/config/env.ts:162-164`) is
     then expected.
   - Proven at the real `AuthMiddleware` and `AuthGuard` by
     `T/identity-local-auth.integration.test.ts`. With the secret empty,
     forged tokens with no `iss` and with `iss = SUPABASE_URL` both get 401,
     and nothing leaves the server. With the former placeholder set, both pass
     the guard carrying the forged email, and the hosted shape is refused.
     The second group is a characterization that flips when a code packet
     fixes the issuer check.
3. **The shared Supabase token bucket is a denial-of-service risk.
   Should-fix.** Every password and refresh grant leaves from the API server's
   IP, so all users share one per-IP bucket on `/auth/v1/token` (capacity 30,
   see "Free-tier limits"). Keyflow lets each client IP make 10 logins per
   15 min and 120 refreshes per hour
   (`S/modules/identity/auth-security.service.ts:87`, `:114`). It relays each
   one to Supabase, including refresh tokens that are garbage. So one
   unauthenticated client can empty the bucket at once, and a few addresses
   can keep it empty. While it is empty, a refresh answers 401
   `refresh_failed` (`S/modules/identity/identity-signup.service.ts:409-418`).
   The web treats that as an expired session and sends the user to the login
   page (`W/lib/workspace.ts:243-245`, `W/components/require-auth.tsx:67-80`).
   Logins fail with `signin_failed` (`:361-364`). This was read from code and
   Supabase's documentation, not measured; no Supabase project was available.
   The mitigation is a code change: send the client IP in `Sb-Forwarded-For`,
   which Supabase honours only with an `sb_secret_…` key and forwarding
   enabled. Until that lands, Release 0 either accepts this risk explicitly
   or stays small enough for an operator to watch the `token_refresh_failed`
   rows in `AuthAuditLog`.

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
3. **Project Settings → JWT.** Do not copy the legacy JWT secret into
   `SUPABASE_JWT_SECRET`. For Release 0, leave it empty and never deploy a
   placeholder in it. With a hosted project it verifies no real token, but it
   is still an acceptance path for tokens signed with it (open defect 2). Set
   `GOOGLE_STATE_SECRET` first, because unsubscribe links fall back to it.
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
| `SUPABASE_JWT_SECRET` | `S/core/auth/supabase-auth.service.ts:38-42`; `S/modules/email-marketing/email-marketing.service.ts:109` | **Leave empty** | Local HS256 verification. It is an acceptance path for any token signed with it (open defect 2, and the caveat below). It is also the fallback HMAC secret for marketing unsubscribe tokens when `GOOGLE_STATE_SECRET` is unset |
| `GOOGLE_STATE_SECRET` | `S/modules/email-marketing/email-marketing.service.ts:109`, and the Google, Gmail, Calendar and Drive OAuth state | Set before emptying `SUPABASE_JWT_SECRET` | The unsubscribe-token HMAC, preferred over `SUPABASE_JWT_SECRET`. Use a long random value, never the `.env.example` placeholder |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | `S/modules/identity/identity-signup.service.ts:20-25`; `S/main.ts:29-52` | Set it explicitly | On by default when `NODE_ENV=production` |
| `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` | `S/modules/notifications/system-email.service.ts:18-24`, `:41-55` | Only with verification on | Sending the verification mail |
| `SITE_URL`, else `APP_URL`, else `NEXT_PUBLIC_SITE_URL`, else `PUBLIC_BASE_URL` | `S/modules/identity/identity-signup.service.ts:53-55`; `S/core/config/runtime-urls.ts:32-38` | Required on a hosted deployment | Where verification links point |
| `APP_URL`, else `NEXT_PUBLIC_SITE_URL`, else `PUBLIC_BASE_URL`, else the first `CORS_ALLOWED_ORIGINS` entry | `S/core/config/runtime-urls.ts:93-114`; `S/modules/identity/identity.controller.ts:415-426` | Required on a hosted deployment | Where recovery links point (`SITE_URL` is not read here). With none set, both kinds of link point at `http://localhost:5000` and no error is raised (see the forgot-password row below) |
| `HIBP_DISABLED` | `S/modules/identity/password-policy.service.ts:59` | `true` for Release 0 | Otherwise each sign-up makes one outbound call to the Pwned Passwords API (`:55`), which fails open (`:145`). The build map sets `HIBP_DISABLED=true` for Release 0, and `.env.example` documents it beside `HIBP_DISABLED`. Only `true`, in any case, disables the call, and with it the breached-password check |
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
`AuthGuard`, so `AuthMiddleware` must accept the bearer token first. It calls
Supabase only to prove an invitee owns its address (item 1, team invitations).
`IdentityService.bootstrapUser`
(`S/modules/identity/identity.service.ts:912`) finds the local `User` by the
token's `sub`. If there is none, it creates the row with the token's `email`
claim; a body `email` is ignored. If another `User` already holds that email,
bootstrap answers 409 `account_email_in_use` and writes nothing. It never moves
that row to the caller (fixed by R0-SEC-01, item 1 above; line numbers in this
paragraph are on the R0-14 base). The one exception is a team-invitation
placeholder that nobody has signed in as (item 1). The default `Business` and `OWNER` membership are created in a
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
request. `SUPABASE_JWT_SECRET` verifies no real token, but it is **not
inert**. The first two rows are an acceptance path: any token signed with the
secret that has no `iss`, or has `iss = SUPABASE_URL`, passes the middleware
carrying whatever `sub` and `email` it names. That is open defect 2, and it is
why the Release 0 rule leaves the secret empty. The same fallback
applies when a project signs with asymmetric JWT signing keys (ES256/RS256,
[signing keys](https://supabase.com/docs/guides/auth/signing-keys)), because
`:57` accepts only HS256. The boot warning about the secret
(`S/core/config/env.ts:162-164`) fires only when the secret is missing; it says
nothing about the issuer mismatch, and boot accepts a placeholder value. Fixing
the comparison, and refusing tokens with no `iss`, is a code change outside
this documentation-only packet. `T/identity-local-auth.integration.test.ts`
reproduces the first three rows at the real `AuthMiddleware` and `AuthGuard`.

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
| `POST /identity/forgot-password` (measured in review) | admin client; `APP_URL` or `NEXT_PUBLIC_SITE_URL` | 201 `{status:'sent'}` regardless; the admin-client error is logged and swallowed. The 400 for "no allowed origin" (controller `:416-420`) never fires, because `allowedCorsOrigins()` always adds `http://localhost:5000`, `http://localhost:3000` and `http://127.0.0.1:5000` (`S/core/config/runtime-urls.ts:109-112`). With `APP_URL`, `NEXT_PUBLIC_SITE_URL`, `PUBLIC_BASE_URL` and `CORS_ALLOWED_ORIGINS` all unset, the server answers 201 and the recovery mail's `redirectTo` is `http://localhost:5000/auth/reset-password`, with no error anywhere. A hosted deployment must set `APP_URL` or `NEXT_PUBLIC_SITE_URL` | controller `:415-439`; `S/modules/identity/identity-password.service.ts:51-60` |
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
  address. Since R0-SEC-01, neither setting is what protects existing
  accounts: bootstrap ignores a body email and never moves an existing row to
  a caller with another `sub`, so an unproven sign-up with a taken address gets
  409 `account_email_in_use`. With verification off, an unproven sign-up with a
  free address still gets its own new account under that address. A pending
  team invitation is accepted on bootstrap only with verification on (409
  `invite_email_unverified` otherwise; item 1). On adds Resend: an account, `RESEND_API_KEY`, and an
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
| **Auth rate limits.** A per-IP token bucket with capacity 30 on `/auth/v1/token` (password and refresh grants) and `/auth/v1/verify`. Supabase answers 429 when it is exhausted ([rate limits](https://supabase.com/docs/guides/auth/rate-limits)) | **A Release 0 denial-of-service risk, not only a capacity note (open defect 3).** The API server calls login, refresh and the auto-confirm sign-in (`S/modules/identity/identity-signup.service.ts:317`, `:393`), so every user of a deployment shares the server's egress-IP bucket, and one unauthenticated client can empty it. The code sends no `Sb-Forwarded-For` header (none appears in `apps/server/src`), and Supabase honours that header only with `sb_secret_…` keys and forwarding enabled. A Supabase 429 surfaces as `signin_failed` on login (`:361-364`) and as `refresh_failed` on refresh (`:409-418`), which signs the user out. Keyflow's own per-client-IP limits (`S/modules/identity/auth-security.service.ts:86-121`) are applied first, but they allow 10 logins per 15 min plus 120 refreshes per hour per client IP, which is more than the shared bucket holds |
| **Built-in SMTP.** It delivers only to the organisation's team addresses, has a low hourly cap, and has no SLA ([custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)) | It affects password recovery only, because Supabase sends that mail. Sign-up verification goes through Resend |
| **JWT signing.** Supabase calls the legacy HS256 secret "no longer recommended" and offers asymmetric signing keys ([signing keys](https://supabase.com/docs/guides/auth/signing-keys)) | With either choice, today's code falls back to `getUser` (the `verifyLocal` caveat) |

### How the real-database tests mint tokens without a project

No suite contacts Supabase. There are three patterns.

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
3. **The boundary suite** `T/identity-local-auth.integration.test.ts` runs the
   real `AuthMiddleware` (real `SupabaseAuthService`, `PrismaService` and
   Redis) in front of the real `AuthGuard` under `configureNestApp`, with a
   probe route. It mints tokens with and without `iss`, sets
   `SUPABASE_URL` to a fake host, sets no anon key, and refuses every `fetch`.
   It proves the Release 0 rule (secret empty means forged tokens get 401) and
   characterizes the acceptance path of open defect 2. Its R0-SEC-01 block
   runs the real `IdentityController` and `IdentityService` and proves the
   fix for item 1 against Postgres.

So CI proves the code after token verification only for the tokens it mints
itself, which the middleware accepts because they carry no `iss`. It does not
prove Supabase sign-up, login or refresh. It does not prove that a real hosted
token is accepted, because no test mints the hosted `iss` shape and expects
success. Bootstrap with an email that belongs to another user is covered
(R0-SEC-01), with the tokens the suite mints.

### Where the live sign-up leg runs

- Only where a Supabase project is configured: the operator-authorised staging
  run (#186 step B). The Release 0 Playwright journey (R0-25) starts at
  `/auth/signup`. Under D-02 option C it records the substitution when no
  project is configured (`docs/reconstruction/BUILD-MAP-001.md`, review
  disposition row 2).
- **Stop condition (open defect 2).** The run's server runs with
  `SUPABASE_JWT_SECRET` empty. If it does not, the run stops and reports it.
  The former condition for defect 1 (no account in the database other than
  the run's own) was lifted when R0-SEC-01 landed.
- The minimum environment for that run:
  - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`;
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`;
  - `NEXT_PUBLIC_API_BASE_URL`, and `NEXT_PUBLIC_SITE_URL` or `APP_URL`;
  - an explicit `AUTH_REQUIRE_EMAIL_VERIFICATION`, plus the Resend variables
    when it is on;
  - `SUPABASE_JWT_SECRET` empty, and `GOOGLE_STATE_SECRET` set to a random
    value;
  - `HIBP_DISABLED=true`, as Release 0 sets it, so the run makes no other
    outbound call.
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
| `POST /identity/bootstrap` | Bearer | Idempotently create the user + default business; accept a pending team invitation | 401, 400, 409 (`account_email_in_use`, `invite_email_unverified`) |
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
| `SUPABASE_JWT_SECRET` | **Leave empty for Release 0.** Meant to let the auth middleware verify tokens locally instead of round-tripping `getUser()`. With a hosted project it verifies no real token, but it still accepts any token signed with it that has no `iss` or has `iss = SUPABASE_URL` (open defect 2). It is also the fallback secret for marketing unsubscribe tokens, so set `GOOGLE_STATE_SECRET` before removing it. |
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
reuses the local `User` row with the token's `sub` or creates a fresh row
with the token's email, then ensures a default `Business` + `Membership`
exist. When a row with the same email already exists under a different id,
it answers 409 `account_email_in_use` and writes nothing. Until R0-SEC-01 it
moved that row, with its role, memberships and businesses, to the caller
(task #308, `reconcileUserId`), which was an account takeover (item 1 in the
Release 0 section). It still moves a team-invitation placeholder nobody has
signed in as, and moves its pending memberships only for a caller proven to
own the address (item 1).

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
  #308. Since R0-SEC-01 the collision answers 409 `account_email_in_use`
  (see "Moving an account to a new subject" in the Release 0 section).
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
