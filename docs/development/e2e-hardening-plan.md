# KEYFLOWOS End-to-End Hardening Plan

**Date:** 2026-08-30  
**Scope:** Move all user-facing features from "implemented / partially working" to verifiable end-to-end working.  
**Baseline:** Deep scan of 15 domains (auth, onboarding, command center, KEY AI, CRM, commerce, finance, bookings, communications/marketing, projects, documents, settings/admin, build/test, database, integrations).  
**Current build health:** Server `tsc` passes, Web `tsc` passes. Per-app builds are green. Root `pnpm` commands are blocked by a Windows Prisma-engine EPERM issue on this machine but work per-app.

---

## 0. Fixes Already Applied (2026-08-30)

The following items were fixed and verified in this session:

- **Admin login crash:** `AdminLoginDto` now uses `@IsNotEmpty()`; `validateCredentials` guards against undefined email/password.
- **Admin console access:** `isSuperAdmin()` falls back to `kf_admin_user_cache` so `/admin` no longer rejects a freshly-logged-in admin.
- **Auth DTO hardening:** `@IsNotEmpty()` added to `LoginDto` and `SignupDto` email/password fields.
- **Onboarding deep-link empty chat:** any empty-chat step now auto-seeds its card, not just `welcome`.
- **Commerce `markInvoicePaid` bypass:** removed the dangerous direct mutation from `packages/api/src/routers/commerce.ts`.
- **Public `/pay` page:** redirects to the real `/pay/${invoiceId}` gateway instead of calling an authenticated endpoint.
- **Cashflow forecast query:** now queries `RecurringExpense` instead of the non-existent `expense.nextRunDate`.
- **Tax-liability stale comment:** comment updated to reflect the current schema.
- **CRM data-quality "mark verified":** now updates `contact.lastVerifiedAt` and resolves stale issues instead of re-running a full scan.
- **Public booking DTO:** required contact fields now match the controller.
- **Evidence client path:** fixed `checkTaskEvidence` URL to match the server route.
- **Content-ops deliverable upload:** wired via `window.prompt` + `uploadDeliverables()` (prompt-based MVP).
- **Document intelligence page:** redirects to `/app/profile?tab=documents`.
- **Notifications page:** redirects to `/app/settings/notifications`.
- **AI DI hazard:** removed duplicate `@Inject` in `AiMessageSenderService`.
- **Social dead stub:** removed `SocialConnectionsService.exchangeOAuthCode` stub that threw even though the controller handled exchange.
- **Expense transaction matching:** removed the fake "Match transaction" button.
- **Project plan executor honesty:** `executeInAppEvent` now refuses to report success for unwired automations, marks the event `blocked` with `impactAnalysis.notImplemented`, records `event_execution_unavailable` on the timeline, leaves the linked task untouched, and returns `{ status: 'unavailable' }`. Tier-3 governance path remains `awaiting_approval`.
- **Finance intelligence crash:** `detectOverspending` no longer uses `groupBy` (which fails through the soft-delete middleware); it aggregates expenses in-memory.
- **Migration repair doc:** updated to reference the current `0_baseline` migration instead of the archived `20251128000000_baseline_full_schema`.

---

## 1. Current State Summary

### What is broadly working
- **Build & typecheck:** `apps/server` and `apps/web` both typecheck and build successfully today.
- **Auth foundation:** Supabase JWT verification, local JWT fallback, login/signup/callback/logout, token refresh, and Edge middleware gating are all functional.
- **Command Center:** Dashboard, module launcher, nav, redirects, and command-item actions are wired and tested.
- **Core data domains:** CRM contacts/deals, commerce invoices/quotes/products, finance ledger/COA/reconciliation, bookings/calendar CRUD, projects/tasks/time tracking, email campaigns, WhatsApp inbox, and social publishing all have real backends and working UIs.
- **Database:** Prisma schema validates, migrations are up to date, connection health is clean, tenant isolation extension covers the majority of business-scoped models.

### What is preventing 100% E2E
The remaining gaps fall into five patterns:

1. **Critical path blockers** — a new user cannot complete signup/onboarding or an admin cannot log in.
2. **Silent no-ops** — features look functional but do not actually execute (sequences never send, project plans fake execution, cashflow forecast queries the wrong table).
3. **Orphaned / mock surfaces** — pages exist but show hard-coded data or are not reachable from nav.
4. **Security / tenant isolation holes** — missing guards, unscoped background paths, plaintext tokens in some bulk paths.
5. **Tooling / environment friction** — Windows Prisma EPERM, stale lint ratchets, admin auth misconfiguration.

---

## 2. Priority Framework

| Tier | Definition | Examples |
|------|------------|----------|
| **P0 — Stop-the-line** | Blocks signup, login, onboarding, admin access, or creates live security holes. | Admin login 500, admin console gate, invoice endpoint guard, tenant isolation gaps, OAuth plaintext tokens. |
| **P1 — Core journey** | Breaks the primary day-one/day-seven user flow. | Onboarding empty chat, genome state loss, sequences no-send, cashflow forecast crash, booking double-book. |
| **P2 — Feature completeness** | Feature is reachable but incomplete or mock. | Document-intelligence dashboard, project milestones/notes, content-ops deliverable upload, duplicate detection scale. |
| **P3 — Polish & architecture** | Debt that slows future work or creates operational risk. | Dead routes/events, lint ratchets, Windows dev EPERM, AI/Cortex coupling. |

---

## 3. P0 Stop-the-Line Fixes (do first)

### 3.1 Admin login and console access
**Problem:** `POST /api/admin/auth/login` crashes with an empty body because `AdminAuthService.validateCredentials` calls `email.trim()` on a possibly-undefined value. Even after login succeeds, `/admin/*` denies the user because `admin/layout.tsx` reads `kf_user_cache`, but `/admin/login` only writes `kf_admin_user_cache`.  
**Evidence:** `logs/api-dev-bg.log:1:29:20`; `apps/server/src/modules/admin-auth/admin-auth.service.ts:50`; `apps/web/src/app/admin/login/page.tsx:43-49`; `apps/web/src/app/admin/layout.tsx:42-55`.  
**Fix:**
1. Add `@IsNotEmpty()` to `AdminLoginDto.email` and `.password` (and do the same for `LoginDto`/`SignupDto` as defense-in-depth).
2. Harden `validateCredentials` with an early `if (!email || !password) return null`.
3. Make `/admin/login` write the authenticated admin user into the cache key that `admin/layout.tsx` checks, or change the layout to read `kf_admin_user_cache` via a dedicated helper.
4. Add a server-side admin auth check to `admin/layout.tsx` (currently the check is client-side only).
5. Verify with a fresh server build and a manual `/admin/login` → `/admin/users` walkthrough.

### 3.2 Audit critical unguarded write endpoints
**Problem:** Some write endpoints are missing guards. The commerce invoice-creation endpoint was already fixed in source, but the tRPC `commerce.markInvoicePaid` bypasses the canonical workflow. The public `/public/pay` page calls an authenticated mark-paid endpoint.  
**Evidence:** `packages/api/src/routers/commerce.ts:46-49`; `apps/web/src/app/public/pay/page.tsx:17-33`.  
**Fix:**
1. Run a registry audit: grep every `@Post`/`@Patch`/`@Put`/`@Delete` in `apps/server/src/modules/**/*.controller.ts` for missing `@UseGuards(AuthGuard, BusinessGuard)`.
2. Fix any unguarded writes found; add regression tests.
3. Rewrite tRPC `markInvoicePaid` to call `CommerceService.markInvoicePaid` instead of mutating the row directly.
4. Remove or redirect `/public/pay` to the real `/pay/${invoiceId}` gateway flow.

### 3.3 Token encryption and tenant isolation backfill
**Problem:** OAuth/bank/social tokens are still plaintext in some bulk paths (`createMany`/`updateMany`/`deleteMany` are not encrypted). 42 business-scoped models remain outside `BUSINESS_ID_MODELS`, and cron/WebSocket/BullMQ paths have no ambient tenant context.  
**Evidence:** `packages/db/src/middleware/token-encryption.ts:193-337`; `packages/db/src/client.ts:81-277`; `apps/server/src/core/prisma/tenant-model-list.spec.ts:131-168`.  
**Fix:**
1. Extend token-encryption middleware to cover `createMany`, `updateMany`, `deleteMany` on the four protected models.
2. Provide `runWithTenant(businessId, systemUserId, ...)` for background handlers and apply it to BullMQ workers, cron jobs, and WebSocket handlers.
3. Add `KeyActionProposal` and `TemporalFlowMemory` to `BUSINESS_ID_MODELS` immediately (confirmed cross-tenant paths exist).
4. Add integration tests that fail if a cross-tenant read/write succeeds.

---

## 4. P1 Core Journey Fixes

### 4.1 Onboarding first-run experience
**Problem:** Deep-linking or resuming onboarding at `?step=intake|template|configure` shows an empty chat until the user types. The genome-intake conversation state lives in an in-memory `Map`, so refresh or server restart resets it. The only way to satisfy the contacts setup check is via `seedDemoData`, which also creates a demo invoice.  
**Evidence:** `apps/web/src/app/app/onboarding/components/key-onboarding-chat-view.tsx:61-78`; `apps/server/src/modules/ai/blueprint-onboarding.service.ts:122`; `apps/web/src/components/key/chat/key-onboarding-cards/comprehensive-cards.tsx:848-858`.  
**Fix:**
1. On mount, if `step !== 'welcome'` and the chat is empty, send a silent prompt to the orchestrator to present the card for the current step.
2. Persist `BlueprintOnboardingService` state to `GenomeChatMessage` (or reuse `GenomeChatService`) so the interview survives refresh.
3. Split "add sample contact" out of `seedDemoData` into a dedicated endpoint that does not create a demo invoice.
4. Decide whether legal/registration/tax/ownership sections are collected in onboarding; if not, remove them from the completion checklist UI.
5. Add an E2E test for the full `welcome → intake → template → configure → complete` path.

### 4.2 KEY AI / model gateway
**Problem:** Chat, deep-think, TTS, STT, and financial copilot all depend on a working AI provider. The `.env` now contains an OpenAI key, but logs showed repeated 401s with an older key. The full-duplex LiveKit voice component is implemented but never imported, and the voice-agent worker targets `gpt-realtime`, whose availability is unclear. The WebSocket `/key-cortex` gateway has no client.  
**Evidence:** `apps/web/src/components/key/chat/key-live-voice.tsx`; `apps/voice-agent/src/main.ts:115-118`; `apps/server/src/modules/key-cortex/key-cortex.gateway.ts:113`.  
**Fix:**
1. Verify the current `AI_INTEGRATIONS_OPENAI_API_KEY` is valid (run a smoke call via `ModelGatewayService`).
2. If OpenAI is the sole provider, ensure every service reads `AI_INTEGRATIONS_OPENAI_API_KEY` (not `OPENAI_API_KEY` or a hardcoded fallback).
3. Remove the `'native-key'` fallback in `model-gateway.service.ts` so missing config fails loudly.
4. Decide the fate of full-duplex voice: either wire `KeyLiveVoice` into the chat shell and use a verified realtime-capable model, or remove the dead code.
5. Either wire the `/key-cortex` WebSocket gateway to a client surface or deprecate it.
6. Fix the `FinanceIntelligenceService` Prisma `groupBy` `_count` issue (`logs/api-dev.log`) so background scans do not crash.

### 4.3 CRM sequences actually send messages
**Problem:** The sequence scheduler advances enrollments and emits `sequence.step_due`, but no listener creates `OutboundDelivery` or sends email/WhatsApp/SMS.  
**Evidence:** `apps/server/src/modules/crm/crm-sequence-scheduler.service.ts:367`; no subscriber to `sequence.step_due` found in communications/email-marketing/notifications.  
**Fix:**
1. Add an `OutboundDelivery` table/flow or extend the existing `delivery-queue.service.ts` to listen for `sequence.step_due`.
2. Implement sequence message dispatch through the configured channel (email via Gmail/Resend, WhatsApp, SMS fallback).
3. Update sequence analytics so `sentAt` reflects real dispatch.
4. Add an integration test that enrolls a contact, runs the scheduler, and asserts a delivery record is created.

### 4.4 Commerce / finance correctness
**Problem:** The cashflow forecast endpoint queries `expense.nextRunDate`, but that field lives on `RecurringExpense`, causing a runtime Prisma error. Safe-to-spend hard-codes payroll and debt to zero. Expense transaction matching is a toast placeholder.  
**Evidence:** `apps/server/src/modules/finance/cashflow-forecast.service.ts:68-75`; `apps/server/src/modules/finance/safe-to-spend.service.ts:68-70`; `apps/web/src/app/app/expenses/[id]/page.tsx:208`.  
**Fix:**
1. Rewrite the cashflow forecast query to use `RecurringExpense` plus scheduled bills.
2. Either implement payroll/debt reservation in safe-to-spend or remove the KPI until it is honest.
3. Wire the expense "Match transaction" button to the existing reconciliation data.
4. Add a manual journal-entry UI or restore `/app/finance/journal`.

### 4.5 Bookings avoid double-booking
**Problem:** `BookingsService.createBooking` inserts rows without conflict, availability, business-hours, or lead-time checks. The public booking widget derives slots only from `businessHours` and does not query real-time occupancy.  
**Evidence:** `apps/server/src/modules/bookings/bookings.service.ts:693`; `apps/web/src/app/book/[slug]/components/utils.ts:5`.  
**Fix:**
1. Extract a shared `validateBookingSlot` helper and call it from both `createBooking` and `publicCreateBooking`.
2. Add a `GET /bookings/public/businesses/:businessId/availability` endpoint that returns free slots for a service/staff/date, and wire the public widget to it.
3. Fix the `PublicCreateBookingDto` / controller mismatch on required contact fields.

---

## 5. P2 Feature Completeness

### 5.1 Projects
**Problem:** Milestones, notes, and deliverables tabs keep state in React only. Task assignment backend exists but has no UI. Plan event execution is faked. Budget and kanban views are implemented but not imported.  
**Evidence:** `apps/web/src/app/app/projects/components/project-detail.tsx:110-112`; `apps/server/src/modules/projects/project-plan-executor.service.ts:172-174`.  
**Fix:**
1. Wire milestones/notes/deliverables tabs to the existing server endpoints.
2. Add an assignee picker to tasks and call the task-assignment API.
3. Implement real plan event execution via `FlowOrchestrator`.
4. Import `ProjectBudgetView` and `TaskKanban` into the detail tabs or delete them.

### 5.2 Documents / Evidence / Content Ops
**Problem:** `/app/document-intelligence` is a mock page. `/app/documents` is gated off in production. Evidence and content ops are gated by add-on packs. Content-ops deliverable upload is a stub toast.  
**Evidence:** `apps/web/src/app/app/document-intelligence/page.tsx:119-151`; `apps/web/src/app/app/documents/layout.tsx:6`; `apps/web/src/app/app/content-ops/[id]/page.tsx:189-192`.  
**Fix:**
1. Replace `/app/document-intelligence` mock data with real API calls.
2. Decide the permanent home for documents (`/app/documents`, `/app/profile?tab=outputs`, or the new hub) and remove the gates/redirects.
3. Wire content-ops deliverable upload to the existing `uploadDeliverables()` helper.
4. Fix the broken `evidence.ts` client path (`/evidence/check` vs. `/businesses/:businessId/tasks/.../evidence-check`).

### 5.3 Integrations / Key Connector
**Problem:** The new `/key-connector` module is a backend shell: it writes `IntegrationConnection` rows without credential validation, returns zero-row sync placeholders, and returns placeholder AI-gateway objects. The UI still uses the legacy `/connectors` routes, and 16 of 22 legacy connectors return `PULL_SYNC_NOT_IMPLEMENTED`.  
**Evidence:** `apps/server/src/modules/key-connector/key-connector.service.ts:134-202`; `apps/server/src/modules/key-connector/sync/sync-engine.service.ts:298-334`; `apps/server/src/core/connectors/connector-sync-not-implemented.spec.ts:28-71`.  
**Fix:**
1. Decide whether to finish Key Connector or deprecate it in favor of the legacy connector framework.
2. If finishing Key Connector: implement credential validation, real sync, and provider-service dispatch before switching the UI.
3. If keeping legacy connectors: implement pull sync for the highest-value connectors (Drive, Calendar, Contacts, QuickBooks/Xero) or hide the "Sync" button for unsupported ones.

### 5.4 Communications / Marketing polish
**Problem:** Marketing campaigns only send via connected Gmail; no default ESP. WhatsApp template creation is not in the UI. `/app/notifications` is an empty page.  
**Evidence:** `apps/server/src/modules/email-marketing/email-marketing.service.ts:397-439`; `apps/web/src/app/app/notifications/page.tsx:7-14`.  
**Fix:**
1. Add a Resend/SystemEmail fallback for marketing campaigns when Gmail is not connected.
2. Redirect `/app/notifications` to `/app/settings/notifications` or render the preferences inline.
3. Add a WhatsApp template creation/link-to-Meta CTA in the inbox.

---

## 6. P3 Polish & Architecture

### 6.1 Dead code and orphan routes
**Problem:** 157 `/app/**` routes are not in nav. 111 events are published-only, 30 are listened-only. Legacy `client.ts` still coexists with `lib/api/*`.  
**Evidence:** `architecture/route-registry.yaml`; `architecture/event-registry.yaml`.  
**Fix:**
1. Review orphaned routes; remove dead pages or add launcher/nav entries.
2. Audit dead events; remove or add listeners.
3. Migrate remaining `client.ts` consumers to `lib/api/*` and retire `client.ts`.

### 6.2 Build / test / CI
**Problem:** Root `pnpm` commands fail on Windows with a Prisma engine EPERM rename. E2E tests are not wired into CI. Server lint is non-blocking with a high warning ceiling. Production deploy is commented out.  
**Evidence:** `turbo.json`; `.github/workflows/ci-cd.yml`; `apps/web/playwright.config.ts`.  
**Fix:**
1. Document WSL/Docker as the supported dev environment, or add a Windows Defender exclusion / elevated-shell guidance for the pnpm store.
2. Wire `pnpm --filter web test:e2e` into CI (non-blocking initially).
3. Lower the server lint ceiling and make lint blocking once warnings are paid down.
4. Uncomment or rewrite the deploy job.

### 6.3 Database hygiene
**Problem:** Soft-delete middleware covers only 15 models and does not hook `groupBy`/`aggregate`. Migration repair docs reference an old baseline. Orphaned tag-migration scripts point to missing files.  
**Evidence:** `packages/db/src/middleware/soft-delete.ts:19-34`; `docs/development/prisma-migration-repair.md`.  
**Fix:**
1. Extend soft-delete coverage to all models with `deletedAt` and to aggregation operations.
2. Update migration repair docs to reference `0_baseline` and the current folder layout.
3. Delete or archive orphaned backfill scripts.

### 6.3.2 Nullable-column default strictness
**Problem:** The schema contains nullable columns with no default (`String?`, `Int?`, etc.) that application code resolves with `??` to a restrictive value. That makes the strict branch the implicit default for any row that was never explicitly configured, which silently breaks downstream flows. Recent examples:
- `bufferMins` falling back to a strict buffer that blocks ordinary bookings.
- `inventoryMode` falling back to `"strict"`, causing `store-order` and `inventory-risk` to disagree and block checkout for merchants who never set inventory policy.
- Product catalog visibility falling back to hidden when inventory is unconfigured, so products silently disappear from the storefront (`catalog.service.ts`; fixed in `37b2400a`).
**Evidence:** `packages/db/prisma/schema.prisma`; grep results for `\?\?` in `apps/server/src/modules/**` and `packages/**`.
**Fix:**
1. Audit every nullable schema field that lacks a `@default`.
2. For each field, decide whether the absence should mean permissive, strict, or truly null.
3. Add explicit `@default` values where the strict fallback is the intended default, or change the code fallback to the permissive value.
4. Add a lint/snapshot test that flags new nullable columns without a default unless they are explicitly documented as tri-state.

### 6.4 AI / Cortex decoupling
**Problem:** `key-cortex` is the largest module (~248 files, ~80 services) with heavy `forwardRef` cycles.  
**Fix:** This remains a long-term migration per `architecture/migration-plan.md` Phase 3. Do not start until P0–P2 are stable.

---

## 7. Suggested Execution Order

### Sprint A — Foundation (week 1)
1. Fix admin login crash and console access.
2. Audit and guard any unguarded write endpoints.
3. Harden auth DTOs with `@IsNotEmpty()`.
4. Verify AI provider key and fix `FinanceIntelligenceService` `groupBy` crash.
5. Fix onboarding empty-chat on deep links and split contact seed from demo invoice.

### Sprint B — Core Journeys (weeks 2–3)
1. Persist onboarding genome-chat state.
2. Implement sequence message dispatch.
3. Fix cashflow forecast, safe-to-spend, and expense transaction matching.
4. Add shared booking validation and public availability API.
5. Wire project milestones/notes/deliverables to the server.

### Sprint C — Feature Surfaces (weeks 4–5)
1. Replace document-intelligence mock page with real data.
2. Decide documents hub and remove production gates.
3. Wire content-ops deliverable upload.
4. Add marketing campaign ESP fallback.
5. Fix `/app/notifications` empty page.

### Sprint D — Hardening (weeks 6–7)
1. Tenant isolation backfill for background/edge paths.
2. Token encryption bulk-path coverage.
3. Dead route/event cleanup and `client.ts` retirement.
4. CI E2E wiring and lint ratchet.
5. Database soft-delete and migration docs cleanup.

### Sprint E — Architecture (weeks 8+)
1. Key Connector vs. legacy connector decision and implementation.
2. AI/Cortex decoupling per existing migration plan.

---

## 8. Verification Criteria

For each domain, define "100% end-to-end working" as:

1. **A user can reach the feature from the nav or a canonical URL** without a 404 or redirect loop.
2. **The happy-path action succeeds** (create/read/update/delete) and persists.
3. **Error states are handled** with a user-visible message, not a silent no-op or white screen.
4. **Background side effects occur** where expected (emails sent, invoices created, ledger posted, events emitted).
5. **Authorization and tenant scoping are enforced** on every write path.
6. **Automated tests exist** for the critical path (unit or integration).

### Recommended E2E smoke suite
- Signup → email verification → onboarding → Command Center.
- Admin login → user list → feature-flag toggle.
- Create contact → create quote → convert to invoice → send public payment link → record payment.
- Create booking → reschedule → complete → verify calendar event.
- Create sequence → enroll contact → run scheduler → verify delivery.
- Create project → add task → assign user → log time → invoice time.

---

## 9. Open Questions Requiring User Decision

1. **Admin auth strategy:** Separate local admin-only flow, or allow any `SUPER_ADMIN` user to access `/admin` with their Supabase session?
2. **Full-duplex voice:** Priority feature to finish and wire, or remove the dead code?
3. **Key Connector:** Finish the new module, or invest in the legacy connector framework?
4. **Documents hub:** Which surface is canonical — `/app/documents`, `/app/document-intelligence`, or `/app/profile?tab=outputs`?
5. **Add-on packs:** Are Evidence and Content Ops meant to be enabled for launch, or remain gated?
6. **Marketing ESP:** Should campaigns fall back to Resend/SystemEmail when Gmail is not connected?
7. **Dev environment:** Is native Windows supported, or should WSL/Docker be the standard?

---

## 10. Related Documents

- `architecture/migration-plan.md` — living migration plan; this hardening plan becomes Phase 2B.
- `architecture/architecture-risks.md` — risk registry; several findings here map to R1–R56.
- `architecture/target-architecture.md` — long-term direction for AI/Cortex decoupling and tenant isolation.
- `AGENTS.md` — launch procedure and known gotchas.
