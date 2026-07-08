# FTUE Re-Audit — First-Class Integrative Onboarding

**Date:** 2026-06-30  
**Scope:** End-to-end first-time user experience: auth → onboarding wizard → genome gate → command center first-run.  
**Method:** Static code review across `apps/web/src/app/app/onboarding/`, `apps/web/src/app/auth/`, `apps/web/src/app/app/command-center/`, `apps/web/src/middleware.ts`, `apps/web/src/hooks/`, `apps/server/src/modules/onboarding-concierge/`, `apps/server/src/modules/business-genesis/`, and `apps/server/src/modules/identity/`.

## Executive Summary

The FTUE is **structurally close to first-class** after the previous hardening pass, but a handful of **integration defects** still break the integrative promise. The most severe issues are silent: a brand-new business can finish onboarding yet have a storefront that is permanently "not done", employee-related compliance that never triggers, and Genesis questions that keep re-asking boolean "no" answers. On the frontend, the Command Center is fragile on first run if `localStorage` is missing the business ID or any snapshot dependency fails.

**Good news:** routing is **not** broken. `apps/web/src/app/app/onboarding/page.tsx` resolves to `/app/onboarding` (the first `app` is the App Router root, the second is the route segment). The previous 404 concern was a false positive.

**Theme of this audit:** the onboarding is integrative in UI but not yet integrative in **data consistency**. Multiple services write partial business DNA without atomic transactions, and several gates read from fields that are never populated.

---

## Verified P0 / P1 Blockers

### P1 — Storefront onboarding step can never complete
- **Files:** `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts:153`, `:453-456`
- **Issue:** `getSetupStatus` marks `storefront` done only when `business.slug && business.storeEnabled`. `autoConfigureFromTemplate` sets `storeEnabled = true` but **never creates a slug**. Businesses are created without a slug, so `storefront` stays `false` forever and setup status never reaches 100%.
- **Impact:** Users cannot fully complete onboarding; nudges persist; the genome gate may stay active depending on how `threePillarMinimumMet` weights storefront.
- **Fix:** In `autoConfigureFromTemplate`, when `configureStorefront` is true and no slug exists, generate a URL-safe slug from the business name / `customBusinessName`, check uniqueness, and persist it in the same transaction.

### P1 — Employee detection reads the wrong blueprint field
- **Files:** `apps/server/src/modules/business-genesis/business-genesis.service.ts:264-267`, `:339-342`; `genesis-document-pack.service.ts:154-156`; `genesis-question-bank.ts:39-45`
- **Issue:** The question bank stores the answer in `registrationProfile.hasEmployees`, but compliance/document logic derives `hasEmployees` from `registrationProfile.nisEmployerStatus`. A user who says "yes, I have employees" will **not** trigger NIS employer compliance or employee document templates.
- **Fix:** Read `registrationProfile.hasEmployees` directly. Add `hasEmployees?: boolean` to `BlueprintRegistrationProfile`.

### P1 — Boolean `false` answers are treated as "not answered"
- **Files:** `apps/server/src/modules/business-genesis/business-genesis.service.ts:30-35`, `:300-305`
- **Issue:** The local `isPopulated` helper does not handle booleans. `isPopulated(false)` falls through and returns falsy, so answered questions such as `hasEmployees=false`, `hasPhysicalLocation=false`, or `hasPartners=false` keep being re-asked.
- **Fix:** Add `if (typeof value === 'boolean') return true;` (or check `field in section` for booleans).

### P1 — Command Center does not recover a missing `businessId`
- **Files:** `apps/web/src/app/app/command-center/page.tsx:42-53`, `:144-153`
- **Issue:** `businessId` is read only from `getStoredBusinessId()`. If localStorage was cleared or the user lands from a fresh tab, the page renders "No business selected" instead of re-bootstrapping from the valid session.
- **Fix:** On mount, if `businessId` is null, call `ensureWorkspace()` to re-bootstrap from the token before declaring failure.

### P1 — Snapshot aggregation has no per-source error boundaries
- **Files:** `apps/server/src/modules/business-command-center/business-command-center.service.ts:103-126`
- **Issue:** `Promise.all` waits for executive brief, mode briefs, approvals, temporal analysis, genome, assets, constitution, etc. If any single dependency throws, the entire `/snapshot` endpoint returns 500 and the first-run user sees a fatal error.
- **Fix:** Wrap each data source in `try/catch` and return a default/empty result for that section. Log partial failures server-side.

### P1 — OAuth callback only parses hash tokens
- **Files:** `apps/web/src/app/auth/callback/page.tsx:65-70`
- **Issue:** The callback reads tokens from `window.location.hash`. Supabase projects configured for **PKCE** return a `code` (or token) in the **query string**. With PKCE this page will throw "No access token received".
- **Fix:** Detect both transports. Parse query params first; if a `code` is present, exchange it before falling back to hash parsing.

---

## P1 Integration / Consistency Gaps

### P1 — Onboarding requires auth in practice, but middleware claims it is public
- **Files:** `apps/web/src/middleware.ts:64-68`; `apps/web/src/app/app/layout.tsx:155-173`
- **Issue:** Middleware allows `/app/onboarding` through, but `app/app/layout.tsx` wraps every child in `<RequireAuth>`, so unauthenticated users are redirected to login before the welcome page renders.
- **Decision needed:** Either make onboarding truly public (move it outside the authenticated `/app/app` tree) or update the middleware comment and remove the allow-through. For a first-class FTUE, **public welcome page + auth-gated wizard** is the better pattern.

### P1 — `CompletionStep` cannot render the structured `GENOME_GATE_BLOCKED` error
- **Files:** `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts:1069-1080`; `apps/web/src/lib/api.ts:132-141`; `apps/web/src/app/app/onboarding/components/completion-step.tsx:26`
- **Issue:** Server returns `{ code, message, missingPillars, genomeIntegrity }`. The API helper only uses `parsed.message` when it is a string; with an object body the frontend falls back to "Forbidden" or a generic message.
- **Fix:** Return a plain string `message` from the backend, or parse the structured body in the frontend and show which pillars are missing.

### P1 — Optimistic step update is not rolled back on persistence failure
- **Files:** `apps/web/src/app/app/onboarding/hooks/use-onboarding.ts:69-82`
- **Issue:** `setStep(next)` runs before the API call. If the server rejects the transition, the UI advances anyway and only logs a warning.
- **Fix:** Roll `step` back to the previous value when `saveOnboardingStep` returns an error, and surface the error.

### P1 — Loading states can hang forever on API errors
- **Files:** `apps/web/src/app/app/onboarding/components/intake-chat-step.tsx:27-33`; `template-picker-step.tsx:31-35`; `genome-chat-step.tsx:19-22`
- **Issue:** Several steps call `.then(...)` without `.catch(...)` or `finally`, so a network/5xx error leaves the spinner running.
- **Fix:** Add `try/catch` (or `.catch`) handlers that set an error message and turn off loading.

### P1 — Deep links with `?step=` are ignored
- **Files:** `apps/web/src/app/app/onboarding/page.tsx`; `apps/web/src/app/app/onboarding/hooks/use-onboarding.ts:40-63`; `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts:874,882,890,906,914,922,930,938`
- **Issue:** Nudges emit CTAs like `/app/onboarding?step=products`, but `useOnboarding` never reads the query string; it only loads server state.
- **Fix:** Initialize `step` from `searchParams.get("step")` when it is a valid `OnboardingStep`, falling back to server state.

---

## P2 Data / Transaction Integrity Gaps

### P2 — Onboarding completion is not atomic with demo seeding
- **Files:** `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts:1082-1096`
- **Issue:** `markOnboardingComplete` updates `business.onboardingComplete = true` inside a transaction, then calls `demoSeeder.seedDemoData` outside that transaction. If seeding fails, onboarding is marked complete but no demo data exists.
- **Fix:** Move `seedDemoData` inside the same transaction, or move the business-status update to after successful seeding.

### P2 — Auto-configure side effects happen outside the DB transaction
- **Files:** `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts:464`, `:468-476`
- **Issue:** `awardSetupMilestone` and `blueprint.inferFromOnboarding` run after `prisma.$transaction` commits. If they fail, products/hours are persisted but the blueprint/milestone are not.
- **Fix:** Run these inside the transaction, or roll back on failure.

### P2 — Intake answer persistence is not transactional
- **Files:** `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts:751-758`
- **Issue:** `persistIntakeAnswers` updates the `Business` row and then calls `blueprint.inferFromOnboarding`. If the blueprint update fails, the business table is already mutated.
- **Fix:** Wrap both writes in a single Prisma transaction.

### P2 — Catalog events are emitted inside a transaction that may roll back
- **Files:** `apps/server/src/modules/catalog/catalog.service.ts:287-288`
- **Issue:** `createProduct` emits events while still inside the onboarding transaction. If the transaction rolls back, listeners may have acted on a product that no longer exists.
- **Fix:** Defer event emission until after the transaction commits.

### P2 — `saveStep('complete')` bypasses the genome gate and demo seeding
- **Files:** `apps/server/src/modules/onboarding-concierge/onboarding-state.service.ts:88-116`
- **Issue:** The state service allows a forward transition of exactly one step, so `welcome → … → complete` is legal. Setting the step to `complete` here does not seed demo data, award milestones, set `onboardingCompletedAt`, or enforce the three-pillar minimum.
- **Fix:** Reject `step === 'complete'` in `saveStep` and require clients to use `POST /complete`.

### P2 — AI-extracted risk/legal data can overwrite existing values with `undefined`
- **Files:** `apps/server/src/modules/business-genesis/business-genesis.service.ts:150-168`, `:136-144`
- **Issue:** `contractToBlueprintPatch` builds `patch.riskProfile` with keys for `legalRisks`, `marketRisks`, and `operationalRisks` even when the input arrays are undefined. `updateBlueprint` shallow-merges with spread, so `undefined` values overwrite previously captured risks.
- **Fix:** Only include keys whose values are defined (filter out `undefined` before merging).

### P2 — `recommendedEntityType` coercion rejects common synonyms
- **Files:** `apps/server/src/modules/business-genesis/business-genesis.service.ts:103-115`
- **Issue:** Allowed list is `SOLE_TRADER | PARTNERSHIP | LIMITED_COMPANY | NONPROFIT | UNKNOWN`. LLMs commonly return `LIMITED_LIABILITY`, `LLC`, `LTD`, etc., which are coerced to `UNKNOWN`. This prevents `legalProfile` from appearing done.
- **Fix:** Map common synonyms to the canonical enum before falling back to `UNKNOWN`.

### P2 — `legalProfile` onboarding step requires a disclaimer that has no intake path
- **Files:** `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts:213-217`
- **Issue:** `deriveGenesisSetupStatus` requires `legalProfile.disclaimerAcceptedAt` to mark the legal profile done. No Genesis question or concierge flow currently sets this field.
- **Fix:** Add a disclaimer acceptance step in the Genesis flow, or relax the gate to require only `recommendedEntityType`.

---

## P2 Frontend UX / State Gaps

### P2 — No universal back/exit navigation; progress bar is non-interactive
- **Files:** `apps/web/src/app/app/onboarding/components/onboarding-shell.tsx:23-33`; `template-picker-step.tsx:146-153`
- **Issue:** Only the template step has a Back button. The shell shows dots but they are not clickable/keyboard-navigable and there is no close/exit action.
- **Fix:** Add a header-level Back/Close control wired to `prevStep()` and make the progress indicator keyboard-accessible.

### P2 — Duplicate onboarding-state request on every app page load
- **Files:** `apps/web/src/app/app/onboarding/hooks/use-onboarding.ts`; `apps/web/src/hooks/use-genome-gate.ts`
- **Issue:** Both hooks call `fetchOnboardingState` independently. On the onboarding page this results in two parallel GET requests.
- **Fix:** Lift the state fetch into a shared provider/context, or have `useOnboarding` expose its state so `useGenomeGate` can consume it.

### P2 — Auto-configure review is a static success screen
- **Files:** `apps/web/src/app/app/onboarding/components/auto-configure-review-step.tsx`
- **Issue:** Always displays the same four success cards regardless of whether the user skipped the template, the API errored, or only some options were applied.
- **Fix:** Pass the actual `AutoConfigureResult` into the step and conditionally render what was created/skipped.

### P2 — Payment methods are "configured" without real configuration
- **Files:** `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts:436-439`; `apps/web/src/app/app/onboarding/components/auto-configure-review-step.tsx:39-43`
- **Issue:** The service sets `meta.paymentMethodsConfigured = true` and stores recommendations, but no actual payment-provider setup occurs. The UI then tells the user payment methods are active.
- **Fix:** Either perform real payment-method seeding or reword the copy and checklist so the user knows these are recommendations, not active integrations.

### P2 — `saveStep` is fire-and-forget with no retry
- **Files:** `apps/web/src/app/app/onboarding/hooks/use-onboarding.ts:75`
- **Issue:** `saveOnboardingStep` is called once. The retry helper does not retry POST/PATCH by default, so a transient blip silently loses progress.
- **Fix:** Surface save failures and provide a manual retry; optionally enable retry for onboarding-step POSTs.

### P2 — `genomeIntegrity` / `genesisCompleted` are declared but never populated
- **Files:** `apps/web/src/hooks/use-genome-gate.ts:30-36`, `:72-78`, `:90-95`, `:106-111`
- **Issue:** The hook's public state contract suggests richer data than it actually provides.
- **Fix:** Populate them from the server response or remove them from the public API.

### P2 — Genesis conversation uses hard navigation for escape links
- **Files:** `apps/web/src/app/app/onboarding/components/GenesisConversation.tsx:341,347`
- **Issue:** Uses `window.location.href = "/app/profile?tab=business-genome"` and `"/app/command-center"`, causing full page reloads.
- **Fix:** Use `useRouter` from `next/navigation`.

### P2 — Command Center error state has no retry / fallback dashboard
- **Files:** `apps/web/src/app/app/command-center/page.tsx:144-153`
- **Issue:** When `getBusinessCommandCenterSnapshot` fails, the UI shows a red alert and no path forward.
- **Fix:** Add a "Retry" button and/or render a skeleton dashboard with onboarding nudges.

### P2 — Nudges can appear even when `onboardingComplete` is true
- **Files:** `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts:847`
- **Issue:** `if (business?.onboardingComplete && setupStatus.percentage === 100) return [];` If the onboarding flag is set but setup status is not 100%, onboarding nudges still render.
- **Fix:** Once `onboardingComplete` is true, suppress onboarding nudges regardless of setup percentage, or gate `markOnboardingComplete` on `setupStatus.percentage === 100`.

### P2 — Completion step requires a manual click to exit
- **Files:** `apps/web/src/app/app/onboarding/components/completion-step.tsx:99-108`
- **Issue:** After `markOnboardingComplete` succeeds, the user must click "Go to Command Center". A distracted user can remain on the completion page indefinitely.
- **Fix:** Auto-redirect to `/app/command-center` 2–3 seconds after success (with an option to cancel).

---

## P3 Polish / Cleanup

### P3 — Accessibility gaps in onboarding components
- **Files:** `LegalDisclaimerModal.tsx`; `GenesisQuestionSet.tsx:86-104`; `IdeaInput.tsx`; `intake-chat-step.tsx`; `GenesisProfilePreview.tsx`; `onboarding-progress.tsx`
- **Issues:** Modal lacks `role="dialog"`, focus trap, and focus restoration; boolean toggle lacks `role="switch"` / `aria-checked`; several inputs rely on placeholders instead of labels; progress dots rely on `title` attributes.
- **Fix:** Add ARIA attributes, focus management, and explicit labels.

### P3 — Currency is hard-coded to TTD in industry templates
- **Files:** `apps/server/src/modules/onboarding-concierge/industry-templates.ts`
- **Issue:** All default products use `currency: 'TTD'`. For a business whose `currency` is USD/EUR, auto-configure creates mismatched products.
- **Fix:** Use the business's `currency` when creating products; keep TTD only as a fallback.

### P3 — Template matching is order-biased
- **Files:** `apps/server/src/modules/onboarding-concierge/industry-templates.ts:173-180`
- **Issue:** `matchIndustryTemplate` returns the first template whose keyword matches, regardless of match quality.
- **Fix:** Score all templates by keyword overlap and return the best match.

### P3 — DTO validation gaps
- **Files:** `dto/auto-configure.dto.ts`; `dto/chat.dto.ts`; `dto/detect-business-type.dto.ts`; `dto/analyze-idea.dto.ts`; `dto/submit-answers.dto.ts`; `dto/apply-updates.dto.ts`; `modules/identity/dto/signup.dto.ts`
- **Issues:** Empty strings accepted, no `@MaxLength`, `role` not restricted, password lacks complexity rules.
- **Fix:** Strengthen DTOs with `@IsNotEmpty`, `@MinLength`, `@MaxLength`, `@IsIn`, `@IsBoolean`.

### P3 — Dead / unused code
- **Files:** `apps/web/src/app/app/onboarding/business-os/page.tsx`; `apps/web/src/app/auth/start/page.tsx`; `completion-step.tsx:101`; `BlueprintOnboardingChat.tsx:6`
- **Issues:** Orphaned redirect page, unused `/auth/start`, unused `onboarding=complete` query param, deprecated `apiPostSimple` import.
- **Fix:** Delete or clean up.

### P3 — Test coverage gaps
- **Files:** `business-genesis.service.spec.ts`; `genome-chat.controller.ts`; `onboarding-concierge.service.spec.ts`; `onboarding-state.service.spec.ts`
- **Issues:** Only `submitAnswers` is tested in genesis; no controller specs for genesis chat; concierge spec uses invalid `'LIMITED_LIABILITY'` fixture; state service does not test `complete` or post-completion transitions.
- **Fix:** Add coverage for the gaps above, especially entity-type coercion and boolean-missing logic.

---

## Recommended Remediation Priority

| Priority | Action | Owner files |
|----------|--------|-------------|
| **P0/P1** | Auto-generate slug in `autoConfigureFromTemplate` so storefront can complete. | `onboarding-concierge.service.ts` |
| **P1** | Fix employee detection to read `registrationProfile.hasEmployees`. | `business-genesis.service.ts`, `genesis-document-pack.service.ts`, `blueprint.types.ts` |
| **P1** | Fix `isPopulated` to treat `false` as populated. | `business-genesis.service.ts` |
| **P1** | Recover missing `businessId` in Command Center. | `command-center/page.tsx` |
| **P1** | Wrap snapshot dependencies so one failure does not 500 the page. | `business-command-center.service.ts` |
| **P1** | Support PKCE/query-token OAuth callback in addition to hash tokens. | `auth/callback/page.tsx` |
| **P1** | Resolve onboarding auth inconsistency (public welcome vs. gated wizard). | `middleware.ts`, `app/app/layout.tsx` |
| **P1** | Render `GENOME_GATE_BLOCKED` missing pillars in `CompletionStep`. | `completion-step.tsx`, `onboarding-concierge.service.ts` or `lib/api.ts` |
| **P1** | Roll back optimistic step on `saveOnboardingStep` failure. | `use-onboarding.ts` |
| **P1** | Add error branches to loading states in intake/template/genome steps. | `intake-chat-step.tsx`, `template-picker-step.tsx`, `genome-chat-step.tsx` |
| **P1** | Honor `?step=` deep links in `useOnboarding`. | `use-onboarding.ts`, `page.tsx` |
| **P2** | Make onboarding completion + demo seeding atomic. | `onboarding-concierge.service.ts` |
| **P2** | Move milestone award + blueprint inference inside auto-configure transaction. | `onboarding-concierge.service.ts` |
| **P2** | Prevent `undefined` overwrites in blueprint patches. | `business-genesis.service.ts`, `blueprint.service.ts` |
| **P2** | Map common entity-type synonyms before coercing to `UNKNOWN`. | `business-genesis.service.ts` |
| **P2** | Add workspace-recovery fallback UI and retry to Command Center. | `command-center/page.tsx` |
| **P2/P3** | Clean up accessibility, dead code, hard-coded TTD templates, and DTO gaps. | Various |

---

## Notes

- Typecheck passes after the latest hardening pass. Lint remains blocked by the missing ESLint 9 config and is out of scope for this FTUE audit.
- The Windows Prisma query-engine file-lock issue continues to require killing orphaned `node.exe` processes before `db:generate` / `typecheck`.
- No live `/auth/test/*` routes remain in source (deletions are staged).
