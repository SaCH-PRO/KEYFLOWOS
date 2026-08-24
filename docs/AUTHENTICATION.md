# Authentication — how it is built and what holds it up

Every figure here was read out of the source or measured against a running
server on 2026-08-24. Where something is *not* done, it says so — a document
that only lists strengths is a document you cannot use to find the next problem.

---

## 1. The parts, and who owns what

| System | Role | Where it is configured |
|---|---|---|
| **Supabase Auth** | The identity store. Owns the user record, hashes the password, issues and signs the JWTs, sends the recovery mail. | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` |
| **This server (Nest)** | The policy layer. Rate limits, audits, enforces the password rules, owns the local `User` / `Business` / `Membership` rows. | `apps/server/src/modules/identity/`, `apps/server/src/core/auth/` |
| **Postgres** | `auth_audit_logs` (the ledger), the rate-limit buckets, and the local user/business tables. | `DATABASE_URL` |
| **Redis** | Token revocation on logout. | `REDIS_URL` |
| **Resend** | Delivers the **signup verification** email. | `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS` |
| **Pwned Passwords (HIBP)** | Breach check on new passwords, by k-anonymity — only the first 5 characters of the SHA-1 leave this server. | `HIBP_THRESHOLD` (default 100), `HIBP_DISABLED` |
| **Browser** | Holds the tokens: `localStorage` for fetch headers, plus a `kf_token` cookie so Next's edge middleware can gate routes without reading localStorage. | — |

**The division that matters:** Supabase decides *who you are*. This server decides
*what is allowed* — how often you may try, what a password must be, and what gets
written down. Any flow that skips the server skips all three.

---

## 2. How a request becomes authenticated

`AuthMiddleware` runs on **every** route (`forRoutes('*')` in `app.module.ts`),
before any guard:

1. Pull `Authorization: Bearer <token>`. Absent → nothing happens, `req.user` stays unset.
2. `SupabaseAuthService.getUserFromToken()`:
   - **Local HS256 verification** against `SUPABASE_JWT_SECRET`. Fast, offline.
   - **Falls back** to a network call to `supabase.auth.getUser()` when that secret is missing or wrong.
3. Reject if the local user row is **deleted**, **banned**, or if Redis holds `auth:revoked:user:<id>`.
4. On success, set `req.user = { id, email, role }`.

`AuthGuard` then does one thing: throw `401` unless `req.user` exists. All the
real work happened in the middleware.

> **A wrong `SUPABASE_JWT_SECRET` fails quietly, not loudly.** The signature check
> fails, returns null, and every request silently becomes a network round-trip to
> Supabase. Auth still works; it just gets slower and dependent on their uptime.
> It fails *closed* — it can only reject tokens, never accept forged ones.

**There is no global auth guard.** A new route is **public by default**, and
forgetting `@UseGuards` produces no error and a working endpoint. That is why
[`public-surface.spec.ts`](../apps/server/src/core/auth/public-surface.spec.ts)
exists: it is a shrink-only ledger of every unauthenticated handler, and it fails
the build when an unacknowledged one appears.

---

## 3. The flows

### Signup — `POST /identity/signup`

```
browser → server            rate limit: 5/hr per IP, 3/hr per email
        → PasswordPolicy    ≥12 chars, not a common password, not in the HIBP corpus
        → Supabase admin    createUser
        → Resend            verification email  (only when verification is on)
        → audit             event=signup
```

Returns `authenticated` **or** `verification_sent`, depending on
`AUTH_REQUIRE_EMAIL_VERIFICATION` (forced on when `NODE_ENV=production`).

### Bootstrap — `POST /identity/bootstrap` *(AuthGuard)*

**Signup does not create the local user.** It creates the Supabase identity and
returns a token; the client must then call `bootstrap` to create the `User`,
`Business` and `Membership` rows.

> Skip this step and the account looks perfectly signed-in while `GET /identity/me`
> returns **404 User not found** — verified, not theorised.

### Login — `POST /identity/login`

Rate limited 10/15min per IP, 8/15min per email. Every attempt audited, success
and failure. Proxied through the server specifically so the Supabase URL and key
stay off the client.

### Logout — `POST /identity/logout` *(AuthGuard)*

Two things, because one is not enough:
1. `supabaseAdmin.signOut(userId, 'global')` — kills the refresh tokens.
2. `SETEX auth:revoked:user:<id> 86400` in Redis — kills **already-issued access
   tokens**, which are self-contained JWTs that Supabase cannot recall. Read back
   by `auth.middleware.ts:145`.

### Password recovery — `POST /identity/forgot-password` → `POST /identity/reset-password`

Both are **necessarily unauthenticated** — the premise is a user who cannot sign
in — so the controls stand in for a guard:

| Control | Detail |
|---|---|
| Rate limit | 8/hr per IP, 4/hr per email; completion 10/hr per IP |
| No enumeration | **Byte-identical response** for known and unknown addresses, including when Supabase errors |
| Redirect allowlist | Target must be a configured origin. The link carries a session in its fragment, so an open redirect here hands over the account |
| Token first | The recovery token is verified **before** the policy runs — reversed, the endpoint becomes an oracle for which passwords are accepted, and a trigger for outbound HIBP lookups |
| Same policy as signup | `PasswordPolicyService`, breach check included |
| Session sweep | Every other session dropped on success — recovery is what you do when you think you are compromised |
| Audit | `password_reset_requested`, `password_reset_completed` |

Recovery mail is sent by **Supabase**, not Resend, because the token in that link
is Supabase's. Minting our own would mean owning its expiry, revocation and
replay semantics.

---

## 4. Rate limits, in one place

Sliding window, backed by Postgres. Exceeding one returns **429** and writes a
`rate_limited` audit row.

| Rule | Limit | Window |
|---|---|---|
| `LOGIN_IP` / `LOGIN_EMAIL` | 10 / 8 | 15 min |
| `SIGNUP_IP` / `SIGNUP_EMAIL` | 5 / 3 | 1 hr |
| `RESEND_IP` / `RESEND_EMAIL` | 10 / 5 | 1 hr |
| `FORGOT_IP` / `FORGOT_EMAIL` | 8 / 4 | 1 hr |
| `RESET_IP` | 10 | 1 hr |

The client IP comes **exclusively** from `req.ip`, so the `TRUST_PROXY` setting in
`app-bootstrap.ts` is the single place that decides how many `x-forwarded-for`
hops are honoured. Parsing XFF anywhere else would let an attacker spoof their way
around every limit above.

---

## 5. The audit ledger

`auth_audit_logs`, readable by super-admins at `GET /identity/admin/auth-audit`.

`signup` · `login_success` · `login_failure` · `logout` · `resend_verification` ·
`rate_limited` · `password_reset_requested` · `password_reset_completed`

Writes are **logged and swallowed** on failure, deliberately: the ledger must never
be able to take auth down.

---

## 6. What is NOT hardened

Stated plainly, because these are the next things to look at.

**Token refresh still goes browser → Supabase directly.**
`workspace.ts` calls `/auth/v1/token?grant_type=refresh_token`. It never crosses
this server, so it is not rate limited or audited by us. Lower risk than recovery
was — it exchanges a token rather than changing a credential — but it is the same
shape as the gap this document was written after closing.

**Google OAuth is browser → Supabase directly** (`/auth/v1/authorize`), same
consequence.

**No MFA / TOTP**, and no step-up for sensitive actions.

**No account lockout.** Rate limiting slows an attacker per IP and per email; it
does not lock an account after N failures.

**Password changes for a signed-in user have no endpoint.** Only recovery can
change a password.

**Recovery emails are Supabase's templates**, so they do not match the branded
Resend mail used for verification.

---

## 7. Verifying any of this yourself

```bash
# Do the keys actually belong together? Supabase signs anon and service_role
# with the JWT secret, so all three can be checked offline. Prints role + ref
# and whether each signature verifies. Never prints a key.
node scripts/auth-audit/verify-supabase-keys.mjs

# Enumeration: these two must return byte-identical bodies
curl -sX POST localhost:3001/identity/forgot-password -H 'Content-Type: application/json' -d '{"email":"real@user.test"}'
curl -sX POST localhost:3001/identity/forgot-password -H 'Content-Type: application/json' -d '{"email":"nobody@nowhere.test"}'

# Open redirect: must be refused
curl -sX POST localhost:3001/identity/forgot-password -H 'Content-Type: application/json' \
  -d '{"email":"a@b.test","redirectTo":"https://evil.example.com"}'

# The ledger
docker exec keyflowos-db-1 psql -U keyflow -d keyflow -tAc \
  "select event, outcome, email from auth_audit_logs order by created_at desc limit 10;"
```

**The gates that fail the build if this drifts:**

- `apps/server/src/core/auth/public-surface.spec.ts` — an unacknowledged unauthenticated handler
- `apps/server/src/modules/identity/identity-password.service.spec.ts` — recovery ordering, policy parity, session sweep
- `apps/server/src/core/config/env-documented.spec.ts` — a config variable read but never written down

A test that only passes is a report. These fail when a number moves the wrong
way, which is the only kind that survives contact with a busy week.
