# User Flows

Developer-friendly narrative of the three most critical end-to-end flows in KEYFLOWOS. Each section maps the happy path from the browser through the API layer to the database and back, including the files, methods, models, integrations, and side effects that participate.

---

## 1. Authentication & Sessions

### Overview

KEYFLOWOS uses a dual-stack identity model. Normal users authenticate through **Supabase Auth** (email/password or OAuth), while internal admin automation uses a local **HMAC-JWT admin token**. The web app stores the Supabase access token in `localStorage` and mirrors it to a `kf_token` cookie so the Next.js Edge middleware can gate `/app/*` routes without a server round-trip. The NestJS API verifies the Bearer token on every request, attaches a `req.user` object, and runs the request inside an AsyncLocalStorage tenant context.

### Frontend pages and components

| Route / File | Responsibility |
|--------------|----------------|
| `apps/web/src/app/auth/login/page.tsx` | Login shell. |
| `apps/web/src/app/auth/login/login-form.tsx` | Email/password + Google OAuth login form. |
| `apps/web/src/app/auth/signup/page.tsx` | New user signup. |
| `apps/web/src/app/auth/callback/page.tsx` | Supabase PKCE / OAuth callback handler; bootstraps workspace. |
| `apps/web/src/app/auth/reset-password/page.tsx` | Password reset flow. |
| `apps/web/src/app/app/layout.tsx` | Authenticated app shell (`AppLayout`). |
| `apps/web/src/components/require-auth.tsx` | Client auth boundary; calls `/identity/me` and redirects on 401. |
| `apps/web/src/middleware.ts` | Edge middleware for `/app/*`; validates `kf_token` cookie expiry. |
| `apps/web/src/lib/workspace.ts` | Token refresh, `localStorage` + cookie sync, business identity cache. |
| `apps/web/src/lib/api.ts` | Typed fetch wrappers with `fetchWithAuthRetry` and plan-limit/unauthorized events. |

### API endpoints

| Endpoint / Procedure | Layer | Purpose |
|----------------------|-------|---------|
| Supabase auth token endpoint | Supabase Auth | Issue/refresh access & refresh tokens. |
| `POST /identity/bootstrap` | REST — `IdentityController` | Creates Prisma `User` + default `Business` + `Membership`. |
| `GET /identity/me` | REST — `IdentityController` | Returns current user and business list. |
| `trpc.identity.*` | tRPC — `packages/api/src/routers/identity.ts` | Business creation/listing/health. |

### Backend service / controller methods

| File | Method | Responsibility |
|------|--------|--------------|
| `apps/server/src/modules/identity/identity.controller.ts` | `bootstrap()`, `me()` | HTTP entry points for identity. |
| `apps/server/src/modules/identity/identity.service.ts` | create user/business/membership logic | Persists identity rows. |
| `apps/server/src/core/auth/auth.middleware.ts` | `configure()` | Verifies Bearer token and attaches `req.user`. |
| `apps/server/src/core/auth/supabase-auth.service.ts` | `getUserFromToken()` | Local HMAC verify or Supabase `getUser()` round-trip. |
| `apps/server/src/core/auth/admin-token.util.ts` | HMAC admin verify | Local admin-JWT validation against Redis. |
| `apps/server/src/core/tenant/tenant.interceptor.ts` | `intercept()` | Puts request into ALS tenant context from `businessId`. |
| `apps/server/src/core/guards/auth.guard.ts` / `business.guard.ts` | `canActivate()` | Authorization checks. |

### Prisma models touched

- `User` — platform user record; role stored locally.
- `UserIdentity` — linked identity records (including RISC/Google).
- `Business` — default business created at signup.
- `Membership` — user ↔ business membership + role.
- `Session` / `PushSubscription` — optional session/push state.
- `AuthAuditLog` / `AuthRateLimit` — security audit/rate-limiting.

### External integrations

- **Supabase Auth** — primary identity provider (OAuth Google, email/password, token refresh).
- **Redis** — admin token storage.
- **Resend** — transactional emails (verification, password reset) when enabled.

### Key side effects

- `kf_token` cookie written and refreshed so Edge middleware can gate routes.
- `localStorage` access token updated on refresh.
- `req.user` attached to every subsequent API request.
- Tenant isolation extension auto-injects `businessId` into intercepted queries.
- On first login, default `Business` + `Membership` rows are created.
- Genome/onboarding gates in `AppLayout` may redirect to `/app/onboarding`.

### Happy path diagram

```
[Browser /app/*]
        │
        ▼
[Edge middleware.ts] ── kf_token cookie valid? ──No──► /auth/login
        │ Yes
        ▼
[AppLayout] ──► [RequireAuth] ──► GET /identity/me
        │                           │
        │                           ▼
        │              [AuthMiddleware]
        │              SupabaseAuthService.getUserFromToken()
        │              local HMAC verify or Supabase getUser()
        │                           │
        │                           ▼
        │              [IdentityController.me()]
        │              returns User + Businesses
        │                           │
        ◄───────────────────────────┘
        │
        ▼
[Render /app/command-center]
(TenantInterceptor sets ALS businessId from selected business)
```

---

## 2. Invoicing & Payments

### Overview

A business creates an invoice in the commerce workspace, sends it to a customer, and the customer pays through a public checkout page. Payments can be collected via **Stripe**, **PayPal**, **WiPay**, or **Google Pay**. Successful payments update the invoice status, post a ledger entry, generate a receipt, and emit an `invoice.paid` domain event that triggers margin snapshots, business-event logging, and receipt email delivery.

### Frontend pages and components

| Route / File | Responsibility |
|--------------|----------------|
| `apps/web/src/app/app/commerce/invoices/page.tsx` (or equivalent) | Invoice list/create UI. |
| Commerce invoice form components | Collect line items, customer, tax, totals. |
| `apps/web/src/app/pay/[invoiceId]/page.tsx` | Public invoice payment page. |
| `apps/web/src/app/widgets/pay/[invoiceId]/page.tsx` | Embeddable pay widget. |
| `apps/web/src/lib/api/commerce.ts` / `payments-gateway.ts` | Domain API wrappers. |

### API endpoints

| Endpoint / Procedure | Layer | Purpose |
|----------------------|-------|---------|
| `trpc.commerce.createInvoice` | tRPC — `packages/api/src/routers/commerce.ts` | Creates invoice + line items. |
| `trpc.commerce.sendInvoice` | tRPC — `packages/api/src/routers/commerce.ts` | Marks sent and triggers delivery. |
| `trpc.commerce.markInvoicePaid` | tRPC — `packages/api/src/routers/commerce.ts` | Manual paid marking; emits `invoice.paid`. |
| `POST /payments/stripe/webhook` (preferred) or `POST /webhooks/stripe` | REST — `WebhooksController` | Stripe webhook ingress. |
| PayPal / WiPay webhook/callback routes | REST / connector | PayPal and WiPay asynchronous confirmations. |

### Backend service / controller methods

| File | Method | Responsibility |
|------|--------|--------------|
| `packages/api/src/routers/commerce.ts` | `createInvoice`, `sendInvoice`, `markInvoicePaid` | tRPC entry points. |
| `apps/server/src/modules/commerce/commerce.service.ts` | create/send/update invoice | Invoice lifecycle + item/tax calculations. |
| `apps/server/src/modules/payments/payments.service.ts` | `processStripePayment`, `processPayPalPayment`, `processWiPayPayment`, webhook handlers | Charges customers, records `Payment`, updates `Invoice`, posts ledger. |
| `apps/server/src/modules/webhooks/webhooks.controller.ts` | Stripe/PayPal webhook actions | Signature verification + delegation. |
| `apps/server/src/modules/notifications/system-email.service.ts` | send receipt/invoice email | Resend integration. |
| `apps/server/src/modules/business-events/business-event.queue.ts` | enqueue/persist events | Durable `invoice.paid` event log. |

### Prisma models touched

- `Invoice` — header, status, totals, due date.
- `InvoiceItem` — line items, quantities, prices, tax.
- `Payment` — payment record linked to invoice and gateway.
- `PaymentLink` — shareable checkout link.
- `LedgerEntry` — double-entry ledger posting.
- `Receipt` — generated receipt.
- `MarginSnapshot` — product margin snapshot after payment.
- `IdempotencyKey` — webhook idempotency.
- `WebhookDeliveryLog` — webhook ingress log.
- `Contact` — may create/link payer contact.
- `BusinessEvent` — canonical domain event audit row.

### External integrations

- **Stripe** — card payments (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`).
- **PayPal** — PayPal checkout SDK v2.
- **WiPay** — Caribbean gateway with callback hash verification.
- **Google Pay** — wallet display config on frontend.
- **Resend** — receipt/invoice email delivery.

### Key side effects

- `Invoice.status` transitions `DRAFT → SENT → PAID` (or `PARTIAL`).
- `Payment` row created with gateway reference.
- `LedgerEntry` posted for revenue recognition.
- `Receipt` generated and emailed.
- `MarginSnapshot` refreshed/created for costed products.
- `invoice.paid` domain event emitted → BusinessEvent queue + anomaly detection.
- Revenue dashboard caches invalidated.
- Payer contact auto-created or linked if not already in CRM.

### Happy path diagram

```
[Merchant /app/commerce]
        │
        ▼
trpc.commerce.createInvoice
        │
        ▼
[CommerceService] ──► Prisma Invoice + InvoiceItem
        │
        ▼
[Send invoice] ──► Invoice.status = SENT
        │
        ▼
[Customer /pay/:invoiceId]
        │
        ▼
[PaymentsService]
   ├─ Stripe PaymentIntent
   ├─ PayPal order capture
   └─ WiPay redirect/callback
        │
        ▼
Prisma Payment + Invoice.status = PAID
        │
        ▼
[Finance ledger] ──► LedgerEntry
[Receipt] ──► emailed via Resend
[Margin] ──► MarginSnapshot
[Events] ──► invoice.paid → BusinessEvent queue
```

---

## 3. CRM Contact Lifecycle

### Overview

A contact is the core entity of the CRM. Users create contacts through the CRM UI or via inbound message matching. Once a contact exists, users add notes, tasks, and tags; each mutation creates a `ContactEvent` row and emits `contact.updated`. Relationship health is continuously computed from events, tasks, and momentum using shared thresholds, and health crossing triggers additional listeners. Domain events feed the business-event log, KEY cortex context, sequence enrollment, and omnichannel inbox resolution.

### Frontend pages and components

| Route / File | Responsibility |
|--------------|----------------|
| `apps/web/src/app/app/crm/page.tsx` | CRM list view. |
| `apps/web/src/app/app/crm/[id]/page.tsx` | Contact detail view. |
| CRM form/note/task/tag components | Create/edit contact sub-entities. |
| `apps/web/src/lib/client.ts` | Legacy monolithic client with Zod `Contact` schema. |
| `apps/web/src/lib/api/crm*.ts` | Domain-specific CRM API wrappers. |

### API endpoints

| Endpoint / Procedure | Layer | Purpose |
|----------------------|-------|---------|
| `trpc.crm.listContacts` | tRPC — `packages/api/src/routers/crm.ts` | Paginated contact list. |
| `trpc.crm.contactDetail` | tRPC — `packages/api/src/routers/crm.ts` | Single contact with notes/tasks/tags/events. |
| `trpc.crm.createContact` | tRPC — `packages/api/src/routers/crm.ts` | Creates contact + initial event. |
| `trpc.crm.updateContact` | tRPC — `packages/api/src/routers/crm.ts` | Updates contact fields. |
| `trpc.crm.softDeleteContact` | tRPC — `packages/api/src/routers/crm.ts` | Soft-delete (sets `deletedAt`). |
| `trpc.crm.addNote` | tRPC — `packages/api/src/routers/crm.ts` | Adds `ContactNote`. |
| `trpc.crm.addTask` | tRPC — `packages/api/src/routers/crm.ts` | Adds `ContactTask`. |

### Backend service / controller methods

| File | Method | Responsibility |
|------|--------|--------------|
| `packages/api/src/routers/crm.ts` | `createContact`, `updateContact`, `addNote`, `addTask`, etc. | tRPC entry points + `assertBusinessAccess`. |
| `apps/server/src/modules/crm/crm.service.ts` | `createContact`, `addNote`, `addTask`, `addTag`, etc. | Core contact CRUD + event creation. |
| `apps/server/src/modules/crm/crm-relationship-health.service.ts` | health computation | Computes and updates relationship health. |
| `packages/shared/src/contact-relationship.ts` | `computeRelationshipHealth()`, thresholds | Pure health-scoring logic. |
| `packages/shared/src/contact-events.ts` | `normalizeContactEventType()`, event taxonomy | Canonical event vocabulary. |
| `apps/server/src/modules/crm/crm-sequence-enrollment.service.ts` (inferred) | enrollment logic | Evaluates sequence rules on contact changes. |
| `apps/server/src/modules/business-events/business-event.queue.ts` | enqueue/persist events | Persists `contact.created` / `contact.updated`. |

### Prisma models touched

- `Contact` — core contact record (soft-deletable).
- `ContactNote` — free-form notes.
- `ContactTask` — follow-up tasks.
- `Tag` — normalized tag dictionary.
- `ContactTag` — contact ↔ tag junction.
- `ContactEvent` — canonical timeline events.
- `ContactRelationship` — relationship metadata + health.
- `ContactMomentum` — engagement/momentum metrics.
- `CrmSequence` / `CrmSequenceEnrollment` — automation sequences.
- `BusinessEvent` — domain event audit row.
- `ContactAuditEntry` / `ContactDataIssue` — audit/data-quality rows.

### External integrations

- None directly for the core create/note/task/tag flow.
- Google Contacts / Outlook Contacts connectors can sync contacts in/out via the connector framework.
- WhatsApp / Twilio / email connectors can create contacts from inbound messages.

### Key side effects

- `ContactEvent` row created for every meaningful change.
- `contact.created` / `contact.updated` events emitted via `ctx.eventBus`.
- `CrmRelationshipHealthService` recomputes `ContactRelationship.health`.
- `BusinessEventQueueService` persists events + runs anomaly detection.
- KEY cortex context snapshot refreshed.
- Sequence enrollment rules evaluated.
- Inbox/omnichannel contact resolution updated.
- Push/email notifications may fire for task assignments.

### Happy path diagram

```
[User /app/crm]
        │
        ▼
trpc.crm.createContact
        │
        ▼
[CrmService.createContact]
   ├─ Prisma Contact
   ├─ ContactEvent (contact.created)
   └─ emit contact.created
        │
        ▼
[Listeners]
   ├─ BusinessEventQueueService ──► BusinessEvent
   ├─ KEY Cortex context refresh
   └─ Sequence enrollment check
        │
        ▼
[User adds note/task/tag]
        │
        ▼
[CrmService.addNote / addTask / addTag]
   ├─ ContactNote / ContactTask / ContactTag
   ├─ ContactEvent (note.added / task.added / tag.added)
   └─ emit contact.updated
        │
        ▼
[CrmRelationshipHealthService]
   ├─ read ContactEvent / ContactTask / ContactMomentum
   ├─ computeRelationshipHealth() from @keyflow/shared
   └─ update ContactRelationship.health
        │
        ▼
[relationship.health.changed] ──► listeners + BusinessEvent log
```

---

## Cross-cutting notes

- All three flows run through `AuthMiddleware` and `TenantInterceptor`, so every authenticated request carries `req.user` and an ALS `businessId`.
- The `@keyflow/db` Prisma extension auto-injects `businessId` into intercepted reads/writes; `create`/`upsert`/`aggregate` are not intercepted and must scope manually.
- Domain events are emitted through `@nestjs/event-emitter` and the `BusinessEventInterceptor`; durable logging is handled by a BullMQ worker.
