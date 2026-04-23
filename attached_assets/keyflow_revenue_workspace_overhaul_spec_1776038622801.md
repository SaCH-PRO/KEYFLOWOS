# KeyFlow Revenue Workspace Overhaul Spec
## AI Coder Implementation Document

### Objective
Redesign and strengthen the **Revenue** workspace comprehensively without removing functionality. Preserve the current capabilities for products/services, invoices, quotes, payments, recurring billing, tax/settings, gateways, templates, and invoice detail views, but reorganize the workspace so it behaves like a true **revenue operations command center**.

Do not remove features. Improve hierarchy, mode separation, collections intelligence, quote-to-cash flow clarity, and system integration.

---

## 1. Product Goal

The Revenue workspace should support three distinct but connected jobs:

1. **Run revenue operations**
   - manage invoices
   - manage quotes
   - track payments
   - monitor outstanding and overdue amounts
   - collect money faster
   - understand revenue health

2. **Manage the offer catalog**
   - products
   - services
   - packages
   - pricing

3. **Configure revenue infrastructure**
   - billing & tax
   - payment gateways
   - branding & templates
   - recurring billing settings

The final workspace should feel:
- operational
- premium
- financially intelligent
- calm
- decisive
- scalable

It should stop feeling like a flat commerce admin area and start feeling like a **quote-to-cash operating surface**.

---

## 2. Existing Strengths to Preserve

Keep these strengths:

1. **Expandable section model**
   - Products & Services
   - Invoices
   - Quotes
   - Payments
   - Recurring

2. **Invoice detail drawer**
   - invoice header/status
   - amount
   - customer
   - dates
   - line items
   - send / mark paid / print / view as customer

3. **Products & Services grid**
   - search
   - segmentation
   - pricing visibility
   - grid/list toggle

4. **Payments tracking**
   - received
   - pending
   - overdue
   - collections health

5. **Recurring billing empty state**
6. **Billing & Tax / Payment Gateways / Branding & Templates**

Do not regress these.

---

## 3. Core Problems to Solve

### A. The workspace is trying to be too many things at once
It currently mixes:
- live revenue operations
- catalog management
- billing configuration

inside one mostly flat shell.

### B. Revenue-first hierarchy is weak
At first glance the page does not strongly communicate:
- what money is collectible now
- what is overdue
- what is blocked
- what needs follow-up
- what is converting
- where revenue leakage exists

### C. Catalog is too visually equal to collections work
Products & Services is important, but if too prominent it dilutes the sense that this workspace is about revenue operations.

### D. Invoices are practical but not triage-driven enough
The invoices section still behaves more like a registry than a collections/operations workspace.

### E. Quotes are under-expressed
Quotes are visible, but not yet treated as a major revenue transition point with conversion insight.

### F. Settings/configuration are mixed too directly into live operations
Billing settings, gateways, and branding should not compete equally with invoices and payments.

### G. Revenue objects need stronger linkage to the rest of the OS
Invoices, quotes, and payments should connect more clearly to:
- clients
- services/packages
- bookings
- communications
- timelines
- automation/flow history

---

## 4. Required Outcome

After overhaul, the Revenue workspace must support:

- fast understanding of cash state
- visibility into collections risk
- clear management of invoices, quotes, payments, and recurring billing
- stronger quote-to-cash flow logic
- clear separation between operations, catalog, and setup
- richer integration with clients and the rest of the system
- a premium, decisive, operational feel

---

## 5. Information Architecture

### Sidebar label
Use **Revenue**

### Page title
Use **Revenue**, not Commerce, at the main workspace level.

Recommended page title and subtitle:
- **Revenue**
- *Invoices, quotes, payments, collections, and billing operations*

You may retain “Commerce” as an internal technical/domain concept, but the user-facing workspace should feel clearly like Revenue Ops.

---

## 6. Final Internal Mode Structure

This is the most important structural change.

Use three clear internal modes:

1. **Operations**
2. **Catalog**
3. **Setup**

---

## 7. Mode Definitions

### Operations
For live money movement and revenue workflow.

Contains:
- Invoices
- Quotes
- Payments
- Recurring

### Catalog
For the offer/pricing surface.

Contains:
- Products
- Services
- Packages

### Setup
For billing system configuration.

Contains:
- Billing & Tax
- Payment Gateways
- Branding & Templates
- Future payment preferences/settings

This will reduce the current flatness and make the workspace much easier to understand.

---

## 8. Final Layout Structure

### A. Left Rail
Keep global workspaces nav unchanged.

Optional improvement:
- visually separate core workspaces from support workspaces

---

### B. Revenue Header
The top of the page should include:

- title
- short subtitle
- compact revenue command strip
- primary CTA
- optional quick actions / settings

Recommended subtitle:
> Invoices, quotes, payments, collections, and billing operations

The top area should communicate money flow and urgency, not just page identity.

---

### C. Operations Mode Layout
This should become the main revenue hero.

Structure:
1. revenue command strip
2. action / collections queue
3. operational sections:
   - Invoices
   - Quotes
   - Payments
   - Recurring

### D. Catalog Mode Layout
This should house Products & Services cleanly.

Structure:
1. catalog summary
2. search / filters / segmentation
3. product/service/package grid or list
4. optional pricing insights / usage / readiness

### E. Setup Mode Layout
This should house configuration surfaces.

Structure:
1. revenue setup readiness summary
2. setup cards/sections
3. dependency warnings
4. preview/help guidance if applicable

---

## 9. Revenue Command Strip (Top-Level Upgrade)

This should be the first thing users see in Operations mode.

Required top-level metrics:
- Outstanding
- Overdue
- Received this month
- Pending quotes
- Draft invoices
- Recurring upcoming

Optional:
- Collection risk
- Average days to payment
- Unsent invoices

Design:
- compact but decisive
- prioritize urgency and cashflow meaning
- do not make it a bloated dashboard

Example:
- Outstanding: TTD 700
- Overdue: TTD 0
- This Month: TTD 0
- Drafts: 2
- Quotes Pending: 1
- Recurring Upcoming: 0

---

## 10. Revenue Action Queue (New / High Priority)

Add a compact action queue directly under the top revenue strip.

Purpose:
Surface what needs money-related action now.

Example items:
- 2 draft invoices are unsent
- 1 quote awaiting follow-up
- TTD 700 pending from 2 invoices
- 1 client has not responded after invoice sent
- recurring schedule not configured

Each queue item should show:
- entity type
- reason
- amount/value if applicable
- urgency
- CTA

Example CTAs:
- Send invoice
- Follow up quote
- Remind client
- Mark paid
- Create schedule
- Open invoice

This is what makes the workspace feel operational.

---

## 11. Operations Mode Overhaul

### 11.1 Invoices Section
The invoices surface must evolve from registry to collections workspace.

Keep:
- search
- filters
- status tabs
- bulk select
- invoice rows
- drawer

Improve with stronger triage views:
- Draft
- Sent
- Due soon
- Overdue
- High value
- Needs reminder

Optional additional metrics:
- total collectible
- total draft value
- average invoice age

### Invoice row improvements
Each invoice row should show:
- invoice number
- client
- status
- date / due date
- amount
- reminder state
- linked service/package if available
- urgency flag if relevant

### Add clearer actions
- Finish draft
- Send
- Remind
- View
- Mark paid

The section should help the user decide what to do, not just browse invoices.

---

### 11.2 Invoice Detail Drawer Enhancement
Preserve the current drawer and improve it slightly.

Add or prepare support for:
- communication timeline
- reminder history
- payment attempts / payment state
- linked client quick access
- linked booking or project if applicable
- automation/flow events
- internal notes

This drawer is one of the strongest parts of the workspace and should become even more central.

---

### 11.3 Quotes Section
Quotes need a much stronger role.

Current issue:
Quotes are present but visually underpowered.

### Required quote visibility
The user should understand:
- sent
- viewed
- accepted
- expired
- stalled / not followed up

### Show key quote metrics
- pending quote value
- accepted quote value
- expired value
- quote conversion rate

### Quote actions
- Send quote
- Follow up
- Convert to invoice
- View as customer
- Archive / expire

Quotes are a core transition point between opportunity and cash.
Treat them like a pipeline stage, not a miscellaneous section.

---

### 11.4 Payments Section
The payments surface is already one of the strongest subareas and should become the model for the rest of the workspace.

Keep:
- Received
- This Month
- Pending
- Overdue
- Collections Health
- searchable payment list
- per-item actions

Improve “Collections Health” so it explains meaning, not just number.

### Collections Health should communicate:
- collectible now
- overdue exposure
- movement from prior period
- average payment delay
- invoices awaiting action

Example:
- TTD 700 pending from 2 invoices
- 0 overdue
- 2 drafts not yet sent
- average delay: 0 days

### Payment list row content
- invoice number
- client
- status
- amount
- last action
- suggested action

### Payment actions
- Send reminder
- Mark paid
- Open invoice
- View client

---

### 11.5 Recurring Section
Recurring billing is strategically important and should connect to revenue forecasting.

Keep:
- clean empty state
- CTA

Improve with:
- next recurring run
- active schedules
- projected recurring value
- failed recurring runs
- inactive recurring opportunities

When empty, explain business value clearly:
- subscriptions
- retainers
- recurring services
- automated billing

---

## 12. Catalog Mode Overhaul

Products & Services should move into a dedicated Catalog mode.

### Goal
Keep the strong catalog capabilities without letting them dilute operations.

### Required structure
1. top catalog summary
2. search bar
3. filters
4. segmentation tabs
5. grid/list toggle
6. product/service/package cards

### Better segmentation
- All
- Services
- Products
- Packages
- Active
- Inactive
- Highest revenue
- Most booked / most sold (future-ready)

### Card improvements
Each card should show:
- type
- title
- price
- status
- description snippet
- linked sales/revenue signal if available
- edit action
- visibility/publish status if relevant

Goal:
This should feel like offer management, not general admin clutter.

---

## 13. Setup Mode Overhaul

Move these surfaces into a dedicated Setup mode:
- Billing & Tax
- Payment Gateways
- Branding & Templates

### Setup should show:
- readiness state
- issues blocking collections
- enabled gateway status
- invoice template status
- tax configuration completeness

### Example readiness states
- No payment gateway connected
- Tax rules not configured
- Default invoice branding incomplete
- Payment methods enabled successfully

This mode should feel like revenue infrastructure, not footer settings.

---

## 14. Visual Hierarchy Rules

### Operations should visually dominate
When the user enters Revenue, the first feeling should be:
- what money is moving
- what money is blocked
- what needs action

### Catalog should be clearly secondary
Catalog is important, but it is not the first thing users should see in a revenue-ops mindset.

### Setup should be clearly separate
Do not let setup cards compete visually with invoices/payments.

---

## 15. Search / Filter Rules

### Operations mode
Support filters such as:
- Draft
- Sent
- Due soon
- Overdue
- Paid
- Client
- Time range
- Value size
- Needs reminder

### Catalog mode
Support:
- Products / Services / Packages
- active/inactive
- price range
- category
- search by name

### Setup mode
Search is optional, but readiness issues and configuration states must be visible.

---

## 16. Functional Integration Requirements

Every revenue object should visibly link into the broader system.

### Invoices should connect to:
- client
- products/services/packages
- bookings if relevant
- communications
- timeline
- automation history

### Quotes should connect to:
- client
- service/package
- sales progression
- follow-up workflow
- conversion outcome

### Payments should connect to:
- invoice
- client
- reminder flow
- payment method / gateway
- revenue reporting

This is essential to make Revenue part of the business OS rather than a standalone billing module.

---

## 17. Visual / Interaction Rules

### Tone
The Revenue workspace must feel:
- decisive
- premium
- financially clear
- operational
- not bureaucratic

### Keep
- expandable sections
- calm surfaces
- clean spacing
- strong drawer pattern

### Improve
- stronger urgency hierarchy
- clearer separation of modes
- richer top-level money visibility
- more action-oriented sub-sections
- better quote and collections prominence

### Avoid
- treating all sections as equal
- burying revenue urgency
- leading with catalog management instead of cashflow
- mixing setup/settings directly into live operations

---

## 18. Suggested Final Component Tree

```text
RevenuePage
  RevenueHeader
    Breadcrumbs
    Title + subtitle
    RevenueCommandStrip
    RevenuePrimaryActions

  RevenueModeTabs
    Operations
    Catalog
    Setup

  OperationsView
    RevenueActionQueue
    InvoiceSection
      InvoiceFilters
      InvoiceList
      InvoiceDrawer
    QuotesSection
      QuoteMetrics
      QuoteFilters
      QuoteList
    PaymentsSection
      PaymentsKpiStrip
      CollectionsHealth
      PaymentFilters
      PaymentList
    RecurringSection
      RecurringSummary
      RecurringListOrEmptyState

  CatalogView
    CatalogSummary
    CatalogSearch
    CatalogFilters
    CatalogTabs
    ProductServiceGrid

  SetupView
    RevenueSetupReadiness
    BillingTaxCard
    PaymentGatewaysCard
    BrandingTemplatesCard
```

---

## 19. Prioritized Implementation Plan

### Phase 1 — Structural clarity
1. Rename main page title to **Revenue**
2. Add internal mode tabs:
   - Operations
   - Catalog
   - Setup
3. Make Operations the default
4. Add a top-level revenue command strip

### Phase 2 — Revenue operations upgrades
5. Add revenue action queue
6. Improve invoice triage states and row metadata
7. Elevate quotes with metrics and clearer actions
8. Improve collections health interpretation
9. Strengthen recurring visibility

### Phase 3 — Integration and context
10. Enhance invoice drawer with timeline/reminder/client linkage
11. Connect quotes and invoices more visibly to clients and services
12. Add cross-links to related modules where appropriate

### Phase 4 — Catalog and setup refinement
13. Move Products & Services into Catalog mode
14. Move Billing & Tax / Gateways / Templates into Setup mode
15. Add readiness and configuration status messaging
16. Refine spacing, copy, CTA hierarchy, and visual grouping

---

## 20. Acceptance Criteria

The Revenue overhaul is successful if:

1. Users can immediately understand cash state and what needs action
2. Operations, Catalog, and Setup are clearly separated
3. Invoices feel like a collections workspace, not just a list
4. Quotes feel like a real conversion stage
5. Payments clearly communicate collections health
6. Setup no longer competes with live revenue work
7. Catalog is powerful but no longer dilutes revenue operations
8. Invoice/quote/payment objects connect visibly to clients and the rest of the system
9. No existing capability is removed

---

## 21. Non-Negotiables

- Do not remove Products & Services
- Do not remove Invoices, Quotes, Payments, or Recurring
- Do not remove invoice drawer actions
- Do not hide billing setup in a confusing way
- Do not leave catalog, setup, and collections flatly equal
- Do not allow the page to feel more like store admin than revenue ops

---

## 22. Target Outcome Statement

The final Revenue workspace should feel like:

> a premium revenue operations command center that helps the user understand what is owed, what is blocked, what is converting, and what to do next — while still supporting catalog management and billing infrastructure in clearly separated modes.
