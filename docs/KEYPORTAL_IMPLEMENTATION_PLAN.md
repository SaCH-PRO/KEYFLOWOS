# KEYPORTAL Implementation Plan

## Document Purpose

This document converts the KEYPORTAL product definition into an implementation-grade build plan. It is intended for the development team to execute in sequenced PRs.

**Product thesis:**

> KEYPORTAL is the public transaction layer of KeyFlowOS: a customizable but controlled portal where customers can book services, order products, pay online, register for events, buy ticket tiers, claim promos, and receive receipts.

---

## 1. GitHub Milestones & Issues

### Milestone 1: Portal Foundation
Goal: establish the public `/portal/[slug]` route and preserve existing `/book/[slug]` behavior.

| Issue | Title | Acceptance Criteria |
|-------|-------|---------------------|
| KP-1 | Create `/portal/[slug]` route shell | Route renders; legacy `/book/[slug]` still works; mobile-first layout exists. |
| KP-2 | Build KEYPORTAL action homepage | Hero, action cards (Book, Order, Events, Promos, Contact), business identity. |
| KP-3 | Add `/portal/[slug]/services` sub-route | Lists services from existing bookings endpoint. |
| KP-4 | Add `/portal/[slug]/products` sub-route | Lists products from existing catalog endpoint. |
| KP-5 | SEO, metadata, structured data | `generateMetadata` uses KEYPORTAL title/description; JSON-LD for local business. |

### Milestone 2: Portal Configuration
Goal: introduce `PortalConfig` as the formal customization model.

| Issue | Title | Acceptance Criteria |
|-------|-------|---------------------|
| KP-6 | Add `PortalConfig` Prisma model | Migration succeeds; relation to `Business`; unique by `businessId` and `slug`. |
| KP-7 | Create PortalConfig API (owner) | CRUD endpoints under `/portal-config`; validation of layout types and section toggles. |
| KP-8 | Build owner customization UI | `/app/keyportal/customize` with layout presets, branding, sections, featured items. |
| KP-9 | Preview mode | Owner can preview portal before publishing. |
| KP-10 | Publish/unpublish state | `DRAFT`, `PUBLISHED`, `PAUSED` statuses enforced on public route. |

### Milestone 3: Unified Catalog
Goal: replace client-side service/product merging with a single server-side catalog.

| Issue | Title | Acceptance Criteria |
|-------|-------|---------------------|
| KP-11 | Create `CatalogModule` | New module under `apps/server/src/modules/catalog`. |
| KP-12 | Build `GET /catalog/public/:slug` | Returns unified `PortalCatalogItem[]`; includes services, products, packages. |
| KP-13 | Build catalog normalizer | Maps `Service`, `Product`, and future `TicketTier` to common shape. |
| KP-14 | Migrate `/portal/[slug]` to catalog endpoint | Page no longer calls separate services/products endpoints. |
| KP-15 | Deprecate duplicate product/service listing paths | Mark old endpoints deprecated; route frontend through catalog. |

### Milestone 4: Harden Transactions
Goal: make booking, ordering, and payment flows production-grade.

| Issue | Title | Acceptance Criteria |
|-------|-------|---------------------|
| KP-16 | Stable receipt routes | `/portal/order/[token]`, `/portal/booking/[token]` render reliably. |
| KP-17 | CRM contact linkage | All checkout/booking flows upsert a `Contact`. |
| KP-18 | Inventory reservation | Product orders decrement/reserve stock; prevent oversell. |
| KP-19 | Payment status standardization | Enum-driven statuses: `UNPAID`, `PENDING`, `PAID`, `REFUNDED`, `FAILED`. |
| KP-20 | Portal transaction ledger | Introduce `PortalTransaction` table as receipt/transaction index. |

### Milestone 5: Events & Ticketing
Goal: add the missing event-ticketing domain.

| Issue | Title | Acceptance Criteria |
|-------|-------|---------------------|
| KP-21 | Add event/ticketing Prisma models | `PortalEvent`, `TicketTier`, `EventRegistration`, `EventAttendee`. |
| KP-22 | Create `EventsModule` | `events.service.ts`, `ticketing.service.ts`, `events-public.controller.ts`. |
| KP-23 | Owner event creation UI | `/app/keyportal/events` create/edit events and ticket tiers. |
| KP-24 | Public event page | `/portal/[slug]/events/[eventSlug]` displays event and tiers. |
| KP-25 | Ticket purchase flow | Select tier → quantity → attendee details → payment → ticket receipt. |
| KP-26 | Attendee dashboard & check-in | Owner sees registrations; QR/token check-in works. |

### Milestone 6: Promotions
Goal: make promos visible inside the portal.

| Issue | Title | Acceptance Criteria |
|-------|-------|---------------------|
| KP-27 | Add `PortalPromo` model | Target service/product/event/ticket tier; scheduling; featured flag. |
| KP-28 | Promo management UI | `/app/keyportal/promos` create/edit promos. |
| KP-29 | Public promo cards | Promos render on portal homepage and target detail pages. |
| KP-30 | Promo-to-checkout tracking | Discount applied at checkout; conversion event logged. |

### Milestone 7: KEYPORTAL Dashboard
Goal: unify owner-facing portal management.

| Issue | Title | Acceptance Criteria |
|-------|-------|---------------------|
| KP-31 | Create `/app/keyportal` shell | Layout with tabs: Overview, Customize, Services, Products, Events, Promos, Orders, Bookings, Tickets, Payments, Customers, Settings. |
| KP-32 | Overview tab | Activity summary, quick actions, portal status. |
| KP-33 | Orders/Bookings/Tickets tabs | Aggregate views across existing modules. |
| KP-34 | Customers tab | Portal-derived contact list with activity. |
| KP-35 | Navigation updates | Add KEYPORTAL entry to main app navigation. |

---

## 2. Database Schema Changes

### 2.1 Add `PortalConfig`

```prisma
model PortalConfig {
  id                String   @id @default(cuid())
  businessId        String   @unique @map("business_id")
  business          Business @relation(fields: [businessId], references: [id], onDelete: Cascade)

  slug              String   @unique
  status            String   @default("DRAFT") // DRAFT | PUBLISHED | PAUSED
  layoutType        String   @default("HYBRID") @map("layout_type") // SERVICE_FIRST | STORE_FIRST | EVENT_FIRST | HYBRID | MINIMAL

  brandColor        String?  @map("brand_color")
  accentColor       String?  @map("accent_color")
  coverImageUrl     String?  @map("cover_image_url")
  logoUrlOverride   String?  @map("logo_url_override")
  headline          String?
  subheadline       String?

  enabledSections   Json     @default("{}") @map("enabled_sections")
  sectionOrder      Json     @default("[]") @map("section_order")
  featuredServiceId String?  @map("featured_service_id")
  featuredProductId String?  @map("featured_product_id")
  featuredEventId   String?  @map("featured_event_id")
  featuredPromoId   String?  @map("featured_promo_id")

  primaryCtaType    String?  @map("primary_cta_type") // BOOK | ORDER | EVENT | CONTACT | PROMO
  primaryCtaLabel   String?  @map("primary_cta_label")

  showReviews       Boolean  @default(true) @map("show_reviews")
  showLocation      Boolean  @default(true) @map("show_location")
  showSocialLinks   Boolean  @default(true) @map("show_social_links")
  showPoweredBy     Boolean  @default(true) @map("show_powered_by")

  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  @@index([slug])
  @@map("portal_configs")
}
```

Update `Business` relation:

```prisma
model Business {
  // ... existing fields ...
  portalConfig PortalConfig?
  portalEvents PortalEvent[]
  portalPromos PortalPromo[]
  portalTransactions PortalTransaction[]
}
```

### 2.2 Add Event & Ticketing Models

```prisma
model PortalEvent {
  id             String   @id @default(cuid())
  businessId     String   @map("business_id")
  business       Business @relation(fields: [businessId], references: [id], onDelete: Cascade)

  title          String
  slug           String
  description    String?
  imageUrl       String?  @map("image_url")

  startsAt       DateTime @map("starts_at")
  endsAt         DateTime? @map("ends_at")
  timezone       String   @default("America/Port_of_Spain")

  locationType   String   @default("PHYSICAL") @map("location_type") // PHYSICAL | ONLINE | HYBRID
  venueName      String?  @map("venue_name")
  address        String?
  onlineUrl      String?  @map("online_url")

  capacity       Int?
  status         String   @default("DRAFT") // DRAFT | PUBLISHED | CLOSED | CANCELLED
  visibility     String   @default("PUBLIC") // PUBLIC | PRIVATE | HIDDEN
  refundPolicy   String?  @map("refund_policy")
  metadata       Json?

  ticketTiers    TicketTier[]
  registrations  EventRegistration[]

  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@unique([businessId, slug])
  @@index([businessId, startsAt])
  @@map("portal_events")
}

model TicketTier {
  id             String      @id @default(cuid())
  eventId        String      @map("event_id")
  event          PortalEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)

  name           String
  description    String?
  price          Float
  currency       String      @default("TTD")
  capacity       Int?
  quantitySold   Int         @default(0) @map("quantity_sold")

  saleStartsAt   DateTime?   @map("sale_starts_at")
  saleEndsAt     DateTime?   @map("sale_ends_at")
  benefits       Json?
  active         Boolean     @default(true)

  registrations  EventRegistration[]

  createdAt      DateTime    @default(now()) @map("created_at")
  updatedAt      DateTime    @updatedAt @map("updated_at")

  @@index([eventId])
  @@map("ticket_tiers")
}

model EventRegistration {
  id              String      @id @default(cuid())
  businessId      String      @map("business_id")
  eventId         String      @map("event_id")
  ticketTierId    String      @map("ticket_tier_id")
  contactId       String?     @map("contact_id")

  event           PortalEvent @relation(fields: [eventId], references: [id], onDelete: NoAction)
  ticketTier      TicketTier  @relation(fields: [ticketTierId], references: [id], onDelete: NoAction)
  contact         Contact?    @relation(fields: [contactId], references: [id], onDelete: SetNull)

  quantity        Int
  subtotal        Float
  discountAmount  Float       @default(0) @map("discount_amount")
  total           Float
  currency        String      @default("TTD")

  paymentStatus   String      @default("UNPAID") @map("payment_status") // UNPAID | PENDING | PAID | REFUNDED
  status          String      @default("PENDING") // PENDING | CONFIRMED | CANCELLED | CHECKED_IN
  receiptToken    String      @unique @map("receipt_token")
  metadata        Json?

  attendees       EventAttendee[]

  createdAt       DateTime    @default(now()) @map("created_at")
  updatedAt       DateTime    @updatedAt @map("updated_at")

  @@index([businessId, eventId])
  @@index([receiptToken])
  @@map("event_registrations")
}

model EventAttendee {
  id                String            @id @default(cuid())
  registrationId    String            @map("registration_id")
  registration      EventRegistration @relation(fields: [registrationId], references: [id], onDelete: Cascade)

  name              String
  email             String?
  phone             String?
  qrCodeToken       String            @unique @map("qr_code_token")
  checkedInAt       DateTime?         @map("checked_in_at")

  createdAt         DateTime          @default(now()) @map("created_at")

  @@index([registrationId])
  @@map("event_attendees")
}
```

Update `Contact`:

```prisma
model Contact {
  // ... existing fields ...
  eventRegistrations EventRegistration[]
}
```

### 2.3 Add Portal Promotions

```prisma
model PortalPromo {
  id             String   @id @default(cuid())
  businessId     String   @map("business_id")
  business       Business @relation(fields: [businessId], references: [id], onDelete: Cascade)

  title          String
  description    String?
  imageUrl       String?  @map("image_url")
  promoCodeId    String?  @map("promo_code_id")
  targetType     String   @map("target_type") // SERVICE | PRODUCT | EVENT | TICKET_TIER | PORTAL
  targetId       String?  @map("target_id")

  startsAt       DateTime? @map("starts_at")
  endsAt         DateTime? @map("ends_at")
  featured       Boolean  @default(false)
  active         Boolean  @default(true)

  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@index([businessId, active, featured])
  @@map("portal_promos")
}
```

### 2.4 Add Unified Transaction Ledger

```prisma
model PortalTransaction {
  id              String   @id @default(cuid())
  businessId      String   @map("business_id")
  business        Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  contactId       String?  @map("contact_id")
  contact         Contact? @relation(fields: [contactId], references: [id], onDelete: SetNull)

  type            String   // BOOKING | ORDER | EVENT_TICKET | INVOICE | DEPOSIT | MANUAL_PAYMENT
  sourceId        String   @map("source_id") // bookingId, orderId, registrationId, invoiceId

  amount          Float
  currency        String   @default("TTD")
  paymentStatus   String   @map("payment_status") // UNPAID | PENDING | PAID | REFUNDED | FAILED
  provider        String?
  providerRef     String?  @map("provider_ref")

  receiptNumber   String   @unique @map("receipt_number")
  receiptToken    String   @unique @map("receipt_token")
  metadata        Json?

  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([businessId, contactId])
  @@index([receiptToken])
  @@index([sourceId, type])
  @@map("portal_transactions")
}
```

Update `Contact`:

```prisma
model Contact {
  // ... existing fields ...
  portalTransactions PortalTransaction[]
}
```

---

## 3. Backend Modules & Endpoints

### 3.1 New/Modified Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| `keyportal` | `apps/server/src/modules/keyportal` | Portal config, public portal metadata, owner dashboard aggregates. |
| `catalog` | `apps/server/src/modules/catalog` | Unified public catalog of services/products/packages/tickets. |
| `events` | `apps/server/src/modules/events` | Event and ticket-tier CRUD, public event pages, ticketing, check-in. |
| `site` | `apps/server/src/modules/site` | Extend with promo management; keep checkout endpoints; eventually delegate catalog reads to `catalog`. |
| `bookings` | `apps/server/src/modules/bookings` | Reuse public booking creation; expose stable booking status endpoint. |
| `payments` | `apps/server/src/modules/payments` | Add event ticket payment path; unify status reconciliation. |
| `marketplace` | `apps/server/src/modules/marketplace` | Keep order status by token; ensure order→transaction ledger write. |

### 3.2 Endpoint Inventory

#### KEYPORTAL module (`/keyportal`)

```
GET    /keyportal/public/:slug                  -> public portal metadata + config
GET    /keyportal/public/:slug/sections         -> ordered sections for rendering
GET    /keyportal/public/:slug/featured         -> featured item(s)
GET    /keyportal/config                        -> owner read own config
POST   /keyportal/config                        -> owner create/update config
PATCH  /keyportal/config/status                 -> publish/unpublish/pause
GET    /keyportal/overview                      -> dashboard aggregates
```

#### Catalog module (`/catalog`)

```
GET    /catalog/public/:slug                    -> unified catalog items
GET    /catalog/public/:slug/services           -> filter by SERVICE
GET    /catalog/public/:slug/products           -> filter by PRODUCT
GET    /catalog/public/:slug/events             -> filter by EVENT / TICKET
GET    /catalog/public/:slug/featured           -> single featured item
GET    /catalog/public/:slug/promos             -> active promos
```

#### Events module (`/events`)

Owner endpoints (authenticated):

```
GET    /events                                    -> list business events
POST   /events                                    -> create event
GET    /events/:id                                -> read event
PATCH  /events/:id                                -> update event
DELETE /events/:id                                -> soft delete
POST   /events/:id/tiers                          -> create ticket tier
PATCH  /events/:id/tiers/:tierId                  -> update ticket tier
DELETE /events/:id/tiers/:tierId                  -> deactivate tier
GET    /events/:id/registrations                  -> list registrations
PATCH  /events/:id/registrations/:id/status       -> confirm/cancel/check-in
GET    /events/:id/attendees/export               -> CSV export
```

Public endpoints:

```
GET    /events/public/:businessId                 -> list published events
GET    /events/public/:businessId/:eventSlug      -> event detail + tiers
POST   /events/public/:businessId/:eventSlug/register -> start registration
GET    /events/public/registration/:token         -> registration status
POST   /events/public/registration/:token/pay     -> initiate payment
POST   /events/public/checkin/:qrToken            -> owner check-in attendee
```

#### Bookings module additions

```
GET    /bookings/public/:token                    -> stable booking receipt/status
```

#### Marketplace module additions

```
POST   /marketplace/orders/:token/transaction     -> write PortalTransaction on order creation
```

#### Site module extensions

```
GET    /site/storefront/public/:slug/promos       -> active portal promos
POST   /site/storefront/public/:slug/promo-apply  -> apply promo to target
```

---

## 4. Frontend Route Structure

### 4.1 Public Portal Routes

```
apps/web/src/app/portal/
├── [slug]/
│   ├── layout.tsx              # fetch business + portal config + metadata
│   ├── page.tsx                # KEYPORTAL homepage with action cards
│   ├── error.tsx
│   ├── loading.tsx
│   ├── services/
│   │   └── page.tsx
│   ├── products/
│   │   └── page.tsx
│   ├── events/
│   │   ├── page.tsx
│   │   └── [eventSlug]/
│   │       └── page.tsx
│   ├── checkout/
│   │   └── page.tsx
│   ├── order/
│   │   └── [token]/
│   │       └── page.tsx
│   ├── ticket/
│   │   └── [token]/
│   │       └── page.tsx
│   ├── booking/
│   │   └── [token]/
│   │       └── page.tsx
│   └── receipt/
│       └── [token]/
│           └── page.tsx
```

### 4.2 Owner Dashboard Routes

```
apps/web/src/app/app/keyportal/
├── layout.tsx                  # KEYPORTAL dashboard shell with tabs
├── page.tsx                    # Overview
├── customize/
│   └── page.tsx
├── services/
│   └── page.tsx
├── products/
│   └── page.tsx
├── events/
│   ├── page.tsx
│   ├── create/
│   │   └── page.tsx
│   └── [eventId]/
│       └── edit/
│           └── page.tsx
├── promos/
│   └── page.tsx
├── orders/
│   └── page.tsx
├── bookings/
│   └── page.tsx
├── tickets/
│   └── page.tsx
├── payments/
│   └── page.tsx
├── customers/
│   └── page.tsx
└── settings/
    └── page.tsx
```

### 4.3 Legacy Support

- Keep `apps/web/src/app/book/[slug]/*` working through Milestone 2.
- At the start of Milestone 3, add a Next.js redirect:
  - `/book/[slug]` → `/portal/[slug]` (308 permanent after soak period).
  - Preserve query strings and hashes.

---

## 5. MVP vs Later Phases

### MVP (Must ship together)

**Customer-facing:**
- `/portal/[slug]` homepage with business identity and action cards.
- Services listing and public booking flow (reuse existing backend).
- Products listing and public order/checkout flow (reuse existing backend).
- Stable receipt page for bookings and orders.
- Mobile-first responsive layout.

**Owner-facing:**
- `/app/keyportal` dashboard shell with Overview and Customize tabs.
- PortalConfig CRUD: branding, layout preset, sections, featured item.
- Publish/unpublish control.
- Aggregate views for orders and bookings.

**System-facing:**
- `PortalConfig` model and API.
- `CatalogModule` with `GET /catalog/public/:slug`.
- `PortalTransaction` ledger written for bookings and orders.
- CRM contact upsert on all checkout/booking flows.

### Post-MVP (Milestones 5–7 + refinements)

- Events and ticketing module.
- Ticket purchase flow and QR check-in.
- `PortalPromo` visible promotions.
- Full `/app/keyportal` tab suite (Events, Promos, Tickets, Payments, Customers).
- Promo-to-checkout tracking and conversion analytics.
- Advanced layout customizations (still controlled, not drag-and-drop).
- Embeddable KEYPORTAL widget.
- Self-service portal subdomain/short link.

---

## 6. Exact PR Sequence for Developers

### PR 1: Portal Route Foundation
- Create `apps/web/src/app/portal/[slug]/` route shell.
- Add layout, page, error, loading files.
- Render business identity from existing `/identity/businesses/slug/:slug`.
- Add action cards: Book, Order, Events (placeholder), Promos (placeholder), Contact.
- Keep `/book/[slug]` untouched.

### PR 2: Portal Sub-Routes
- Add `/portal/[slug]/services` and `/portal/[slug]/products`.
- Reuse existing public endpoints for services and products.
- Add basic mobile-first styling consistent with current storefront.

### PR 3: PortalConfig Schema & API
- Add `PortalConfig` to Prisma schema.
- Generate and apply migration.
- Create `apps/server/src/modules/keyportal` with config CRUD.
- Add `/keyportal/public/:slug` and `/keyportal/config` endpoints.

### PR 4: Owner Customization UI
- Build `/app/keyportal/customize` page.
- Layout presets, branding, section toggles, featured selector.
- Preview mode.
- Publish/unpublish controls.

### PR 5: Unified Catalog
- Create `apps/server/src/modules/catalog`.
- Implement `CatalogService` normalizer for services/products.
- Add `GET /catalog/public/:slug`.
- Migrate `/portal/[slug]` page to use catalog endpoint.
- Mark old separate listing endpoints as deprecated.

### PR 6: Harden Transactions
- Add `PortalTransaction` model.
- Update booking creation to write `PortalTransaction` (type `BOOKING`).
- Update storefront checkout to write `PortalTransaction` (type `ORDER`).
- Ensure CRM contact upsert in both flows.
- Add inventory reservation for product orders.
- Create `/portal/order/[token]` and `/portal/booking/[token]` receipt pages.

### PR 7: Events & Ticketing Schema
- Add `PortalEvent`, `TicketTier`, `EventRegistration`, `EventAttendee` models.
- Generate and apply migration.
- Seed sample event data for local dev.

### PR 8: Events Backend
- Create `apps/server/src/modules/events`.
- Owner CRUD for events and ticket tiers.
- Public endpoints for event listing and detail.
- Registration creation endpoint.

### PR 9: Events Frontend
- `/app/keyportal/events` owner UI.
- `/portal/[slug]/events` and `/portal/[slug]/events/[eventSlug]` public pages.
- Ticket selection and attendee details form.

### PR 10: Ticket Payment & Receipt
- Integrate event registration payment with `PaymentsService`.
- Create `/portal/ticket/[token]` receipt page.
- Add QR generation for attendees.
- Add owner check-in endpoint.

### PR 11: Portal Promos
- Add `PortalPromo` model.
- Owner UI at `/app/keyportal/promos`.
- Public promo cards on portal homepage and target pages.
- Promo application at checkout.

### PR 12: KEYPORTAL Dashboard Completion
- Finish remaining dashboard tabs: Orders, Bookings, Tickets, Payments, Customers, Settings.
- Add portal activity summary to Overview tab.
- Add quick action buttons.
- Update main navigation to include KEYPORTAL.

### PR 13: Legacy Redirect & Cleanup
- Add Next.js redirect from `/book/[slug]` to `/portal/[slug]`.
- Remove deprecated browser-side service/product merge logic.
- Update SEO titles and structured data.
- Add redirect tests.

---

## 7. Cross-Cutting Concerns

### 7.1 Authentication & Authorization
- Public portal routes use no auth; rely on `PublicRateLimitGuard`.
- Owner dashboard uses existing auth middleware.
- Owner endpoints must scope queries by `businessId` from the authenticated user.

### 7.2 Rate Limiting
- Apply `PublicRateLimitGuard` to all new public endpoints.
- Use stricter limits for checkout, registration, and promo validation.

### 7.3 Webhooks & Payment Reconciliation
- Extend existing webhook handlers to update `PortalTransaction.paymentStatus`.
- Ensure idempotency keys are used for provider callbacks.

### 7.4 Notifications
- Emit events: `keyportal.booking.created`, `keyportal.order.created`, `keyportal.ticket.purchased`.
- Hook into existing notification listeners for email/WhatsApp.

### 7.5 Analytics
- Continue using `PublicEventsService` for visitor tracking.
- Add conversion events: `portal_action_click`, `checkout_started`, `payment_completed`.

### 7.6 Testing Strategy
- Unit tests for `CatalogService` and `PortalConfigService`.
- E2E tests for:
  - Public portal render by slug.
  - Booking flow end-to-end.
  - Order checkout and receipt page.
  - Event creation and ticket purchase.
  - Owner publish/unpublish flow.

---

## 8. Definition of Done for KEYPORTAL MVP

- [ ] `/portal/[slug]` renders a branded portal with action cards.
- [ ] Services and products are listed via unified catalog endpoint.
- [ ] Public booking flow works and writes a `PortalTransaction`.
- [ ] Public product order flow works and writes a `PortalTransaction`.
- [ ] Receipt pages work for bookings and orders.
- [ ] Owner can customize branding, layout, sections, and featured item.
- [ ] Owner can publish/unpublish the portal.
- [ ] `/app/keyportal` dashboard has Overview and Customize tabs.
- [ ] `/book/[slug]` still works but shows a deprecation notice or redirect is staged.
- [ ] All new code has tests; CI passes.

---

## 9. Open Questions to Resolve Before PR 1

1. Should `/site/[slug]` (published presence) be merged into `/portal/[slug]` or kept separate?
2. Do we keep the existing `/order/[token]` route or consolidate everything under `/portal/.../[token]`?
3. Which payment gateways must support event ticketing in MVP? (WiPay, PayPal, Stripe, all?)
4. Should ticket tiers support `0` price/free tickets for RSVP-style events?
5. Do we need seat/assignment logic for events, or general admission only for MVP?
6. Should `PortalConfig.slug` mirror `Business.slug` or allow a separate portal slug?

---

*Document version: 1.0*
*Last updated: 2026-06-18*
