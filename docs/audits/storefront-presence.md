# Storefront / Presence Audit & Module Mapping (S0)

**Status:** P0 baseline. Built before any S1+ refactor. Every line in this
document is grounded in the current `apps/`, `packages/db`, and
`scripts/` trees — no aspirational claims. Anything that is *missing* in
the codebase is called out explicitly in the gap list and tagged to the
S1–S5 milestone that will close it.

---

## 1. Routes in scope

### 1.1 Public web routes (`apps/web/src/app`)

These are the routes a visitor reaches without logging in. They are the
only surfaces that *convert*, so they are the focus of the audit.

| Route | File | Purpose | Notes |
|---|---|---|---|
| `/book` | `book/page.tsx` | "Find a business" landing — slug entry. | Used as a fallback when no slug. |
| `/book/[slug]` | `book/[slug]/page.tsx` (1485 lines) | **Primary public storefront.** Renders products, services, packages, guided qualifier, cart, checkout, intake, reviews. | Mixes booking + commerce + intake in one client component. Confusingly mounted under `/book` even when the business sells only physical products. |
| `/book/[slug]/product/[productId]` | `book/[slug]/product/[productId]/page.tsx` | Product / service detail page. | Standalone deep-link target for a single catalog item. |
| `/order/[token]` | `order/[token]/page.tsx` | Public order-status / tracking page (token-gated). | Backed by `marketplace-public.controller.ts` `GET /marketplace/order-status/:token`. |
| `/pay/[invoiceId]` | `pay/[invoiceId]/page.tsx` | Public invoice payment page. | Belongs to commerce flow; not part of storefront, but reachable from order confirmations. |
| `/pay/link/[token]` | `pay/link/[token]/page.tsx` | Tokenized payment-link page. | Backed by `commerce.controller.ts` `GET payment-links/:token`. |
| `/public/book` | `public/book/page.tsx` | Legacy alias / redirect for `/book`. | Candidate for removal in S1. |
| `/public/pay` | `public/pay/page.tsx` | Legacy alias for `/pay`. | Candidate for removal in S1. |
| `/public/social` | `public/social/page.tsx` | "Link in bio" style social presence page (uses `Site.siteData`). | Currently the *only* surface that touches the `Site` model. |
| `/pricing` | `pricing/page.tsx` | Marketing pricing page (KeyFlow plans, not storefront). | Out of scope for storefront refactor; kept here for completeness. |

There is **no** `/store` route, no `/p/` route, and no `(public)` route
group on disk. The audit task assumed those existed; they do not. The
single tenant-facing storefront is `/book/[slug]`.

### 1.2 In-app management routes (`apps/web/src/app/app`)

| Route | File | Purpose |
|---|---|---|
| `/app/store` | `app/store/page.tsx` + `app/store/components/*` (~40 files) | Storefront editor. Tabs: overview, design, merchandising, operations, launch, performance, fulfillment, promos, reviews, customers, orders, qualification config. Edits the `Site` / storefront config + writes to Product, ShippingZone, PromoCode, etc. |
| `/app/bookings` | `app/bookings/page.tsx` + `app/bookings/components/*` | Bookings dashboard (calendar, schedule, services CRUD, staff CRUD, performance, insights). |
| `/app/commerce` | `app/commerce/page.tsx` + `app/commerce/components/*` | Quotes, invoices, products, recurring, payments, billing, collections, insights. |
| `/app/commerce/products` | `app/commerce/products/products-panel.tsx` | Product catalog CRUD UI used by Commerce. |
| `/app/marketplace` | `app/marketplace/page.tsx` + `app/marketplace/components/*` | Listings, inventory, warehousing, customs, pre-orders, purchase orders, shipments, fulfillment, suppliers — wrapped around the same `Product` records. |

Note: there is no `/app/site` directory. Storefront editing lives under
`/app/store`. The Site model is touched only by `/public/social` and the
storefront config persisted via `siteData`.

### 1.3 Server routes (NestJS controllers)

All routes are namespaced by their module's `@Controller(prefix)`.
Authenticated routes are guarded by `AuthGuard + BusinessGuard`. Most
public routes are guarded by `PublicRateLimitGuard` with a
`@PublicRateLimit` decorator, **but several are not** — see the
"unguarded" callouts in the per-module lists below and Gap #G15. Counts
extracted from controllers via ripgrep on `@Get|@Post|@Put|@Patch|@Delete`.

#### `site` module (`apps/server/src/modules/site`, prefix `/site`)
- **Public (rate-limited):**
  - `GET  /site/storefront/public/:slug` — storefront config + business + products + zones (the page-load endpoint).
  - `POST /site/storefront/public/:slug/checkout` — create order + start payment.
  - `POST /site/storefront/public/:slug/validate-promo`
  - `GET  /site/storefront/public/order/:orderId` — public order lookup (email-gated).
  - `POST /site/storefront/public/:slug/reviews`
  - `GET  /site/storefront/public/:slug/products/:productId/reviews`
  - `GET  /site/storefront/public/:slug/review-aggregates`
  - `POST /site/storefront/public/:slug/intake` — quote / inquiry submission.
  - `GET  /site/storefront/public/:slug/qualification-flow`
  - `POST /site/storefront/public/:slug/qualification-recommend`
  - `POST /site/storefront/public/qualification/:journeyId/select`
  - `POST /site/storefront/public/qualification/:journeyId/intake`
  - `POST /site/businesses/:businessId/analytics/event` — pageview / addtocart tracker (rate-limited but **not** auth-required despite operating on a businessId param; see Gap #G2).
- **Authenticated (owner):** storefront config GET/PUT, analytics, conversion-funnel, product-health, seo-health, conversion-suggestions, AI conversion advice, orders list / detail / status / refund, promo-codes CRUD, reviews list / moderate, intake list / moderate, qualification-config GET/PUT, qualification-analytics. Total ~30 owner routes.

#### `bookings` module (prefix `/bookings`)
- **Public:**
  - `GET  /bookings/public/businesses/:businessId/services` — raw `prisma.service.findMany`.
  - `GET  /bookings/public/businesses/:businessId/staff`
  - `POST /bookings/public/businesses/:businessId` — book a service (creates contact if missing, may auto-create invoice).
- **Authenticated:** services CRUD, staff CRUD, availability, calendar OAuth + sync + conflicts, reminder settings, optimizer (no-show, schedule-health, rebooking), bookings CRUD / status / reschedule / notes. ~45 routes.

#### `commerce` module (prefix `/commerce`)
- **Public (currently UNGUARDED — no `PublicRateLimitGuard`):** `GET /commerce/public/businesses/:businessId/products` — used by storefront page to load the catalog. Should gain a rate limit in S1.
- **Authenticated:** products CRUD, bulk + import, invoices CRUD + bulk + receipt, quotes CRUD + send-email + convert, gmail OAuth + threads, payments CRUD + payment-links + payment-intent, recurring invoices CRUD, store readiness/graph/backfill. ~60 routes.
- Sub-controllers: `accounting`, `commerce-ai` (~15 AI-only routes), `commerce-insights` (~15 margin/risk/copilot routes), `financial-copilot` (~4 routes).

#### `marketplace` module (prefix `/marketplace`)
- **Public (token-gated, no `PublicRateLimitGuard` decorator):** `GET /marketplace/order-status/:token` (single endpoint). Token entropy is the only access control today.
- **Authenticated:** dashboard, listings CRUD, shipping-zones CRUD, warehouses CRUD, inventory CRUD + adjust + transfer + summary + movements + import/export-excel + alerts, orders CRUD + status + token + cross-links + create-project + post-purchase, shipments CRUD, customs CRUD, pre-orders CRUD, purchase-orders CRUD + advance, fulfillment routes + activate-preorder, contacts/order-history, products promote, delivery-config GET/PUT. ~52 routes.

#### `identity` (used by storefront)
The storefront resolves a slug → business via `identity.controller.ts`:
- `GET /identity/businesses/slug/:slug`
- `GET /identity/businesses/public/:businessId`

Both are unguarded today (no `PublicRateLimitGuard`, no field whitelist) — see Gap #G15.

---

## 2. Prisma models touching public commerce / presence

| Model | schema.prisma line | Role in public flows | Cross-module use |
|---|---|---|---|
| `Business` | 36 | Slug, brand, storeEnabled, storefront colors, business hours. | All modules. |
| `Site` | 1532 | Stores `siteData` (link-in-bio JSON). Currently only used by `/public/social`. **Not** used to drive `/book/[slug]` — that uses `business.metaData` + storefront config under a separate JSON blob persisted via `SiteService.updateStorefrontConfig`. |
| `LandingPage` | 2076 | Defined but **no public route renders it**. Editor exists (`landingPages` relation) but no controller exposes it publicly. Tagged for S3. |
| `Product` | 800 | Backing entity for everything sold (services, packages, products, resources). Loaded by `/commerce/public/.../products` and rendered in storefront. |
| `Service` | 1027 | Backing entity for bookable services. Loaded by `/bookings/public/.../services`. Has `sourceProductId` pointer to `Product` (one-way denormalisation). |
| `StaffMember` | 1008 | Loaded by `/bookings/public/.../staff`. |
| `Booking` | 1066 | Created by `publicCreateBooking`. |
| `MarketplaceListing` | 2382 | Wraps `Product` with shipping/HS-code/supplier metadata. **Not consumed by storefront** today — storefront reads `Product` directly. |
| `MarketplaceOrder` | 2555 | Created by `StoreOrderService.createOrder` for storefront checkout (`type=STOREFRONT`) and by marketplace fulfillment (`type=STANDARD`). One table, two tenants. |
| `MarketplaceOrderItem` | 2602 | Order line items. References `Product` (no listing FK). |
| `InventoryStock` | 2511 | Per-warehouse per-product quantity. **Not** decremented at storefront checkout (see Gap #G7). |
| `Shipment` | 2620 | Created by marketplace flow, not by storefront flow. |
| `ShippingZone` | 2465 | Loaded by storefront for shipping fee calc inside `StoreOrderService.calculateOrderTotals`. |
| `PromoCode` | 3465 | Validated/applied at storefront checkout. |
| `IntakeSubmission` (model in schema, model row 187 ref) | — | Created by `/site/storefront/public/:slug/intake`. **Does not write to `Contact`** (see Gap #G3). |
| `QualificationJourney` | — | Created/updated by `/site/storefront/public/:slug/qualification-*` endpoints. |
| `Review` (referenced via SiteService.submitReview) | — | Public submission accepted, moderated by owner. |
| `FulfillmentRoute`, `Warehouse`, `CustomsDeclaration`, `PreOrder`, `PurchaseOrder`, `StockMovement` | 2425 / 2488 / 2658 / etc | Marketplace internals; not exposed publicly except through order-status page. |

---

## 3. NestJS modules participating in public flows

| Module | File | Purpose | Public surface? |
|---|---|---|---|
| `SiteModule` | `modules/site/site.module.ts` | Storefront config, public checkout orchestration, intake, qualification, reviews, promos, store orders. | **Yes — primary.** |
| `BookingsModule` | `modules/bookings/bookings.module.ts` | Public service listing, public booking creation, in-app booking ops. | Yes (3 public routes). |
| `CommerceModule` | `modules/commerce/commerce.module.ts` | Public product listing, in-app commerce ops, AI / insights. | Yes (1 public route). |
| `MarketplaceModule` | `modules/marketplace/marketplace.module.ts` | Inventory / fulfillment / shipping / customs; only public route is `order-status/:token`. | Yes (1 public route). |
| `IdentityModule` | `modules/identity/identity.controller.ts` | Resolves slug → business (`/businesses/slug/:slug`, `/businesses/public/:businessId`). | Yes (slug lookup). |
| `PaymentsModule` | imported by SiteModule | `createStorePayment` for non-cash checkout methods. | Indirect. |
| `NotificationsModule` | imported by Site/Marketplace/Bookings | Customer notifications (order placed, booking confirmed). | Indirect. |
| `CrmModule` | imported by Commerce, Bookings, Marketplace (forwardRef) | Contact lookup/creation, lead scoring. | Indirect. |

Module dependency graph (public-flow slice):

```
identity ─► [slug → businessId] ──┐
                                  ▼
        ┌──────── SiteController ──────────┐
        │  /site/storefront/public/:slug   │
        │  ├─ SiteService (config, reviews,│
        │  │   analytics, AI advice)       │
        │  ├─ StoreOrderService ───┐       │
        │  │   ├─ MarketplaceOrder │       │
        │  │   ├─ ShippingZone     │       │
        │  │   └─ PromoCode        │       │
        │  ├─ PromoCodeService     │       │
        │  ├─ IntakeService ──► IntakeSubmission (NO Contact write)
        │  ├─ QualificationService                                  │
        │  └─ PaymentsService (Stripe/WiPay/PayPal)                 │
        └────────┬─────────────────────────┘                        │
                 │ event: store_order.created / .paid               │
                 ▼                                                  │
        EventEmitter2 ──► (notifications, automations)              │
                                                                    │
   BookingsController                                               │
   /bookings/public/businesses/:bid/{services,staff}                │
   /bookings/public/businesses/:bid                                 │
        └─ BookingsService.publicCreateBooking                      │
              ├─ Contact upsert (CRM)                               │
              ├─ Booking insert                                     │
              ├─ Invoice auto-create (CommerceService)              │
              └─ event: booking.created / booking.confirmed         │
                                                                    │
   CommerceController                                               │
   /commerce/public/businesses/:bid/products                        │
        └─ raw Product.findMany (no listing/inventory join)         │
                                                                    │
   MarketplacePublicController                                      │
   /marketplace/order-status/:token                                 │
        └─ MarketplaceService.getOrderByToken                       │
```

---

## 4. Canonical public flows — end-to-end traces

Each trace lists, in order, the visitor action → web call → server
controller → service write → DB rows touched → events emitted → notifications
fired (or **MISSING** when the wiring does not exist).

### Flow A — View → Buy product

1. Visitor lands on `/book/[slug]`.
2. `apps/web/src/app/book/[slug]/page.tsx:255-289` does:
   - `GET /identity/businesses/slug/:slug` → `Business`.
   - `GET /site/storefront/public/:slug` → `SiteService.getPublicStorefront` → `Site` config + `ShippingZone[]` + `completedOrdersCount`.
   - `GET /bookings/public/businesses/:bid/services` → raw `Service.findMany`.
   - `GET /bookings/public/businesses/:bid/staff` → raw `StaffMember.findMany`.
   - `GET /commerce/public/businesses/:bid/products` → raw `Product.findMany`.
   - `GET /site/storefront/public/:slug/review-aggregates`.
   - Fires `POST /site/businesses/:bid/analytics/event { type: 'page_view' }`.
3. Visitor clicks product card → `addToCart()` (local state, persisted to `localStorage`) + `analytics/event { type:'add_to_cart' }`.
4. Visitor clicks Checkout → `CheckoutFlow` collects customer info.
5. `submitStoreOrder` POSTs `/site/storefront/public/:slug/checkout` (`SiteController.publicCheckout`, `site.controller.ts:102-152`).
6. `SiteService.getPublicStorefront(slug)` resolves businessId.
7. `StoreOrderService.createOrder` (`store-order.service.ts:141-210`):
   - `validateCart` against `Product` (active, not deleted).
   - `calculateOrderTotals` — applies `PromoCode`, `ShippingZone`, business `defaultTaxRate`.
   - **Writes** `MarketplaceOrder { type: 'STOREFRONT', status: 'PENDING' }` + `MarketplaceOrderItem[]`.
   - **Emits** `store_order.created`.
8. If `paymentMethod` is non-cash: `PaymentsService.createStorePayment` → returns provider session/redirect URL (Stripe/WiPay/PayPal) — order stays `paymentStatus: 'UNPAID'`.
9. After provider callback / return:
   - `StoreOrderService.updatePaymentStatus(orderId, 'PAID')` flips `status → 'CONFIRMED'`, emits `store_order.paid`.
10. Notification listeners (NotificationsModule + `CustomerNotificationLog`) send customer + owner emails.
11. Owner sees order under `/app/store` (Orders panel) via `/site/businesses/:bid/orders`.

**MISSING / weak in this flow:**
- No `InventoryStock` decrement on storefront orders (Gap #G7).
- No `Contact` row created from buyer (`MarketplaceOrder` has loose `customerEmail` only) → orphan from CRM (Gap #G3).
- No `MarketplaceListing` consultation, so listing-level overrides (digital delivery, supplier dropship, HS code) are ignored on the storefront (Gap #G6).
- No revenue attribution: order has no `source` / `utm` / `journeyId` / `campaignId` field (Gap #G8).

### Flow B — View → Book service

1. Same page-load as Flow A.
2. Visitor selects a service → `BookingForm` modal collects date/time/staff/contact.
3. POST `/bookings/public/businesses/:bid` → `BookingsController.publicCreateBooking` (`bookings.controller.ts:135-172`).
4. Subscription plan-limit check (`subscriptions.checkLimit('bookings')`), throws 403 if exceeded.
5. `BookingsService.publicCreateBooking` (`bookings.service.ts:573+`):
   - Upserts `Contact` (CRM) by email/phone.
   - Inserts `Booking { status: 'PENDING' }`.
   - If service is paid → auto-creates `Invoice` via `CommerceService` and stores `bookingData.invoiceId`.
   - Emits `booking.created`.
   - Writes `Notification { type: 'booking.created' }`.
6. Owner sees booking under `/app/bookings`. Visitor receives confirmation email (notifications listener).

**Behavioural notes:**
- Public booking creates a CRM contact (correct). Public store checkout does not (gap).
- Booking does not write to `Activity` / `CustomerJourney` directly; relies on event listeners — verify hookup in S1.

### Flow C — Inquiry / Quote request

Two paths exist today and they are **not unified**:

Path C1 — Generic intake form (Quote/Inquiry button on storefront):
1. Visitor opens "Get a quote" modal.
2. POST `/site/storefront/public/:slug/intake` → `IntakeService.submitIntake`.
3. Writes `IntakeSubmission` row + `Notification { type: 'intake_submission' }`.
4. **Does not write `Contact`, does not create `Quote`, does not enroll in any CRM sequence.**
5. Owner reviews under `/app/store` Intake tab.

Path C2 — Qualification journey (smart funnel):
1. `GET /site/storefront/public/:slug/qualification-flow` returns question tree.
2. Visitor answers → POST `/site/storefront/public/:slug/qualification-recommend` → returns ranked `Product[]` recommendations + `journeyId`.
3. Visitor selects a package → POST `/site/storefront/public/qualification/:journeyId/select` (records selection on `QualificationJourney`).
4. Optionally → POST `/site/storefront/public/qualification/:journeyId/intake` collects assets.
5. Owner reviews journey under `/app/store` Qualification tab.

**MISSING in C1 + C2:**
- No `Quote` is generated in either path (downstream task already queued: "Connect qualification journeys to project creation").
- No `Contact` is created from intake submissions.
- No notification email to owner outside the in-app `Notification` row.
- No CRM stage assignment / lead-scoring trigger.
- See Gaps #G3, #G4.

### Flow D — Share

1. `/book/[slug]/components/share-buttons.tsx` exposes a `ShareStoreButton`.
2. It uses `navigator.share` when available, else copies URL.
3. There is **no server-side write**: no `share` analytics event, no `Activity` row, no referrer tracking.
4. SEO meta + Open Graph tags are set by `useEffect` in `book/[slug]/page.tsx:406-439` from `storefrontConfig.seo`. `OrganizationSchema` + `BreadcrumbListSchema` JSON-LD are emitted from `book/[slug]/components/structured-data.tsx`.

**MISSING in D:**
- No `analytics/event { type: 'share' }` POST.
- No referral attribution captured on subsequent visits (no `?ref=`/`?via=` parsing).
- No per-product share URL with UTM (Gap #G8).

---

## 5. Duplicated Product / Service CRUD across Store, Commerce, Bookings

This is the heart of the S1 milestone. There are **three** parallel
catalog implementations today, each with its own write path. They
overlap and drift.

### 5.1 Product (sellable item)

| Concern | Implementation 1 — Commerce | Implementation 2 — Marketplace | Implementation 3 — Storefront editor |
|---|---|---|---|
| Create | `CommerceService.createProduct` (`commerce.service.ts:43-72`) → `prisma.product.create` | `MarketplaceService.createListing` wraps a `Product` (creates if not present) → `prisma.product.create` + `prisma.marketplaceListing.create` | `app/store/components/catalog-manager.tsx` calls `POST /commerce/businesses/:bid/products` (same as Commerce). |
| Update | `CommerceService.updateProduct` (`commerce.service.ts:74+`) | `MarketplaceService.updateListing` updates listing-side fields and may patch `Product` | Calls Commerce endpoint. |
| List | `CommerceService.listProducts` (`commerce.service.ts:20-41`) | `MarketplaceService.listListings` (joins `MarketplaceListing → Product`) | Calls Commerce endpoint, then merges with reviews + listings client-side. |
| Public list | `commerce.controller.ts:55 GET /commerce/public/businesses/:bid/products` (raw findMany, no listing/inventory join) | none | uses Commerce public endpoint |
| Inventory | not aware | tracked via `InventoryStock` adjusts | not aware |
| Image / SKU | edited via Commerce form | edited via Marketplace product-editor-modal | edited via Store catalog-manager + storefront-preview |

**Drift symptoms today:**
- Three independent forms (`apps/web/src/app/app/commerce/products/product-form-modal.tsx`, `apps/web/src/app/app/marketplace/components/product-editor-modal.tsx`, `apps/web/src/app/app/store/components/catalog-manager.tsx`) each support a different subset of `Product` fields (e.g. only the marketplace form edits `hsCode`, only the store form edits `executionMeta` tiers).
- Storefront page reads `Product` directly and ignores `MarketplaceListing`, so listing-level overrides are silently dropped.
- `Service` is manually re-created from a `Product` via `Service.sourceProductId` (one-way), with `bookings.controller.ts:185` `createService` taking `sourceProductId` as a hint. There is no reverse sync.

### 5.2 Service (bookable item)

| Concern | Implementation 1 — Bookings | Implementation 2 — Commerce (`Product.category='SERVICE'`) | Implementation 3 — Storefront merge |
|---|---|---|---|
| Create | `bookings.controller.ts:185 createService` → `prisma.service.create` (raw, no DTO, no shared types) | `CommerceService.createProduct({ category:'SERVICE' })` | Storefront catalog-manager creates via Commerce. |
| Update | `bookings.controller.ts:202 updateService` (raw `prisma.service.update`) | `CommerceService.updateProduct` | UI calls Commerce only. |
| Delete | `bookings.controller.ts:224 deleteService` (soft) | `CommerceService.deleteProduct` (soft) | n/a |
| Batch | `bookings.controller.ts:236 batchServices` | `commerce.controller.ts:90 bulk` | n/a |
| Public list | `/bookings/public/businesses/:bid/services` (raw findMany) | `/commerce/public/businesses/:bid/products` filtered to `category='SERVICE'` client-side | Storefront calls **both** then de-dupes by name (see `book/[slug]/page.tsx:457`: `storeServiceNames = new Set(services.map(s => s.name))`). |

**Concrete bug surface from this duplication:**
- A "Pro Detail" service can exist as both a `Service` and a `Product(category='SERVICE')` with the same name; the storefront silently drops the `Product` copy by name (case-sensitive) inside `book/[slug]/page.tsx:484`. Edit either copy → catalog flickers between two prices/durations.
- Bookings controller writes `Service` rows directly via `prisma` instead of through a service class, so any future audit logging / event emission added to a service layer will miss these writes.
- `Service.sourceProductId` is set on create but never enforced on update/delete; the two rows can drift indefinitely.

### 5.3 File:line index of duplicated CRUD (for the S1 PR)

```
apps/server/src/modules/commerce/commerce.service.ts:20    listProducts
apps/server/src/modules/commerce/commerce.service.ts:43    createProduct
apps/server/src/modules/commerce/commerce.service.ts:74    updateProduct
apps/server/src/modules/commerce/commerce.controller.ts:55 GET  /commerce/public/businesses/:businessId/products
apps/server/src/modules/commerce/commerce.controller.ts:62 GET  /commerce/businesses/:businessId/products
apps/server/src/modules/commerce/commerce.controller.ts:80 POST /commerce/businesses/:businessId/products
apps/server/src/modules/commerce/commerce.controller.ts:102 PATCH /commerce/businesses/:businessId/products/:productId
apps/server/src/modules/commerce/commerce.controller.ts:115 DELETE /commerce/businesses/:businessId/products/:productId

apps/server/src/modules/bookings/bookings.controller.ts:117 GET  /bookings/public/businesses/:businessId/services (raw prisma)
apps/server/src/modules/bookings/bookings.controller.ts:175 GET  /bookings/businesses/:businessId/services       (raw prisma)
apps/server/src/modules/bookings/bookings.controller.ts:184 POST /bookings/businesses/:businessId/services       (raw prisma)
apps/server/src/modules/bookings/bookings.controller.ts:202 PATCH/services/:serviceId                            (raw prisma)
apps/server/src/modules/bookings/bookings.controller.ts:224 DELETE /services/:serviceId                          (raw prisma)
apps/server/src/modules/bookings/bookings.controller.ts:236 POST /services/batch                                 (raw prisma)

apps/server/src/modules/marketplace/marketplace.service.ts (createListing/updateListing/listListings) — touches Product + MarketplaceListing in lockstep but diverges from Commerce shape.

apps/web/src/app/app/commerce/products/product-form-modal.tsx        (Commerce form)
apps/web/src/app/app/marketplace/components/product-editor-modal.tsx  (Marketplace form, different fields)
apps/web/src/app/app/store/components/catalog-manager.tsx             (Store manager wraps Commerce API, adds storefront-only fields)
apps/web/src/app/book/[slug]/page.tsx:441-507                         (client-side de-dupe of services vs products)
```

**Proposed shared-Catalog target (informs S1):**
- One `CatalogModule` (server) owning `Product`, `Service`, `MarketplaceListing`, `InventoryStock` writes through one `CatalogService`.
- One `catalog-product-form` component (web) used by Commerce / Marketplace / Store.
- `Service` becomes a *projection* of a `Product` with `kind='service'` + scheduling metadata, eliminating `sourceProductId` drift.
- Storefront page reads from a single `/catalog/public/:slug` endpoint that already merges products + services + listings + inventory + reviews.

---

## 6. Gap list (with milestone tags)

Each gap names: where it bites, what fix looks like, which downstream
milestone owns it. S1 / S2 / S3 / S4 / S5 are the queued milestones.

| # | Gap | Where | Fix sketch | Milestone |
|---|---|---|---|---|
| G1 | Product/Service duplication across Store/Commerce/Bookings (see §5). | Server + web | Single CatalogModule + CatalogService, one form component. | **S1 (Shared Catalog)** |
| G2 | `POST /site/businesses/:businessId/analytics/event` accepts arbitrary `businessId` from the body's URL with only IP rate limiting — no signed token, so the counter can be polluted by anyone. | `site.controller.ts:53` | Sign analytics events with the slug-derived public key, or scope by slug + cookie session id. | **S1 (Public conversion hardening)** |
| G3 | Storefront checkout does not create / link a CRM `Contact`; intake submissions don't either. Buyers and inquirers are invisible to CRM. | `store-order.service.ts:141-210`, `intake.service.ts:42-66` | On checkout/intake, upsert `Contact` by email/phone (same path as `BookingsService.publicCreateBooking` already uses) and link `MarketplaceOrder.contactId` / `IntakeSubmission.contactId`. Requires schema FK additions. | **S1 (Public conversion hardening)** + S2 (CRM hookups follow-up) |
| G4 | Intake / Quote-request flow does not create a `Quote` row, send owner an email, or trigger any CRM sequence — only an in-app notification. | `intake.service.ts` | After intake insert, create `Quote(status=DRAFT)` for the highest-value matched product, send templated email via `NotificationsModule`, enroll Contact in `CrmSequence`. | **S1 (Public conversion hardening)** |
| G5 | "Share" flow is fully client-only — no analytics event, no referral attribution. | `book/[slug]/components/share-buttons.tsx` | On share click, POST `analytics/event { type:'share', itemId }`. On page load, parse `?ref=`/`?via=` query and persist into the order metadata. | **S1 (Public conversion hardening)** |
| G6 | Storefront ignores `MarketplaceListing` (HS code, supplier, digital delivery, min order qty). | `book/[slug]/page.tsx:441-507`, `commerce.controller.ts:55` | New `/catalog/public/:slug` endpoint returns merged Product+Listing+Inventory shape; web reads from it. | **S1 (Shared Catalog)** |
| G7 | `InventoryStock` is not decremented when a `MarketplaceOrder { type:'STOREFRONT' }` is created or paid. Stock can oversell silently. | `store-order.service.ts:141-210` | In `createOrder`, reserve stock; on `updatePaymentStatus('PAID')`, decrement and write `StockMovement`. | **S1 (Shared Catalog)** |
| G8 | No revenue attribution. `MarketplaceOrder` has no `source`, `utm`, `journeyId`, or `campaignId` columns. Cannot answer "what drove this sale". | schema.prisma model `MarketplaceOrder` (line 2555) | Add `sourceChannel`, `referrer`, `utmCampaign`, `qualificationJourneyId`, `campaignId` columns. Populate at `createOrder`. Aggregate into existing `AttributionResult`. | **S1 (Public conversion hardening)** + S4 (Growth Intelligence) |
| G9 | Two parallel public-payment surfaces: storefront checkout (via `PaymentsService.createStorePayment`) and invoice payment links (`/pay/[invoiceId]`, `/pay/link/[token]`). They share no common refund / chargeback handling. | `payments` module + `commerce.controller.ts:799-844` | Unify into a single `PaymentIntent` abstraction in S2. | S2 |
| G10 | `LandingPage` model exists but no public renderer. | `schema.prisma:2076`, no `/p/:slug` route | Either delete the model or build the public renderer in S3. | S3 (new public sections) |
| G11 | `Site` model is barely used (only `/public/social`). The "storefront config" lives in a JSON blob persisted via `SiteService.updateStorefrontConfig` — schema is informal. | `site.service.ts` (1145 lines) | Promote `Site.siteData.storefront` to typed columns or a `StorefrontConfig` model in S1. | **S1 (Shared Catalog / Public conversion hardening boundary)** |
| G12 | Mobile UX: `book/[slug]/page.tsx` is one 1485-line client component; cart drawer + checkout flow + qualifier all rendered in a single tree, no code-splitting, no skeleton on slow networks. | `book/[slug]/page.tsx` | Split into route-level segments, add `loading.tsx`, lazy-load qualifier and asset-intake. | **S1 (Public conversion hardening)** |
| G13 | Public endpoints rely solely on IP-based `PublicRateLimitGuard`. No body-size guard, no schema validation (DTOs are untyped `Body() body: Record<string, any>` in places — see `site.controller.ts:39, 277, 460`). | site/bookings public endpoints | Apply `class-validator` DTOs + `ValidationPipe`, cap body size, add CAPTCHA on intake/review submission. | **S1 (Public conversion hardening)** |
| G14 | `Service` writes in `bookings.controller.ts` bypass any service layer (raw `prisma.client.service.create`), so emitted events / activity logs are absent for service catalog changes. | `bookings.controller.ts:185-265` | Move to `CatalogService` in S1. | **S1 (Shared Catalog)** |
| G15 | Identity public endpoints (`/identity/businesses/slug/:slug`, `/identity/businesses/public/:businessId`) appear unguarded — any field on `Business` is potentially exposed. | `identity.controller.ts:289, 309` | Whitelist returned fields; gate behind `PublicRateLimitGuard`. | **S1 (Public conversion hardening)** |
| G16 | Order confirmation page is rendered inside the same SPA (`/book/[slug]` Success state), not at a stable URL. Visitors cannot bookmark or share their receipt. | `book/[slug]/page.tsx` order-confirmation flow | Redirect to `/order/[token]` after checkout (route + controller already exist). | **S1 (Public conversion hardening)** |
| G17 | No public sitemap / robots tuning per business storefront. `apps/web/src/app/robots.ts` is global. | `apps/web/src/app/robots.ts` + missing `sitemap.ts` per slug | Add per-slug `sitemap.ts`. | S3 (SEO) |
| G18 | `LandingPage`, custom-section presence pages, FAQ, About, Contact pages — all required for "presence" — are missing as standalone routes. | n/a | Build in S3. | S3 |
| G19 | No verify-public-flows smoke script existed before this audit. | `scripts/` | Added by this PR (`scripts/verify-presence.sh`). | **S0 (this task)** |

---

## 7. How the verify script is used

`scripts/verify-presence.sh` is a curl-driven smoke test that exercises
each canonical public flow against the running dev server. It exits
non-zero on any failed step and prints a per-step pass/fail table.

```
BASE_URL=http://localhost:3001 BUSINESS_SLUG=demo-co BUSINESS_ID=cluxxx \
PRODUCT_ID=prdxxx SERVICE_ID=svcxxx \
  bash scripts/verify-presence.sh
```

It does **not** charge real money — checkout uses `paymentMethod=CASH`
and refunds are not exercised. Anything that requires real provider
credentials (Stripe / WiPay) is skipped with a "SKIP" line.

The script only validates HTTP status + minimum payload shape; it is
not a replacement for the full e2e suite. Its job is to make sure the
public flows are wired end-to-end so S1 work has a baseline to refactor
against.

---

## 8. Out of scope (intentional)

- Any code refactor — owned by S1.
- Any new public sections / about / FAQ / landing pages — owned by S3.
- Real payment integration changes — owned by S2.
- CRM playbook / sequences enrollment beyond the immediate "create Contact" — owned by S2.
- Threat modelling / pen-test of public surface — owned by separate security pass.
