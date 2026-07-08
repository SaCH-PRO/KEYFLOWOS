# FTUE Re-Audit — Post-Hardening

**Date:** 2026-07-02  
**Scope:** Auth/signup, onboarding concierge, business genesis, and command-center FTUE after the hardening pass that added username-availability tests, storefront slug generation, employee/`hasEmployees` fixes, boolean-false handling, and command-center resilience.  
**Method:** Static code review of changed and adjacent files.

---

## Executive Summary

The hardening pass resolved the most severe **data-integrity blockers**:

- Storefront can now complete — slug is auto-generated inside `autoConfigureFromTemplate`.
- Employee-related compliance/documents now read `registrationProfile.hasEmployees`.
- Boolean `false` answers are no longer re-asked.
- Command Center recovers a missing `businessId` and no longer 500s when one snapshot dependency fails.
- Username availability has race-condition guards, abort handling, format validation, and unit tests.

The remaining risks are predominantly **web-side integration gaps** (PKCE OAuth, auth-gating consistency, `?step=` deep links, optimistic rollback, structured error rendering) and a few **server-side transaction-atomicity** issues where side effects still run outside the Prisma transaction.

---

## 1. Signup / Username Availability

### Fixed
- Debounced, abort-safe check via `useUsernameAvailability` hook (`apps/web/src/hooks/use-username-availability.ts:34-103`).
- Serial-number guard drops stale out-of-order responses.
- Format validation (2–32 chars, letters/numbers/dots/underscores/hyphens) in `apps/web/src/lib/username-availability.ts:19-46`.
- Submit-time re-verification in `apps/web/src/app/auth/signup/page.tsx:139-141`.
- Unit tests added: 19 passing in `apps/web`.

### Remaining
- **P1 — Submit does not guard the `checking` state.** If the user presses Enter while a check is in flight, the form advances to step 2 before availability is confirmed.  
  `apps/web/src/app/auth/signup/page.tsx:126-134`
- **P2 — Format errors are surfaced generically.** The hook returns a specific format message, but the page renders the generic “Couldn’t verify username” copy.  
  `apps/web/src/app/auth/signup/page.tsx:447`
- **P2 — Submit re-check has no timeout/abort handling.** `checkUsernameAvailability(username.trim())` is awaited without an `AbortSignal`.  
  `apps/web/src/app/auth/signup/page.tsx:139`

---

## 2. Onboarding Concierge Auto-Configuration

### Fixed
- Slug generation inside the transaction when `configureStorefront && !business.slug`.  
  `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts:263-287`, `:485-490`
- `storefrontSlug` returned in `AutoConfigureResult`.
- Business name fetched so slug can fall back to it.

### Remaining
- **P2 — Side effects run outside the DB transaction.** `awardSetupMilestone` and `blueprint.inferFromOnboarding` execute after `prisma.$transaction` commits. If either fails, products/hours are persisted but the blueprint mirror and milestone are not.  
  `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts:498-510`
- **P2 — Completion + demo seeding is not atomic.** `markOnboardingComplete` updates `onboardingComplete` inside a transaction, then calls `demoSeeder.seedDemoData` outside it. A seeding failure leaves onboarding marked complete with no demo data.  
  `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts:1116-1130`
- **P2 — Intake answer persistence is not transactional.** `persistIntakeAnswers` updates the `Business` row and then calls `blueprint.inferFromOnboarding`; a blueprint failure leaves the business row mutated.  
  `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts:786-792`
- **P2 — `saveStep('complete')` bypasses the genome gate and demo seeding.** `OnboardingStateService.isAllowedTransition` permits `genome → complete` by exactly one step, so calling the state endpoint with `complete` never triggers `markOnboardingComplete`.  
  `apps/server/src/modules/onboarding-concierge/onboarding-state.service.ts:99-131`

---

## 3. Business Genesis Correctness

### Fixed
- `isPopulated` returns `true` for booleans.  
  `apps/server/src/modules/business-genesis/business-genesis.service.ts:32`
- `hasEmployees?: boolean` added to `BlueprintRegistrationProfile` and read before `nisEmployerStatus`.  
  `apps/server/src/modules/blueprint/blueprint.types.ts:176`; `business-genesis.service.ts:283-287`, `:360-365`; `genesis-document-pack.service.ts:155-158`
- `BlueprintService.inferFromOnboarding` now stores `registrationProfile.hasEmployees`.  
  `apps/server/src/modules/blueprint/blueprint.service.ts:816-818`
- Entity-type synonym mapping (`LLC`, `LTD`, `SOLE_PROPRIETORSHIP`, `NON_PROFIT`, etc.).  
  `apps/server/src/modules/business-genesis/business-genesis.service.ts:104-137`
- `undefined` overwrites fixed for `recommendedEntityType` and risk arrays.  
  `apps/server/src/modules/business-genesis/business-genesis.service.ts:158-188`

### Remaining
- **P2 — Other contract sections still spread `undefined` values.** `contractToBlueprintPatch` spreads `contract.identity`, `operatingModel`, `customerModel`, `financials`, and `projectionProfile` directly; any `undefined` fields will overwrite previously captured values in `updateBlueprint`.  
  `apps/server/src/modules/business-genesis/business-genesis.service.ts:142-168`
- **P2 — `inferFromOnboarding` does not map entity-type synonyms.** `legalStructurePreference: 'LLC'` is coerced to `'UNKNOWN'` because only the allowed enum list is checked.  
  `apps/server/src/modules/blueprint/blueprint.service.ts:787-799`
- **P2 — `legalProfile` setup status still requires `disclaimerAcceptedAt`.** No Genesis question or concierge flow currently sets this field, so the legal profile step can never show as done.  
  `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts:214-218`

---

## 4. Command Center Resilience

### Fixed
- Missing `businessId` recovery via `ensureWorkspace()`.  
  `apps/web/src/app/app/command-center/page.tsx:51-64`
- Retry button in error state.  
  `apps/web/src/app/app/command-center/page.tsx:161-169`
- Snapshot dependencies isolated via `safeResolve` / `safeResolveSync`; single failures no longer 500 the page.  
  `apps/server/src/modules/business-command-center/business-command-center.service.ts:109-126`, `:139-165`

### Remaining
- **P2 — No recovery path when `ensureWorkspace()` returns null.** If workspace recovery fails, the UI shows “No business selected” with only Retry; there is no fallback to re-bootstrap or return to onboarding.  
  `apps/web/src/app/app/command-center/page.tsx:60`, `:155-173`
- **P2 — No per-component error boundaries.** A render error in any child card (`CommandHealthStrip`, `BusinessPulseCard`, `CommandGenomeCard`, etc.) will crash the entire page.  
  `apps/web/src/app/app/command-center/page.tsx:175-345`
- **P3 — `safeResolve` fallbacks rely on `as` casts.** The fallback objects are typed with `as`, so type mismatches against downstream mappers are not caught at compile time.  
  `apps/server/src/modules/business-command-center/business-command-center.service.ts:140-154`

---

## 5. Remaining Cross-Cutting Integration Gaps

| Gap | Severity | File / Line | Status |
|-----|----------|-------------|--------|
| **OAuth callback does not support PKCE.** It only reads `access_token` from `window.location.hash`; Supabase PKCE flows return a `code` in the query string, which is ignored and yields “No access token received”. | P1 | `apps/web/src/app/auth/callback/page.tsx:65-94` | Still open |
| **Onboarding auth gating is inconsistent.** `middleware.ts` whitelists `/app/onboarding` as public, but `app/app/layout.tsx` wraps every child in `<RequireAuth>`, so unauthenticated users are redirected to login before the welcome page renders. | P1 | `apps/web/src/middleware.ts:64-68`; `apps/web/src/app/app/layout.tsx:155-173` | Still open |
| **`?step=` deep links are ignored.** Nudges emit CTAs like `/app/onboarding?step=products`, but `useOnboarding` initializes only from server state and never reads `searchParams`. | P1 | `apps/web/src/app/app/onboarding/hooks/use-onboarding.ts:32-67`; `apps/web/src/app/app/onboarding/page.tsx:14-54` | Still open |
| **Optimistic step update is not rolled back.** `goToStep` sets the local step before the API call and only logs a warning on failure. | P1 | `apps/web/src/app/app/onboarding/hooks/use-onboarding.ts:69-82` | Still open |
| **`GENOME_GATE_BLOCKED` structured error is only partially rendered.** The `message` string is shown, but `missingPillars` / `genomeIntegrity` are not surfaced, so the user does not know which DNA pillars to complete. | P1 | `apps/web/src/app/app/onboarding/components/completion-step.tsx:24-26`; `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts:1108-1113`; `apps/web/src/lib/api.ts:138` | Still open |

---

## Recommended Next Actions

1. **P1 — Fix signup submit guarding `checking` state** so Enter cannot advance while availability is unresolved.
2. **P1 — OAuth PKCE support** in `auth/callback/page.tsx`.
3. **P1 — Decide and align onboarding auth model** (public welcome vs. auth-gated wizard).
4. **P1 — Honor `?step=` deep links** in `useOnboarding`.
5. **P1 — Roll back optimistic step** in `use-onboarding.ts` on API failure.
6. **P1 — Render structured `GENOME_GATE_BLOCKED`** in `CompletionStep`.
7. **P2 — Make onboarding completion + demo seeding atomic**.
8. **P2 — Run milestone award + blueprint inference inside auto-configure transaction**.
9. **P2 — Fix remaining `undefined` overwrite paths** in `contractToBlueprintPatch`.
10. **P2 — Add entity-type synonym mapping to `inferFromOnboarding`**.
11. **P2 — Resolve `legalProfile` disclaimer requirement** (add intake step or relax gate).
