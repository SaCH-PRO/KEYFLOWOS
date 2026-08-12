# Security / Tenant Isolation / Privacy Audit — KEYFLOWOS

**Scope:** Authentication, authorization, session/cookie management, OAuth/PKCE, token handling, tenant isolation in Prisma/extensions/controllers/WebSocket/background jobs, GDPR contact erasure, audit/PII logging, and object-storage privacy.

**Date:** 2026-08-09

**Source:** Combined output of four parallel subagent audits covering `apps/server/src`, `apps/web/src`, `packages/db/prisma/schema.prisma`, and related migration files.

---

## Executive Summary

- **Plaintext token storage is the single biggest blast-radius issue.** OAuth, social, channel, and bank-feed tokens are stored as plaintext `String` columns; a database dump or compromised replica gives attackers access to email, drive, calendar, contacts, social accounts, and live bank feeds.
- **Supabase token verification is purely local and ignores revocation.** A stolen or revoked access token remains usable until expiry, and there is no `bannedAt`/`status` check on the local user record.
- **Tenant isolation is both incomplete and bypassable.** Only 77 of 337 `businessId`-bearing tables are intercepted, `create`/`upsert` are never scoped, and WebSocket approval handlers plus `TemporalFlowMemory` updates are cross-tenant by design.
- **GDPR contact erasure fails or leaks data.** The hard-purge aborts on financial child records, leaves snapshots in `BusinessEvent`, leaves files in S3, and leaves PII in SET-NULL child tables.
- **Admin surface and privileged actions are under-gated.** `/admin/*` is not protected by edge middleware, Keystore admin endpoints and API-key management allow any business member, and password reset/change bypass backend controls entirely.

## Mitigations Already Applied (2026-08-09)

- **User-state checks in `AuthMiddleware`.** Added `deleted_at`/`banned_at` columns to `User`; `AuthMiddleware` now rejects tokens for deleted, banned, or Redis-revoked users. `SupabaseAuthService` rejects `banned_at` users in the fallback round-trip.
- **Server-side logout.** Added `POST /identity/logout` which calls `SupabaseAdminService.signOut(userId, 'global')`, sets a 24-hour Redis revocation marker, and is invoked from the frontend `handleLogout`.
- **Local JWT claim validation.** `SupabaseAuthService.verifyLocal` now validates `alg === 'HS256'`, `iss`, `aud`, `nbf`, and future-`iat`.
- **PII logging reduction.** `AuthMiddleware` no longer logs user email; only `userId` is emitted.

---

## Critical — Fix Immediately

| Title | Impact | Evidence | Fix |
|-------|--------|----------|-----|
| OAuth, bank, social, and channel tokens stored in plaintext at rest | DB compromise grants full read/write access to Gmail, Drive, Calendar, Contacts, Outlook, social accounts, and bank feeds. | `packages/db/prisma/schema.prisma:506-565`, `3823-3824`, `3874-3875`, `10061`; `apps/server/src/core/connectors/google-suite.service.ts:193-196`; `apps/server/src/modules/connect/microsoft-oauth.service.ts:108-116`; `apps/server/src/modules/social/social-connections.service.ts:61-113`; `apps/server/src/modules/finance/bank-connection.service.ts:68-69`. | Encrypt all token columns using existing AES-256-GCM utilities; backfill plaintext rows; decrypt only at the service boundary. |
| Supabase JWT local verification bypasses revocation and user state | Stolen/revoked tokens and banned/deleted users remain valid until expiry. | `apps/server/src/core/auth/supabase-auth.service.ts:101-120`; `apps/server/src/core/auth/auth.middleware.ts:88-104`; `packages/db/prisma/schema.prisma:101-130`. | Remove local verification or add a Redis revocation cache; add `bannedAt`/`status` column and check it in `AuthMiddleware`. |
| Password reset and change flows are client-side against Supabase | Anon key exposed in bundle; bypasses rate limits, audit, and server password policy. | `apps/web/src/app/auth/login/login-form.tsx:33-34, 53-64`; `apps/web/src/app/auth/reset-password/page.tsx:13-17`; `apps/web/src/app/app/profile/components/security-section.tsx:79-105`; `apps/server/src/modules/identity/password-policy.service.ts`. | Move flows to backend endpoints that apply `AuthSecurityService`, `AuthAuditLog`, and `PasswordPolicyService`. |
| Admin console routes have no server-side gate | `/admin/*` HTML/structure leaks; admin API routes reachable without credentials unless each route re-checks. | `apps/web/src/middleware.ts:143-145`; `apps/web/src/app/admin/layout.tsx:40-62`. | Extend middleware matcher to `/admin/:path*`; add server-side admin auth check in `admin/layout.tsx`. |
| WebSocket approval/execution handlers are cross-tenant | Business A member can approve/execute AI autonomy proposals in Business B. | `apps/server/src/modules/key-cortex/key-cortex.gateway.ts:308-347`; `apps/server/src/modules/key-cortex/key-cortex-approval.service.ts:81-98`; `apps/server/src/modules/key-autonomy/key-action-proposal.service.ts:110-116`; `packages/db/src/client.ts:81-153`. | Pass and validate `clientInfo.businessId` against proposal; add `KeyActionProposal` to `BUSINESS_ID_MODELS`; remove unscoped `getById`. |
| Tenant isolation extension covers only ~23% of business-scoped tables | 260 unlisted models pass through unscoped whenever a developer relies on the extension. | `packages/db/src/client.ts:81-153`; schema scan of `packages/db/prisma/schema.prisma` (337 models with `businessId String`). | Generate `BUSINESS_ID_MODELS` from schema; backfill high-risk tables (`KeyActionProposal`, `Payment`, `MarketplaceOrder`, `ApiKey`, `Membership`, `Webhook`). |
| GDPR hard-purge fails for contacts with financial child records | Contact PII retained indefinitely when invoices/quotes/bookings/recurring invoices exist. | `apps/server/src/modules/crm/privacy/contact-privacy.service.ts:448-523`; migration FKs `ON DELETE NO ACTION` at `migration.sql:10481`, `10496`, `10532`, `10745`. | Delete/anonymize financial rows before `tx.contact.delete()`; test all four child types. |
| GDPR purge leaves full PII snapshots in `BusinessEvent` | Erased contact data recoverable from JSON snapshots. | `apps/server/src/modules/business-events/business-event.service.ts:24-60`; `apps/server/src/modules/key-autonomy/action-audit.service.ts:81-113`; `apps/server/src/modules/key-cortex/key-cortex-audit.service.ts:26-55`; `apps/server/src/modules/business-events/business-event.interceptor.ts:94-99`. | Scrub `BusinessEvent` by subject/contact id during purge, or route all writes through `safeRedactedSnapshot()`. |
| Contact media files survive erasure | Photos, IDs, voice recordings remain in S3 after contact purge. | `packages/db/prisma/schema.prisma:11191-11215`, `3299-3313`; `migration.sql:10460`; `apps/server/src/modules/crm/privacy/contact-privacy.service.ts:448-523`. | Delete `MediaAsset`/`ContactMedia` rows and their S3 objects before deleting the contact. |
| SET-NULL child tables retain PII after purge | `message_intakes`, `ingestion_items`, `whatsapp_contacts`, `support_tickets`, `financial_transactions` keep PII with nulled `contactId`. | Migration FKs `ON DELETE SET NULL` at `migration.sql:10292`, `10301`, `10583`, `10655`, `11384`; `apps/server/src/modules/crm/privacy/contact-privacy.service.ts:448-523`. | Delete or anonymize these rows as part of `purgeOne`. |

---

## High — Next Planning Cycle

| Title | Impact | Evidence | Fix |
|-------|--------|----------|-----|
| Google/Microsoft OAuth flows omit PKCE | Intercepted authorization codes can be exchanged for long-lived refresh tokens. | `apps/server/src/core/connectors/google-suite.service.ts:109-127`; `apps/server/src/modules/connect/microsoft-oauth.service.ts:43-58`. | Add `code_challenge_method=S256` + `code_challenge`; store `code_verifier` keyed by signed state. |
| Keystore admin endpoints allow any business member | Staff can manage listings/orders and impersonate the business. | `apps/server/src/modules/keystore/keystore-admin.controller.ts:28-30` and admin endpoints lines 35, 42, 56, 64, 79, 94, 111, 119, 128, 144. | Add `ModuleScopeGuard`/`@RequireModuleScope('storefront','admin')` or restrict to OWNER/ADMIN. |
| API keys can be created/revoked by any business member | Staff can mint full-scope credentials and revoke admin keys. | `apps/server/src/modules/api-keys/api-keys.controller.ts:10-34`. | Restrict to OWNER/ADMIN and/or scope requested scopes to caller's own scopes. |
| Regular user logout does not invalidate server-side sessions | Stolen refresh tokens remain usable indefinitely after logout. | `apps/web/src/hooks/use-app-layout.ts:373-376`; `apps/web/src/lib/workspace.ts:259-271`. | Add `POST /identity/logout` calling Supabase Admin `signOut(userId,'global')`. |
| Admin auth has no logout flow/cookie clearing | 24-hour admin cookies persist with no user-visible termination. | `apps/web/src/app/admin/login/page.tsx:43-50`; no callers to `POST /api/admin/auth/logout` in `apps/web/src`. | Add admin logout UI calling backend logout and clearing storage/cookies. |
| Session cookies are non-HttpOnly, JS-accessible, and long-lived | XSS can steal access and refresh tokens. | `apps/web/src/lib/workspace.ts:11, 18-27`; `apps/web/src/app/admin/login/page.tsx:48`; refresh token in `localStorage`. | Move to HttpOnly Secure SameSite=Lax server-set cookies; remove refresh token from `localStorage`. |
| Local JWT verification ignores standard claims | Cross-environment replay and algorithm-swap risk. | `apps/server/src/core/auth/supabase-auth.service.ts:41-77`. | Validate `alg`, `iss`, `aud`, `iat`, `nbf`. |
| `TemporalFlowMemory.updateMemory` is cross-tenant | AI memory/context for one tenant can be poisoned by another. | `apps/server/src/modules/temporal-flow/temporal-flow-memory.service.ts:130-150`; `apps/server/src/modules/key-cortex/adapters/temporal-adapter.service.ts:58-89`; `packages/db/src/client.ts:81-153`. | Enforce `businessId` in service; add `TemporalFlowMemory` to `BUSINESS_ID_MODELS`. |
| `ContactAuditEntry` retains IP/UA/actor email after GDPR purge | Erasure leaves device/network identifiers and staff emails. | `apps/server/src/modules/crm/privacy/contact-privacy.service.ts:471-480`; `apps/server/src/modules/crm/privacy/contact-privacy.controller.ts:81-82, 125-127`. | Null `ip`/`userAgent`; store only stable actor user id. |
| Contact export can access soft-deleted/forget-pending contacts | CRM write user can recover data that should be inaccessible. | `apps/server/src/modules/crm/privacy/contact-privacy.service.ts:539-560` (line 543); `apps/server/src/modules/crm/privacy/contact-privacy.controller.ts:69-87`. | Reject export if `contact.deletedAt != null`; redact audit snapshots in bundle. |
| Service-side audit/event writes bypass secret redaction | Secrets/PII persisted verbatim in `BusinessEvent`. | `apps/server/src/core/security/redaction.ts:13-76`; `apps/server/src/modules/key-autonomy/action-audit.service.ts:89-108`; `apps/server/src/modules/key-cortex/key-cortex-audit.service.ts:26-55`; `apps/server/src/modules/business-events/business-event.interceptor.ts:30-92`. | Apply `safeRedactedSnapshot()` inside `BusinessEventService.emit()` and `ContactAuditService.write()`. |
| AI execution logs store raw tool payloads without redaction | Secrets/PII in AI tool args/results persisted. | `apps/server/src/modules/ai/ai-execution-log.service.ts:82-101`, `169-180`. | Run payloads through `deepRedact()` before storing. |
| No retention cleanup for export jobs, notification logs, activity logs, or sessions | PII accumulates indefinitely; stale export bundles remain in S3. | `apps/server/src/modules/crm/privacy/contact-privacy.service.ts:188-200`; `apps/server/src/modules/notifications/transactional-email.service.ts:262-293`; `apps/server/src/core/interceptors/team-audit.interceptor.ts:44`; `apps/server/src/modules/risc/risc.service.ts:318, 371`. | Add cron retention worker with configurable windows and S3 cleanup. |
| Security audit env-secrets check is broken | Service-role key misconfigurations never flagged. | `apps/server/src/modules/security-audit/security-audit.service.ts:119-126`. | Correct the ternary to evaluate key length/environment. |
| Hardcoded dev password and native-AI fallback key in source | Accidental activation; credential-scanning alerts. | `apps/server/src/core/seed/seed.service.ts:58`; `apps/server/src/modules/ai/model-gateway.service.ts:1452, 2423`. | Randomize dev password; remove `'native-key'` fallback. |
| Admin local-auth JWT is non-standard | Millisecond `exp`, no `iss`/`aud`; replay risk if secret shared. | `apps/server/src/core/auth/admin-token.util.ts:65-82`. | Use seconds-based `exp` plus `iss`/`aud` and validate them. |
| RISC receiver is not registered with Google | Account-disabled/hijacking events never delivered. | `apps/server/src/modules/risc/risc.controller.ts`; `apps/server/src/modules/risc/risc.service.ts`. | Add boot-time registration via Google's RISC Configuration Admin API. |
| `AuthMiddleware` DI fallback bypasses lifecycle | Fallback verifier may behave differently than the injected service. | `apps/server/src/core/auth/auth.middleware.ts:37-46`. | Remove fallback; fail fast at boot; add DI integration test. |

---

## Medium / Low — Track

### Medium

- **Social OAuth flows use in-memory sessions and lack PKCE** (`apps/server/src/modules/social/social.controller.ts:351-377`, `social-connections.service.ts:14`). Use signed state, Redis-backed sessions, and PKCE for all providers.
- **Google/Microsoft OAuth state uses `Math.random()`** (`google-suite.service.ts:112`, `microsoft-oauth.service.ts:45`). Replace with `randomBytes`/`randomUUID`.
- **`PublicRateLimitGuard` fail-open on Redis pipeline errors** (`public-rate-limit.guard.ts:42`). Port the error-inspection fix from `RateLimitGuard`.
- **`fetchWithAuthRetry` does not emit global logout on final 401** (`apps/web/src/lib/api.ts:297-315`). Emit `kf:unauthorized` when refresh fails.
- **`AuthMiddleware` swallows invalid bearer tokens** (`auth.middleware.ts:60-86`). Distinguish "no token" from "bad token" and log invalid attempts at `warn`.
- **`TenantInterceptor` trusts body/query `businessId`** (`tenant.interceptor.ts:16`, `business.guard.ts:21`). Derive tenant only from URL params or require `BusinessGuard` everywhere.
- **`KeyCortexApprovalOrchestrator` unscoped audit read** (`key-cortex-approval-orchestrator.service.ts:201-241`). Use scoped `get(businessId, proposalId)` for the pre-execution snapshot.
- **Public contact-export download lacks rate limiting** (`contact-privacy.controller.ts:89-107`). Apply `PublicRateLimitGuard`.
- **`ConsentRecord` can accumulate duplicates** (`consent.service.ts:26-50`, `schema.prisma:11155-11171`). Add unique constraint and upsert.
- **Transactional email ignores soft-deleted contacts** (`transactional-email.service.ts:327-344`). Add `deletedAt: null` gate.
- **Forget request/cancel conflates normal delete with forget flow** (`contact-privacy.service.ts:298-409`). Track deletion source and restrict restoration/export.
- **`AuthMiddleware` logs user email** (`auth.middleware.ts:65-76`). Log only user id.
- **Object storage uploads lack explicit private ACL/encryption** (`objectStorage.ts:284-288, 307-314`; `contact-privacy.service.ts:170-186`). Add `ACL: 'private'` and `ServerSideEncryption`.

### Low

- **Invalid bearer tokens logged only at debug** (`auth.middleware.ts:81-85`) — also tracked by the Medium finding above.
- **tRPC context reads `req.business` which is never set** (`apps/server/src/trpc.module.ts:22-31`).
- **Username availability endpoint enables enumeration** (`apps/server/src/modules/identity/identity.controller.ts:309-326`).
- **Post-login redirect strips query/hash** (`apps/web/src/lib/safe-redirect.ts:8-31`; `apps/web/src/middleware.ts:134-136`).
- **Misplaced JSDoc / stale expiry cleanup in workspace storage** (`apps/web/src/lib/workspace.ts:165-174, 259-271`).
- **`ContactForgetRequest` retains `reason` and `requestedById` after purge** (`contact-privacy.service.ts:494-502`; `schema.prisma:9332-9357`).
- **`undoContact` uses unscoped contact lookup** (`apps/server/src/modules/crm/crm.service.ts:884-919`).
- **Contact audit `actorId` filter uses unindexed JSON path** (`apps/server/src/modules/crm/privacy/contact-audit.service.ts:198-200`).

---

## Recommended Remediation Order

1. **Encrypt all OAuth/social/channel/bank tokens at rest** (R16) — reduces blast radius of any future DB compromise.
2. **Fix Supabase revocation and user-state checks** (R17) — closes the stolen/banned-token window.
3. **Gate `/admin/*` server-side** (R19) — protects the highest-privilege surface.
4. **Fix WebSocket cross-tenant approval/execution** (R20) — active cross-tenant data-corruption path.
5. **Generate/expand `BUSINESS_ID_MODELS` and scope unscoped queries** (R21, R3, R4, R33, R50) — address the root cause behind most tenant-isolation bugs.
6. **Make GDPR hard-purge complete** (R22–R25) — required for compliance and removes retained PII.
7. **Move password reset/change to backend controls** (R18) — closes anon-key exposure and audit gap.
8. **Harden session lifecycle and cookies** (R29–R31) — limits XSS and shared-device exposure.
9. **Enforce role/scope on privileged endpoints** (R27–R28) — reduces privilege-escalation surface.
10. **Add PKCE and secure OAuth state** (R26, R44, R45) — hardens the connector attack surface.

---

## What Is NOT In Scope

- Infrastructure/network-level security (firewalls, VPCs, TLS termination, CDN/WAF rules) unless explicitly surfaced in code-level findings.
- Runtime environment hardening (OS patches, container scanning, secrets-manager rotation policies).
- Third-party provider security posture beyond how KEYFLOWOS integrates them.
- Deep audit of `apps/voice-agent` (LiveKit/OpenAI Realtime worker) or native mobile clients.
- Active penetration testing or fuzzing; this was a source-review-only audit.
