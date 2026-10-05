# Data Model

This document summarizes the database entities, Prisma schema scale, and key data flows in KEYFLOWOS.

## Schema Scale

| Metric | Value |
|--------|-------|
| Schema file | `packages/db/prisma/schema.prisma` |
| Models | ~440 |
| Enums | ~16 |
| Lines in schema | ~12,690 |
| Migrations directory | `packages/db/prisma/migrations/` |
| Archived migrations | `packages/db/prisma/migrations-archive/`, `migrations-archived/` |
| Primary key type | `@id @default(cuid())` |
| Table naming | `PascalCase` model → `snake_case` table via `@@map` |

## Enums

```text
ApprovalStatus, BookingStatus, BusinessAssetStatus, BusinessEventType,
ContractAlertType, ContractStatus, DealStatus, EvidenceClaimType,
FlowSignalImportance, FlowSignalStatus, FlowType, InvoiceStatus,
ProjectTaskStatus, QuoteStatus, SubscriptionPaymentStatus, SubscriptionStatus
```

## Tenant Root

- **`Business`** is the central tenant. Most models carry `businessId` and are auto-scoped by the Prisma tenant-isolation extension.
- `Membership` links `User` to `Business` with a role.
- `UserIdentity` and `Session` support Supabase-backed identity.

## Entity Clusters

| Domain | Representative Models |
|--------|------------------------|
| Identity & Access | `User`, `UserIdentity`, `Business`, `Membership`, `Session`, `PushSubscription`, `ApiKey` |
| Business Profile / Genome | `BusinessBlueprint`, `BusinessGenome`, `BusinessProfileVersion`, `BusinessSetting`, `FounderProfile` |
| CRM | `Contact`, `Account`, `Deal`, `DealStage`, `ContactTag`, `ContactNote`, `ContactTask`, `CrmSequence`, `ContactMomentum`, `MergeOperation` |
| Commerce | `Product`, `ProductVariant`, `Quote`, `QuoteItem`, `Invoice`, `InvoiceItem`, `Payment`, `PaymentLink`, `RecurringInvoice`, `CreditNote`, `TaxRate` |
| Bookings & Calendar | `Booking`, `BookingWaitlistEntry`, `Service`, `Availability`, `StaffMember`, `Skill`, `CalendarEvent`, `CalendarSyncConflict` |
| Projects & Time | `Project`, `ProjectTask`, `ProjectMilestone`, `TimeEntry`, `ProjectTemplate`, `ProjectPlan` |
| Finance / Accounting | `FinancialAccount`, `ChartOfAccount`, `LedgerEntry`, `BankTransaction`, `BankConnection`, `BankRule`, `TaxLiability`, `RecurringExpense`, `RevenueAction` |
| Inventory & Marketplace | `InventoryStock`, `StockMovement`, `Warehouse`, `Shipment`, `FulfillmentRoute`, `MarketplaceListing`, `MarketplaceOrder`, `SupplierConnection` |
| Communications | `KeyInboxThread`, `KeyInboxMessage`, `WhatsAppContact`, `WhatsAppMessage`, `ChannelConnection`, `OutboundContent`, `OutboundDelivery`, `EmailCampaign` |
| Marketing | `LandingPage`, `LeadForm`, `LeadFormSubmission`, `CampaignBriefing` |
| AI / Autonomy / Cortex | `AiMemory`, `AiMemoryEmbedding`, `AiExecutionLog`, `AiUsageLog`, `AiGoal`, `AiPlan`, `CortexSession`, `CortexActionLog`, `KeyCortexMemory`, `AutonomyVerdict`, `FlowSession` |
| Genome / Intelligence | `GenomeFact`, `GenomeSignal`, `GenomeRecommendation`, `GenomeEvidence`, `GenomeExperiment`, `GenomeCrossDomainSnapshot`, `GenomeFinancialMetric` |
| Governance & Compliance | `Contract`, `ContractParty`, `ContractTerm`, `ContractVersion`, `ContractAlert`, `DocumentInstance`, `BusinessRisk`, `BusinessEntityLink` |
| Connectors & Integrations | `ConnectorStatus`, `ConnectorActivityLog`, `ConnectorAuditLog`, `IntegrationConnection`, `SocialConnection`, `Webhook`, `WebhookDeliveryLog`, `WebhookEvent` |
| Operating Kernel | `BusinessEvent`, `Evidence`, `TaskAssignment`, `ApprovalRequest`, `CommandItem`, `KeyCommand`, `TemporalFlowEvent`, `TemporalFlowMemory` |
| Community | `CommunityPost`, `CommunityComment`, `NetworkConnection`, `Opportunity`, `Cohort`, `PartnerProgram` |

## Key Data Flows

### 1. Request-Scoped Data Flow

```
HTTP request
  → TenantInterceptor sets businessId in AsyncLocalStorage
  → Prisma client extension intercepts find/findMany/update/delete
  → injects where: { businessId } for BUSINESS_ID_MODELS
  → query executed against PostgreSQL
```

Caveats from the codebase:

- `create`, `createMany`, `upsert`, `aggregate`, `groupBy` are **not** intercepted.
- `Payment` and `MarketplaceOrder` are intentionally excluded from `BUSINESS_ID_MODELS` because provider webhooks resolve the business from the provider key.
- Cron jobs, BullMQ workers, WebSocket handlers, and webhook paths have no request tenant context and must scope explicitly.

### 2. Soft Delete Flow

```
delete() / deleteMany()
  → soft-delete Prisma extension rewrites to update { deletedAt: now }
  → find operations automatically filter deletedAt: null
```

Models with soft delete include `Business`, `Contact`, `Product`, `Quote`, `Invoice`, `StaffMember`, `Service`, `Booking`, `SocialPost`, `Automation`, `Project`, `ProjectTask`, `Site`, `CalendarEvent`.

### 3. Token Encryption Flow

```
Create/update Business or SocialConnection token fields
  → tokenEncryptionExtension encrypts with AES-256-GCM
  → find operations decrypt transparently
```

Key source: `packages/db/src/middleware/token-encryption.ts`.

### 4. AI Memory / Embedding Flow

```
AI interaction
  → ModelGatewayService logs to AiExecutionLog / AiUsageLog
  → long-term memory stored in AiMemory + AiMemoryEmbedding (vector 1536)
  → context assembled by KeyCortexContextV2Service
```

### 5. Business Event Audit Flow

```
Domain event emitted
  → BusinessEventInterceptor / explicit emit
  → BusinessEventQueueService enqueues
  → BullMQ worker persists BusinessEvent
  → BusinessEventAnomalyService evaluates
```

### 6. Booking Waitlist Flow

```
Booking cancelled or rescheduled
  → booking.cancelled / booking.rescheduled event emitted
  → BookingWaitlistListener finds first WAITING entry matching the freed slot
  → BookingWaitlistService.offerSlot creates an UNCONFIRMED placeholder Booking
  → BookingWaitlistEntry.status set to OFFERED, offeredBookingId linked
  → Contact accepts via convertWaitlistEntry → placeholder Booking becomes CONFIRMED
  → Contact declines or timeout → cancelWaitlistEntry cancels entry + placeholder
```

Models: `BookingWaitlistEntry` → `Booking` (offered booking), `Contact`, `Service`, `StaffMember`.

### 7. Payment / Ledger Flow

```
Invoice created (Quote → Invoice)
  → Payment via Stripe/PayPal/WiPay/Google Pay
  → Webhook verified and parsed
  → PaymentsService records Payment
  → LedgerEntry posted
  → RevenueAction / attribution updated
```

### 8. KEY Action Boundary Flow

KF-EXEC-ACTION-001. No new table.

```
KeyActionProposal (key_action_proposals)      the action record
  capability_name, capability_version         real CapabilityContract identity
  execution_surface                           where the action entered
  action_envelope, action_fingerprint         canonical material parameters and their sha256
  control_requirement                         as derived when recorded, with the legacy decision beside it
  control_evidence, evidence_expires_at       server-issued, bound to the fingerprint and the principal
  requested_by, proposed_by, executed_for     with approved_by and executed_by, the principal chain
  outcome_evidence                            claim key, entity id, clearance basis, principal chain

IdempotencyKey (idempotency_keys)             the execution claim
  idempotency_key = key-action-claim:<actionId>
  @@unique([businessId, idempotencyKey])      the uniqueness invariant; unchanged
  status   claimed → completed | voided
  request_hash = the action fingerprint
  response = { actionId, supportTicketId }

SupportTicket (support_tickets)               the effect; unchanged
```

All twelve columns are nullable and are null on every row that is not an action record of an adopted capability. The claim row, the ticket and the outcome evidence are written in one transaction.

`KeyIdempotencyService` uses the same table for other keys. It treats a `pending` row as new and never compares `request_hash`; the boundary does not go through it, and its keys cannot collide with `key-action-claim:`.

## Data-Ownership Registry

Approximate model ownership is captured in `architecture/data-ownership.yaml` (auto-generated). It contains ~441 entries, with 92 currently marked `unassigned`.
