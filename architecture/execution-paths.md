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
