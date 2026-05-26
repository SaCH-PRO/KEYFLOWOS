# KeyflowOS Navigation Overhaul Plan

**Objective:** Merge 28+ workspace modules into fewer navigation surfaces with simpler, job-to-be-done access patterns.

**Target Surfaces:** 3 primary (down from 4) + 1 secondary = **Cockpit | Operate | Build** (+ Me)

---

## The Problem Statement

| # | Problem | Current State | Impact |
|---|---------|---------------|--------|
| 1 | **28 workspace items** in one drawer | Users scroll endlessly to find modules | Cognitive overload, slow navigation |
| 2 | **Fragmented money flows** | Revenue, Finance, Accounting, Commerce, Payments, Expenses = 6 separate modules | Users don't know where to invoice, expense, or reconcile |
| 3 | **Scattered CRM** | Contacts, Deals, Pipeline, Accounts, Sequences, Intelligence, Network = 7+ separate entry points | No single "customer view" |
| 4 | **20 settings sub-pages** | Every setting is top-level in Settings drawer | Finding a setting requires memorizing its category |
| 5 | **Dormant modules clutter nav** | Documents, Payments, Community, Learn, Marketplace visible but locked | Visual noise, false promise |
| 6 | **Studio vs Workspaces blur** | Storefront, Blueprint, SEO in Studio; Intake Forms in Public | No clear "build vs run" mental model |
| 7 | **Public Surfaces underpopulated** | Only 2 items (Intake Forms, Business Profile) in its own drawer | Wasted rail real estate |
| 8 | **No Operations center** | Projects, Time Tracking, Retainers, Change Orders, Procurement all separate | No unified "work execution" view |

---

## The New Architecture: "Cockpit | Operate | Build"

### Mental Model

```
Cockpit  = Where you START your day (briefing, priorities, command)
Operate  = Where you DO your work (money, people, schedule, tasks)
Build    = Where you CONFIGURE your business (settings, integrations, storefront, automations)
Me       = Personal hub (profile, notifications, shortcuts) — secondary, always accessible
```

### Primary Rail (4 items)

```
┌─────────┐
│  🏠     │  Home → Cockpit
│  ⚡     │  Operate
│  🔧     │  Build
│  👤     │  Me
└─────────┘
```

---

## Phase 1: Operate Drawer — "Where You Do Your Work"

**Replaces:** Workspaces (28 items) + Public Surfaces (2 items)

**Organized by job-to-be-done, not module name:**

### Section 1: Money 💰
*Consolidates: Revenue, Finance, Accounting, Commerce, Payments, Expenses, Procurement*

```
Money
├── Overview      → /app/money           (new unified dashboard)
├── Revenue       → /app/money/revenue   (invoices, quotes, payments, subscriptions, collections)
├── Expenses      → /app/money/expenses  (expenses, receipts, procurement, POs)
├── Accounting    → /app/money/books     (journal, reconciliation, tax, COA, reports)
└── Cash Flow     → /app/money/cashflow  (forecast, banking, pulse, weekly briefing)
```

**Rationale:** A business owner thinks "I need to send an invoice" or "I need to check cash flow" — not "I need to open the Commerce module vs the Finance module." One Money hub, 5 tabs.

**Implementation:**
- Create `/app/money` as new shell page with tabbed sub-navigation
- `/app/commerce` → redirect to `/app/money/revenue`
- `/app/finance` → redirect to `/app/money`
- `/app/accounting` → redirect to `/app/money/books`
- `/app/expenses` → redirect to `/app/money/expenses`
- Keep all existing sub-routes functional (`/app/commerce/billing`, etc.)

---

### Section 2: People 👥
*Consolidates: CRM, Contacts, Sales Team, Portal, Helpdesk, WhatsApp*

```
People
├── Directory     → /app/people              (all contacts, accounts, leads)
├── Pipeline      → /app/people/pipeline     (deals, stages, forecast)
├── Sequences     → /app/people/sequences    (email campaigns, lifecycle, outreach)
├── Intelligence  → /app/people/intelligence (AI insights, network, data quality)
└── Service       → /app/people/service      (helpdesk, portal, WhatsApp)
```

**Rationale:** "People" is the natural mental model. Directory = who; Pipeline = deals with who; Sequences = communication to who; Intelligence = insights about who; Service = support for who.

**Implementation:**
- `/app/crm` → redirect to `/app/people`
- `/app/crm/pipeline` → `/app/people/pipeline`
- `/app/crm/contacts/:id` → `/app/people/directory/:id`
- `/app/helpdesk` → `/app/people/service`
- `/app/whatsapp` → `/app/people/service`
- `/app/portal` → `/app/people/service`
- Contact detail page keeps all 9 tabs (overview, notes, timeline, tasks, bookings, money, AI insights, recommendations)

---

### Section 3: Work ⚙️
*Consolidates: Projects, Time Tracking, Retainers, Change Orders, Plans, Tasks, Approvals*

```
Work
├── Projects      → /app/work/projects     (active projects, plans, deliverables)
├── Time          → /app/work/time         (time tracking, timesheets, billing)
├── Agreements    → /app/work/agreements   (retainers, change orders, SOWs)
└── Tasks         → /app/work/tasks        (my tasks, approvals, team workload)
```

**Rationale:** Projects are the unit of work. Time tracks against projects. Agreements govern projects. Tasks are the atomic unit. Everything work-related lives here.

**Implementation:**
- `/app/projects` → redirect to `/app/work/projects`
- `/app/time-tracking` → `/app/work/time`
- `/app/retainers` → `/app/work/agreements`
- `/app/change-orders` → `/app/work/agreements`
- `/app/approvals` → `/app/work/tasks`

---

### Section 4: Schedule 📅
*Consolidates: Calendar, Bookings, Call Tasks*

```
Schedule
├── Calendar      → /app/schedule/calendar   (full calendar, Google sync)
├── Bookings      → /app/schedule/bookings   (appointment types, booking links)
└── Calls         → /app/schedule/calls      (call tasks, scripts, outcomes)
```

**Rationale:** Time-based activities belong together. Calendar = your time; Bookings = others booking your time; Calls = scheduled conversations.

**Implementation:**
- `/app/calendar` → redirect to `/app/schedule/calendar`
- `/app/bookings` → `/app/schedule/bookings`
- `/app/call-tasks` → `/app/schedule/calls`

---

### Section 5: Communicate 💬
*Consolidates: Inbox, Content Ops, Marketing, Assets, Social*

```
Communicate
├── Inbox         → /app/inbox               (unified inbox, email, notifications)
├── Campaigns     → /app/communicate/campaigns (marketing, email, social posts)
├── Content       → /app/communicate/content   (content ops, assets, approvals)
└── Social        → /app/communicate/social    (social media management)
```

**Rationale:** All outbound communication and content creation in one place. Inbox = inbound; Campaigns = outbound marketing; Content = creative production; Social = social presence.

**Implementation:**
- `/app/inbox` stays as primary entry
- `/app/marketing` → `/app/communicate/campaigns`
- `/app/content-ops` → `/app/communicate/content`
- `/app/social` → `/app/communicate/social`
- `/app/assets` → `/app/communicate/content/assets`

---

### Section 6: Intelligence 📊
*Consolidates: Reports, Goals, Evidence, Operations, Structure*

```
Intelligence
├── Reports       → /app/intelligence/reports    (cross-module reports)
├── Goals         → /app/intelligence/goals      (OKRs, goal tracking)
├── Operations    → /app/intelligence/ops        (ops dashboard, structure)
└── Compliance    → /app/intelligence/compliance (evidence, audit trail)
```

**Rationale:** "Intelligence" is about understanding your business. Reports = what happened; Goals = what we're targeting; Operations = how we run; Compliance = how we prove it.

**Implementation:**
- `/app/reports` → redirect to `/app/intelligence/reports`
- `/app/goals` → `/app/intelligence/goals`
- `/app/operations` → `/app/intelligence/ops`
- `/app/evidence` → `/app/intelligence/compliance`
- `/app/structure` → `/app/intelligence/ops`

---

### Operate Drawer Summary

```
OPERATE
━━━━━━━━━━━━━━━━━━━━
💰 Money
   Overview | Revenue | Expenses | Accounting | Cash Flow
👥 People
   Directory | Pipeline | Sequences | Intelligence | Service
⚙️ Work
   Projects | Time | Agreements | Tasks
📅 Schedule
   Calendar | Bookings | Calls
💬 Communicate
   Inbox | Campaigns | Content | Social
📊 Intelligence
   Reports | Goals | Operations | Compliance
```

**Before:** 28 separate items, no grouping
**After:** 6 sections, 29 sub-items, grouped by job

---

## Phase 2: Build Drawer — "Where You Configure"

**Replaces:** Studio (6 items) + Settings (20 sub-pages) + Public Surfaces (2 items) + Dormant modules

### Section 1: Business 🏢
*Consolidates: Blueprint, Storefront, SEO, Presence, Intake Forms*

```
Business
├── Blueprint     → /app/build/business/blueprint   (business config, industry templates)
├── Storefront    → /app/build/business/store       (e-commerce store, products, catalog)
├── Presence      → /app/build/business/presence    (SEO, public pages, intake forms, site builder)
└── Templates     → /app/build/business/templates   (document templates, workflow templates)
```

**Rationale:** Everything that defines "your business" online and operationally. Blueprint = who you are; Storefront = what you sell; Presence = how you're found; Templates = how you work.

**Implementation:**
- `/app/blueprint` → redirect to `/app/build/business/blueprint`
- `/app/store` → `/app/build/business/store`
- `/app/seo` → `/app/build/business/presence`
- `/app/crm/intake` → `/app/build/business/presence/intake`
- `/app/templates` → `/app/build/business/templates`
- `/app/presence` → `/app/build/business/presence`

---

### Section 2: System ⚙️
*Consolidates: Settings (20 sub-pages collapsed to 6 groups)*

```
System
├── Account       → /app/build/system/account       (profile, security, privacy, notifications)
├── Workspace     → /app/build/system/workspace     (business info, team, invite, billing)
├── Connections   → /app/build/system/connections   (integrations, contact sources, webhooks)
├── AI            → /app/build/system/ai            (AI prefs, control, output templates)
├── Compliance    → /app/build/system/compliance    (compliance settings, structure)
└── Developers    → /app/build/system/developers    (API keys, webhooks, conversion tracking)
```

**Rationale:** 20 settings pages is absurd. Group into 6 logical buckets that match how users think about configuration.

**Mapping old → new:**

| Old Page | New Location |
|----------|-------------|
| `/app/settings/profile` | Account |
| `/app/settings/security` | Account |
| `/app/settings/privacy` | Account |
| `/app/settings/notifications` | Account |
| `/app/settings/business` | Workspace |
| `/app/settings/team` | Workspace |
| `/app/settings/invite` | Workspace |
| `/app/settings/billing` | Workspace |
| `/app/settings/connections` | Connections |
| `/app/settings/contact-sources` | Connections |
| `/app/settings/webhooks` | Connections (or Developers) |
| `/app/settings/ai` | AI |
| `/app/settings/ai-control` | AI |
| `/app/settings/output-templates` | AI |
| `/app/settings/compliance` | Compliance |
| `/app/settings/catalog` | Workspace |
| `/app/settings/conversion` | Developers |
| `/app/settings/developers` | Developers |
| `/app/settings/templates` | Business > Templates |

---

### Section 3: Connect 🔌
*All 22 integrations in one place*

```
Connect
├── Overview      → /app/build/connect          (connection health, needs-attention)
├── Google        → /app/build/connect/google   (Gmail, Calendar, Drive, Forms, Contacts, Business Profile)
├── Microsoft     → /app/build/connect/microsoft (Outlook)
├── Payments      → /app/build/connect/payments (Stripe, PayPal, WiPay)
├── Accounting    → /app/build/connect/accounting (QuickBooks, Xero)
├── Marketing     → /app/build/connect/marketing (Mailchimp, Klaviyo)
├── Social        → /app/build/connect/social   (Meta, LinkedIn, TikTok, Twitter)
├── Forms         → /app/build/connect/forms    (Typeform, Jotform, Webhook Forms)
└── WhatsApp      → /app/build/connect/whatsapp
```

**Implementation:**
- `/app/connect` → redirect to `/app/build/connect`
- All existing connector sub-pages redirect appropriately

---

### Section 4: Automate 🤖
*Consolidates: Flows, Workflows*

```
Automate
├── Flows         → /app/build/automate/flows      (automation builder, triggers)
└── Workflows     → /app/build/automate/workflows  (business process workflows)
```

**Implementation:**
- `/app/automations` → redirect to `/app/build/automate/flows`
- `/app/workflows` → `/app/build/automate/workflows`

---

### Section 5: More (Dormant) 🔮
*Hidden by default, expandable. Removes visual clutter.*

```
More ▼
├── Documents     → /app/documents        (hidden, locked)
├── Community     → /app/community        (hidden, locked)
├── Learn         → /app/learn            (hidden, locked)
├── Marketplace   → /app/marketplace      (hidden, locked)
└── Supplier      → /app/supplier         (hidden, locked)
```

**Rationale:** Dormant modules are not navigation items — they're future features. Hide them in an expandable "More" section at the bottom of Build. Users who know about them can expand. New users aren't distracted.

**Implementation:**
- Remove all `comingSoonNav` items from main nav
- Add collapsible "More" section at bottom of Build drawer
- Keep `dormantFlag` logic but don't render in primary nav at all

---

### Build Drawer Summary

```
BUILD
━━━━━━━━━━━━━━━━━━━━
🏢 Business
   Blueprint | Storefront | Presence | Templates
⚙️ System
   Account | Workspace | Connections | AI | Compliance | Developers
🔌 Connect
   Overview | Google | Microsoft | Payments | Accounting | Marketing | Social | Forms | WhatsApp
🤖 Automate
   Flows | Workflows
🔮 More ▼
   Documents | Community | Learn | Marketplace | Supplier
```

**Before:** Studio (6) + Settings (20) + Public (2) + Coming Soon (8) = 36 items
**After:** 4 sections + 1 collapsible = 19 visible items, 5 hidden

---

## Phase 3: Cockpit (Minimal Changes)

Keep Cockpit as-is. It's already the right concept — daily briefing + command center.

**One enhancement:** Add quick-jump tiles to Operate sections:

```
┌─────────────────────────────────────┐
│  Today's Briefing                   │
├─────────────────────────────────────┤
│  [Send Invoice] [Check Cash]        │
│  [Add Contact]  [Book Meeting]      │
│  [Start Timer]  [Create Task]       │
└─────────────────────────────────────┘
```

These are deep-links into `/app/money/revenue`, `/app/schedule/calendar`, etc.

---

## Phase 4: Me Drawer (New)

**Always accessible, lightweight personal hub.**

```
ME
━━━━━━━━━━━━━━━━━━━━
👤 Profile        → /app/profile
🔔 Notifications  → /app/notifications
⚙️ Preferences    → /app/build/system/account
🌙 Theme          → (toggle)
🚪 Logout
```

**Rationale:** Profile, notifications, and preferences are personal — they don't belong in "Build" (business configuration). Give them a dedicated, always-accessible surface.

**Implementation:**
- Create `/app/profile` page (moves from `/app/settings/profile`)
- Add notification center at `/app/notifications`
- Rail item always visible, compact

---

## Phase 5: Mobile Navigation

Current mobile bottom nav has 5 items. New:

```
┌─────┬─────┬─────┬─────┬─────┐
│ 🏠  │ ⚡  │ 🔧  │ 💬  │ 👤  │
│Home │Oper.│Build│Inbox│ Me  │
└─────┴─────┴─────┴─────┴─────┘
```

- Home = Cockpit
- Operate = Opens Operate sheet/drawer
- Build = Opens Build sheet/drawer
- Inbox = Quick access to unified inbox (most-used action)
- Me = Personal hub

---

## URL Migration Strategy

**Rule: Keep all old URLs working with redirects.**

| Old URL | Redirect To | Status |
|---------|-------------|--------|
| `/app/commerce` | `/app/money/revenue` | 301 |
| `/app/commerce/*` | `/app/money/revenue/*` | 301 |
| `/app/finance` | `/app/money` | 301 |
| `/app/finance/*` | `/app/money/*` | 301 |
| `/app/accounting` | `/app/money/books` | 301 |
| `/app/expenses` | `/app/money/expenses` | 301 |
| `/app/crm` | `/app/people` | 301 |
| `/app/crm/*` | `/app/people/*` | 301 |
| `/app/projects` | `/app/work/projects` | 301 |
| `/app/time-tracking` | `/app/work/time` | 301 |
| `/app/retainers` | `/app/work/agreements` | 301 |
| `/app/change-orders` | `/app/work/agreements` | 301 |
| `/app/approvals` | `/app/work/tasks` | 301 |
| `/app/calendar` | `/app/schedule/calendar` | 301 |
| `/app/bookings` | `/app/schedule/bookings` | 301 |
| `/app/call-tasks` | `/app/schedule/calls` | 301 |
| `/app/marketing` | `/app/communicate/campaigns` | 301 |
| `/app/content-ops` | `/app/communicate/content` | 301 |
| `/app/social` | `/app/communicate/social` | 301 |
| `/app/assets` | `/app/communicate/content/assets` | 301 |
| `/app/reports` | `/app/intelligence/reports` | 301 |
| `/app/goals` | `/app/intelligence/goals` | 301 |
| `/app/operations` | `/app/intelligence/ops` | 301 |
| `/app/evidence` | `/app/intelligence/compliance` | 301 |
| `/app/structure` | `/app/intelligence/ops` | 301 |
| `/app/blueprint` | `/app/build/business/blueprint` | 301 |
| `/app/store` | `/app/build/business/store` | 301 |
| `/app/seo` | `/app/build/business/presence` | 301 |
| `/app/presence` | `/app/build/business/presence` | 301 |
| `/app/templates` | `/app/build/business/templates` | 301 |
| `/app/connect` | `/app/build/connect` | 301 |
| `/app/connect/*` | `/app/build/connect/*` | 301 |
| `/app/automations` | `/app/build/automate/flows` | 301 |
| `/app/workflows` | `/app/build/automate/workflows` | 301 |
| `/app/settings` | `/app/build/system/workspace` | 301 |
| `/app/settings/*` | `/app/build/system/*` | 301 |
| `/app/helpdesk` | `/app/people/service` | 301 |
| `/app/whatsapp` | `/app/people/service` | 301 |
| `/app/portal` | `/app/people/service` | 301 |

**Implementation:** Add a `navigation-redirects.ts` middleware that handles these before route matching. Or use Next.js `redirects` in `next.config.js`.

---

## File Changes Required

### 1. Navigation Config
- `apps/web/src/lib/nav-config.ts` — Complete rewrite
- `apps/web/src/components/layout/desktop-sidebar.tsx` — Update drawer rendering logic
- `apps/web/src/components/layout/mobile-nav.tsx` — Update bottom nav

### 2. New Shell Pages
- `apps/web/src/app/(app)/money/page.tsx` — Money overview
- `apps/web/src/app/(app)/money/revenue/page.tsx` — Revenue tab
- `apps/web/src/app/(app)/money/expenses/page.tsx` — Expenses tab
- `apps/web/src/app/(app)/money/books/page.tsx` — Accounting tab
- `apps/web/src/app/(app)/money/cashflow/page.tsx` — Cash flow tab
- `apps/web/src/app/(app)/people/page.tsx` — People directory
- `apps/web/src/app/(app)/people/pipeline/page.tsx`
- `apps/web/src/app/(app)/people/sequences/page.tsx`
- `apps/web/src/app/(app)/people/intelligence/page.tsx`
- `apps/web/src/app/(app)/people/service/page.tsx`
- `apps/web/src/app/(app)/work/projects/page.tsx`
- `apps/web/src/app/(app)/work/time/page.tsx`
- `apps/web/src/app/(app)/work/agreements/page.tsx`
- `apps/web/src/app/(app)/work/tasks/page.tsx`
- `apps/web/src/app/(app)/schedule/calendar/page.tsx`
- `apps/web/src/app/(app)/schedule/bookings/page.tsx`
- `apps/web/src/app/(app)/schedule/calls/page.tsx`
- `apps/web/src/app/(app)/communicate/campaigns/page.tsx`
- `apps/web/src/app/(app)/communicate/content/page.tsx`
- `apps/web/src/app/(app)/communicate/social/page.tsx`
- `apps/web/src/app/(app)/intelligence/reports/page.tsx`
- `apps/web/src/app/(app)/intelligence/goals/page.tsx`
- `apps/web/src/app/(app)/intelligence/ops/page.tsx`
- `apps/web/src/app/(app)/intelligence/compliance/page.tsx`
- `apps/web/src/app/(app)/build/business/blueprint/page.tsx`
- `apps/web/src/app/(app)/build/business/store/page.tsx`
- `apps/web/src/app/(app)/build/business/presence/page.tsx`
- `apps/web/src/app/(app)/build/business/templates/page.tsx`
- `apps/web/src/app/(app)/build/system/account/page.tsx`
- `apps/web/src/app/(app)/build/system/workspace/page.tsx`
- `apps/web/src/app/(app)/build/system/connections/page.tsx`
- `apps/web/src/app/(app)/build/system/ai/page.tsx`
- `apps/web/src/app/(app)/build/system/compliance/page.tsx`
- `apps/web/src/app/(app)/build/system/developers/page.tsx`
- `apps/web/src/app/(app)/build/connect/page.tsx`
- `apps/web/src/app/(app)/build/automate/flows/page.tsx`
- `apps/web/src/app/(app)/build/automate/workflows/page.tsx`

### 3. Redirects
- `apps/web/src/middleware.ts` or `next.config.js` redirects
- Or route-level `page.tsx` files that redirect

### 4. Components
- New `OperateDrawer`, `BuildDrawer`, `MeDrawer` components
- Shared `NavSection`, `NavItem`, `NavSubItem` components
- Updated `MobileSheet` for mobile navigation

---

## Implementation Priority

| Phase | Work | Effort | Impact |
|-------|------|--------|--------|
| 0 | Update nav-config.ts with new structure | 2h | High |
| 1 | Build redirect layer (all old URLs → new) | 4h | Critical |
| 2 | Create shell pages (Operate sections) | 8h | High |
| 3 | Create shell pages (Build sections) | 6h | High |
| 4 | Migrate Settings into 6 groups | 8h | High |
| 5 | Update desktop sidebar rendering | 4h | Medium |
| 6 | Update mobile navigation | 3h | Medium |
| 7 | Add "More" collapsible for dormant | 1h | Low |
| 8 | Update Cockpit quick-jump tiles | 2h | Medium |
| 9 | QA all redirects and active states | 4h | Critical |
| | **Total** | **~42 hours** | |

---

## Rollback Strategy

All changes are additive + redirects:
- Old pages continue to exist at old URLs (redirects handle forwarding)
- If rollback needed, remove redirects and restore old nav-config
- No database migrations required
- No API changes required

---

## Success Metrics

1. **Navigation time:** Average clicks to reach any module ≤ 2 (currently 1 but with excessive scanning)
2. **Cognitive load:** New user can guess where to find "send invoice" on first try
3. **Surface count:** Primary nav items reduced from 4 surfaces × 36 items to 3 surfaces × 19 items
4. **Settings discovery:** Time to find any setting ≤ 30 seconds
5. **Dormant noise:** 0 dormant modules visible in primary navigation

---

## Visual Summary

### Before (Current)
```
Rail: [Home] [Cockpit] [Workspaces ▼] [Studio ▼] [Public ▼] [Admin] [Store] [Theme]

Workspaces Drawer (28 items):
  Revenue, Finance, Accounting, Contacts, Bookings, Calendar,
  Flows, Time Tracking, Projects, Retainers, Portal, Change Orders,
  AI Plans, Workflows, Inbox, Content, Approvals, Assets, Evidence,
  Call Tasks, Helpdesk, Structure, Operations, Procurement,
  Reports, Goals, Sales Team, WhatsApp

Studio Drawer (6 items):
  Storefront, Connect, Blueprint, SEO, Templates, Settings

Public Drawer (2 items):
  Intake Forms, Business Profile

Coming Soon (8 items):
  Documents, Time Tracking, Payments, Email, Community, Learn, Marketplace, Supplier
```

### After (Proposed)
```
Rail: [🏠 Cockpit] [⚡ Operate ▼] [🔧 Build ▼] [👤 Me]

Operate Drawer (6 sections, 29 items):
  💰 Money → Overview, Revenue, Expenses, Accounting, Cash Flow
  👥 People → Directory, Pipeline, Sequences, Intelligence, Service
  ⚙️ Work → Projects, Time, Agreements, Tasks
  📅 Schedule → Calendar, Bookings, Calls
  💬 Communicate → Inbox, Campaigns, Content, Social
  📊 Intelligence → Reports, Goals, Operations, Compliance

Build Drawer (4 sections, 19 items):
  🏢 Business → Blueprint, Storefront, Presence, Templates
  ⚙️ System → Account, Workspace, Connections, AI, Compliance, Developers
  🔌 Connect → Overview, Google, Microsoft, Payments, Accounting, Marketing, Social, Forms, WhatsApp
  🤖 Automate → Flows, Workflows
  🔮 More ▼ → Documents, Community, Learn, Marketplace, Supplier

Me Drawer (4 items):
  👤 Profile, 🔔 Notifications, ⚙️ Preferences, 🚪 Logout
```

---

*Plan authored: 2026-05-25*
*Target implementation: Incremental, Phase 0-3 first (navigation structure), Phase 4-9 follow*
