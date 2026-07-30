# FTUE / Onboarding / Auth Re-Audit Report

**Date:** 2026-06-26  
**Scope:** Onboarding client flow, OAuth/PKCE auth, server-side FTUE/business-genesis completion, Business Command Center resilience, global exception filter, and API wrapper.  
**Method:** Read-only code review across the relevant modules. No files were modified.

---

## Executive Summary

The happy path works, but several **new P0/P1 issues** were found that can corrupt onboarding state or bypass completion gates:

- `TemplatePickerStep` instantiates its own `useOnboarding`, causing the page-level step state to diverge from URL/server state.
- `updateBlueprint` overwrites existing values with explicit `undefined` entries, contrary to its documented contract.
- `UpdateBusinessDto` allows a client to mark `onboardingComplete=true` directly, bypassing the genome gate, demo seeding, and milestone logic.
- The PKCE verifier generator falls back to `Math.random()` in environments without Web Crypto.

In addition, the previously flagged P1/P2 issues around URL sync, deep-link/server-state mismatch, optimistic rollback races, and transaction boundaries are still present.

---

## P0 — State corruption / critical bypass

### 1. `TemplatePickerStep` uses its own `useOnboarding` instance
- **File:** `apps/web/src/app/app/onboarding/components/template-picker-step.tsx` (~line 20)
- **Problem:** The step calls `useOnboarding()` independently of the page. Its `prevStep()` operates on a separate hook instance, so clicking **Back** can update the URL/server without updating the parent page’s rendered step. The parent’s `load()` is guarded by `loadedRef`, so it never re-reconciles.
- **Plan:** Remove `useOnboarding` from `TemplatePickerStep`. Pass an `onBack` prop from the page, wired to the page’s single `prevStep()` instance.

---

## P1 — Functional / security bugs

### 2. Pending navigation can execute after an optimistic rollback and skip steps
- **File:** `apps/web/src/app/app/onboarding/hooks/use-onboarding.ts` (~lines 177–192)
- **Problem:** If `saveOnboardingStep` fails, the hook rolls the UI/URL back but still processes `pendingStepRef.current`, which may have been queued against the optimistic state. This can jump from the rolled-back step to a far-ahead step.
- **Plan:** Clear `pendingStepRef.current = null` on error and do not process pending steps after a rollback.

### 3. Deep-link to `?step=complete` can strand the user when the genome gate is not met
- **Files:** `apps/web/src/app/app/onboarding/hooks/use-onboarding.ts` (~lines 105–126), `apps/web/src/app/app/onboarding/components/completion-step.tsx` (~lines 47–94)
- **Problem:** `load()` saves `onboardingStep=complete` and renders `CompletionStep` even when `threePillarMet` is false. The completion call fails with `GENOME_GATE_BLOCKED`, but the UI only offers **Try again** with no way back to the genome step.
- **Plan:** Refuse to jump ahead to `complete` in `load()` unless `onboardingComplete` or `threePillarMet` is true. Add a **Back to Genome** action in the completion error branch.

### 4. Back button is clickable while auto-configure is in flight
- **File:** `apps/web/src/app/app/onboarding/components/template-picker-step.tsx` (~lines 146–153)
- **Problem:** The **Back** button is not disabled while `configuring` is true. A user can navigate back, then the success handler still calls `onComplete()` from the unmounted/unrendered step.
- **Plan:** Disable the Back button when `configuring` is true (and when the global `isTransitioning` is true).

### 5. PKCE verifier falls back to `Math.random()`
- **File:** `apps/web/src/lib/oauth-pkce.ts` (~lines 26–35)
- **Problem:** If Web Crypto is unavailable, the verifier is generated with `Math.random()`, which is not cryptographically secure and defeats PKCE.
- **Plan:** Remove the `Math.random()` fallback and throw an error, matching `generateOAuthState` behavior.

### 6. Blueprint patches overwrite existing values with `undefined`
- **File:** `apps/server/src/modules/blueprint/blueprint.service.ts` (~lines 243–248)
- **Problem:** `updateBlueprint` spreads `{ ...next[key], ...sectionPatch }`. Explicit `undefined` values in `sectionPatch` clobber existing data, even though the type docs say `undefined` means “leave as-is.”
- **Plan:** Strip `undefined` entries from each section patch before merging, e.g.:
  ```ts
  const clean = Object.fromEntries(Object.entries(sectionPatch).filter(([, v]) => v !== undefined));
  ```

### 7. `UpdateBusinessDto` allows direct `onboardingComplete` mutation
- **Files:** `apps/server/src/modules/identity/dto/update-business.dto.ts` (~lines 160–161), `apps/server/src/modules/identity/identity.service.ts` (~lines 168–169, 229–236)
- **Problem:** `PATCH /identity/businesses/:businessId` accepts `onboardingComplete?: boolean` and writes it directly to the `Business` row, bypassing the genome gate, demo seeding, disclaimer acceptance, and milestone creation.
- **Plan:** Remove `onboardingComplete` from `UpdateBusinessDto`; completion must only happen through `OnboardingConciergeService.markOnboardingComplete`.

---

## P2 — UX reliability, security hardening, and server correctness

### 8. `useOnboarding` does not react to query-param or business changes
- **File:** `apps/web/src/app/app/onboarding/hooks/use-onboarding.ts` (~lines 136–141)
- **Problem:** `loadedRef.current` prevents re-reconciliation, so browser back/forward, manual URL edits, or switching the selected business never update the step.
- **Plan:** Remove the `loadedRef` guard; make the effect depend on `businessId` and `requestedStep`. Add a `popstate` listener and use an internal `isReconcilingRef` to avoid loops with `syncUrl`.

### 9. `?step=complete` re-triggers completion on every revisit
- **File:** `apps/web/src/app/app/onboarding/components/completion-step.tsx` (~lines 47–49)
- **Problem:** `complete()` runs unconditionally in `useEffect` on mount, rewriting `onboardingCompletedAt`/milestone even when already complete.
- **Plan:** Gate the effect with `!alreadyComplete` and/or a mount-only `isCalledRef`.

### 10. OAuth state cookie is not `HttpOnly`
- **File:** `apps/web/src/lib/oauth-state.ts` (~lines 38–42)
- **Problem:** State is stored in a client-readable cookie, so XSS can read it and satisfy the callback state check.
- **Plan:** Move PKCE/state initiation and validation to a Next.js Route Handler that sets an `HttpOnly` cookie and validates server-side.

### 11. PKCE verifier is mirrored to `localStorage` and a non-`HttpOnly` cookie
- **File:** `apps/web/src/lib/oauth-pkce.ts` (~lines 53–62)
- **Problem:** XSS can steal the verifier before the callback exchange. `localStorage` and the cookie can also diverge.
- **Plan:** Keep the verifier only in an `HttpOnly` cookie set by a Route Handler; stop mirroring to `localStorage`.

### 12. Callback still accepts implicit-grant tokens in URL fragment
- **File:** `apps/web/src/app/auth/callback/page.tsx` (~lines 89–93)
- **Problem:** If no `code` is present, the callback reads tokens from `window.location.hash`, exposing them in history/referrers.
- **Plan:** Enforce PKCE and reject the callback unless a `code` and matching state are present; remove the fragment-token branch.

### 13. `expires_at` is parsed as a date string instead of a Unix timestamp
- **File:** `apps/web/src/app/auth/callback/page.tsx` (~lines 138–143)
- **Problem:** Supabase returns `expires_at` as Unix seconds. `Date.parse("1700000000")` returns `NaN`, so token expiry is not stored reliably.
- **Plan:** Detect numeric `expires_at`, multiply by 1000 to get milliseconds, then store it. Use `expires_in` only as a fallback.

### 14. OAuth state is cleared before validation
- **File:** `apps/web/src/app/auth/callback/page.tsx` (~lines 82–87)
- **Problem:** `clearOAuthState()` runs before the state comparison. A transient validation failure destroys the stored state and prevents legitimate retry.
- **Plan:** Validate first, then clear.

### 15. Middleware only checks cookie presence, not token validity
- **File:** `apps/web/src/middleware.ts` (~lines 70–72)
- **Problem:** Any non-empty `kf_token` cookie satisfies the middleware. Token validation is deferred to `<RequireAuth>` on the client.
- **Plan:** Document this as a UX-only gate (current behavior is acceptable because `<RequireAuth>` validates), or validate the Supabase JWT in middleware with the project JWKS.

### 16. Password-reset flow reads access token from URL fragment
- **File:** `apps/web/src/app/auth/reset-password/page.tsx` (~lines 26–44, 97–104)
- **Problem:** The recovery token is pulled from `window.location.hash`, exposing it in browser history.
- **Plan:** Prefer server-side recovery handling, or consume and replace the URL immediately in an effect before any network request.

### 17. Sign-out leaves `kf_token_expires_at` in storage
- **File:** `apps/web/src/lib/workspace.ts` (~lines 259–271)
- **Problem:** `clearStoredBusinessId` does not clear the token expiry key.
- **Plan:** Remove `kf_token_expires_at` during sign-out.

### 18. `submitAnswers` performs two non-atomic blueprint writes
- **File:** `apps/server/src/modules/business-genesis/business-genesis.service.ts` (~lines 339–396)
- **Problem:** `inferFromOnboarding` and the compliance/projection patch run in separate transactions; if the second fails, the blueprint is half-updated.
- **Plan:** Wrap inference, patch calculation, and final `updateBlueprint` in a single Prisma transaction.

### 19. Concierge intake persistence updates Business and Blueprint separately
- **File:** `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts` (~lines 761–798)
- **Problem:** `persistIntakeAnswers` does `prisma.business.update(...)` then `blueprint.inferFromOnboarding(...)` with no transaction.
- **Plan:** Run both updates inside a single `$transaction`, passing the transaction client through.

### 20. Auto-configure blueprint mirror is swallowed inside the transaction
- **File:** `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts` (~lines 502–514)
- **Problem:** `blueprint.inferFromOnboarding` is wrapped in a `try/catch` that logs at `debug` level while the transaction still commits.
- **Plan:** Either let inference failures roll back the transaction, or return a warning to the client.

### 21. Demo seeder has a read-then-write race and no unique constraint
- **Files:** `apps/server/src/modules/onboarding-concierge/demo-data-seeder.service.ts` (~lines 27–49), `packages/db/prisma/schema.prisma` (~lines 2224–2305)
- **Problem:** `seedWithTx` checks for an existing demo contact, but `Contact` has no `@@unique([businessId, source])`, so concurrent completions can create duplicates.
- **Plan:** Add `@@unique([businessId, source])` on `Contact` and rely on the existing `P2002` retry path, or use upsert-based idempotency.

### 22. `markOnboardingComplete` silently ignores disclaimer write failures
- **File:** `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts` (~lines 1150–1169)
- **Problem:** `ensureLegalDisclaimerAccepted` catches `blueprint.updateBlueprint` failures and only logs a warning, then commits `onboardingComplete=true`.
- **Plan:** Remove the inner try/catch so the failure rolls back completion, or return a distinct error code.

### 23. `markOnboardingComplete` idempotency check is too strict
- **File:** `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts` (~lines 1114–1116)
- **Problem:** Early return requires both `onboardingComplete === true` **and** `onboardingCompletedAt`. If the timestamp is missing, completion re-runs.
- **Plan:** Treat `onboardingComplete === true` as sufficient for idempotency, and backfill missing timestamps when encountered.

### 24. Document pack is gated on `disclaimerAcceptedAt` but nothing sets it in-band
- **Files:** `apps/server/src/modules/business-genesis/genesis-document-pack.service.ts` (~lines 32–37), `apps/server/src/modules/blueprint/blueprint.service.ts` (~lines 812–814)
- **Problem:** `generatePack` throws if `disclaimerAcceptedAt` is missing, but Genesis questions do not set it.
- **Plan:** Add a disclaimer-acceptance step in the Genesis flow (or auto-accept when the user explicitly requests the pack) and persist `disclaimerAcceptedAt` before pack generation.

### 25. Command Center snapshot still has unguarded dependency calls
- **File:** `apps/server/src/modules/business-command-center/business-command-center.service.ts` (~lines 874–955)
- **Problem:** `mapGenomeSignalItems` and `mapGenomeRecommendationItems` call dependency services directly, outside `safeResolve`.
- **Plan:** Wrap both calls with `this.safeResolve(..., [])` so a failure returns an empty array instead of a 500.

### 26. `parsePlanLimitError` reads plan-limit fields from the wrong level
- **Files:** `apps/web/src/lib/api.ts` (~lines 52–61), `apps/server/src/core/filters/http-exception.filter.ts` (~lines 51–54)
- **Problem:** The filter places extra fields (`resource`, `current`, `limit`, `upgradeTo`) in `body.details`, but `parsePlanLimitError` looks for them at the top level.
- **Plan:** Update `parsePlanLimitError` to read from `parsed.details` when top-level fields are absent.

### 27. Command Center detail page has no `businessId` recovery
- **File:** `apps/web/src/app/app/command-center/[id]/page.tsx` (~lines 84, 279, 291, 305, 319, 333, 347, 363)
- **Problem:** The detail page reads `getStoredBusinessId()` directly and uses `businessId!` everywhere. If storage is empty, actions fail.
- **Plan:** Mirror the list page: call `ensureWorkspace()` on mount, store the resolved id in state, disable actions until resolved, and remove non-null assertions.

### 28. Command-queue failures are swallowed
- **File:** `apps/web/src/app/app/command-center/page.tsx` (~lines 83–93)
- **Problem:** `loadQueue()` has no error handling or retry UI.
- **Plan:** Add `try/catch`, a queue-specific error state, and a retry affordance.

### 29. `ensureWorkspace()` failures are opaque
- **File:** `apps/web/src/lib/workspace.ts` (~lines 273–291)
- **Problem:** Returns `null` on any bootstrap failure without distinguishing cause.
- **Plan:** Return a discriminated result or throw typed errors so callers can show actionable messages.

---

## P3 — Polish / defense-in-depth

### 30. Onboarding step transition validation allows arbitrary jumps
- **File:** `apps/server/src/modules/onboarding-concierge/onboarding-state.service.ts` (~lines 123–134)
- **Problem:** `isAllowedTransition` returns `true` for any forward/backward move, allowing clients to skip required steps.
- **Plan:** Allow backward moves freely, allow one-step forward moves freely, and block multi-step forward jumps unless a `force` intent is verified.

### 31. Entity-type synonym normalization misses common labels
- **File:** `apps/server/src/modules/blueprint/entity-type.helpers.ts` (~lines 7–33)
- **Problem:** Labels like `COMPANY`, `CORPORATION`, `INC`, `SARL`, `GMBH` normalize to `UNKNOWN`.
- **Plan:** Expand `RECOMMENDED_ENTITY_TYPE_SYNONYMS` and consider fuzzy matching.

### 32. Business creation does not eagerly seed the initial Blueprint
- **Files:** `apps/server/src/modules/identity/identity.service.ts` (~lines 132–142, 905–914), `apps/server/src/modules/blueprint/blueprint.service.ts` (~lines 192–199)
- **Problem:** `BusinessBlueprint` is created lazily, which can race.
- **Plan:** Eagerly create the blueprint row in the same transaction as business creation.

### 33. Genesis DTO validation is minimal
- **Files:** `apps/server/src/modules/business-genesis/dto/submit-answers.dto.ts`, `apps/server/src/modules/business-genesis/dto/analyze-idea.dto.ts`
- **Problem:** Only `@IsObject()` / `@IsString()` are used.
- **Plan:** Add stricter validation for answer value types, max lengths, and allowed keys.

### 34. `api.ts` network errors omit `rawError`
- **File:** `apps/web/src/lib/api.ts` (~lines 157–161, 177–181, 194–198, 211–215, 236–240)
- **Problem:** Catch blocks return `{ data: null, error: message }` without `rawError: null`.
- **Plan:** Return `rawError: null` in all network-error branches for consistency.

### 35. Non-`HttpException` path loses custom fields
- **File:** `apps/server/src/core/filters/http-exception.filter.ts` (~lines 59–67)
- **Problem:** Plain `Error` objects with custom metadata only return a generic 500.
- **Plan:** Include extra enumerable fields under `details` (excluding `stack`).

### 36. Client never captures response `X-Request-ID`
- **File:** `apps/web/src/lib/api.ts`
- **Problem:** The server returns `correlationId`, but `api.ts` does not surface it in warnings/telemetry.
- **Plan:** Include `rawError?.correlationId` in console warnings.

### 37. Accessibility / cleanup issues in onboarding components
- **Files:** `welcome-step.tsx`, `auto-configure-review-step.tsx`, `intake-chat-step.tsx`, `template-picker-step.tsx`, `GenesisConversation.tsx`, `completion-step.tsx`, `onboarding-progress.tsx`
- **Problems:** Buttons lack `type="button"`, progress dots have no ARIA roles, async state updates may run after unmount, `GenesisConversation` can navigate to Command Center without finishing onboarding.
- **Plan:** Add explicit button types, ARIA labels/current-step to progress, mount guards in async effects, and either complete onboarding or warn before redirecting from Genesis.

---

## Verified non-issues (previous suspicions cleared)

| Concern | Finding |
|---|---|
| PKCE verifier cleared before exchange succeeds | **Not present** — verifier is cleared only after `setStoredToken` succeeds. |
| Middleware dot-path bypass | **Not present** — matcher is `/app/:path*` and only specific static extensions are allow-listed. |
| Forwarded `from` query injection | **Not present** — `safeFromParam` enforces same-origin and `/app` prefix. |
| PKCE param mismatch between login and signup | **Not present** — both send identical params. |
| Weak OAuth state randomness | **Not present** — `generateOAuthState` throws if Web Crypto is unavailable. |

---

## Recommended implementation order

1. **P0 #1** — Fix `TemplatePickerStep` hook instance.
2. **P1 #5** — Remove `Math.random()` fallback in PKCE verifier.
3. **P1 #6 & #7** — Fix `undefined` blueprint overwrites and remove `onboardingComplete` from `UpdateBusinessDto`.
4. **P1 #2, #3, #4** — Harden optimistic rollback, gate deep-link to `complete`, disable Back during auto-configure.
5. **P2 #8, #9** — Make `useOnboarding` reactive and completion idempotent.
6. **P2 #10–#14** — Move OAuth state/verifier to `HttpOnly` Route Handler and enforce PKCE-only callback.
7. **P2 #18–#24** — Server transaction/idempotency/disclaimer fixes.
8. **P2 #25–#29** — Command Center resilience and detail-page recovery.
9. **P3** — Accessibility, DTO validation, synonym mapping, and telemetry polish.
