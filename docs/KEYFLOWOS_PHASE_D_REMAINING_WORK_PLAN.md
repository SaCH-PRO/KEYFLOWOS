# KEYFLOWOS — Phase D Remaining Work Implementation Plan

**Branch:** `feat/key-phase-d-proactive`  
**Last audited:** 2026-06-23  
**Baseline:** server test suite green (189 files / ~1,525 tests), `tsc --noEmit` clean, Prisma client generated.

---

## 1. Executive Summary

The repo has successfully merged Phases 0, A, B, and C. Phase D is meant to close the gap between "construction manual claims" and "source-truth reality", then finish the strategic roadmaps that feed the Business Command Center (KEY Genome, Mind/Soul, Navigation, Freelancer Hardening, Flow/Automation).

This plan is intentionally **execution-first**: it starts with the smallest, highest-impact fixes that unblock the UI the user already sees, then moves outward to larger strategic foundations. Every task includes the exact files that must change and a verifiable acceptance criterion.

### North star

1. **Construction Manual Phases 1–6** must actually work in the browser before claiming them done.
2. **Phase 11 / Phase 17 stabilization** (tests, lint, redirects, empty states) is the door to `main`.
3. **KEY Genome + Mind/Soul** are the next strategic arc after stabilization; they are not Phase D blockers but Phase D must not make them harder.
4. **Navigation Overhaul** and **Freelancer Hardening** are user-facing product bets that should start only after the daily-run surface (Cockpit/Command Center) is trustworthy.

---

## 2. Verification Baseline (do not regress)

Run before each sub-phase and after the branch is complete:

```bash
pnpm --filter server test        # must stay green
pnpm --filter server build       # must stay green
pnpm --filter web build          # must stay green
cd packages/db && pnpm db:generate
```

If a task requires a schema change, produce a migration with `pnpm db:migrate dev --name <name>` and verify `db:deploy` succeeds against a fresh shadow DB.

---

## 3. Immediate Tactical Close-Out (Construction Manual Phases 1–6)

These are the gaps that make the manual’s "✅" inaccurate. They are small, independent, and high leverage.

### 3.1 Phase 1 — Command Spine: `SNOOZED` validation + action-enabled list

**Gap:** The service and schema support `SNOOZED`, but the DTO validators reject it, and `/app/command-center` renders read-only `CommandItemCard` instead of the action-enabled `CommandCard`/`CommandQueue`.

**Files & changes:**

| File | Change |
|------|--------|
| `apps/server/src/modules/command/dto/create-command-item.dto.ts` | Add `'SNOOZED'` to `VALID_STATUSES`. |
| `apps/server/src/modules/command/dto/update-command-item.dto.ts` | Add `'SNOOZED'` to `VALID_STATUSES`. |
| `apps/server/src/modules/command/dto/list-command-items.dto.ts` | Add `'SNOOZED'` to `VALID_STATUSES` and allow filtering by it. |
| `apps/server/src/modules/command/command.service.ts` | Confirm `snooze()` already sets `status: 'SNOOZED'`. Add a guard that rejects `until` in the past. |
| `apps/web/src/lib/api/business-command-center.ts` | Add `snoozedItems?: CommandItem[]` to the snapshot type if the UI needs a tab. |
| `apps/web/src/app/app/command-center/page.tsx` | Replace read-only `CommandItemCard` list with `CommandQueue` + `CommandCard`. Import action helpers from `@/lib/api/command` (`completeCommandItem`, `approveCommandItem`, `executeCommandItem`, `assignCommandItem`, `dismissCommandItem`, `snoozeCommandItem`, `reopenCommandItem`). Wire each card action to a handler that mutates then re-fetches the snapshot. |
| `apps/web/src/components/command/command-card.tsx` | Add a visible "Snooze" button (already supported by `STATUS_LABELS` and `isDone`). |
| `apps/web/src/components/command/command-queue.tsx` | Add a `"SNOOZED"` category filter pill. |

**Acceptance criteria:**
- `POST /command/businesses/:id/items/:id/snooze` with a future `until` succeeds for an `OPEN` item and returns `status: 'SNOOZED'`.
- The Command Center list shows Done / Approve / Execute / Assign / Dismiss / Snooze / Reopen buttons and each action refreshes the list.
- A snoozed item no longer appears in "Open" but appears in a "Snoozed" filter.
- Server tests remain green.

**Status:** ✅ Completed (2026-06-28) — `SNOOZED` added to DTOs, Command Queue wired with action handlers, web build green.

**Estimate:** 1 dev day.

---

### 3.2 Phase 2 — Cockpit redesign: pulse, KEY briefing, governance

**Gap:** `BusinessPulseCard` exists but is not used; the snapshot API does not expose `businessPulse`, `keyBriefing`, or `governanceSummary`, so the Construction Manual Phase 2 cards are missing.

**Files & changes:**

| File | Change |
|------|--------|
| `apps/server/src/modules/business-command-center/business-command-center.service.ts` | Add `buildBusinessPulse()`, `buildKeyBriefing()`, and `buildGovernanceSummary()` to the `snapshot()` return. Compute dimensions from health counts + integrity scores (money, people, time, operations, risk). |
| `apps/web/src/lib/api/business-command-center.ts` | Extend `BusinessCommandCenterSnapshot` with `pulse: { overallScore, dimensions[] }`, `briefing: { headline, bullets, warnings[] }`, and `governance: { autoReady, needsApproval, dueToday, urgentRisks }`. |
| `apps/web/src/app/app/command-center/page.tsx` | Render `BusinessPulseCard`, a new `KeyBriefingCard`, and a new `GovernanceSummaryCard` above the existing lists. |
| `apps/web/src/components/business-pulse-card.tsx` | Already exists; accept `className` and use design tokens. |
| `apps/web/src/app/app/command-center/components/key-briefing-card.tsx` | Create: shows 1-line headline + 3–5 bullets summarizing top priority, top risk, and a KEY suggestion. |
| `apps/web/src/app/app/command-center/components/governance-summary-card.tsx` | Create: 4 mini-stat tiles (Auto-Ready, Needs Approval, Due Today, Urgent Risks) using snapshot counts. |

**Acceptance criteria:**
- `/app/command-center` renders Pulse, Briefing, and Governance cards without layout shift.
- The governance counts match real `CommandItem` / `KeyActionProposal` / `ResponseDraft` pending states.
- `pnpm --filter web build` passes.

**Status:** ✅ Completed (2026-06-28) — Snapshot exposes pulse/briefing/governance, cards rendered, web build green.

**Estimate:** 1.5 dev days.

---

### 3.3 Phase 3 — Omnichannel Inbox: save draft + webhook security + outbound message IDs

**Gap:**
- Response Draft panel "Save Draft" is a stub (`onClick={cancelEdit}`).
- WhatsApp/Meta inbound webhooks accept unsigned payloads.
- Outbound WhatsApp/SMS do not capture the provider `messageId` in `CommunicationMessage`.

**Files & changes:**

| File | Change |
|------|--------|
| `apps/server/src/modules/communications/response-draft.service.ts` | Add `updateDraftBody(draftId, body, updatedById?)` that sets `status` back to `PENDING_APPROVAL` if it was approved, updates `evidence.lastEditedBy`, and returns the draft. |
| `apps/server/src/modules/communications/omnichannel.controller.ts` | Add `PATCH /drafts/:id` → `this.drafts.updateDraftBody(...)`. |
| `apps/web/src/lib/api/omnichannel.ts` | Add `updateDraft(businessId, draftId, body)` helper. |
| `apps/web/src/components/communications/response-draft-panel.tsx` | Replace the stub Save Draft `onClick` with `async () => { await updateDraft(...); cancelEdit(); onMutate?.(); }`. Disable while saving. |
| `apps/server/src/modules/whatsapp/whatsapp.controller.ts` | Add Meta `X-Hub-Signature-256` verification in `webhook()` using the configured `WHATSAPP_APP_SECRET`. Add Twilio signature verification when `X-Twilio-Signature` is present (use `twilio` SDK or HMAC of the full request URL + sorted params). Fail closed if a signature header is present and invalid. |
| `apps/server/src/modules/whatsapp/whatsapp.service.ts` | Change `sendMessage` / `sendViaTwilio` / `sendViaMeta` return type to include `messageId?: string`. Capture Twilio `sid` and Meta `messages[0].id`. |
| `apps/server/src/modules/ai/ai-message-sender.service.ts` | Pass `messageId` into `logCommunication` metadata for WhatsApp/SMS, and surface it in the `SendMessageResult`. |
| `apps/server/src/modules/communications/communications.service.ts` | Ensure `CommunicationMessage` records store `externalMessageId` from the adapter result if available. |

**Acceptance criteria:**
- Editing a draft body and clicking Save Draft persists the change and reverts the card to read mode with the new text.
- Sending a WhatsApp message returns/logs a real provider message ID for both Twilio and Meta providers.
- A WhatsApp webhook POST with a bad signature returns `403`; a valid signature is processed.
- Existing WhatsApp service tests still pass.

**Status:** ✅ Completed (2026-06-28) — Save Draft wired to `PATCH /drafts/:id`, webhook signatures verified, outbound message IDs captured, tests green.

**Estimate:** 2 dev days.

---

### 3.4 Phase 4 — Device Capture: public URL + expense prefill

**Gap:**
- `capture-sheet.tsx` uploads files but never passes `publicUrl` to `createCapture`, so `MediaAsset.publicUrl` stays null and AI auto-extraction never runs.
- The receipt → expense redirect uses `?prefill=...` but the expense form never reads it.

**Files & changes:**

| File | Change |
|------|--------|
| `apps/web/src/components/device/capture-sheet.tsx` | In `uploadFile`, derive `publicUrl = presigned.uploadURL.split('?')[0]` and include it in the `createCapture()` call. |
| `apps/web/src/app/app/expenses/page.tsx` | On mount, read `searchParams.get('prefill')`, base64-decode/parse the JSON, open the expense form side-sheet pre-populated, and strip the query param after reading so a refresh is clean. |
| `apps/web/src/app/app/expenses/components/expense-form-sidesheet.tsx` | Accept an optional `prefill` prop and seed `formData` from it when `editingExpense` is null. |
| `apps/server/src/modules/device/device.service.ts` | In `createCapture`, persist `publicUrl` into `MediaAsset.publicUrl`. (Schema field already exists.) |
| `apps/server/src/modules/device/device.controller.ts` | Confirm `POST /captures` accepts `publicUrl` in the body. |

**Acceptance criteria:**
- After uploading a receipt, `MediaAsset.publicUrl` is populated in the database.
- The "Create expense" action from the capture result opens `/app/expenses` with description, amount, vendor, and receipt URL pre-filled.
- Auto-extraction (`runAutoExtraction`) runs for image captures with a public URL.

**Status:** ✅ Completed (2026-06-28) — `capture-sheet.tsx` passes `publicUrl`; expenses page reads `?prefill=` and seeds the side-sheet; server persists `publicUrl`.

**Estimate:** 1 dev day.

---

### 3.5 Phase 5 — Voice: session lifecycle + settings + named components

**Gap:**
- `JarvisVoice` never calls `createVoiceSession` / `endVoiceSession`.
- Saved voice settings (`kf_voice_settings`) are not loaded into `JarvisVoice`.
- Named components (`VoiceOrb`, `PushToTalkButton`, `VoiceTranscriptDrawer`, `KeyVoiceSelector`) do not exist as standalone files.

**Files & changes:**

| File | Change |
|------|--------|
| `apps/web/src/app/app/keyflow-command/components/jarvis-voice.tsx` | On open, call `createVoiceSession(businessId, 'push_to_talk')`. On close, call `endVoiceSession(businessId, sessionId, transcript, summary)` with a generated summary. Load `voice` and `muted` from `localStorage.getItem('kf_voice_settings')` on mount. |
| `apps/web/src/app/app/key/voice-settings/page.tsx` | Already saves to backend; also keep `localStorage` in sync so `JarvisVoice` reads it. |
| `apps/web/src/components/voice/voice-orb.tsx` | Create: animated orb that responds to `recording`/`thinking` props. |
| `apps/web/src/components/voice/push-to-talk-button.tsx` | Create: hold-to-talk button with press handlers. |
| `apps/web/src/components/voice/voice-transcript-drawer.tsx` | Create: scrollable transcript panel fed by `turns`. |
| `apps/web/src/components/voice/key-voice-selector.tsx` | Create: voice option grid that reads/writes `kf_voice_settings`. |
| `apps/web/src/app/app/keyflow-command/components/jarvis-voice.tsx` | Refactor internals to use the new named components. |
| `apps/server/src/modules/device/device.service.ts` | Confirm `createVoiceSession` / `endVoiceSession` exist and update `endedAt`, `durationSeconds`, `status: 'COMPLETED'`. |

**Acceptance criteria:**
- Opening Jarvis creates a `VoiceSession` row with `status: 'ACTIVE'`.
- Closing Jarvis updates the row with `status: 'COMPLETED'`, a transcript snippet, and duration.
- Changing the voice in `/app/key/voice-settings` is reflected in the next Jarvis TTS call.
- `pnpm --filter web build` passes.

**Status:** ✅ Completed (2026-06-29) — `JarvisVoice` creates/ends `VoiceSession`; voice settings page loads cloud preferences and round-trips `muted`/`speed` via `settings`; named components created and composed; server/web builds green; server tests green.

**Estimate:** 1.5 dev days.

---

### 3.6 Phase 6 — Flow Studio: contracts, test mode, metrics, trigger naming

**Gap:**
- `GET /templates` and `GET /runs/:runId/steps` return raw arrays; the UI expects `{ items, total }`.
- The Test button fails on draft/unpublished flows because `FlowRunnerService` requires `status === 'ACTIVE'` and a published version.
- Cross-module workflows use `triggerEvent` while Flow nodes use `triggerType`, creating a naming split.
- `AutomationFlow.metrics` is never updated.

**Files & changes:**

| File | Change |
|------|--------|
| `apps/server/src/modules/flow/flow.controller.ts` | Wrap `listTemplates()` return in `{ items, total }` (total = templates count). Wrap `getRunSteps()` return in `{ items, total }`. |
| `apps/server/src/modules/flow/flow-template.service.ts` | Add `count()` helper if not present. |
| `apps/server/src/modules/flow/flow-runner.service.ts` | Add `runFlowTest(businessId, flowId, payload)` that skips the `status === 'ACTIVE'` check, uses the latest version regardless of `status`, creates a `TEST` run, executes it, and returns the run. Mark the run `status: 'TEST_COMPLETED'` or `'TEST_FAILED'`. |
| `apps/server/src/modules/flow/flow.controller.ts` | Change `POST /flows/:flowId/test` to call `runner.runFlowTest(...)`. |
| `apps/server/src/modules/flow/flow-runner.service.ts` | After a normal run completes/fails, update `AutomationFlow.metrics` with `totalRuns`, `successRuns`, `failedRuns`, `lastRunAt`, `lastRunStatus`. |
| `apps/server/src/modules/flow/cross-module-agent.service.ts` | Add a runtime mapping: when converting a cross-module workflow to a Flow node, map `triggerEvent` → `triggerType`. Keep `triggerEvent` as the canonical workflow field. |
| `apps/web/src/lib/api/flow.ts` | Ensure `listFlowTemplates` and `getFlowRunSteps` already expect `{ items, total }` (they do). |
| `apps/web/src/app/app/flows/page.tsx` | Confirm the "Total runs" stat reads from `flow.metrics.totalRuns`. |

**Acceptance criteria:**
- `/app/flows/templates` loads without a type/runtime error.
- Expanding a run in `/app/flows/:id` shows steps.
- Clicking Test on a draft flow executes and shows a test run in the run history.
- After a run, `AutomationFlow.metrics.totalRuns` increments.
- Server tests remain green.

**Status:** ✅ Completed (2026-06-29) — Templates/run-steps wrapped as `{ items, total }`; `runFlowTest` works on drafts; `triggerType` mapped to canonical events; `AutomationFlow.metrics` updated after production runs; server/web builds green; server tests green.

**Estimate:** 2 dev days.

---

## 4. Stabilization & Launch Hardening (Phase 11 / Phase 17)

This is the gate for merging Phase D to `main`.

### 4.1 Lint, type-check, and build hygiene

- Run `pnpm lint` and fix any new errors introduced by the tactical work.
- Run `pnpm --filter server build` and `pnpm --filter web build`.
- Eliminate any new `as any` casts introduced on the critical path.

**Status:** Completed. Fixed ESLint errors across key-cortex/key-connector services and web `set-state-in-effect` violations in expenses/autonomy pages. `pnpm lint`, server build, and web build all pass.

### 4.2 Redirects for Navigation Overhaul Phase 1

Even if the full overhaul is not built in Phase D, the old URLs must not 404 when the new nav is partially adopted. Add `next.config.js` redirects or route stubs:

| From | To |
|------|-----|
| `/app/commerce` | `/app/money/revenue` |
| `/app/finance` | `/app/money` |
| `/app/accounting` | `/app/money/books` |
| `/app/expenses` | `/app/money/expenses` |
| `/app/crm` | `/app/people` |
| `/app/projects` | `/app/work/projects` |
| `/app/calendar` | `/app/schedule/calendar` |
| `/app/marketing` | `/app/communicate/campaigns` |

**Acceptance criterion:** `pnpm --filter web build` passes and each old path returns the new page (or a redirect).

**Status:** Completed. Stubs created at canonical targets and redirects added to `apps/web/next.config.ts`; `pnpm --filter web build` passes.

**Estimate:** 0.5 dev days.

### 4.3 Server test reliability

- Identify any flaky tests added by Phase D changes.
- Add unit tests for:
  - `SNOOZED` DTO validation
  - `updateDraftBody`
  - WhatsApp signature verification
  - Flow test mode and metrics update
  - Capture `publicUrl` persistence

**Status:** Completed. Added unit tests in `apps/server/test/` covering all listed areas; full server suite passes (216 files / 1,753 tests).

**Estimate:** 1 dev day.

---

## 5. Strategic Foundations (not Phase D blockers)

After Phase D merges to `main`, the following roadmaps are the next execution arcs. Phase D should prepare the ground without building them fully.

### 5.1 KEY Genome kernel

The Genome roadmap identifies the largest gap: there is no `GenomeFact` / `GenomeEvidence` / `GenomeSignal` kernel.

**Phase D prep only:**
- Do not add new tables yet.
- Ensure every existing service that writes business truth (`BusinessGenesisService`, `BlueprintService`, `GenomeChatService`) emits a `genome.fact.proposed` event with `{ businessId, section, source, value, confidence }`.
- Add a stub `GenomeFactService` that logs the event but does not persist it.

This makes the Phase E Genome build a matter of schema + persistence, not retrofitting every writer.

**Estimate (prep only):** 1 dev day.

### 5.2 Mind / Soul / Evolution stabilization

The Mind/Soul plan is large and intentionally scoped out of Phase D. Phase D prep only:
- Fix the live autonomy bypass already documented in `key-cortex-reasoning.service.ts` if it is still present on this branch.
- Add the `AutonomyOrchestratorService` interface and register it in `KeyAutonomyModule`.
- Add the `UnifiedMemoryRetrievalService` interface and register it in `KeyCortexModule`.
- Parameterize `SemanticMemoryService.search` (remove `$queryRawUnsafe` interpolation).

**Estimate (prep only):** 1.5 dev days.

### 5.3 Freelancer Hardening and Navigation Overhaul

These are full product phases. Phase D should not start them, but it should avoid blocking them:
- Do not introduce new top-level `/app/*` routes that conflict with the Navigation Overhaul URL map.
- When building new UI, place pages in the target locations from the start (e.g. `/app/money/expenses` rather than adding another `/app/expenses-v2`).
- Keep the redirect table above accurate.

---

## 6. Suggested Execution Order

| Order | Work | Owner / Skill | Days | Merge Gate |
|-------|------|---------------|------|------------|
| 1 | 3.1 Command Spine (`SNOOZED` + action cards) | Full-stack | 1 | Tests green |
| 2 | 3.2 Cockpit redesign (pulse/briefing/governance) | Full-stack | 1.5 | UI build green |
| 3 | 3.3 Omnichannel hardening | Backend + UI | 2 | Tests green |
| 4 | 3.4 Device Capture public URL + prefill | Full-stack | 1 | Manual e2e receipt flow |
| 5 | 3.5 Voice session lifecycle + components | Frontend | 1.5 | Build green |
| 6 | 3.6 Flow Studio contracts + test mode | Backend + UI | 2 | Tests green |
| 7 | 4.1–4.3 Stabilization, redirects, tests | Full-stack | 1.5 | All gates green |
| 8 | 5.1–5.2 Strategic prep (events + interfaces) | Backend | 2.5 | Tests green |
| **Total** | | | **~13 dev days** | |

---

## 7. Acceptance Criteria for Phase D Completion

- [x] `/app/command-center` displays Pulse, Briefing, Governance, and an action-enabled Command Queue.
- [x] Snooze, complete, dismiss, assign, approve, execute, reopen all work from the Command Center list.
- [x] Response Draft "Save Draft" persists the edited body.
- [x] WhatsApp webhooks verify signatures and outbound messages capture provider IDs.
- [x] Device Capture uploads populate `MediaAsset.publicUrl`; receipt → expense prefill works.
- [x] Jarvis Voice creates/ends `VoiceSession` rows and respects saved voice/mute settings.
- [x] Flow Studio templates and run steps return `{ items, total }`; Test button works on draft flows; metrics update after runs.
- [x] `pnpm --filter server test` green.
- [x] `pnpm --filter server build` and `pnpm --filter web build` green.
- [x] Navigation redirect table is live and old URLs do not 404.
- [x] `docs/KEYFLOWOS_PHASE_D_REMAINING_WORK_PLAN.md` is updated if the plan changes during execution.

---

## 8. Notes & Risks

1. **Schema changes:** Phase D has no new tables, only DTO/schema enum/field usage. If a migration is required for `GenomeFact` prep, defer it to the next phase.
2. **Cross-plan overlap:** The Navigation Overhaul and Construction Manual Cockpit both touch `/app/command-center`. Build Cockpit first, then migrate URLs.
3. **WhatsApp signature verification:** Meta verification needs `WHATSAPP_APP_SECRET`; Twilio needs `TWILIO_AUTH_TOKEN`. Both must be added to `.env.example`.
4. **Flow test mode:** Running draft flows against real actions could have side effects. Ensure `runFlowTest` logs a `source: 'TEST'` flag and skips non-idempotent actions where possible.
5. **Runtime launch caveat:** `bash scripts/launch-dev.sh` uses `tsx` to run the server. The codebase has pre-existing circular module dependencies that `tsx`'s CJS transform surfaces as `ReferenceError: Cannot access ... before initialization` during boot, even though `pnpm --filter server build` and `pnpm --filter server test` pass. Two mitigations were applied in Phase D stabilization:
   - `key-cortex-phone.service.ts` now lazy-loads the optional `twilio` SDK instead of failing at import time.
   - `ai.module.ts` → `BlueprintModule` and `temporal-flow.module.ts` → `AiModule` use `forwardRef()`.
   Fully resolving the dev-boot cycle is out of Phase D scope; track as a follow-up if the launcher must be used in daily development.
6. **Do not expand the Body:** Per the Mind/Soul plan, Phase D adds no new connectors or commerce modules.
