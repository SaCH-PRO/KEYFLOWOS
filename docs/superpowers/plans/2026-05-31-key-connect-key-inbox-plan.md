# Key Connect + Key Inbox Implementation Plan

**Date:** 2026-05-31  
**Spec:** `docs/superpowers/specs/2026-05-31-key-connect-key-inbox-design.md`  
**Approach:** Build in phases. First deliverable is Phase 1 + 2 (foundation + Google Drive), so the user can test Key Inbox immediately. Then layer messaging connectors and UI.

---

## Phase 1: Foundation (Prisma + Orchestrator + API)

**Goal:** `IngestionItem` table exists, `IngestionOrchestrator` can receive/build/execute plans, and `KeyInboxController` exposes CRUD.

### 1.1 Prisma schema changes

**Files:**
- `packages/db/prisma/schema.prisma`

**Changes:**
1. Add `IngestionItem` model with all fields from spec.
2. Add `WebhookDeliveryLog` model.
3. Extend `ConnectorStatus` with `intakeEnabled`, `autoApproveThreshold`, `createContactsAutomatically`.
4. Run `pnpm --filter db migrate dev --name key_connect_key_inbox`.
5. Regenerate Prisma client: `pnpm --filter db generate`.

### 1.2 Extend `IConnector` interface

**Files:**
- `apps/server/src/core/connectors/connector.interface.ts`

**Changes:**
1. Add optional methods:
   - `syncToIngestion?(businessId: string): Promise<IngestionItemInput[]>`
   - `parseInbound?(payload, businessId): IngestionItemInput[] | Promise<...>`
   - `verifyWebhook?(payload, signature, secret): boolean | Promise<boolean>`
2. Add `IngestionItemInput` type definition to this file or a new `ingestion.types.ts`.

### 1.3 Create `IngestionModule`

**Files to create:**
- `apps/server/src/modules/ingestion/ingestion.module.ts`
- `apps/server/src/modules/ingestion/ingestion-orchestrator.service.ts`
- `apps/server/src/modules/ingestion/ingestion.listener.ts`
- `apps/server/src/modules/ingestion/key-inbox.service.ts`
- `apps/server/src/modules/ingestion/key-inbox.controller.ts`
- `apps/server/src/modules/ingestion/dto/*.dto.ts`
- `apps/server/src/modules/ingestion/adapters/email-sms-ingestion.adapter.ts`

**Files to modify:**
- `apps/server/src/app.module.ts` — import `IngestionModule`.

**Implementation details:**
- `IngestionOrchestrator.receive()`:
  - Compute `dedupeHash`.
  - Deduplicate via `prisma.ingestionItem.findUnique` on `(businessId, sourceType, externalId)` or `(businessId, dedupeHash)`.
  - Resolve contact.
  - Persist item status `pending`.
  - Call `buildPlan()`.
- `buildPlan()`:
  - Messages → delegate to new extracted method in `MessageIntakeOrchestrator`.
  - Drive → `extracting` → `DocumentIntelligenceService.extractFromDocument` → plan.
- `execute()`:
  - Optimistic lock on `reviewing` status.
  - Call extracted execution method.
  - Update status to `approved`.
- `reject()`:
  - Optimistic lock.
  - Update status to `rejected`, store `userFeedback`.
- `KeyInboxController`:
  - Implement all endpoints from spec.
  - Cursor pagination via Prisma `cursor` + `take`.

### 1.4 Refactor legacy orchestrators (minimal)

**Files:**
- `apps/server/src/modules/communications/message-intake-orchestrator.service.ts`
- `apps/server/src/modules/commerce/drive-intake-orchestrator.service.ts`

**Changes:**
1. Extract `buildPlanFromInput(input)` from `buildPlan()`.
2. Extract `executePlanJson(plan, businessId, userId)` from `executePlan()`.
3. Keep legacy public methods (`receive`, `buildPlan`, `executePlan`) working for backward compatibility.

### 1.5 Tests

- Unit test `IngestionOrchestrator.receive()` deduplication.
- Unit test `buildPlan()` delegates to correct legacy orchestrator.
- Unit test optimistic-lock mutations.
- Server build passes: `pnpm --filter server build`.

---

## Phase 2: Google Drive Through Key Inbox

**Goal:** Real Drive files appear in Key Inbox; approving creates invoices/payments/tasks.

### 2.1 Implement `syncToIngestion` on Google Drive connector

**Files:**
- `apps/server/src/core/connectors/implementations/google-drive.connector.ts`
- `apps/server/src/modules/ai/connector-intelligence.service.ts`

**Changes:**
1. Add `syncToIngestion(businessId)` to `google-drive.connector`.
   - Reuse `GoogleDriveService.listFiles()` and download logic.
   - Return `IngestionItemInput[]` with `sourceType: 'google_drive'`.
2. Modify `ConnectorIntelligenceService.syncGoogleDrive()`:
   - Get the `google-drive` connector from registry.
   - If `connector.syncToIngestion` exists and `ConnectorStatus.intakeEnabled` is true, call it and emit `ingestion.item.received` for each input.
   - Keep existing Drive file extraction logic as fallback during transition.

### 2.2 Wire `IngestionListener`

**Files:**
- `apps/server/src/modules/ingestion/ingestion.listener.ts`

**Changes:**
1. Subscribe to `ingestion.item.received`.
2. Call `IngestionOrchestrator.receive()` for each input.

### 2.3 Event emitter wiring

**Files:**
- Wherever `ConnectorIntelligenceService` emits events.

**Changes:**
1. After `syncToIngestion()` returns inputs, emit `ingestion.item.received` for each.

### 2.4 Backfill migration script

**Files:**
- `scripts/backfill-ingestion-items.ts` (new)

**Changes:**
1. Query existing `MessageIntake` and `DriveIntakeFile` rows.
2. Create deterministic `IngestionItem` rows with `ki_mig_` prefix.
3. Set `ConnectorStatus.intakeEnabled = true` for `google_drive` connector where Drive was connected.
4. Wrap in transaction.

### 2.5 Tests

- Connect Google Drive in `/app/connect`.
- Trigger sync or wait for 5-minute poll.
- Verify `IngestionItem` rows appear in DB.
- Server build passes.

---

## Phase 3: Key Inbox UI

**Goal:** User can see and approve/reject/correct Drive items in `/app/key-inbox`.

### 3.1 Create Key Inbox page

**Files to create:**
- `apps/web/src/app/app/key-inbox/page.tsx`
- `apps/web/src/app/app/key-inbox/components/ingestion-item-card.tsx`
- `apps/web/src/app/app/key-inbox/components/ingestion-item-detail.tsx`
- `apps/web/src/app/app/key-inbox/components/ingestion-item-list.tsx`
- `apps/web/src/lib/api/key-inbox.ts`

**Files to modify:**
- `apps/web/src/components/ui/navigation/*` or wherever main nav lives.

**Implementation details:**
- Fetch `/key-inbox/businesses/:businessId/items` with cursor pagination.
- Render cards with source icon, summary, status, intent.
- Expand card to show detail, proposed actions, approve/reject/correct.
- Approve calls `POST .../approve`, refreshes list.

### 3.2 Refactor Drive intake queue components

**Files:**
- `apps/web/src/app/app/connect/drive/components/drive-intake-queue.tsx`

**Changes:**
1. Refactor to accept `IngestionItem[]` and render inside Key Inbox detail view.
2. Or remove and use new generic components.

### 3.3 Tests

- `pnpm --filter web build` passes.
- User can open `/app/key-inbox`, see Drive items, approve one.
- Approved item executes and creates invoice/contact/task.

---

## Phase 4: Key Connect UI

**Goal:** `/app/key-connect` becomes the main connector hub.

### 4.1 Create Key Connect page

**Files to create:**
- `apps/web/src/app/app/key-connect/page.tsx`
- `apps/web/src/app/app/key-connect/components/connector-card.tsx`
- `apps/web/src/app/app/key-connect/components/connector-detail-sheet.tsx`
- `apps/web/src/lib/api/key-connect.ts`

**Implementation details:**
- Call `GET /connectors/businesses/:businessId/statuses`.
- Render grouped cards.
- Card click opens sheet with auth, webhook info, settings toggles.
- Settings PATCH `/connectors/businesses/:businessId/inbox-config/:type`.

### 4.2 Add new server endpoint for inbox config

**Files:**
- `apps/server/src/core/connectors/connector.controller.ts`
- `apps/server/src/core/connectors/connector-status.service.ts` (new)

**Changes:**
1. Create `ConnectorStatusService` to read/write inbox config.
2. Add `PATCH /connectors/businesses/:businessId/inbox-config/:type`.

### 4.3 Tests

- User can toggle “Send to Key Inbox” for Google Drive.
- Toggle persists after refresh.
- `pnpm --filter web build` and `pnpm --filter server build` pass.

---

## Phase 5: Messaging Connectors

**Goal:** Email, WhatsApp, and Meta social DMs flow into Key Inbox.

### 5.1 Email/SMS webhook

**Files:**
- `apps/server/src/modules/communications/inbound-communications.controller.ts`
- `apps/server/src/modules/communications/inbound-communications.service.ts`
- `apps/server/src/modules/ingestion/adapters/email-sms-ingestion.adapter.ts`

**Changes:**
1. Verify HMAC signature using `INBOUND_WEBHOOK_SECRET`.
2. Parse payload into `IngestionItemInput`.
3. Emit `ingestion.item.received`.
4. Gate by `Business.messageIntakeEnabled` (existing behavior).

### 5.2 WhatsApp webhook

**Files:**
- `apps/server/src/modules/whatsapp/whatsapp.controller.ts`
- `apps/server/src/modules/whatsapp/whatsapp.service.ts`
- `apps/server/src/core/connectors/implementations/whatsapp.connector.ts`

**Changes:**
1. Implement `parseInbound()` and `verifyWebhook()` on WhatsApp connector.
   - Support Twilio signature (`X-Twilio-Signature`) and Meta signature.
2. Update WhatsApp webhook controller to use connector methods.
3. Emit `ingestion.item.received`.

### 5.3 Meta social webhook

**Files:**
- `apps/server/src/modules/social/social.controller.ts`
- `apps/server/src/core/connectors/implementations/meta-social.connector.ts`

**Changes:**
1. Implement `parseInbound()` and `verifyWebhook()` on Meta social connector.
2. Verify `X-Hub-Signature-256`.
3. Emit `ingestion.item.received`.

### 5.4 Add WhatsApp config UI

**Files:**
- `apps/web/src/app/app/build/connect/whatsapp/page.tsx` or Key Connect detail sheet.

**Changes:**
1. Add credential fields for Twilio/Meta WABA.
2. Show webhook URL and verify token.

### 5.5 Tests

- Send inbound email → appears in Key Inbox.
- Send WhatsApp message → appears in Key Inbox.
- Send Meta DM → appears in Key Inbox.

---

## Phase 6: Cleanup & Redirection

**Goal:** Remove redundant pages and old event listeners.

### 6.1 Redirects

**Files:**
- `apps/web/src/app/app/inbox/intake/page.tsx`
- `apps/web/src/app/app/inbox/unified/page.tsx`
- `apps/web/src/app/app/connect/drive/page.tsx`
- `apps/web/src/app/app/build/connect/*/page.tsx`
- `apps/web/src/app/app/connect/page.tsx`

**Changes:**
1. Replace content with `redirect('/app/key-inbox')` or `redirect('/app/key-connect')`.
2. Update navigation to point to new routes.

### 6.2 Remove legacy listeners

**Files:**
- `apps/server/src/modules/communications/message-intake.listener.ts`
- Any Drive legacy intake listener.

**Changes:**
1. Remove feature flag and delete listeners that write to legacy tables.
2. Keep legacy orchestrator public methods if still used elsewhere; otherwise deprecate.

### 6.3 Delete dead components

**Files:**
- Any components only used by removed pages.

### 6.4 Update docs

**Files:**
- `AGENTS.md`
- `docs/superpowers/specs/2026-05-31-key-connect-key-inbox-design.md` — mark implemented.

---

## Phase 7: Feedback Loop (separate spec)

**Deferred.** After the main build is live and tested, write and implement `docs/superpowers/specs/2026-06-key-inbox-feedback-loop-design.md`.

---

## Recommended first deliverable

**Implement Phase 1 + 2 + 3 first.** This gives you:
- `IngestionItem` model
- `IngestionOrchestrator`
- Google Drive → Key Inbox
- `/app/key-inbox` UI

You can test Google Drive end-to-end before we touch messaging connectors.

---

## Testing plan per phase

| Phase | Test |
|-------|------|
| 1 | `pnpm --filter server build`, unit tests for dedupe/locking |
| 2 | Connect Drive, sync, items appear in DB |
| 3 | Open `/app/key-inbox`, approve Drive item, invoice created |
| 4 | Toggle Drive intake in `/app/key-connect` |
| 5 | Inbound email/WhatsApp/Meta → Key Inbox → approve |
| 6 | Old URLs redirect, build passes |

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Refactoring legacy orchestrators breaks existing flows | Keep legacy public methods working; add unit tests before changing. |
| Deduplication misses duplicates | Use both `(businessId, sourceType, externalId)` and `dedupeHash` unique constraints. |
| Webhook verification incompatible with providers | Implement per-provider verification; log failures. |
| Large migration fails | Transaction-wrapped backfill with deterministic IDs; rollback script. |
| UI build breaks | Build after each phase; fix TypeScript errors immediately. |

---

## Next action

Start **Phase 1.1** (Prisma schema migration) once this plan is approved.
