# FTUE (First-Time User Experience) Audit Report

**Date:** 2026-06-30  
**Branch:** `feat/key-phase-1-organ-maturation`  
**Scope:** End-to-end first-time user experience — auth/signup, onboarding wizard, Business Genesis, Business Genome gate, demo-data seeding, empty states, and command-center first-run surfaces.  
**Method:** Read-only code review across `apps/web/src/app/auth/`, `apps/web/src/app/app/onboarding/`, `apps/server/src/modules/onboarding-concierge/`, `apps/server/src/modules/business-genesis/`, `apps/server/src/modules/business-genome/`, `apps/server/src/modules/blueprint/`, and related cross-cutting services.

---

## Executive Summary

The FTUE has a polished visual shell and the backend wiring between onboarding, blueprint, and Business Genesis is largely in place. However, the activation pipeline has **critical reliability and data-consistency gaps** that will cause real first-run users to see blank pages, spinners, redirect loops, or silently skipped onboarding.

The three highest-risk areas are:

1. **Onboarding completion is fragile** — the final step hangs on API failure and product creation is non-atomic, so a partially failed completion can leave the business in an inconsistent state.
2. **The genome gate can trap or bypass users** — the client gate fails open on API errors and disagrees with the server-side exit condition, creating redirect loops or users entering the app before they are ready.
3. **The intake chat is write-only** — user answers during onboarding are not persisted to the Business or Blueprint, so later steps operate on stale or empty data.

Overall FTUE maturity: **UI/flow design ~7/10, reliability/error handling ~4/10, data consistency ~5/10, test coverage ~5/10**.

---

## FTUE Flow Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  AUTH / SIGNUP                                                               │
│  /auth/login  →  /auth/signup  →  /auth/callback  →  /app                   │
│  Issues: OAuth refresh token lost, referral code dropped, OAuth CSRF risk   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  GENOME GATE  (client-side, use-genome-gate.ts)                              │
│  Redirects to /app/onboarding if !onboardingComplete || !threePillarMet     │
│  Issues: fails open on error, re-checks every route change                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  ONBOARDING WIZARD  (/app/onboarding)                                        │
│  welcome → intake-chat → template-picker → auto-configure-review            │
│       → genome-chat → completion                                            │
│  Issues: completion hangs, optimistic state drift, no error UX,             │
│          intake answers not persisted                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  BUSINESS GENESIS  (server-side, parallel entry point)                       │
│  submitAnswers → inferFromOnboarding → syncAnswersToGenomeFacts             │
│       → generateMarketStrategy → updateBlueprint                            │
│  Issues: multi-step updates not atomic, hasEmployees inverted,              │
│          setup status duplicated in concierge                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  COMMAND CENTER  (/app/command-center)                                       │
│  Empty states + demo data seeded at completion                               │
│  Issues: empty states have no CTAs, demo invoice is unpaid (SENT)           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Critical Findings

### C1 — `autoConfigureFromTemplate` is not atomic
**Files:** `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts` (386–452), `apps/server/src/modules/catalog/catalog.service.ts`

The method wraps business-hour and metadata updates in `prisma.client.$transaction`, but product creation calls `this.catalog.createProduct(...)` which uses its own `this.prisma.client.product.create(...)` — **not** the transaction client `tx`. If the transaction rolls back, products remain orphaned and catalog events are already emitted.

**Fix:** Add an optional `tx` parameter to `CatalogService.createProduct` (and related writers) and use it from onboarding.

---

### C2 — `CompletionStep` hangs on API failure with no recovery
**File:** `apps/web/src/app/app/onboarding/components/completion-step.tsx` (15–21)

```ts
markOnboardingComplete(businessId).then(({ data }) => {
  if (data) setDemoData(data.demoData);
  setLoading(false);
});
```

There is no `.catch`. If the endpoint errors, `loading` never becomes `false` and the user is trapped on a spinner.

**Fix:** Wrap in `try/catch` or `.catch`, surface an error message, and provide a retry button.

---

### C3 — Genome gate fails open when the onboarding API errors
**File:** `apps/web/src/hooks/use-genome-gate.ts` (60–65, 84–86)

When `fetchOnboardingState` fails or returns no data, the hook sets `gateActive: false`, allowing unready users to enter `/app` routes.

**Fix:** On error/empty response keep `gateActive: true` and redirect to `/app/onboarding`; show a retry/error state instead of defaulting to open.

---

### C4 — Intake chat answers are not persisted
**Files:** `apps/web/src/app/app/onboarding/components/intake-chat-step.tsx`, `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts`

The concierge extracts template suggestions in memory but does not update `Business.businessIntent`, `archetype`, `industry`, `country`, or `BusinessBlueprint`. Later steps operate on stale or empty data.

**Fix:** Persist extracted intent to the `Business` row and the blueprint via `inferFromOnboarding` after the intake conversation.

---

### C5 — OAuth callback ignores the refresh token
**File:** `apps/web/src/app/auth/callback/page.tsx` (58–80)

The callback parses the access token but ignores `refresh_token` and `expires_in/expires_at` from the URL fragment. OAuth users will be forced to sign in again when the access token expires.

**Fix:** Parse refresh token and expiry, store via `setStoredRefreshToken()`, and schedule proactive refresh.

---

### C6 — Referral code is dropped for both email and OAuth sign-ups
**Files:** `apps/web/src/app/auth/signup/page.tsx`, `apps/web/src/app/auth/callback/page.tsx`

The sign-up page never reads `ref` query param or `kf_referral_code` from storage; the callback does not forward a referral code to `bootstrapIdentity()`.

**Fix:** Read and pass referral code through both email and OAuth sign-up flows.

---

## Major Findings

### M1 — OAuth `/authorize` calls lack a `state` nonce
**Files:** `apps/web/src/app/auth/login/login-form.tsx` (39–47), `apps/web/src/app/auth/signup/page.tsx` (37–45)

Without a `state` parameter, the OAuth flow is vulnerable to login CSRF.

**Fix:** Generate a random `state`, store it in `sessionStorage`, append it to the provider URL, and validate it in the callback.

---

### M2 — No server-side `/app/*` auth fast path
**File:** Missing `apps/web/src/middleware.ts`

The `kf_token` cookie is set but never enforced by middleware. Unauthenticated visitors may see the app shell flash before `RequireAuth` redirects them.

**Fix:** Add lightweight middleware that validates `kf_token` and redirects to `/auth/login?from=…`.

---

### M3 — `RequireAuth` renders protected pages on non-401 errors
**File:** `apps/web/src/components/require-auth.tsx` (73–83)

A 500 or network failure is treated as “authenticated”, allowing invalid sessions to render protected pages.

**Fix:** Distinguish 401 (redirect) from transient errors (show retry/error state).

---

### M4 — Genome gate and onboarding page disagree on exit conditions
**Files:** `apps/web/src/hooks/use-genome-gate.ts`, `apps/web/src/app/app/onboarding/hooks/use-onboarding.ts`

- Gate redirects **to** onboarding when `!threePillarMet || !onboardingFinished`.
- Onboarding redirects **away** when `onboardingComplete && threePillarMet`.

A user with `onboardingComplete === true` but `threePillarMet === false` can be caught in a redirect loop.

**Fix:** Use the server’s `OnboardingState` as the single source of truth; avoid re-checking on every render.

---

### M5 — Genome step completion uses wrong metric
**Files:** `apps/web/src/app/app/profile/components/blueprint-onboarding-chat.tsx` (155–157), `apps/web/src/app/app/onboarding/components/genome-chat-step.tsx`

The chat calls `onComplete()` when `completeness >= 80`, but the server `GenomeGateGuard` checks `threePillarMinimumMet` (founder ≥ 50, business ≥ 50, market ≥ 50). A user can finish the UI step and then be immediately redirected back by the gate.

**Fix:** Check `threePillarMinimumMet` from the genome-integrity endpoint before allowing completion.

---

### M6 — `autoConfigureFromTemplate` controller sends ignored `customBusinessName`
**Files:** `apps/server/src/modules/onboarding-concierge/onboarding-concierge.controller.ts` (84), `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts` (361)

The controller accepts `customBusinessName` but the service never applies it.

**Fix:** Either remove the field from the contract or implement the rename in the service.

---

### M7 — `markOnboardingComplete` has no server-side readiness validation
**File:** `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts` (991–1007)

A client or direct API call can mark onboarding complete prematurely.

**Fix:** Validate `threePillarMinimumMet` and setup percentage before setting `onboardingComplete`.

---

### M8 — Business Genesis multi-step updates are not atomic
**Files:** `apps/server/src/modules/business-genesis/business-genesis.service.ts`, `apps/server/src/modules/business-genesis/genesis-market-strategy.service.ts`

`submitAnswers` and `generateMarketStrategy` perform multiple blueprint updates and fact syncs outside a single transaction.

**Fix:** Wrap the full answer → patch → readiness → genome-sync flow in a Prisma transaction, or refactor `BlueprintService.updateBlueprint` to accept an optional `tx` client.

---

### M9 — `hasEmployees` flag is inverted in `analyzeIdea`
**File:** `apps/server/src/modules/business-genesis/business-genesis.service.ts` (264)

```ts
hasEmployees: previewBlueprint.registrationProfile?.nisEmployerStatus === 'NOT_STARTED'
```

`NOT_STARTED` means the employer registration has not started, implying the user likely does **not** have employees.

**Fix:** Use a positive employee indicator or dedicated field.

---

### M10 — FTUE controllers accept raw, unvalidated body objects
**Files:** All FTUE controllers (`onboarding-concierge.controller.ts`, `business-genesis.controller.ts`, `genome-chat.controller.ts`, etc.)

No DTOs or `ValidationPipe` are used for mutating endpoints.

**Fix:** Create `class-validator` DTOs for every mutating endpoint and enable `ValidationPipe`.

---

### M11 — `OnboardingConciergeService` has no unit tests
**File:** Missing `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.spec.ts`

The service is ~1,035 lines of business logic and is the largest untested FTUE surface.

**Fix:** Add a spec covering `getSetupStatus`, `autoConfigureFromTemplate`, `generateConciergeResponse`, and nudge logic.

---

### M12 — Demo data seeder has hardcoded values and non-atomic invoice numbering
**File:** `apps/server/src/modules/onboarding-concierge/demo-data-seeder.service.ts`

Hardcoded `TTD`, `sample-client@example.com`, and invoice-number generation reads `findFirst(orderBy: createdAt desc)` then increments, which can produce duplicates under concurrency.

**Fix:** Use business currency; make invoice numbering atomic (counter row or CUID suffix).

---

### M13 — Command center empty states lack guidance
**File:** `apps/web/src/app/app/command-center/page.tsx`

Every section renders plain text such as “No top priorities right now.” with no CTAs.

**Fix:** Use `EmptyState` components with primary actions (e.g., “Set up your first product”, “Continue onboarding”).

---

### M14 — Concierge nudge API has no frontend consumer
**Files:** `apps/web/src/lib/client.ts` (nudges API), `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts` (`checkAndGenerateNudges`)

The server builds nudges but no component calls `fetchConciergeNudges`.

**Fix:** Add a `NudgePanel` or `NudgeBanner` to the command center/header.

---

### M15 — Genesis onboarding components are unused dead code
**Files:** `apps/web/src/app/app/onboarding/components/Genesis*.tsx`, `IdeaInput.tsx`, `LegalDisclaimerModal.tsx`

A full Genesis UI exists but the current wizard imports only six steps. `GenesisConversation` is not wired in.

**Fix:** Either integrate `GenesisConversation` into the genome step or remove the unused components.

---

## Minor Findings

| # | Issue | File(s) | Recommended Fix |
|---|-------|---------|-----------------|
| m1 | Dev credentials banner visible in non-production builds | `apps/web/src/app/auth/login/page.tsx` | Guard with explicit dev-only env var |
| m2 | Dead auth test pages publicly accessible | `apps/web/src/app/auth/test/*.tsx` | Delete or guard behind `NODE_ENV === 'development'` |
| m3 | Username availability check returns `true` on error | `apps/web/src/app/auth/signup/page.tsx` | Treat errors as indeterminate |
| m4 | Password-reset client validation weaker than server | `apps/web/src/app/auth/reset-password/page.tsx` | Align rules with server policy |
| m5 | `useGenomeGate` re-fetches on every route change | `apps/web/src/hooks/use-genome-gate.ts` | Add SWR/cache with short TTL |
| m6 | `useGenomeGate` includes unused `genomeIntegrity`/`genesisCompleted` state | `apps/web/src/hooks/use-genome-gate.ts` | Remove or wire to real data |
| m7 | Mobile bottom nav uses non-functional anchors (`#flows`, `#key`, `#me`) | `apps/web/src/lib/nav-config.ts` | Replace with real routes or remove |
| m8 | Hardcoded TTD / Trinidad assumptions across FTUE | `industry-templates.ts`, `demo-data-seeder.service.ts`, UI copy | Derive from `Business.currency`/`country` |
| m9 | `/app` root always redirects to command center | `apps/web/src/app/app/page.tsx` | Check onboarding state first |
| m10 | `useAppLayout` reads `onboardingComplete` but discards it | `apps/web/src/hooks/use-app-layout.ts` (291) | Implement redirect or remove fetch |
| m11 | `detect-type` endpoint ignores `businessId` | `apps/server/src/modules/onboarding-concierge/onboarding-concierge.controller.ts` (90–94) | Pass `businessId` to detection logic |
| m12 | `MarketStrategyRepository` uses `createManyAndReturn` | `apps/server/src/modules/business-genesis/market-strategy.repository.ts` | Verify Prisma compatibility |
| m13 | Seed script only seeds 2 templates while concierge offers 6 | `packages/db/prisma/seed.ts` | Align seed with concierge templates |
| m14 | `prisma.seed` key missing from `packages/db/package.json` | `packages/db/package.json` | Add `prisma.seed` config |
| m15 | `GenomeChatService` rate limiter is in-memory only | `apps/server/src/modules/business-genesis/genome-chat.service.ts` | Move to Redis |

---

## Recommended Fix Priority

### P0 — Ship blockers
1. Make `autoConfigureFromTemplate` atomic (pass `tx` to catalog writers).
2. Add error handling + retry to `CompletionStep`.
3. Harden genome gate so it fails closed on API errors.
4. Persist intake-chat answers to `Business` + `BusinessBlueprint`.
5. Store OAuth refresh token and expiry in the callback.
6. Forward referral code through sign-up and OAuth flows.

### P1 — High impact
7. Add `state` nonce to OAuth authorize calls.
8. Add server-side `/app/*` auth middleware.
9. Fix `RequireAuth` error handling.
10. Unify genome gate exit condition with onboarding page.
11. Drive genome-step completion from `threePillarMinimumMet`.
12. Add input validation DTOs to all FTUE controllers.
13. Add unit tests for `OnboardingConciergeService`.
14. Make Business Genesis updates atomic.
15. Fix inverted `hasEmployees` logic.
16. Validate `threePillarMinimumMet` in `markOnboardingComplete`.

### P2 — Medium impact
17. Improve command-center empty states with CTAs.
18. Build a UI consumer for concierge nudges.
19. Integrate or remove unused Genesis components.
20. Make demo invoice numbering atomic and use business currency.
21. Cache or lighten `GenomeGateGuard` checks.
22. Remove circular dependency between `OnboardingConciergeService` and `OnboardingStateService`.

### P3 — Polish
23. Localize currency/country assumptions.
24. Add Swagger decorators to FTUE endpoints.
25. Clean up dead test pages and dev-credentials banner.
26. Add `prisma.seed` config and align seed data.

---

## Files Audited

### Web
- `apps/web/src/app/auth/login/page.tsx`
- `apps/web/src/app/auth/login/login-form.tsx`
- `apps/web/src/app/auth/signup/page.tsx`
- `apps/web/src/app/auth/callback/page.tsx`
- `apps/web/src/app/auth/reset-password/page.tsx`
- `apps/web/src/app/auth/test/*.tsx`
- `apps/web/src/app/app/page.tsx`
- `apps/web/src/app/app/layout.tsx`
- `apps/web/src/app/app/command-center/page.tsx`
- `apps/web/src/app/app/onboarding/page.tsx`
- `apps/web/src/app/app/onboarding/hooks/use-onboarding.ts`
- `apps/web/src/app/app/onboarding/components/*.tsx`
- `apps/web/src/app/app/profile/components/blueprint-onboarding-chat.tsx`
- `apps/web/src/app/app/profile/components/business-genome-tab.tsx`
- `apps/web/src/components/require-auth.tsx`
- `apps/web/src/hooks/use-genome-gate.ts`
- `apps/web/src/hooks/use-app-layout.ts`
- `apps/web/src/lib/client.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/lib/api-base.ts`
- `apps/web/src/lib/workspace.ts`
- `apps/web/src/lib/api/onboarding-concierge.ts`
- `apps/web/src/lib/api/business-genesis.ts`
- `apps/web/src/lib/api/business-genome.ts`
- `apps/web/src/lib/nav-config.ts`
- `apps/web/src/lib/semantic-routes.ts`

### Server
- `apps/server/src/core/auth/auth.middleware.ts`
- `apps/server/src/core/auth/auth.guard.ts`
- `apps/server/src/core/auth/optional-auth.guard.ts`
- `apps/server/src/core/auth/business.guard.ts`
- `apps/server/src/core/auth/genome-gate.guard.ts`
- `apps/server/src/core/auth/supabase-auth.service.ts`
- `apps/server/src/modules/identity/identity.service.ts`
- `apps/server/src/modules/identity/identity-signup.service.ts`
- `apps/server/src/modules/identity/dto/*.ts`
- `apps/server/src/modules/onboarding-concierge/*.ts`
- `apps/server/src/modules/business-genesis/*.ts`
- `apps/server/src/modules/business-genome/key-genome/*.ts`
- `apps/server/src/modules/blueprint/*.ts`
- `apps/server/src/modules/catalog/catalog.service.ts`
- `apps/server/src/modules/business-command-center/business-command-center.service.ts`

### Database / Seed
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/seed.ts`
- `packages/db/package.json`

---

## Conclusion

The FTUE surface is visually complete but operationally fragile. Before this branch ships, the P0 items — atomic auto-configuration, completion-step error handling, genome gate hardening, intake persistence, and OAuth token/referral handling — should be fixed. These changes will eliminate the most common first-run failure modes (spinners, redirect loops, dropped sessions, and silently incomplete businesses) and provide a solid foundation for the P1/P2 polish work.
