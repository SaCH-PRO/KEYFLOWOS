# Key Connect + Key Inbox Design Spec

**Date:** 2026-05-31  
**Status:** Reviewed — ready for implementation planning  
**Author:** Kimi Code CLI  
**Scope:** Unify all external inputs (social, messaging, email, Google Drive) into a single connection hub and a single intelligent inbox where KEY assesses, recommends, executes, and learns.

---

## 1. Goals

1. **Key Connect** — one interface (`/app/key-connect`) to connect, configure, and monitor every external channel: Google Drive, Gmail, WhatsApp, Facebook/Instagram/Messenger, and later others.
2. **Key Inbox** — one interface (`/app/key-inbox`) that receives every ingestion item, shows it as a triage card, lets KEY propose actions, lets the user approve/reject/correct, and executes approved actions.
3. **Google Drive must flow through Key Inbox** instead of the standalone Drive intake page.
4. **Remove redundant pages** once Key Connect + Key Inbox are live:
   - `/app/connect/drive` (replaced by Key Inbox queue + Key Connect card)
   - `/app/inbox/intake` (replaced by Key Inbox)
   - `/app/inbox/unified` (replaced by Key Inbox)
   - `/app/build/connect/*` placeholder shells (replaced by Key Connect)
5. **Preserve and reuse** the existing strong engines:
   - `core/connectors` framework (registry, credentials, health, sync, webhooks)
   - `ModelGatewayService` / `AiUsageService` for LLM calls
   - `MessageIntakeOrchestrator` for message assessment/planning
   - `DriveIntakeOrchestrator` for document assessment/planning
   - `GovernanceService` for approval items
6. **Design for scale** — extend the existing `IConnector` interface so adding a new source later requires only a new adapter implementation.

---

## 2. Current State & Redundancy

### What exists today
- `apps/web/src/app/app/connect/page.tsx` — real connector dashboard backed by `/connectors` API.
- `apps/server/src/core/connectors/` — full framework: `ConnectorRegistryService`, `IConnector`, `ConnectorStatus`, `ConnectorCredentialsService`, `ConnectorSyncSchedulerService`, `ConnectorController`.
- Existing connector implementations: `google_drive`, `gmail`, `whatsapp`, `meta_social`, `google_calendar`, `google_forms`, etc.
- `apps/web/src/app/app/connect/drive/page.tsx` — Drive browser + intake queue.
- `apps/web/src/app/app/inbox/unified/page.tsx` — unified conversation threads.
- `apps/web/src/app/app/inbox/intake/page.tsx` — message intake approval queue.
- `apps/web/src/app/app/build/connect/*` — empty placeholder shells.
- Server-side:
  - `InboundCommunicationsService` — email/SMS webhook routing.
  - `WhatsAppService` — outbound + thin inbound webhook.
  - `SocialController` — outbound publishing + thin inbound webhook stub.
  - `GoogleDriveService` + `ConnectorIntelligenceService.syncGoogleDrive()` — Drive polling/extraction.
  - `MessageIntakeOrchestrator` — message assessment, plan creation, approval, execution.
  - `DriveIntakeOrchestrator` — document assessment, plan creation, approval, execution.

### What is redundant after this build
1. Standalone `/app/inbox/intake` page.
2. Standalone `/app/inbox/unified` page.
3. Standalone `/app/connect/drive` page.
4. `/app/build/connect/*` placeholder pages.
5. The separate `DriveIntakeFile` UI queue (function absorbed into Key Inbox).

---

## 3. Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         KEY CONNECT                                 │
│  /app/key-connect  (UI)                                             │
│  - Reuses /connectors API                                           │
│  - Connector cards + settings slide-out                             │
└─────────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   [Google Drive]        [Email/WhatsApp]      [Meta Social]
   existing connector     existing connector    existing connector
   extended with          extended with         extended with
   syncToIngestion()      parseInbound()        parseInbound()
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     INGESTION ORCHESTRATOR                          │
│  - Normalizes every input into an `IngestionItem`                   │
│  - Resolves contact / entity                                        │
│  - Classifies intent + extracts entities                            │
│  - Builds a proposed action plan                                    │
│  - Creates a governance approval item                               │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          KEY INBOX                                  │
│  /app/key-inbox                                                     │
│  - Triage list of all IngestionItems                                │
│  - Filter by source, status, intent, contact                        │
│  - Expand card to see original payload + KEY assessment             │
│  - Approve / reject / edit proposed actions                         │
│  - Execute approved actions                                         │
└─────────────────────────────────────────────────────────────────────┘
```

### Key principle: reuse the existing connector framework

`/app/key-connect` is a **new UI page** that consumes the existing `/connectors` API. No new backend controller is created for the connection hub. We extend the existing `IConnector` interface with two optional methods:

```ts
export interface IConnector {
  // ... existing methods ...

  /**
   * Poll the provider for new items and return normalized inputs.
   * Invoked by ConnectorIntelligenceService (5-minute poll) for polling connectors.
   */
  syncToIngestion?(businessId: string): Promise<IngestionItemInput[]>;

  /**
   * Parse a provider webhook payload into normalized inputs.
   * Invoked by webhook controllers after signature verification.
   */
  parseInbound?(
    payload: unknown,
    businessId: string,
  ): IngestionItemInput[] | Promise<IngestionItemInput[]>;

  /**
   * Verify a provider webhook signature. Return true if valid.
   * Called by webhook controllers before parseInbound.
   */
  verifyWebhook?(
    payload: unknown,
    signature: string | undefined,
    secret: string,
  ): boolean | Promise<boolean>;
}
```

For **polling connectors** like Google Drive, the existing `ConnectorIntelligenceService` (which already polls every 5 minutes) will call `syncToIngestion()` on the `google_drive` connector and feed results to `IngestionOrchestrator`. The nightly `ConnectorSyncSchedulerService` remains unchanged and is not used for ingestion.

For **webhook connectors**:
- **WhatsApp** and **Meta social** use registered connectors (`whatsapp`, `meta_social`). Webhook controllers call `verifyWebhook()` and `parseInbound()` on those connector instances, then emit `ingestion.item.received`.
- **Email** and **SMS** are not registered `ConnectorType` values today. They are treated as pseudo-connectors: webhook controllers use the global `INBOUND_WEBHOOK_SECRET` for verification, then call a shared `EmailSmsIngestionAdapter.parseInbound()` to produce `IngestionItemInput`. A future iteration can promote them to full connectors.

An `IngestionListener` subscribes to `ingestion.item.received` and calls `IngestionOrchestrator.receive()`.

This preserves the current event-bus decoupling and keeps webhook handlers fast.

---

## 4. Core Abstractions

### 4.1 `IngestionItemInput`

Every connector adapter returns one or more of these. The `IngestionOrchestrator` turns this into a persisted `IngestionItem`.

```ts
interface IngestionItemInput {
  sourceType: 'email' | 'whatsapp' | 'sms' | 'instagram' | 'messenger' | 'google_drive' | 'manual';
  externalId?: string;            // provider-side stable id
  receivedAt?: Date;              // provider timestamp
  from: {                         // sender/uploader
    id?: string;
    name?: string;
    email?: string;
    phone?: string;
  };
  to?: string;                    // destination mailbox/number/page
  subject?: string;               // email subject / post title
  body?: string;                  // message body / extracted text
  rawPayload: Record<string, unknown>;
  attachments?: IngestionAttachment[];
}

interface IngestionAttachment {
  externalId?: string;
  name: string;
  mimeType: string;
  url?: string;                   // public/pre-signed URL
  sizeBytes?: number;
}
```

### 4.2 `IngestionItem` (new Prisma model)

A single table/entity replaces `MessageIntake`, `DriveIntakeFile`, and any future intake queues.

```prisma
model IngestionItem {
  id                    String    @id @default(cuid())
  businessId            String    @map("business_id")
  sourceType            String    @map("source_type")
  sourceConnectorType   String    @map("source_connector_type")
  externalId            String?   @map("external_id")
  contactId             String?   @map("contact_id")
  status                String    @default("pending")

  rawPayload            Json      @map("raw_payload")
  summary               String?
  subject               String?
  body                  String?
  toDestination         String?   @map("to_destination")
  receivedAt            DateTime? @map("received_at")
  attachments           Json?     @map("attachments")
  fromName              String?   @map("from_name")
  fromEmail             String?   @map("from_email")
  fromPhone             String?   @map("from_phone")
  fromExternalId        String?   @map("from_external_id")
  dedupeHash            String?   @map("dedupe_hash")
  intentType            String?   @map("intent_type")
  confidence            Float?
  extractedData         Json?     @map("extracted_data")
  proposedActions       Json?     @map("proposed_actions")
  userFeedback          Json?     @map("user_feedback")
  executedResults       Json?     @map("executed_results")
  errorMessage          String?   @map("error_message")

  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")

  @@unique([businessId, sourceType, externalId])
  @@unique([businessId, dedupeHash])
  @@index([businessId, status])
  @@index([businessId, sourceType])
  @@index([businessId, createdAt])
  @@map("ingestion_items")
}

// sourceType vs sourceConnectorType:
// sourceType is the semantic type of the item (email, whatsapp, google_drive).
// sourceConnectorType is the registered connector type (gmail, whatsapp, meta_social, google_drive).
// They can differ when one connector produces multiple source types (e.g. meta_social -> instagram | messenger).

// sourceType vs sourceConnectorType:
// sourceType is the semantic type of the item (email, whatsapp, google_drive).
// sourceConnectorType is the registered connector type (gmail, whatsapp, meta_social, google_drive).
// They can differ when one connector produces multiple source types (e.g. meta_social -> instagram | messenger).
```

Status values: `pending`, `extracting`, `reviewing`, `approved`, `rejected`, `error`, `auto_executed`.

State flow:
- `pending` → `extracting` (Drive only) → `reviewing`
- `pending` → `reviewing` (messages)
- `reviewing` → `approved` / `rejected` / `error`
- `reviewing` → `auto_executed` (auto-approve path)
- `error` → `reviewing` (after retry/reassess)

### 4.3 `IngestionOrchestrator`

Single entry point for all inbound items.

```ts
interface IngestionOrchestrator {
  receive(input: IngestionItemInput, businessId: string): Promise<IngestionItem>;
  reassess(itemId: string, userHint?: string): Promise<IngestionItem>;
  buildPlan(item: IngestionItem): Promise<IngestionItem>;
  execute(itemId: string, userId: string): Promise<IngestionItem>;
  reject(itemId: string, userId: string, reason?: string): Promise<IngestionItem>;
}
```

**Sequence for a new item:**

1. Connector adapter `parseInbound` / `syncToIngestion` returns `IngestionItemInput[]`.
2. `IngestionOrchestrator.receive()`:
   - Deduplicate by `(businessId, sourceType, externalId)` when `externalId` is present; otherwise by `dedupeHash` computed as `SHA256(businessId + sourceType + fromEmail/phone + subject + body + receivedAt)`.
   - Resolve contact via `EntityResolutionService`.
   - Persist `IngestionItem` with status `pending` and `dedupeHash`.
   - Call `buildPlan()`.
3. `buildPlan()`:
   - For `sourceType` in `['email','whatsapp','sms','instagram','messenger']` → call the extracted `MessageIntakeOrchestrator.buildPlanFromInput(input)` and copy the resulting plan JSON into `IngestionItem.proposedActions`.
   - For `sourceType === 'google_drive'`:
     - First, set status to `extracting` and call `DocumentIntelligenceService.extractFromDocument()` to populate `extractedData`.
     - Then call `DriveIntakeOrchestrator.buildPlanFromExtractedData(extractedData, fileMeta)` and copy the plan into `proposedActions`.
   - For unknown source types → generic LLM assessment.
   - Update `IngestionItem` with `intentType`, `confidence`, `extractedData`, `proposedActions`, status `reviewing`.
   - Create `aiApprovalItem` via `GovernanceService`.

### Refactoring legacy orchestrators

`MessageIntakeOrchestrator` and `DriveIntakeOrchestrator` are currently tightly coupled to `MessageIntake` and `DriveIntakeFile` tables. The refactor strategy is:

1. Extract pure plan-building functions from both orchestrators:
   - `MessageIntakeOrchestrator.buildPlanFromInput(input: IngestionItemInput)`
   - `DriveIntakeOrchestrator.buildPlanFromExtractedData(extractedData, fileMeta)`
2. Extract pure execution functions that accept the plan JSON and perform side effects:
   - `MessageIntakeOrchestrator.executePlanJson(plan, businessId, userId)`
   - `DriveIntakeOrchestrator.executePlanJson(plan, businessId, userId)`
3. Keep legacy webhook/event listeners writing to legacy tables for one release behind a feature flag, then remove them in Phase 5.
4. `IngestionOrchestrator` becomes the only caller of the pure plan/execution functions for new items.
5. User opens Key Inbox and approves/rejects/corrects.
6. `execute()` runs the plan through the extracted execution functions:
   - Messages → `MessageIntakeOrchestrator.executePlanJson(plan, businessId, userId)`
   - Drive → `DriveIntakeOrchestrator.executePlanJson(plan, businessId, userId)`
   - Updates status to `approved`.

### 4.4 Auto-execute state machine

Each connector has `autoApproveThreshold` stored in the typed column `ConnectorStatus.autoApproveThreshold` only (default `null`, meaning manual only).

Rules:
- If `autoApproveThreshold` is `null` or `confidence` is `null`, never auto-execute.
- If `confidence >= autoApproveThreshold`, `IngestionOrchestrator.receive()` calls `execute()` automatically after `buildPlan()` succeeds.
- Item status becomes `auto_executed`.
- No `aiApprovalItem` is created for auto-executed items.
- If execution fails, status falls back to `error` and user is notified.

**Governance changes:** `AiApprovalItem.status` is currently a plain `String`. Add `auto_resolved` as a supported value and add `GovernanceService.autoResolveApproval(itemId, businessId, userId)` for any future cases where auto-execution needs an explicit audit record. Default auto-execution does not create an approval item.

### 4.5 Schema changes to `ConnectorStatus`

Add typed columns for Key Inbox settings:

```prisma
model ConnectorStatus {
  // ... existing fields ...
  intakeEnabled                 Boolean  @default(false) @map("intake_enabled")
  autoApproveThreshold          Float?   @map("auto_approve_threshold")
  createContactsAutomatically   Boolean  @default(true) @map("create_contacts_automatically")
  // metadata remains for connector-specific settings
}
```

Settings are read/written via:
- Read: new `ConnectorStatusService.getInboxConfig(businessId, connectorType)` (create this service; it wraps `ConnectorStatus` CRUD).
- Write: `PATCH /connectors/businesses/:businessId/inbox-config/:type`

---

## 5. Key Connect UI (`/app/key-connect`)

### UI
- Grid of connector cards, grouped by `ConnectorGroup`.
- Each card shows: icon, name, connection status, last sync, toggle for "Send to Key Inbox".
- Clicking a card opens a slide-out with:
  - Auth section (OAuth button or credential dialog — reuse existing `/connectors/credentials/:type` API).
  - Webhook URL + secret copy (for inbound webhook connectors — reuse `/connectors/webhook-info/:type`).
  - Settings: intake enabled, auto-approve threshold, default contact creation behavior.
  - Test / sync now / disconnect (reuse existing `/connectors/test/:type`, `/connectors/sync/:type`, `/connectors/disconnect/:type`).

### Backing API

Key Connect reuses the existing `/connectors` controller. The actual paths are under `/connectors/businesses/:businessId/...`:

- `GET /connectors/businesses/:businessId/dashboard`
- `GET /connectors/businesses/:businessId/list`
- `GET /connectors/businesses/:businessId/statuses`
- `GET /connectors/businesses/:businessId/health/:type`
- `POST /connectors/businesses/:businessId/sync/:type`
- `POST /connectors/businesses/:businessId/disconnect/:type`
- `POST /connectors/businesses/:businessId/authenticate/:type`
- `POST /connectors/businesses/:businessId/reconnect/:type`
- `POST /connectors/businesses/:businessId/test/:type`
- `POST /connectors/businesses/:businessId/smoke/:type`
- `GET /connectors/businesses/:businessId/credentials/:type`
- `POST /connectors/businesses/:businessId/credentials/:type`
- `GET /connectors/businesses/:businessId/webhook-info/:type`

We add one new endpoint for updating Key Inbox-specific settings:

- `PATCH /connectors/businesses/:businessId/inbox-config/:type`
  - Body: `{ intakeEnabled?: boolean; autoApproveThreshold?: number | null; createContactsAutomatically?: boolean }`
  - Updates `ConnectorStatus` typed columns (not metadata).

All other UI calls go to existing `/connectors` endpoints.

---

## 6. Key Inbox UI (`/app/key-inbox`)

### UI
- Header with filters: all / messages / documents / social / status.
- Search bar.
- Triage list of cards.
- Each card shows:
  - Source icon (Drive, WhatsApp, Gmail, etc.)
  - Sender / file name
  - Summary line
  - Intent tag + confidence
  - Status badge
  - Proposed actions count
- Expand card to show:
  - Original payload preview (sanitized)
  - KEY assessment (intent, extracted entities)
  - Proposed actions list
  - Approve / Reject / Edit buttons

### Backing API (new `KeyInboxController`)

All endpoints require `AuthGuard` + `BusinessGuard` + `ModuleScopeGuard` with module `operations`.

| Endpoint | Scope |
|---|---|
| `GET /key-inbox/businesses/:businessId/items` | `operations:read` |
| `GET /key-inbox/businesses/:businessId/items/:itemId` | `operations:read` |
| `POST /key-inbox/businesses/:businessId/items/:itemId/approve` | `operations:write` |
| `POST /key-inbox/businesses/:businessId/items/:itemId/reject` | `operations:write` |
| `POST /key-inbox/businesses/:businessId/items/:itemId/correct` | `operations:write` |

#### DTOs

```ts
interface IngestionItemListResponse {
  items: IngestionItemDto[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface IngestionItemDto {
  id: string;
  sourceType: string;
  sourceConnectorType: string;
  status: string;
  summary: string;
  intentType?: string;
  confidence?: number;
  from: { name?: string; email?: string; phone?: string };
  subject?: string;
  createdAt: string;
  proposedActionsCount: number;
}

interface IngestionItemDetailDto extends IngestionItemDto {
  body?: string;
  rawPayload: Record<string, unknown>;
  extractedData: Record<string, unknown>;
  proposedActions: ProposedAction[];
  executedResults?: Record<string, unknown>;
  userFeedback?: UserFeedback;
}

interface ProposedAction {
  id: string;
  type: string;
  title: string;
  description?: string;
  payload: Record<string, unknown>;
}

interface UserFeedback {
  action: 'approved' | 'rejected' | 'corrected';
  reason?: string;
  note?: string;
  correctedActions?: ProposedAction[];
}
```

#### Query parameters for list
- `status` — filter by status
- `sourceType` — filter by source
- `search` — search summary/subject/from/body
- `intentType` — filter by intent
- `sortBy` — `createdAt` | `updatedAt` | `confidence`
- `sortOrder` — `asc` | `desc` (default `desc`)
- `cursor` + `limit` — cursor pagination (default `limit=25`, max `100`)

#### Endpoints
- `GET /key-inbox/businesses/:businessId/items`
- `GET /key-inbox/businesses/:businessId/items/:itemId`
- `POST /key-inbox/businesses/:businessId/items/:itemId/approve`
- `POST /key-inbox/businesses/:businessId/items/:itemId/reject`
  - Body: `{ reason?: string }`
- `POST /key-inbox/businesses/:businessId/items/:itemId/correct`
  - Body: `{ correctedActions: ProposedAction[]; note?: string }`
  - Behavior:
    1. Validate item is in `reviewing` or `error` status (optimistic lock).
    2. Replace `proposedActions` with `correctedActions`.
    3. Store `userFeedback` with action `corrected`, note, and corrected actions.
    4. Update `aiApprovalItem` description if one exists.
    5. Return updated item. User must then click Approve to execute; no automatic execution on correct.

#### Concurrency & idempotency
- All mutation endpoints use Prisma `update` with `status` in the `where` clause as an optimistic lock.
- Example: `update IngestionItem where id=:id AND status='reviewing'`.
- If no rows updated, return `409 Conflict` with current item state.
- Duplicate approve requests are idempotent: if status is already `approved` or `auto_executed`, return the existing result.
- Correct/reject on an already-executed/rejected item returns `409 Conflict`.

---

## 7. Webhook Routing & Verification

### Existing webhook endpoints to extend

| Connector | Endpoint | Current State | Change |
|---|---|---|---|
| Email | `POST /communications/inbound/email` | Generic, HMAC via `INBOUND_WEBHOOK_SECRET` | Route through `IngestionOrchestrator` |
| SMS | `POST /communications/inbound/sms` | Generic | Route through `IngestionOrchestrator` |
| WhatsApp | `POST /whatsapp/webhook/:businessId` | Stub parser | Implement real Meta/Twilio parser + verification |
| Meta social | `POST /social/webhook/:businessId` | Stub parser | Implement real Meta signature verification + parser |
| Google Drive | N/A — polling | Polls every 5 min | `syncToIngestion()` on `google_drive` connector |

### Verification strategy
- Email/SMS: continue using `INBOUND_WEBHOOK_SECRET` HMAC signature in `x-keyflow-signature`.
- WhatsApp Meta: verify payload signature using Meta app secret.
- WhatsApp Twilio: validate `X-Twilio-Signature` using Twilio auth token.
- Meta social: verify `X-Hub-Signature-256` using app secret.
- All webhook endpoints return `400` on verification failure and log to `WebhookDeliveryLog`.

### Webhook delivery log
```prisma
model WebhookDeliveryLog {
  id              String   @id @default(cuid())
  businessId      String   @map("business_id")
  connectorType   String   @map("connector_type")
  payload         Json
  headers         Json
  statusCode      Int?     @map("status_code")
  responseBody    String?  @map("response_body")
  errorMessage    String?  @map("error_message")
  retryCount      Int      @default(0) @map("retry_count")
  createdAt       DateTime @default(now()) @map("created_at")

  @@index([businessId, connectorType, createdAt])
  @@map("webhook_delivery_logs")
}
```

---

## 8. Migration & Redundancy Removal

### Pages to remove / redirect
- `/app/inbox/intake` → redirect to `/app/key-inbox`
- `/app/inbox/unified` → redirect to `/app/key-inbox`
- `/app/connect/drive` → redirect to `/app/key-inbox`
- `/app/build/connect/*` → redirect to `/app/key-connect`
- `/app/connect` → redirect to `/app/key-connect` (implemented in Phase 5 after Key Connect is verified stable).

### Components to keep
- `DriveIntakeQueue` → refactor to render `IngestionItem[]` inside Key Inbox.
- `MessageIntakeQueue` → refactor to render `IngestionItem[]` inside Key Inbox.
- `ResponseDraftPanel` → keep, invoked from Key Inbox expanded card.

### Server tables
- `MessageIntake` and `DriveIntakeFile` become **read-only source-specific snapshots**.
- `IngestionOrchestrator` writes only to `IngestionItem` going forward.
- Existing webhook/poll paths are refactored to emit `ingestion.item.received` events, which `IngestionListener` consumes to write to `IngestionItem`.
- For one release, legacy event listeners remain enabled behind a feature flag `LEGACY_INTAKE_ENABLED` (default `false` for new code, `true` during migration). In Phase 5, the flag is removed and legacy listeners deleted.
- Backfill: create `IngestionItem` rows from existing `MessageIntake` and `DriveIntakeFile` records.

#### Backfill details
- For each `MessageIntake` row, create an `IngestionItem` with:
  - `sourceType` = `sourceChannel`
  - `sourceConnectorType` inferred from `sourceChannel` (`email` → `gmail`, `whatsapp` → `whatsapp`, `instagram` → `meta_social`, etc.)
  - `externalId` = `externalId`
  - `contactId` = existing `contactId`
  - `status` mapped from legacy status
  - `fromName`, `fromEmail`, `fromPhone` copied from `fromName` / resolved contact
  - `summary` = legacy summary or generated from body
  - `proposedActions` = legacy `proposedActions`
  - `executedResults` and `userFeedback` preserved where available
- For each `DriveIntakeFile` row, create an `IngestionItem` with:
  - `sourceType` = `google_drive`
  - `sourceConnectorType` = `google_drive`
  - `externalId` = `driveFileId`
  - `summary` = file name
  - `extractedData` = legacy extracted data
  - `proposedActions` = legacy proposed actions
- Deterministic IDs: `SHA256(businessId + sourceType + COALESCE(externalId, legacyId))` passed explicitly to create calls.
- Backfill `ConnectorStatus.intakeEnabled` from `Business.messageIntakeEnabled`: if `Business.messageIntakeEnabled = true`, set `ConnectorStatus.intakeEnabled = true` for `whatsapp` and `meta_social` connectors. Email remains a pseudo-connector; its intake gating continues via `Business.messageIntakeEnabled` until email is promoted to a full connector in a follow-up iteration.
- Script is wrapped in a transaction; re-runnable.
- Rollback: delete `IngestionItem` rows where `id` starts with the deterministic migration prefix `ki_mig_` (migration script prefixes deterministic IDs with `ki_mig_`); legacy tables untouched.

---

## 9. Error Handling & Operational Policy

### Connector inbound failures
- Webhook parser errors return `400 Bad Request` with structured error; provider retries are provider-dependent.
- Transient AI failures during `buildPlan()` mark item status `error` and store `errorMessage`.
- Retry policy for `buildPlan()`: inline retry within the event handler, 3 attempts with exponential backoff (1s, 3s, 9s). If all fail, status `error` and notify user. No separate job queue for v1.

### Duplicate detection
- `IngestionOrchestrator.receive()` checks `(businessId, sourceType, externalId)` uniqueness.
- If `externalId` is missing, fallback dedupe uses `SHA256(sourceType + from.email/phone + subject + body + receivedAt)`.
- Duplicate payloads return the existing `IngestionItem` id with `200 OK` (idempotent).

### Rate limiting
- Public webhook endpoints rate-limited per business: 60 requests/minute.
- Internal `IngestionOrchestrator` calls to `AiUsageService` inherit existing 30 req/min/business limit.

### Dead-letter / replay
- Failed webhooks logged to `WebhookDeliveryLog`.
- Admin replay via future admin tool or one-off script.

---

## 10. Implementation Phases

### Phase 1: Foundation
- Add `IngestionItem` and `WebhookDeliveryLog` Prisma models.
- Extend `ConnectorStatus` with `intakeEnabled`, `autoApproveThreshold`, `createContactsAutomatically`.
- Create `IngestionOrchestrator`.
- Create `KeyInboxController` and service.
- Add `syncToIngestion`, `parseInbound`, `verifyWebhook` optional methods to `IConnector`.

### Phase 2: Google Drive through Key Inbox
- Implement `syncToIngestion()` on `google_drive` connector.
- Route Drive files through `IngestionOrchestrator`.
- Refactor Drive UI queue into Key Inbox.

### Phase 3: Messaging connectors
- Implement real `parseInbound()` and `verifyWebhook()` for email, SMS, WhatsApp, Meta social.
- Route inbound messages through `IngestionOrchestrator`.
- Add WhatsApp config UI and credential fields.

### Phase 4: Key Connect + Key Inbox UI
- Build `/app/key-connect` page.
- Build `/app/key-inbox` page.
- Add navigation entries.
- Remove/redirect redundant pages.

### Phase 5: Cleanup
- Delete redundant pages and dead code.
- Disable legacy event listeners (`MessageIntakeListener` for messages, Drive intake legacy path) and remove feature flag.
- Update AGENTS.md / docs.
- End-to-end test.

### Phase 6: Feedback loop
- Vector-based learning from approvals/rejections/corrections.
- Deferred to a separate spec (`docs/superpowers/specs/2026-06-key-inbox-feedback-loop-design.md`) to keep initial implementation focused.

---

## 11. Testing Checklist

- [ ] Connect Google Drive → new file appears in Key Inbox → approve → invoice/contact/task created.
- [ ] Configure email webhook → send email → appears in Key Inbox → approve → reply/thread created.
- [ ] Configure WhatsApp → inbound message → appears in Key Inbox → approve → reply sent.
- [ ] Connect Meta social → DM/comment → appears in Key Inbox → approve → response posted.
- [ ] Reject an item + give reason → reason stored.
- [ ] Correct an item via edited actions → revised plan executed.
- [ ] Auto-approve threshold executes high-confidence items automatically.

---

## 12. Out of Scope (for this plan)

- **Feedback-loop learning** (vector similarity, few-shot prompt injection) — deferred to a separate spec.
- **Admin replay UI** for failed webhooks — logged, but no UI in v1.
- **Promoting email/SMS to full connectors** — they remain pseudo-connectors in v1.
- **Replacing `/app/crm/intake`** — excluded; only `/app/inbox/*` and `/app/connect/drive` are replaced.
- **Meta Ads** — not implemented.

## 13. What the User Needs to Do to Test

1. **Google Drive:** Connect a Google account with Drive files (invoices/receipts). No external webhook needed.
2. **Email:** Set `INBOUND_WEBHOOK_SECRET`, then forward email from a provider (Resend, Cloudflare, custom MTA) to `POST /communications/inbound/email` with `x-keyflow-signature` HMAC.
3. **WhatsApp:** Either Twilio account + WhatsApp sender, OR Meta WABA + phone number ID + access token. Webhook must point to `POST /whatsapp/webhook/:businessId`.
4. **Meta social:** Meta app with `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, and webhook subscribed to `messages` + `instagram_basic` events pointing to `POST /social/webhook/:businessId`.
5. **OpenAI key:** Ensure `AI_INTEGRATIONS_OPENAI_API_KEY` is set so KEY can assess items.

---

## 14. Module Boundaries & File Locations

| Component | Location | Notes |
|---|---|---|
| `IngestionOrchestrator` | `apps/server/src/modules/ingestion/ingestion-orchestrator.service.ts` | New module `IngestionModule`. |
| `IngestionListener` | `apps/server/src/modules/ingestion/ingestion.listener.ts` | Listens to `ingestion.item.received`. |
| `KeyInboxService` | `apps/server/src/modules/ingestion/key-inbox.service.ts` | Query/mutation logic for IngestionItem. |
| `KeyInboxController` | `apps/server/src/modules/ingestion/key-inbox.controller.ts` | HTTP routes under `/key-inbox`. |
| `EmailSmsIngestionAdapter` | `apps/server/src/modules/ingestion/adapters/email-sms-ingestion.adapter.ts` | Pseudo-connector parser for email/SMS webhooks. |
| `ConnectorStatusService` (inbox config) | `apps/server/src/core/connectors/connector-status.service.ts` or extend existing service | Reads/writes `ConnectorStatus` inbox columns. |
| `IConnector` extensions | `apps/server/src/core/connectors/connector.interface.ts` | Add optional `syncToIngestion`, `parseInbound`, `verifyWebhook`. |
| `KeyConnectPage` | `apps/web/src/app/app/key-connect/page.tsx` | New UI page. |
| `KeyInboxPage` | `apps/web/src/app/app/key-inbox/page.tsx` | New UI page. |

## 15. Open Questions

1. Should rejected items be permanently deleted or archived?  
   **Recommended default:** archived (status `rejected`), searchable, never deleted.
2. Should there be an "auto-approve when confidence > X" toggle per connector?  
   **Recommended:** yes, in connector config; default off.
3. Should Key Inbox replace `/app/crm/intake` as well?  
   **Recommended:** yes — route manual CRM intake through `IngestionItem` with `sourceType: 'manual'`.

---

## 16. Decision Log

| Decision | Rationale |
|----------|-----------|
| Reuse existing `core/connectors` framework | Avoids duplicate registry, credentials, health, sync, and webhook infrastructure. |
| `/app/key-connect` is a UI route only | Backend remains `/connectors`; minimal API surface change. |
| Single `IngestionItem` table | Prevents N intake queues; enables one inbox and one audit log. |
| Extend `IConnector` with optional `syncToIngestion` / `parseInbound` / `verifyWebhook` | Backward-compatible; non-intake connectors are unaffected. |
| Reuse existing orchestrators | Preserves investment in Drive/message assessment and execution logic. |
| Remove standalone intake/unified pages | Eliminates redundancy; one inbox is the product promise. |
| Defer feedback loop to separate spec | Keeps initial implementation focused and testable. |
