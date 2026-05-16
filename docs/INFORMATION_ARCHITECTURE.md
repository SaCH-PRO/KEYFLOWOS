# KeyflowOS Information Architecture v2.0

**Principles:** Leverage money, time, and people. Profit and results driven. Networking and connectivity. Scalability and value.

**Date:** 2026-05-12

---

## The 4 Master Surfaces

KeyflowOS is organized around **how the user interacts** with the system, not what feature they use. This matches mental models:

| Surface | User Question | Mode |
|---------|--------------|------|
| **Cockpit** | "What's happening and what should I do?" | Monitor & Command |
| **Workspaces** | "Let me do my work." | Execute |
| **Studio** | "Let me set things up." | Build & Configure |
| **Public** | "What do my customers see?" | Customer-Facing |

---

## Surface 1: Cockpit

**Purpose:** Answer "What are the 3 most important things I need to do?" in under 3 seconds.

**Principle:** Profit & Results driven. Money first.

### Structure (4 sections only)

```
COCKPIT
├─ URGENT (1-3 items, high contrast, action buttons)
│  "2 overdue invoices · $4,200 · Send reminders"
│  "1 booking in 30 min · Acme Corp · View"
│  "3 contacts need follow-up · KEY recommends"
├─ TODAY (schedule + actions)
│  "10am: Meeting with Acme Corp"
│  "2pm: Send quote to Jane"
│  "4pm: Follow up with stale lead"
├─ PULSE (4 KPIs, sparklines, minimal)
│  Revenue · Contacts · Bookings · Momentum
└─ KEY COMMAND (single input, always visible)
   "Ask KEY anything..."
```

### What Moves OUT of Cockpit

| Component | Current Location | New Location |
|-----------|-----------------|--------------|
| BusinessTimeline | Cockpit | Workspaces > Contacts (activity feed) |
| ModuleHealthGrid | Cockpit | Studio > Diagnostics |
| StorefrontIntel | Cockpit | Workspaces > Storefront |
| BlueprintCompletenessWidget | Cockpit | Studio > Blueprint |
| GrowthOpsPanel | Cockpit | Reports > Growth |
| GrowthIntelligencePanel | Cockpit | Reports > Intelligence |
| AutopilotRulesWidget | Cockpit | Studio > Automations |
| RiskAlerts | Cockpit | Cockpit > Urgent (merged) |
| ApprovalsQueue | Cockpit | Cockpit > Urgent (merged) |
| HealthOverview | Cockpit | Cockpit > Pulse (merged) |
| DailyPlan | Cockpit | Cockpit > Today (merged) |
| TodaysPlanCard | Cockpit | Cockpit > Today (merged) |
| NextActionsWidget | Cockpit | Cockpit > Today (merged) |
| NextBestActionWidget | Cockpit | KEY Command results |
| KeyNoticedStream | Cockpit | KEY Command results |
| DoItForMePanel | Cockpit | KEY Command results |
| CommandEntry | Cockpit | KEY Command input |
| UnifiedCalendar | Cockpit | Workspaces > Calendar |

---

## Surface 2: Workspaces

**Purpose:** Daily execution. Where work happens.

**Principles:** Leverage money, time, and people.

### Organized by Leverage Principle

```
WORKSPACES
├─ MONEY (Revenue-generating)
│  ├─ Revenue (Commerce: invoices, quotes, payments)
│  ├─ Contacts (CRM: pipeline, deals, follow-ups)
│  └─ Bookings (schedule, appointments)
├─ TIME (Efficiency & automation)
│  ├─ Calendar (master schedule)
│  ├─ Flows (automations, playbooks)
│  └─ Projects (deliverables, milestones)
└─ PEOPLE (Relationships & communication)
   ├─ Inbox (messages, notifications)
   ├─ Content (marketing, campaigns, social)
   └─ Community (directory, network)
```

### Module Details

**Revenue** (was Commerce)
- Tabs: Overview | Quotes | Invoices | Payments | Recurring
- Removes: Inventory (→ Studio > Products), Actions tab (→ Cockpit Urgent)
- KPI strip: Single line (Stripe-style), not 5 cards

**Contacts** (was CRM)
- Tabs: Pipeline | List | Deals | Sequences | Intelligence
- Removes: Accounts, Data Quality, Duplicates (→ Studio)
- Merges: Pipeline and Contacts into one concept

**Bookings**
- Tabs: Schedule | Week | Month
- Removes: Performance (→ Reports), Setup (→ Studio > Services)
- Today strip: Auto-collapses after first view

**Calendar**
- Merges into Bookings as "Schedule" tab
- Master calendar view becomes "Week" and "Month" tabs
- External calendar sync stays

**Flows** (was Automations)
- Flow builder, triggers, playbooks, blueprints
- Renamed from "Automations" to "Flows" (shorter, more active)

**Projects**
- Keeps current structure
- Links to Contacts and Revenue

**Inbox**
- Unified messages, notifications, emails
- Was buried in "moreNav"

**Content** (was Marketing)
- Campaigns, social posts, email marketing
- Renamed from "Marketing" to "Content" (clearer user language)

**Community**
- Directory, feed, network
- Feature-flagged, stays dormant until enabled

---

## Surface 3: Studio

**Purpose:** Build and configure the business operating system.

**Principle:** Scalability and value.

```
STUDIO
├─ Business (name, timezone, currency, tax, address)
├─ Products (catalog, pricing, margins, inventory)
├─ Services (bookable services, staff, capacity)
├─ Storefront (design, domain, pages, publish)
├─ Branding (logo, colors, fonts, email templates)
├─ Flows (automation builder, triggers, playbooks)
├─ Team (users, roles, permissions, seats)
├─ Integrations (connectors, webhooks, API keys)
├─ Templates (documents, emails, proposals)
└─ Billing (plan, usage, payment method, invoices)
```

### What Moves IN to Studio

| Component | Current Location | New Location |
|-----------|-----------------|--------------|
| Products & Catalog | Commerce > Inventory tab | Studio > Products |
| Billing Settings | Commerce > PointerCard | Studio > Billing |
| Services & Setup | Bookings > Setup tab | Studio > Services |
| Performance Analytics | Bookings > Performance | Reports > Bookings |
| Accounts | CRM sub-route | Studio > Business |
| Data Quality | CRM sub-route | Studio > Contacts (or remove) |
| Duplicates | CRM sub-route | Studio > Contacts (or remove) |
| Blueprint | Cockpit | Studio > Blueprint |
| Module Health | Cockpit | Studio > Diagnostics |
| Connect | moreNav | Studio > Integrations |
| Branding/Profile | Profile + moreNav | Studio > Branding |
| Templates | Settings | Studio > Templates |
| Developers | moreNav | Studio > Integrations |

---

## Surface 4: Public

**Purpose:** Customer-facing surfaces. Conversion and trust.

```
PUBLIC
├─ Booking Page (public appointment scheduling)
├─ Payment Page (checkout, payment links)
├─ Intake Forms (lead capture, onboarding)
├─ Business Profile (public presence, directory)
└─ Share Links (invoices, quotes, documents)
```

### Notes

- Public surfaces are designed for **customers**, not the business owner
- They need a separate design system (cleaner, more conversion-oriented)
- Preview mode in Studio > Storefront shows what customers see

---

## Navigation Structure

### Desktop Rail (52px, always visible)

```
[🟠] Cockpit          (Zap icon)
[📊] Workspaces       (LayoutGrid icon)  → expands drawer
[🔧] Studio           (Wrench icon)      → expands drawer
[🌐] Public           (Globe icon)       → expands drawer
[✨] KEY              (Sparkles icon)    → global command
[🔔] Notifications    (Bell icon)
[👤] Profile          (User icon)
```

### Expanded Drawer (208px, grouped by surface)

**Workspaces drawer:**
```
MONEY
├─ Revenue
├─ Contacts
└─ Bookings

TIME
├─ Calendar
├─ Flows
└─ Projects

PEOPLE
├─ Inbox
├─ Content
└─ Community
```

**Studio drawer:**
```
CONFIGURE
├─ Business
├─ Products
├─ Services
├─ Storefront
├─ Branding
├─ Flows
├─ Team
├─ Integrations
├─ Templates
└─ Billing
```

**Public drawer:**
```
CUSTOMER SURFACES
├─ Booking Page
├─ Payment Page
├─ Intake Forms
├─ Business Profile
└─ Share Links
```

### Mobile Bottom Nav

```
[Cockpit] [Workspaces] [KEY] [Notifications] [Profile]
```

- Workspaces opens a sheet with MONEY / TIME / PEOPLE sections
- Studio and Public accessible via Profile menu or KEY command

---

## Route Changes

**No URL changes.** All existing `/app/*` routes remain valid. This is a **navigation reorganization only**.

| Old Nav Location | New Nav Location |
|-----------------|-----------------|
| Primary rail: Commerce | Workspaces > Revenue |
| Primary rail: Contacts | Workspaces > Contacts |
| Primary rail: Calendar | Workspaces > Calendar |
| Primary rail: Storefront | Workspaces > Storefront (or Studio) |
| Primary rail: Settings | Studio |
| moreNav: Inbox | Workspaces > Inbox |
| moreNav: Bookings | Workspaces > Bookings |
| moreNav: Finance | Workspaces > Revenue |
| moreNav: Accounting | Workspaces > Revenue |
| moreNav: Payments | Workspaces > Revenue |
| moreNav: WhatsApp | Workspaces > Inbox |
| moreNav: Automations | Workspaces > Flows |
| moreNav: Projects | Workspaces > Projects |
| moreNav: Expenses | Studio > Billing (or Reports) |
| moreNav: Reports | Reports (separate surface, TBD) |
| moreNav: Procurement | Studio > Products |
| moreNav: Inventory | Studio > Products |
| moreNav: Team | Studio > Team |
| moreNav: Connect | Studio > Integrations |
| moreNav: Branding | Studio > Branding |
| moreNav: Site editor | Studio > Storefront |
| moreNav: SEO | Studio > Storefront |
| moreNav: Developer | Studio > Integrations |

---

## Progressive Disclosure Strategy

### Always Visible
- Current state (KPIs, counts, status)
- Urgent work (overdue, at-risk, today)
- Primary action (+ New)
- Navigation

### Contextually Visible
- Related records (contact's invoices, booking's history)
- AI suggestions (when relevant, not always)
- Recent activity
- Secondary actions

### Hidden Behind Expansion
- Logs and history
- Metadata and IDs
- Advanced settings
- Developer features
- Rarely used controls
- Module diagnostics

---

## AI Strategy

### One Global KEY Command
- **Command Bar** at top of every page (or Cmd+K)
- Single input: "Ask KEY anything..."
- Context-aware suggestions based on current surface

### Contextual Panels (per module)
- Contacts: "What should I do with this contact?"
- Revenue: "What pricing action should I take?"
- Bookings: "What's my highest-value day?"
- Flows: "What should I automate?"

### Removed AI Entry Points
- ❌ AiHubTrigger floating button (all modules)
- ❌ GraphInsightsPanel above content (all modules)
- ❌ NextBestActionWidget inline (Cockpit)
- ❌ KeyNoticedStream inline (Cockpit)
- ❌ Separate module AI hooks (consolidate to one)

---

## Design Principle Check

| Principle | How IA Supports It |
|-----------|-------------------|
| **Leverage money** | Cockpit shows urgent revenue. Workspaces > MONEY is first group. Revenue is top module. |
| **Leverage time** | Flows (automation) is prominent. Cockpit shows today's schedule. Setup is separated from operate. |
| **Leverage people** | Contacts is top module. Inbox unifies communications. Team management in Studio. |
| **Profit & results** | Cockpit answers "what matters now." Urgent actions are primary. KPIs are minimal. |
| **Networking** | Contacts, Community, Content, Integrations all support connectivity. |
| **Scalability** | Studio separates configuration from operations. Public surfaces scale customer reach. |

---

*This document is the foundation for Phase 3 (Design System) and Phase 4 (Signature Redesigns).*
