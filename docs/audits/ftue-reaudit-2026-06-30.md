# FTUE Re-Audit Report (Latest)

**Date:** 2026-06-30  
**Branch:** `feat/key-phase-1-organ-maturation`  
**Scope:** Verify fixes applied since previous re-audit and identify remaining open issues.

---

## Summary

All four remaining P0 blockers from the previous re-audit have now been fixed. The FTUE critical path is now significantly more robust:

- `markOnboardingComplete` validates the three-pillar minimum server-side.
- `TemplatePickerStep` inspects the auto-configure result and surfaces errors.
- Intake chat answers are now persisted to `Business` and `BusinessBlueprint`.
- `hasEmployees` logic in Business Genesis is now correct.

**No P0 ship blockers remain.** The remaining issues are P1/P2 polish and operational hardening.

---

## Verified Fixes Since Previous Re-Audit

| Previous Finding | Status | Evidence |
|---|---|---|
| **RC1 — `markOnboardingComplete` no server-side validation** | ✅ Fixed | Service now calls `calculateGenomeIntegrity` and throws `ForbiddenException` with `GENOME_GATE_BLOCKED` if `!threePillarMinimumMet`. |
| **RC2 — `TemplatePickerStep` advances on failure** | ✅ Fixed | Step now inspects `{ data, error }`, shows an inline error, and only calls `onComplete()` on success. "Skip" path preserved. |
| **RC3 — Intake chat answers not persisted** | ✅ Fixed | `OnboardingConciergeService.generateConciergeResponse` now calls `persistIntakeAnswers`, which updates the `Business` row and calls `blueprint.inferFromOnboarding`. |
| **RC4 — `hasEmployees` inverted** | ✅ Fixed | Logic now reads `status !== undefined && status !== 'NOT_NEEDED'`, correctly treating `NOT_NEEDED` as "no employees". |

---

## Remaining Issues (No P0 Blockers)

### P1 — High Impact

#### P1.1 — FTUE controllers still lack input validation DTOs
**Files:** `apps/server/src/modules/onboarding-concierge/onboarding-concierge.controller.ts`, `business-genesis.controller.ts`, `genome-chat.controller.ts`

Mutating endpoints still accept inline object types. No `class-validator` DTOs or `ValidationPipe` are used.

**Recommended fix:** Add DTOs for every mutating endpoint and enable `ValidationPipe`.

---

#### P1.2 — `OnboardingConciergeService` still has no unit tests
**File:** Missing `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.spec.ts`

The service is ~1,105 lines and remains the largest untested FTUE surface.

**Recommended fix:** Add a spec covering `getSetupStatus`, `autoConfigureFromTemplate`, `generateConciergeResponse`, `persistIntakeAnswers`, and nudge logic.

---

#### P1.3 — Command center empty states lack guidance
**File:** `apps/web/src/app/app/command-center/page.tsx`

Empty sections still render plain text ("No top priorities right now.", "No pending approvals.", etc.) with no CTAs.

**Recommended fix:** Replace with `EmptyState` components that include primary actions.

---

#### P1.4 — Demo data seeder issues
**File:** `apps/server/src/modules/onboarding-concierge/demo-data-seeder.service.ts`

- Invoice numbering is non-atomic (reads `findFirst` inside a transaction; concurrent completions can collide).
- Demo invoice is created with `status: 'SENT'` and no payment, which can mislead users viewing revenue.
- Currency is hardcoded to `TTD`.

**Recommended fix:** Use atomic numbering (counter row or CUID suffix); either mark invoice `PAID` with a sample payment or add explanatory copy; derive currency from `Business.currency`.

---

#### P1.5 — `autoConfigureFromTemplate` ignores `customBusinessName`
**Files:** `onboarding-concierge.controller.ts` (84), `onboarding-concierge.service.ts` (362–383)

Controller accepts `customBusinessName` but the service never applies it.

**Recommended fix:** Remove the field from the contract or implement the rename in the service.

---

#### P1.6 — `OnboardingStateService` circular dependency and weak step persistence
**File:** `apps/server/src/modules/onboarding-concierge/onboarding-state.service.ts`

- Still injects `OnboardingConciergeService`.
- `saveStep` does not validate transitions or set `onboardingStartedAt`.

**Recommended fix:** Remove the circular dependency and add step-order validation.

---

#### P1.7 — No server-side `/app/*` auth fast path
**File:** Missing `apps/web/src/middleware.ts`

The `kf_token` cookie is set but never enforced by middleware.

**Recommended fix:** Add lightweight middleware that validates the token cookie and redirects unauthenticated requests to `/auth/login?from=…`.

---

#### P1.8 — OAuth `/authorize` calls still lack a `state` nonce
**Files:** `apps/web/src/app/auth/login/login-form.tsx`, `apps/web/src/app/auth/signup/page.tsx`

No `state` parameter is generated or validated.

**Recommended fix:** Generate, store in `sessionStorage`, and validate a `state` nonce in the callback.

---

#### P1.9 — Concierge nudges still have no UI consumer
**File:** `apps/web/src/lib/client.ts` (`fetchConciergeNudges`)

The helper exists but no component calls it.

**Recommended fix:** Add a `NudgePanel` or `NudgeBanner` to the command center or app header.

---

#### P1.10 — Genesis onboarding components still unused
**Files:** `apps/web/src/app/app/onboarding/components/Genesis*.tsx`

Not imported by `OnboardingPage`.

**Recommended fix:** Integrate them or remove them.

---

### P2 — Medium Impact

#### P2.1 — `RequireAuth` allows access on non-401 errors
**File:** `apps/web/src/components/require-auth.tsx`

Intentional behavior to avoid kicking users out during brief outages, but it means invalid sessions can render protected pages when the API is down.

**Recommended fix:** Consider a short retry/backoff with an error state before allowing access.

---

#### P2.2 — Hardcoded TTD / Trinidad localization
**Files:** `industry-templates.ts`, `demo-data-seeder.service.ts`, concierge prompts, UI copy

Currency and country assumptions are hardcoded.

**Recommended fix:** Derive from `Business.currency`/`country`.

---

#### P2.3 — `useOnboarding.goToStep` still optimistic
**File:** `apps/web/src/app/app/onboarding/hooks/use-onboarding.ts`

Sets local step before server save resolves; no rollback on failure.

**Recommended fix:** Await server save or rollback on error; disable navigation while saving.

---

#### P2.4 — Chat inputs lack request deduplication
**Files:** `intake-chat-step.tsx`, `blueprint-onboarding-chat.tsx`

No `AbortController`; rapid clicks can create duplicate in-flight requests.

**Recommended fix:** Disable submit while loading; optionally add `AbortController`.

---

### P3 — Minor Polish

| # | Issue | File(s) | Recommended Fix |
|---|---|---|---|
| p1 | Dev credentials banner visible in non-prod builds | `apps/web/src/app/auth/login/page.tsx` | Guard with explicit dev-only env var |
| p2 | Dead auth test pages publicly accessible | `apps/web/src/app/auth/test/*.tsx` | Delete or guard behind `NODE_ENV === 'development'` |
| p3 | Username availability returns `true` on error | `apps/web/src/app/auth/signup/page.tsx` | Treat errors as indeterminate |
| p4 | Password-reset client validation weaker than server | `apps/web/src/app/auth/reset-password/page.tsx` | Align rules with server policy |
| p5 | `useGenomeGate` re-fetches on every route change | `apps/web/src/hooks/use-genome-gate.ts` | Add SWR/cache with short TTL |
| p6 | `useGenomeGate` has unused state fields | `apps/web/src/hooks/use-genome-gate.ts` | Remove or wire to real data |
| p7 | Mobile bottom nav uses non-functional anchors | `apps/web/src/lib/nav-config.ts` | Replace with real routes or remove |
| p8 | `/app` root always redirects to command center | `apps/web/src/app/app/page.tsx` | Check onboarding state first |
| p9 | `useAppLayout` discards `onboardingComplete` | `apps/web/src/hooks/use-app-layout.ts` | Implement redirect or remove fetch |
| p10 | `detect-type` endpoint ignores `businessId` | `onboarding-concierge.controller.ts` | Pass `businessId` to detection logic |
| p11 | `MarketStrategyRepository` uses `createManyAndReturn` | `market-strategy.repository.ts` | Verify Prisma compatibility |
| p12 | Seed script only seeds 2 templates; concierge offers 6 | `packages/db/prisma/seed.ts` | Align seed with concierge templates |
| p13 | `prisma.seed` key missing from `packages/db/package.json` | `packages/db/package.json` | Add config |
| p14 | `GenomeChatService` rate limiter is in-memory only | `genome-chat.service.ts` | Move to Redis |
| p15 | Accessibility gaps across onboarding | Multiple components | Add labels, progress roles, aria-live |

---

## Updated Priority Matrix

### P1 — Do before ship
1. Add input validation DTOs to FTUE controllers.
2. Write `onboarding-concierge.service.spec.ts`.
3. Improve command-center empty states with CTAs.
4. Fix demo data seeder (atomic numbering, paid/sample invoice, business currency).
5. Resolve `customBusinessName` or remove it from the contract.
6. Break circular dependency and add step-transition validation in `OnboardingStateService`.
7. Add `/app/*` auth middleware.
8. Add OAuth `state` nonce.
9. Build a UI consumer for concierge nudges.
10. Integrate or remove unused Genesis components.

### P2 — Medium impact
11. Decide on `RequireAuth` behavior for non-401 errors.
12. Localize currency/country assumptions.
13. Harden `useOnboarding.goToStep` against server-save failures.
14. Add request cancellation/deduplication to chat steps.

### P3 — Polish
15. Clean up dead test pages and dev-credentials banner.
16. Align seed data and add `prisma.seed` config.
17. Accessibility pass across onboarding components.

---

## Conclusion

All P0 FTUE blockers are now resolved. The activation pipeline is functionally sound: onboarding completion is gated, template auto-configuration reports failures, intake answers are persisted, and the Business Genesis employee check is correct. The remaining work is P1/P2 hardening (validation, tests, empty states, auth middleware, OAuth CSRF, nudges) and P3 polish. Fixing the P1 items should bring the FTUE to production-ready quality.
