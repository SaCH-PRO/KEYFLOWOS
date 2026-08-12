# Module Registry

This document proposes a curated domain-module view of KEYFLOWOS. It is intended as a human-readable complement to the auto-generated `architecture/module-registry.yaml`.

## Module Template

```markdown
### `domain-name`
- **Responsibility:** one-sentence purpose.
- **Files:** representative file paths.
- **Dependencies:** modules/packages this module imports from.
- **Dependents:** modules that import from this module.
- **Events published:** `domain.action`.
- **Events consumed:** `other-domain.action`.
- **External integrations:** third-party APIs/SDKs.
```

---

## Identity & Access

### `identity`
- **Responsibility:** User signup/login/me/bootstrap and business creation.
- **Files:** `apps/server/src/modules/identity/*`, `packages/api/src/routers/identity.ts`, `apps/web/src/app/auth/*`.
- **Dependencies:** `@keyflow/db`, `core/auth`, `core/redis`, `modules/notifications`.
- **Dependents:** `modules/key-cortex`, `modules/business-genesis`, `modules/business-command-center`, web onboarding.
- **Events published:** `user.signed-up`.
- **Events consumed:** —
- **External integrations:** Supabase Auth, Resend.

### `auth-core`
- **Responsibility:** Token verification, middleware, guards, admin fallback.
- **Files:** `apps/server/src/core/auth/*`, `apps/server/src/core/guards/*`.
- **Dependencies:** `@supabase/supabase-js`, `@keyflow/db`, `core/redis`.
- **Dependents:** All controllers and tRPC routers; `apps/web/src/components/require-auth.tsx`.
- **Events published:** —
- **Events consumed:** —
- **External integrations:** Supabase Auth.

---

## AI, Cortex, and Autonomy

### `ai`
- **Responsibility:** Multi-provider LLM gateway, cost tracking, usage logging, code execution, tool registry.
- **Files:** `apps/server/src/modules/ai/*`.
- **Dependencies:** `@keyflow/db`, `core/redis`, `core/event-bus`, `modules/mcp`.
- **Dependents:** 30+ modules including `key-cortex`, `crm`, `commerce`, `bookings`, `identity`, `business-genesis`.
- **Events published:** `ai.usage.logged`.
- **Events consumed:** —
- **External integrations:** OpenAI, Anthropic, xAI, Kimi, Google, E2B, MCP remote servers.

### `key-cortex`
- **Responsibility:** Cross-module business context assembly, reasoning, insight, memory, and KEY agent orchestration.
- **Files:** `apps/server/src/modules/key-cortex/*` (~80 services, ~248 files).
- **Dependencies:** `@keyflow/db`, `core/redis`, `core/event-bus`, `modules/ai`, `modules/crm`, `modules/commerce`, `modules/bookings`, `modules/business-genome`, `modules/business-genesis`.
- **Dependents:** `modules/business-command-center`, `modules/intelligence`, `modules/key-autonomy`, `modules/key-inbox`, `web KEY chat`.
- **Events published:** `cortex.insight.generated`.
- **Events consumed:** `contact.*`, `booking.*`, `invoice.*`.
- **External integrations:** OpenAI (via model gateway), LiveKit (voice dispatch).

### `key-autonomy`
- **Responsibility:** Autonomous rule evaluation, daily action budget, verdicts.
- **Files:** `apps/server/src/modules/key-autonomy/*`.
- **Dependencies:** `@keyflow/db`, `modules/ai`, `modules/key-cortex`, `modules/business-genome`.
- **Dependents:** `modules/business-command-center`.
- **Events published:** `autonomy.verdict.created`.
- **Events consumed:** `business-event.*`.
- **External integrations:** —

### `mcp`
- **Responsibility:** Remote Model Context Protocol server bridge.
- **Files:** `apps/server/src/modules/mcp/*`.
- **Dependencies:** `@modelcontextprotocol/sdk`, `modules/ai`.
- **Dependents:** `modules/ai`.
- **Events published:** —
- **Events consumed:** —
- **External integrations:** Allowlisted MCP HTTP(S) servers.

---

## Business Genome & Genesis

### `business-genome`
- **Responsibility:** Business Genome integrity, signals, recommendations, experiments, evolution proposals.
- **Files:** `apps/server/src/modules/business-genome/*`, `apps/web/src/app/app/genome/*`, `packages/api/src/routers/business-genome` (via server).
- **Dependencies:** `@keyflow/db`, `modules/ai`, `modules/key-cortex`, `modules/intelligence`.
- **Dependents:** `modules/business-command-center`, `modules/key-autonomy`, `modules/onboarding-concierge`, `web genome hub`.
- **Events published:** `genome.recommendation.created`.
- **Events consumed:** `business.*`.
- **External integrations:** —

### `business-genesis`
- **Responsibility:** Onboarding intake, idea extraction, template picker, genesis section generation.
- **Files:** `apps/server/src/modules/business-genesis/*`, `apps/web/src/app/app/onboarding/*`.
- **Dependencies:** `@keyflow/db`, `modules/ai`, `modules/blueprint`, `modules/business-genome`.
- **Dependents:** `modules/onboarding-concierge`, `modules/key-cortex`.
- **Events published:** `business.created`, `genesis.completed`.
- **Events consumed:** `user.signed-up`.
- **External integrations:** —

### `blueprint`
- **Responsibility:** BusinessBlueprint storage and mutation (identity, operating model, financials, genesis sections).
- **Files:** `apps/server/src/modules/blueprint/*`, `apps/web/src/lib/blueprint-types.ts`.
- **Dependencies:** `@keyflow/db`, `modules/ai`.
- **Dependents:** `modules/business-genesis`, `modules/business-genome`, `modules/identity`, `modules/projects`, `modules/onboarding-concierge`.
- **Events published:** `blueprint.updated`.
- **Events consumed:** —
- **External integrations:** —

---

## CRM

### `crm`
- **Responsibility:** Contacts, accounts, deals, tasks, notes, tags, sequences, relationship health, network graph.
- **Files:** `apps/server/src/modules/crm/*`, `packages/api/src/routers/crm.ts`, `apps/web/src/app/app/crm/*`.
- **Dependencies:** `@keyflow/db`, `@keyflow/shared`, `core/event-bus`, `core/redis`, `modules/ai`.
- **Dependents:** `modules/key-cortex`, `modules/commerce`, `modules/bookings`, `modules/key-inbox`, `modules/autopilot`.
- **Events published:** `contact.created`, `contact.updated`, `deal.won`, `deal.lost`.
- **Events consumed:** `user.signed-up`.
- **External integrations:** Google Contacts, Twilio.

---

## Commerce & Finance

### `commerce`
- **Responsibility:** Products, quotes, invoices, payments, credit notes, recurring invoices.
- **Files:** `apps/server/src/modules/commerce/*`, `packages/api/src/routers/commerce.ts`, `apps/web/src/app/app/commerce/*`, `apps/web/src/app/app/money/*`.
- **Dependencies:** `@keyflow/db`, `core/event-bus`, `modules/payments`, `modules/crm`, `modules/ai`.
- **Dependents:** `modules/key-cortex`, `modules/finance`, `modules/bookings`.
- **Events published:** `invoice.paid`, `quote.created`.
- **Events consumed:** `contact.created`.
- **External integrations:** Stripe, PayPal, WiPay, Google Pay.

### `payments`
- **Responsibility:** Payment processing, gateway abstraction, reconciliation.
- **Files:** `apps/server/src/modules/payments/*`, `apps/server/src/modules/webhooks/*`.
- **Dependencies:** `@keyflow/db`, `core/connectors`, `modules/commerce`, `modules/finance`.
- **Dependents:** `modules/commerce`, public pay pages.
- **Events published:** `payment.recorded`.
- **Events consumed:** `webhook.stripe.*`, `webhook.paypal.*`.
- **External integrations:** Stripe, PayPal, WiPay.

### `finance`
- **Responsibility:** Chart of accounts, ledger entries, bank transactions, tax, accounting periods.
- **Files:** `apps/server/src/modules/finance/*`, `apps/web/src/app/app/finance/*` (legacy redirect to `/app/money`).
- **Dependencies:** `@keyflow/db`, `modules/commerce`, `modules/bank`.
- **Dependents:** `modules/key-cortex`, `modules/reports`.
- **Events published:** `ledger.entry.posted`.
- **Events consumed:** `invoice.paid`, `payment.recorded`.
- **External integrations:** Plaid / bank feed connectors (if configured).

---

## Bookings & Calendar

### `bookings`
- **Responsibility:** Booking creation, availability, staff, skills, public booking pages, and waitlist queue for freed slots.
- **Files:** `apps/server/src/modules/bookings/*`, `packages/api/src/routers/bookings.ts`, `apps/web/src/app/app/bookings/*`, `apps/web/src/app/book/[slug]/*`. Waitlist-specific: `apps/server/src/modules/bookings/booking-waitlist.service.ts`, `apps/server/src/modules/bookings/booking-waitlist.listener.ts`, `apps/server/src/modules/bookings/dto/create-waitlist-entry.dto.ts`, `apps/server/src/modules/bookings/dto/offer-waitlist-slot.dto.ts`, `apps/server/src/modules/bookings/dto/waitlist-query.dto.ts`, `apps/web/src/app/app/bookings/components/waitlist-panel.tsx`.
- **Dependencies:** `@keyflow/db`, `core/event-bus`, `modules/calendar`, `modules/crm`, `modules/ai`.
- **Dependents:** `modules/key-cortex`, `modules/keyflow-command`, `modules/ai` (waitlist tools registered in flow-tool-registry).
- **Events published:** `booking.created`, `booking.cancelled`, `booking.rescheduled`, `booking.waitlist.added`, `booking.waitlist.slot_offered`, `booking.waitlist.converted`, `booking.waitlist.cancelled`.
- **Events consumed:** `booking.cancelled`, `booking.rescheduled`.
- **External integrations:** Google Calendar (via connectors).

### `calendar`
- **Responsibility:** Calendar events, ticket types, attendees, sync conflicts.
- **Files:** `apps/server/src/modules/calendar/*`, `apps/web/src/app/app/calendar/*`.
- **Dependencies:** `@keyflow/db`, `modules/bookings`, `core/connectors`.
- **Dependents:** `modules/bookings`, `modules/key-cortex`.
- **Events published:** `calendar.event.created`.
- **Events consumed:** `booking.created`.
- **External integrations:** Google Calendar, Microsoft Outlook.

---

## Communications

### `key-inbox`
- **Responsibility:** Unified inbox threads, messages, insights.
- **Files:** `apps/server/src/modules/key-inbox/*`, `apps/web/src/lib/api/key-inbox.ts`.
- **Dependencies:** `@keyflow/db`, `core/event-bus`, `modules/crm`, `modules/ai`.
- **Dependents:** `modules/key-cortex`, `modules/whatsapp`, `modules/chatwoot`.
- **Events published:** `message.received`.
- **Events consumed:** `contact.created`.
- **External integrations:** WhatsApp, Twilio, Chatwoot.

### `whatsapp`
- **Responsibility:** WhatsApp Business Cloud / Twilio inbound and outbound messaging.
- **Files:** `apps/server/src/modules/whatsapp/*`.
- **Dependencies:** `@keyflow/db`, `modules/key-inbox`, `modules/crm`, `core/connectors`.
- **Dependents:** `modules/key-cortex`.
- **Events published:** `whatsapp.message.received`.
- **Events consumed:** —
- **External integrations:** Meta WhatsApp Cloud API, Twilio.

### `chatwoot`
- **Responsibility:** L1 support desk bridge.
- **Files:** `apps/server/src/modules/chatwoot/*`.
- **Dependencies:** `modules/key-inbox`, `core/event-bus`.
- **Dependents:** —
- **Events published:** —
- **Events consumed:** `message.received`.
- **External integrations:** Chatwoot.

---

## Projects & Operations

### `projects`
- **Responsibility:** Projects, milestones, tasks, time entries, templates, plans.
- **Files:** `apps/server/src/modules/projects/*`, `apps/web/src/app/app/projects/*`.
- **Dependencies:** `@keyflow/db`, `modules/blueprint`, `modules/crm`, `core/event-bus`.
- **Dependents:** `modules/key-cortex`.
- **Events published:** `project.task.completed`.
- **Events consumed:** `business.created`.
- **External integrations:** —

### `temporal-flow`
- **Responsibility:** Time-aware flow execution, memory, signals.
- **Files:** `apps/server/src/modules/temporal-flow/*`, `apps/web/src/app/app/temporal-flow/*`.
- **Dependencies:** `@keyflow/db`, `core/redis`, `core/event-bus`, `modules/ai`.
- **Dependents:** `modules/key-cortex`.
- **Events published:** `temporal-flow.event`.
- **Events consumed:** `business-event.*`.
- **External integrations:** —

---

## Marketing & Site

### `marketing`
- **Responsibility:** Campaigns, lead forms, landing pages, email campaigns.
- **Files:** `apps/server/src/modules/marketing/*`, `apps/web/src/app/app/marketing/*`.
- **Dependencies:** `@keyflow/db`, `modules/crm`, `core/event-bus`.
- **Dependents:** `modules/key-cortex`.
- **Events published:** `lead.form.submitted`.
- **Events consumed:** `contact.created`.
- **External integrations:** Mailchimp, Klaviyo (via connectors).

### `site`
- **Responsibility:** Public micro-sites, business directory, storefront pages.
- **Files:** `apps/server/src/modules/site/*`, `packages/api/src/routers/site.ts`, `apps/web/src/app/site/[slug]/*`, `apps/web/src/app/directory/*`.
- **Dependencies:** `@keyflow/db`.
- **Dependents:** `web public pages`.
- **Events published:** —
- **Events consumed:** —
- **External integrations:** —

---

## Governance & Compliance

### `contracts`
- **Responsibility:** Contracts, parties, terms, versions, alerts, clause analysis.
- **Files:** `apps/server/src/modules/contracts/*`, `apps/web/src/app/app/contracts/*`.
- **Dependencies:** `@keyflow/db`, `modules/ai`, `modules/documents`.
- **Dependents:** `modules/key-cortex`, `modules/business-genome`.
- **Events published:** `contract.alert.created`.
- **Events consumed:** —
- **External integrations:** —

### `documents`
- **Responsibility:** Rich document instances, templates, versions, change log.
- **Files:** `apps/server/src/modules/documents/*`, `apps/web/src/app/app/documents/*`.
- **Dependencies:** `@keyflow/db`, `core/object-storage`, `modules/ai`.
- **Dependents:** `modules/contracts`, `modules/key-cortex`.
- **Events published:** `document.version.created`.
- **Events consumed:** —
- **External integrations:** S3/MinIO, Google Drive.

---

## Connectors & Integrations

### `connectors`
- **Responsibility:** Connector framework, registry, health, sync, credentials, entity resolution.
- **Files:** `apps/server/src/core/connectors/*`.
- **Dependencies:** `@keyflow/db`, `core/crypto`, `core/event-bus`.
- **Dependents:** 24 connector implementations; `modules/payments`, `modules/google-drive`, `modules/whatsapp`, `modules/key-connector`.
- **Events published:** `connector.sync.completed`.
- **Events consumed:** —
- **External integrations:** Google Workspace, Stripe, PayPal, WhatsApp, Meta, QuickBooks, Xero, Mailchimp, Klaviyo, LinkedIn, TikTok, Twitter, Typeform, Jotform, Shopify, Webhook forms.

### `key-connector`
- **Responsibility:** Unified integration connector API exposed via tRPC.
- **Files:** `packages/api/src/routers/key-connector.ts`, `apps/web/src/app/app/key-connect/*`.
- **Dependencies:** `core/connectors`, `@keyflow/db`, `packages/api/src/lib/access.ts`.
- **Dependents:** `web key-connect UI`.
- **Events published:** `connector.connection.updated`.
- **Events consumed:** —
- **External integrations:** All connector implementations.

---

## Operations Kernel

### `business-events`
- **Responsibility:** Canonical business event log, queue, anomaly detection.
- **Files:** `apps/server/src/modules/business-events/*`.
- **Dependencies:** `@keyflow/db`, `core/redis`, `core/event-bus`, `bullmq`.
- **Dependents:** `modules/diagnostics`, `modules/key-cortex`, `AppController`.
- **Events published:** `business-event.persisted`.
- **Events consumed:** Many domain events.
- **External integrations:** Redis.

### `diagnostics`
- **Responsibility:** System health checks, module/integration diagnostics.
- **Files:** `apps/server/src/modules/diagnostics/*`, `packages/api/src/routers/diagnostics.ts`.
- **Dependencies:** `@keyflow/db`, `core/redis`, `core/event-bus`, many modules.
- **Dependents:** `apps/web/src/app/api/healthz/route.ts`, admin dashboard.
- **Events published:** —
- **Events consumed:** —
- **External integrations:** —

---

## Notes

- The auto-generated `architecture/module-registry.yaml` contains the authoritative module list (109 modules, 104 registered in `AppModule`).
- This curated registry intentionally merges related sub-folders (e.g., `crm-*` services under `crm`) to show domain boundaries.
- `forwardRef` cycles are documented in `architecture/architecture-risks.md`.
