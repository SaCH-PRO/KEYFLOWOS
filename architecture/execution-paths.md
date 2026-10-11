# Execution Paths

This document lists the major execution pathways traced during baseline cartography, with file paths and key symbols where available.

## 1. API Bootstrap and Request Handling

```
apps/server/src/main.ts
  → validate env (core/config/env.ts)
  → create Nest app
  → configureNestApp (app-bootstrap.ts): trust proxy, helmet, CORS, rate limit
  → install tenant context provider (packages/db/src/client.ts)
  → listen on :: :PORT

Incoming HTTP request
  → CorrelationIdMiddleware
  → AuthMiddleware (core/auth/auth.middleware.ts) → req.user
  → TenantInterceptor (core/tenant/tenant.interceptor.ts) → ALS businessId
  → Controller / tRPC router
  → Service → PrismaService → @keyflow/db client
```

Key symbols:

- `bootstrap()` — `apps/server/src/main.ts`
- `configureNestApp()` — `apps/server/src/app-bootstrap.ts`
- `AppModule` — `apps/server/src/app.module.ts`
- `AuthMiddleware.configure()` — `apps/server/src/core/auth/auth.middleware.ts`
- `TenantInterceptor.intercept()` — `apps/server/src/core/tenant/tenant.interceptor.ts`
- `runWithTenant()` / `getCurrentBusinessId()` — `apps/server/src/core/tenant/tenant-context.ts`

## 2. Authentication

### Supabase JWT Path

```
Client sends Bearer token (from localStorage / kf_token cookie)
  → AuthMiddleware.configure() — apps/server/src/core/auth/auth.middleware.ts
       → SupabaseAuthService.getUserFromToken()
            → local HMAC verify against SUPABASE_JWT_SECRET (preferred)
            → or Supabase getUser() round-trip
       → PrismaService resolves User role from Prisma User / Membership
       → req.user attached { userId, email, role, businessId?, admin? }
  → BusinessGuard / ModuleScopeGuard / optional guards enforce access
```

### Token Refresh

```
Access token near expiry or 401 from /trpc or REST
  → apps/web/src/lib/api.ts fetchWithAuthRetry()
       → refreshAccessToken() in apps/web/src/lib/workspace.ts
            → POST to Supabase auth token endpoint
            → writes new access token to localStorage
            → mirrors token to kf_token cookie for Edge middleware
       → retries original request with new Bearer token
```

### Admin HMAC Fallback

```
Admin token (Bearer) or x-admin-token header
  → AuthMiddleware
       → admin-token.util (local HMAC against ADMIN_JWT_SECRET + Redis)
       → req.user with admin role
```

### Key symbols / files

- `AuthMiddleware` — `apps/server/src/core/auth/auth.middleware.ts`
- `SupabaseAuthService.getUserFromToken` — `apps/server/src/core/auth/supabase-auth.service.ts`
- `SupabaseAuthService` / `SupabaseAdminService` — `apps/server/src/core/auth/auth.module.ts`
- `admin-token.util` — `apps/server/src/core/auth/admin-token.util.ts`
- `AuthGuard`, `BusinessGuard`, `OptionalAuthGuard`, `ModuleScopeGuard`, `GenomeGateGuard` — `apps/server/src/core/guards/*`
- `User` / `Membership` / `UserIdentity` models — `packages/db/prisma/schema.prisma`
- Redis admin-token storage — `apps/server/src/core/redis/redis.service.ts`

## 3. Web Auth and App Shell

### Edge Gate

```
Browser request to /app/*
  → apps/web/src/middleware.ts (Edge)
       → reads kf_token cookie
       → checks token expiry
       → redirects to /auth/login if missing/expired (308)
       → otherwise forwards to route
```

### Authenticated Shell

```
/app/* route renders
  → apps/web/src/app/app/layout.tsx (AppLayout)
       → RequireAuth — apps/web/src/components/require-auth.tsx
            → calls /identity/me via apiGet
            → redirects to /auth/login on 401
       → Providers (theme, toast, compose)
       → GenomeProvider / genome-context.tsx loads Business Genome integrity
       → Sidebar / mobile bottom nav / KEY chat bubble
       → Onboarding gate (redirects to /app/onboarding if incomplete)
```

### Sign-in Pages

```
/auth/login
  → apps/web/src/app/auth/login/page.tsx
  → apps/web/src/app/auth/login/login-form.tsx
       → Supabase email/password signInWithPassword
       → Supabase OAuth signInWithOAuth (Google)
       → on success: setStoredToken + kf_token cookie, bootstrap workspace

/auth/callback
  → apps/web/src/app/auth/callback/page.tsx
       → Supabase PKCE / OAuth callback exchange
       → creates/fetches Business via identity bootstrap
       → redirects to /app/command-center (or /app/onboarding)

/auth/signup
  → apps/web/src/app/auth/signup/page.tsx
       → Supabase signUp
       → IdentityService creates User + Business + Membership
```

### Identity Bootstrap

```
POST /identity/bootstrap (or /identity/me)
  → IdentityController — apps/server/src/modules/identity/identity.controller.ts
       → IdentityService
            → creates Prisma User (if new)
            → creates default Business
            → creates Membership
            → returns user + business list
```

### Key symbols / files

- `apps/web/src/middleware.ts`
- `apps/web/src/app/app/layout.tsx`
- `apps/web/src/components/require-auth.tsx`
- `apps/web/src/lib/workspace.ts` — token/business identity persistence
- `apps/web/src/lib/api.ts` — fetchWithAuthRetry, apiGet/apiPost
- `apps/web/src/app/auth/login/page.tsx` + `login-form.tsx`
- `apps/web/src/app/auth/callback/page.tsx`
- `apps/web/src/contexts/genome-context.tsx`
- `apps/server/src/modules/identity/identity.controller.ts`
- `apps/server/src/modules/identity/identity.service.ts`

## 4. Onboarding / Business Genesis

```
/app/onboarding
  → chat-driven funnel: welcome → intake → template picker → configure → genome check → complete
  → business-genesis API (apps/web/src/lib/api/business-genesis.ts)
  → NestJS modules/business-genesis/*
  → populates BusinessBlueprint (Genesis sections)
  → markOnboardingComplete redirects to /app/command-center
```

Key files:

- `apps/web/src/app/app/onboarding/page.tsx`
- `apps/web/src/lib/api/business-genesis.ts`
- `apps/server/src/modules/business-genesis/*`
- `apps/server/src/modules/business-genome/*`

## 5. Command Center / Dashboard

```
/app/command-center
  → AppLayout with module launcher
  → business-command-center service aggregates KPIs/actions
  → KEY agent bubble receives module context (AiContextProvider)
  → Module launcher dispatches to /app/<domain>
```

Key files:

- `apps/web/src/app/app/command-center/page.tsx`
- `apps/web/src/contexts/ai-context.tsx`
- `apps/server/src/modules/business-command-center/*`
- `apps/web/src/components/ui/module-launcher-sheet.tsx`

## 6. KEY AI Chat / Voice

### Chat Path

```
/app/key/chat or slide-out panel
  → KeyChatProvider, KeyChatCommandBar, KeyMessageBubble
  → api calls through lib/api/key-agent.ts
  → server key-agent / key-cortex services
  → ModelGatewayService selects provider and logs usage
```

### Voice Path

```
User opens voice bar
  → key-live-voice.tsx requests LiveKit token from server
  → LivekitService creates room, mints JWT, dispatches agent
  → voice-agent worker joins room
  → OpenAI Realtime (gpt-realtime) handles audio
  → agent state propagated via lk.agent.state participant attribute
```

Key files:

- `apps/web/src/components/key/chat/key-live-voice.tsx`
- `apps/web/src/components/key/chat/voice-conversation.ts`
- `apps/server/src/modules/livekit/livekit.service.ts`
- `apps/voice-agent/src/main.ts`
- `apps/server/src/modules/ai/model-gateway.service.ts`

## 7. Commerce / Invoicing / Payments

### Create Invoice

```
User in /app/commerce/invoices
  → commerce page + invoice form components
  → tRPC commerce.createInvoice (or REST equivalent)
       → packages/api/src/routers/commerce.ts
       → CommerceService — apps/server/src/modules/commerce/commerce.service.ts
            → creates Invoice + InvoiceItem rows
            → computes tax, totals, status = DRAFT / SENT
            → creates optional PaymentLink
            → emits invoice.created via EventEmitter2 / BusinessEventInterceptor
```

### Send Invoice

```
Send action in commerce UI
  → tRPC commerce.sendInvoice
       → CommerceService
            → updates Invoice.status = SENT
            → creates OutboundDelivery / email via SystemEmailService or connector
            → emits invoice.sent
```

### Customer Payment

```
Customer opens public pay page
  → /pay/:invoiceId — apps/web/src/app/pay/[invoiceId]/page.tsx
  → or /widgets/pay/:invoiceId — apps/web/src/app/widgets/pay/[invoiceId]/page.tsx
       → fetches invoice details via public/payments endpoint
       → renders Stripe Card / PayPal button / Google Pay / WiPay

User submits payment
  → PaymentsService — apps/server/src/modules/payments/payments.service.ts
       → Stripe: create PaymentIntent / confirm, charge customer
       → PayPal: server SDK v2 order capture
       → WiPay: redirect/callback flow with hash verification
       → creates Payment record linked to Invoice
       → updates Invoice.status = PAID (or PARTIAL)
       → posts LedgerEntry via finance/ledger service
       → creates Receipt record
       → emits invoice.paid via ctx.eventBus / BusinessEventInterceptor
       → triggers margin snapshot via supplier/cost services
       → triggers receipt email
```

### Webhook Ingestion

```
Stripe webhook
  → POST /payments/stripe/webhook (preferred) OR /webhooks/stripe
       → WebhooksController — apps/server/src/modules/webhooks/webhooks.controller.ts
            → raw body preserved
            → Stripe SDK signature verification (STRIPE_WEBHOOK_SECRET)
            → delegates to PaymentsService.handleStripeWebhook
                 → idempotency via IdempotencyKey model
                 → updates Invoice / Payment
                 → posts ledger entries
                 → emits invoice.paid

PayPal webhook
  → PayPal connector / webhook controller
       → verifies webhook signature
       → PaymentsService.handlePayPalWebhook

WiPay callback
  → WiPay connector callback handler
       → verifies callback hash
       → records Payment + updates Invoice
```

### Side Effects

- Ledger entries posted to `LedgerEntry` (double-entry)
- `Receipt` generated and emailed via `SystemEmailService` (Resend)
- `MarginSnapshot` computed/updated for costed products
- `BusinessEvent` persisted by `BusinessEventQueueService` / BullMQ worker
- `WebhookDeliveryLog` records ingress attempts
- `Contact` may be created/linked if payer email not yet known
- Cache invalidation for revenue dashboards / KPIs

### Key symbols / files

- `packages/api/src/routers/commerce.ts` — `commerceRouter` (createProduct, markInvoicePaid, etc.)
- `apps/server/src/modules/payments/payments.service.ts` — `PaymentsService`
- `apps/server/src/modules/webhooks/webhooks.controller.ts` — `WebhooksController`
- `apps/server/src/modules/commerce/commerce.service.ts` — `CommerceService`
- `apps/server/src/modules/notifications/system-email.service.ts` — `SystemEmailService`
- `apps/web/src/app/pay/[invoiceId]/page.tsx`
- `apps/web/src/app/widgets/pay/[invoiceId]/page.tsx`
- `packages/db/prisma/schema.prisma` — `Invoice`, `InvoiceItem`, `Payment`, `PaymentLink`, `LedgerEntry`, `Receipt`, `MarginSnapshot`, `IdempotencyKey`, `WebhookDeliveryLog`
- External: Stripe, PayPal, WiPay, Resend

## 8. CRM Contact Lifecycle

### Create Contact

```
User in /app/crm
  → CRM list/detail UI components
  → tRPC crm.createContact
       → packages/api/src/routers/crm.ts
            → protectedProcedure + assertBusinessAccess
            → CrmService.createContact — apps/server/src/modules/crm/crm.service.ts
                 → creates Contact row (tenant-scoped via Prisma extension)
                 → normalizes email/phone
                 → creates initial ContactEvent (contact.created)
                 → emits contact.created via ctx.eventBus
  → listeners react:
       → key-inbox / omnichannel: index new contact for message matching
       → key-cortex: update context snapshot
       → sequences: evaluate enrollment rules
       → business-events worker: persist BusinessEvent
```

### Add Notes / Tasks / Tags

```
Add note
  → tRPC crm.addNote
       → CrmService.addNote
            → creates ContactNote
            → creates ContactEvent (note.added)
            → emits contact.updated

Add task
  → tRPC crm.addTask
       → CrmService.addTask
            → creates ContactTask
            → creates ContactEvent (task.added)
            → emits contact.updated

Add tag
  → CRM UI or bulk action
       → CrmService.addTag or tag-normalization helper
            → creates/updates Tag
            → creates ContactTag junction
            → creates ContactEvent (tag.added)
            → emits contact.updated
```

### Relationship Health

```
Health computation / update
  → CrmRelationshipHealthService — apps/server/src/modules/crm/crm-relationship-health.service.ts
       → imports thresholds from @keyflow/shared
            → packages/shared/src/contact-relationship.ts
            → DEFAULT_RELATIONSHIP_HEALTH_THRESHOLDS
            → computeRelationshipHealth()
       → reads ContactEvent / ContactMomentum / ContactTask data
       → writes ContactRelationship.health / score
       → emits relationship.health.changed when crossing thresholds
```

### Contact Events & Listeners

```
Domain event emitted (contact.created / contact.updated / relationship.health.changed)
  → @nestjs/event-emitter / BusinessEventInterceptor
  → listeners across modules:
       → key-inbox: match incoming messages
       → key-cortex: refresh contact context
       → sequences: CrmSequenceEnrollmentService
       → business-events: BusinessEventQueueService enqueues
       → BullMQ worker persists BusinessEvent row + anomaly detection
```

### Side Effects

- `BusinessEvent` persisted for audit/timeline
- `ContactMomentum` / `ContactRelationship` updated
- Sequence enrollments evaluated (`CrmSequence`, `CrmSequenceEnrollment`)
- KEY cortex context snapshot refreshed
- Inbox / omnichannel contact resolution updated
- Push notification or email for assigned tasks (if configured)

### Key symbols / files

- `packages/api/src/routers/crm.ts` — `crmRouter` (listContacts, contactDetail, createContact, updateContact, softDeleteContact, addNote, addTask)
- `apps/server/src/modules/crm/crm.service.ts` — `CrmService`
- `apps/server/src/modules/crm/crm-relationship-health.service.ts` — `CrmRelationshipHealthService`
- `packages/shared/src/contact-relationship.ts` — health thresholds & `computeRelationshipHealth`
- `packages/shared/src/contact-events.ts` — canonical contact event taxonomy
- `apps/web/src/lib/client.ts` / `apps/web/src/lib/api/*` — web CRM API wrappers
- `packages/db/prisma/schema.prisma` — `Contact`, `ContactNote`, `ContactTask`, `ContactTag`, `Tag`, `ContactEvent`, `ContactRelationship`, `ContactMomentum`, `CrmSequence`, `CrmSequenceEnrollment`, `BusinessEvent`

## 9. Bookings / Calendar

### Create booking

```
Create booking
  → bookings router / bookings service
  → Prisma Booking, Availability, Service, StaffMember
  → emit booking.created
  → Google Calendar sync (if connected)
```

### Waitlist flow

```
Booking cancellation or reschedule frees a slot
  → BookingsService.updateBookingStatus emits booking.cancelled / booking.rescheduled
  → BookingWaitlistListener.handleFreedSlot (apps/server/src/modules/bookings/booking-waitlist.listener.ts)
       → BookingWaitlistService.findWaitlistMatchesForSlot
       → filters by service, preferred staff, date range, time-of-day bucket
       → returns oldest WAITING entry
       → BookingWaitlistService.offerSlot creates UNCONFIRMED placeholder Booking
       → BookingWaitlistEntry updated to OFFERED
       → emits booking.waitlist.slot_offered

User accepts offered slot
  → POST /bookings/businesses/:businessId/waitlist/:entryId/convert
       → BookingsController.convertWaitlistEntry
       → BookingWaitlistService.convertWaitlistEntry
       → placeholder Booking.status = CONFIRMED
       → BookingWaitlistEntry.status = CONVERTED

User declines offered slot
  → POST /bookings/businesses/:businessId/waitlist/:entryId/cancel
       → BookingWaitlistService.cancelWaitlistEntry
       → BookingWaitlistEntry.status = CANCELLED + deletedAt set
       → placeholder Booking.status = CANCELLED

KEY adds contact to waitlist
  → flow-tool-registry tool bookings_add_to_waitlist
       → BookingWaitlistService.addToWaitlist
       → emits booking.waitlist.added
```

Key files:

- `packages/api/src/routers/bookings.ts`
- `apps/server/src/modules/bookings/*`
- `apps/server/src/modules/bookings/booking-waitlist.service.ts`
- `apps/server/src/modules/bookings/booking-waitlist.listener.ts`
- `apps/server/src/modules/calendar/*`
- `apps/web/src/app/app/bookings/components/waitlist-panel.tsx`

## 10. Business Event Log / Audit

```
Domain event emitted
  → BusinessEventInterceptor or explicit eventBus emit
  → BusinessEventQueueService enqueues
  → BullMQ worker persists BusinessEvent row
  → anomaly detection runs
```

Key files:

- `apps/server/src/modules/business-events/business-event.queue.ts`
- `apps/server/src/core/event-bus/events.types.ts`
- `apps/server/src/core/interceptors/business-event.interceptor.ts` (if present)

## 11. Connector Sync

```
Connect OAuth provider
  → ConnectorModule / key-connector router
  → credential encrypted (tokenEncryptionExtension)
  → sync scheduled
  → connector implementation pulls/pushes data
  → ConnectorActivityLog / WebhookDeliveryLog updated
```

Key files:

- `apps/server/src/core/connectors/connector.module.ts`
- `apps/server/src/core/connectors/connector.interface.ts`
- `packages/api/src/routers/key-connector.ts`
- `packages/db/src/middleware/token-encryption.ts`

## 12. Agent Control Plane: Issue #80 Authority → Effective Programme Projection

Added by KF-META-STATE-REDUCER-LIVE-001. `.agent-control/programme-state.yaml` is a reviewed checkpoint, anchored to one #80 authority message (`authority_basis`). The CLIs never decide on it directly. They decide on the checkpoint with every newer typed authority folded over it.

```
orchestrate.mjs / status.mjs --verify
  → loadState() — the committed checkpoint (never rewritten from authority);
    normalizeState() defaults an absent container only, and leaves one that is present
    with the wrong structural type (`holds: []`) as written for validateState() to reject
    (CHECKPOINT_SHAPE_INVALID)
  → reconcileWithTruth() (lib/truth.mjs)
      → gatherTruth(): #80 comments via gh, or a recorded --truth-file snapshot
      → collectAuthority() (lib/control-envelope.mjs) — parseEnvelope on every body;
        an edited or unorderable snapshot is refused whole
      → reconcileProjection() (lib/reconcile.mjs)
          → reduceAuthority() (lib/authority-effects.mjs)
              once the anchor is found, validateState(checkpoint): a checkpoint the state
              contract rejects is never folded from (CHECKPOINT_INVALID), with zero or more
              newer messages; otherwise
              fold applyEffect, oldest first, over each valid authority message newer than
              the anchor that declares `control_effect:`; stop at the first message that is
              malformed, untyped, has an unknown or unauthorized effect, lacks a field its
              effect needs, carries a non-canonical health or production_touched other
              than false, conflicts with the projection (holds are read and written
              by own key, so any non-blank packet id is safe),
              names programme activation, or yields a projection validateState() rejects
          → repoFor(effective programme) — repository truth for the folded projection
          → reconcile(effective, authority, repo, reduction) — findings (a stopped fold
            reports DERIVED_STATE_STALE_AUTHORITY naming the blocking message; an anchored
            projection validateState() rejects reports DERIVED_STATE_INVALID)
  → decide({ state: effective_state, reconciliation, … }) (lib/orchestrator.mjs)
      → activeHolds() (lib/state.mjs) reads `holds`, its entries and the legacy `hold` only
        when they are mappings; a wrong-type container gives no hold entry, here and in
        the status rendering
  → --apply: validateState(checkpoint) first; a checkpoint the contract rejects is not
    journaled onto and nothing is written (`apply_refused: CHECKPOINT_INVALID`, the same
    REPORT_DRIFT, exit 0); otherwise
    journals the event onto the checkpoint only; the effective projection is never persisted
```

What wakes that path for a #80 comment (`.github/workflows/agent-control-autopilot.yml`, job `normalize-event`, on `issue_comment` `created`):

```
normalize-event.mjs
  → normalizeEvent() (lib/events.mjs)
      → parseEnvelope(); a repeated or badly quoted field is MALFORMED and never actionable
      → RETURN, CONTRADICTION, MOMENTUM, DIRECTIVE, REVIEW, HOLD and RESUME are the wake types
      → an authority type must pass rejectionOf() and the AUTHORITY profile
      → a HOLD or RESUME must also declare its own effect as readEffect() reads it
        (HOLD_SET on a HOLD, HOLD_CLEAR on a RESUME) in a created, unedited comment;
        otherwise actionable is false and wake_refused says why
      → a claimed HOLD or RESUME refused earlier (outside author, non-ChatGPT sender,
        malformed or incomplete envelope) records that reason in wake_refused too;
        authority.problems keeps the structured form
orchestrate.mjs --json (the path above) — the decision with that comment folded
  → "Publish actionable wake event" posts one AUTO_EVENT, only when actionable is true
```

The exact-head merge path is separate and does not read the projection:

```
auto-merge-admitted.mjs
  → the PR, and both control artifacts at the PR head, via the GitHub API
  → evaluateAdmission() (lib/admission.mjs)
      → artifactBindingProblems() — both artifacts name one non-blank packet, each
        implementation_branch is the PR head_ref, and a declared pr_number is this PR's;
        a packet id or branch is a string compared as written, never trimmed and never
        made into text (`1` is not `"1"`);
        a matching pair from another packet fails as control_artifacts_not_bound_to_pr
      → review status, safety, source_main / source_head / control-only tail
      → evaluateSemanticReview() (lib/semantic-review.mjs)
      → proof, then the required workflows at the exact head
```

The checkpoint is read and written by `lib/yaml.mjs`. It defines every mapping key as an own property and writes a key in the form its parser reads back as the same key, so a hold keyed by any non-blank packet id survives a save and reload.

Key files:

- `scripts/agent-control/lib/authority-effects.mjs` — `CONTROL_EFFECTS`, `CONTROL_EFFECT_ALIASES` (historical spellings, each read as one canonical effect before any rule applies), `readEffect()`, `applyEffect()`, `reduceAuthority()`
- `scripts/agent-control/lib/admission.mjs` — `evaluateAdmission()`, `artifactBindingProblems()`
- `scripts/agent-control/lib/yaml.mjs` — `parseYaml()`, `stringifyYaml()`
- `scripts/agent-control/lib/reconcile.mjs` — `reconcileProjection()`, `reconcile()`
- `scripts/agent-control/lib/truth.mjs` — `gatherTruth()`, `reconcileWithTruth()`
- `scripts/agent-control/lib/control-envelope.mjs` — `parseEnvelope()`, `collectAuthority()`
- `scripts/agent-control/lib/events.mjs` — `normalizeEvent()`, `ACTIONABLE_MESSAGE_TYPES`, `HOLD_MESSAGE_TYPES`
- `scripts/agent-control/orchestrate.mjs`, `scripts/agent-control/status.mjs`
- `.agent-control/programme-state.yaml` — the reviewed checkpoint
- Contract: `docs/development/AGENT_CONTROL_PLANE.md`

## 13. KEY Action Boundary: Capability → Control → Clearance (helpdesk_create_ticket)

KF-EXEC-ACTION-001, first adoption. One capability is governed: `helpdesk_create_ticket`. Every other tool keeps the path in §6.

Every surface that can run the tool reaches one branch of the executor, and that branch does one thing:

```
FlowOrchestratorService.executeToolAction(businessId, toolName, args, action?)
  case 'helpdesk_create_ticket'
    → KeyActionBoundaryService.executeFromTool(businessId, toolName, args, action)
```

`action` is what the calling surface knows: its surface name, the authenticated user if it has one, and a server-issued action id if it holds one. A caller that passes nothing arrives as `UNDECLARED` and is refused.

| Surface | Declared as | Principal |
|---|---|---|
| `POST ai/businesses/:id/flow/chat`, `.../chat/stream` | `CHAT`, `CHAT_STREAM` | the authenticated user |
| `POST ai/businesses/:id/flow/confirm` (and `pendingConfirmation` on chat) | confirms by id | the authenticated user |
| phone stream WebSocket (`PhoneVoiceService`) | `PHONE_STREAM` | none; tenant binding untrusted |
| inbound conversational (`ConversationalAIService`) | `INBOUND_CONVERSATION` | none |
| `POST ai/businesses/:id/flow/execute-plan/:planId` | `PLAN_HTTP` | the authenticated user |
| plan queue (`ActionDispatcherService`) | `PLAN_QUEUE` | none |
| proposal execute (`KeyActionProposalService`, executor plugin) | `PROPOSAL` | the approver on the proposal |
| cortex registry bridge (`KeyCortexEfferentBridgeService`) | `CORTEX_BRIDGE` | none |
| `POST actions/businesses/:id/execute` (`GraphActionsController`) | `GRAPH_ACTION` | the authenticated user |
| `execute_custom_logic` inner executor | `CUSTOM_LOGIC` | none |
| `autoExecuteToolForMonitoring` | `PRO_AUTO_MONITOR` | none |

The chain, in the order it runs:

```
prepare(businessId, capability, rawArgs, action)
  → CapabilityContractService.get(name)                 real capability identity, never a wrapper
  → an untrusted tenant binding (PHONE_STREAM, UNDECLARED) is refused here; nothing is read or written
  → buildHelpdeskCreateTicketEnvelope()                  server-built, canonical, frozen
  → fingerprintEnvelope()                                sha256 over capability, version, business, material
  → AiOversightService.evaluate(real tool name)          KEY autonomy and business policy
  → deriveControlRequirement()                           DENY | NONE | PRINCIPAL_CONFIRMATION | HUMAN_APPROVAL
  → compareWithLegacy()                                  what the surface used to do, recorded beside it
  → KeyActionProposal row (PENDING)                      the action record; a denial writes no row

recordEvidence(businessId, actionId, authenticatedUserId)
  → lock the action record; lock and re-read policy and the giver's authority
  → evidenceKindFor()                                    requester → CONFIRMATION; tier ≥ capability tier → APPROVAL
  → ControlEvidence { fingerprint, principal, expiresAt, authority assumptions }

admit(businessId, actionId)                              ONE transaction
  1. INSERT idempotency_keys (business, key-action-claim:<actionId>)   the claim: insert-or-fail on the unique index
  2. read the action record; recompute the fingerprint from the stored envelope
  3. SELECT ... FOR SHARE on autopilot_settings, ai_memories (autonomy), businesses, users, memberships; re-read them
  4. deriveControlRequirement() again, on those rows; computeClearance()
  5. HelpdeskService.createTicketRow(tx, ...)             the effect, on this transaction
  6. outcome evidence on the action record and the claim  ticket id, fingerprint, principal chain
  commit → HelpdeskService.emitTicketCreated()            supportTicket.created, after the commit
```

A refusal or a failed effect rolls the claim back with everything else. There is no state between "nothing" and "claim, ticket and evidence", so no outcome is unknown. A concurrent executor waits on the unique index and is then given the recorded ticket. A rejection or a cancellation takes the same claim, so exactly one of executed, rejected and cancelled is ever recorded for an action.

A plan step is one action. `prepare()` finds the record a step already has by business, capability, plan step and fingerprint, whether it is PENDING, APPROVED or EXECUTED. That is what makes the plan runner's resume work: the queue files the step's action, a human approves the proposal, `PlanExecutorService.onProposalApproved` sets the step pending, and the queue run that follows admits the approved action instead of filing another. A run after execution is given the recorded ticket. Outside a plan step a request matches an existing record only while that record is still waiting.

A refusal is not a failure of the tool, and three places that count failures are told so:

- `ActionDispatcherService.dispatch` does not retry it, does not count it towards the tool's circuit breaker, and returns `awaitingApproval`.
- `QueueService.processPlanStep` leaves such a step `awaiting_approval` and the plan `awaiting_input`.
- `KeyCortexEfferentBridgeService` returns `notExecuted`, and `KeyCortexToolRegistryService.execute` does not score a `notExecuted` result in `ToolOutcomeScore`, count it against the daily limits or cache it under an idempotency key. `AutonomyOrchestratorService` reads that score before a proposal executes, so scoring refusals would block the tool the approvals are waiting to run.

Who may clear an action:

- The requester may confirm their own action if they could do it by hand: `Business.ownerId`, a `Membership`, or `SUPER_ADMIN` (the `BusinessGuard` rule).
- Anyone else, and any action nobody requested, needs an approval tier at or above the capability tier (`resolveMembershipApprovalTier`, the frozen AUTH-001 rule). An owner with no `Membership` row has tier 0.
- With no trusted principal, KEY autonomy clears nothing: the action is a proposal for a human.

Not on this path:

- `POST helpdesk/businesses/:id/tickets` (`HelpdeskController`), the human manual operation, calls `HelpdeskService.createTicket` directly.
- `apps/voice-agent` `transfer_to_human` is a different capability and is unchanged.

Key files:

- `apps/server/src/modules/key-autonomy/action-boundary/key-action-boundary.service.ts` — `prepare()`, `recordEvidence()`, `admit()`, `voidAction()`, `executeFromTool()`, `confirmAndExecute()`, `sealProposal()`
- `apps/server/src/modules/key-autonomy/action-boundary/action-envelope.ts` — `buildHelpdeskCreateTicketEnvelope()`, `fingerprintEnvelope()`, `BOUNDARY_CAPABILITIES`
- `apps/server/src/modules/key-autonomy/action-boundary/control-clearance.ts` — `deriveControlRequirement()`, `evidenceKindFor()`, `computeClearance()`, `resolvePrincipalAuthority()`, `EXECUTION_SURFACES`
- `apps/server/src/modules/key-autonomy/action-boundary/shadow-parity.ts` — `legacyDisposition()`, `compareWithLegacy()`
- `apps/server/src/modules/key-autonomy/key-action-proposal.service.ts` — seals, approves, rejects, cancels and executes an adopted capability's proposal through the boundary
- `apps/server/src/modules/ai/flow-orchestrator.service.ts` — `governToolCall()`, `confirmThroughBoundary()`, `executeToolAction()`
- `apps/server/src/modules/helpdesk/helpdesk.service.ts` — `createTicketRow()`, `emitTicketCreated()`
- Proof: `apps/server/test/key-action-boundary.integration.test.ts`, `apps/server/test/key-action-boundary-surfaces.integration.test.ts`, `scripts/proof-admission/manifests/action-001-negative-controls.json`
