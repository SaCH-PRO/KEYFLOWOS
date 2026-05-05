# KEYFLOWOS UI Surface Map

Canonical homes for each major UI component. Use this when adding new
features so you can find the right mount point and avoid orphaning new
work.

## Shell (apps/web/src/app/app/layout.tsx)
- **Header right cluster** — Search, +New, MissionsButton, Notifications, User menu.
- **Primary rail** — Cockpit/KEYFLOW logo, Store, Workspaces, Studio, Public.
- **Secondary panel `workspaces`** — Contacts, Inbox, Calendar, Bookings, Finance, Accounting, Revenue, Payments, WhatsApp, Content, Automations, Projects, Expenses, Reports, Documents, SEO.
- **Secondary panel `studio`** — Business, Services, Team, Branding, Connect, Templates, Emails.
- **Secondary panel `public`** — Site editor, Community, Learn, Marketplace.

## Routes & their canonical components

| Route | Page file | Notable mounted components |
|-------|-----------|----------------------------|
| `/app/keyflow-command` | `keyflow-command/page.tsx` | CommandEntry, HealthOverview, PriorityQueue, NextActionsWidget, **NextBestActionWidget**, TodaysPlanCard, UnifiedCalendar, RiskAlerts, ApprovalsQueue, DailyPlan, StorefrontIntel, GrowthOpsPanel, GrowthIntelligencePanel, ModuleHealthGrid |
| `/app/commerce` | `commerce/page.tsx` | CommerceOverviewTab (incl. **ChurnRiskPanel**), QuotesPanel, InvoicesPanel, PaymentsTab, RecurringPanel, RevenueActionsTab (incl. **CollectionsScoringPanel**, **PaymentPlanPanel**, **QuoteFollowUpPanel** drawers) |
| `/app/crm/contacts/[contactId]` | `crm/contacts/[contactId]/page.tsx` | **RelationshipHealthStrip** (top), Timeline, Notes, Tasks, Playbook |
| `/app/projects` | `projects/page.tsx` | ProjectBoard, ProjectListView, TemplateManager, **PlaybookPanel** (Playbooks tab) |
| `/app/bookings` | `bookings/page.tsx` | Schedule, Performance, Setup tabs |
| `/app/bookings/insights` | `bookings/insights/page.tsx` | **BookingsInsightsTab** standalone view |
| `/app/accounting` | `accounting/page.tsx` | Accounting workspace (linked from Workspaces nav) |
| `/app/whatsapp` | `whatsapp/page.tsx` | WhatsApp Business workspace (linked from Workspaces nav) |
| `/app/store` | `store/page.tsx` | Tabs incl. **MerchandisingMode** (already wired) |
| `/app/templates` | `templates/page.tsx` | Business Templates (industry-based pre-config). Distinct from `/app/settings/templates` (Template Gallery / Playbooks). |

## Component → canonical home

- `MissionsButton` — shell header right cluster (`apps/app/layout.tsx`), lazy-loaded, shown next to Notifications.
- `NextBestActionWidget` — KEYFLOW home (`/app/keyflow-command`) below NextActionsWidget.
- `RelationshipHealthStrip` — top of contact detail (`/app/crm/contacts/[id]`).
- `PaymentPlanPanel` — overlay drawer; primary entry: invoice row "AI Payment Plan" overflow menu item on `/app/commerce?tab=invoices` (overdue/partially-paid invoices). Also reachable from overdue-invoice action cards on `/app/commerce?tab=actions`. Lazy-loaded.
- `QuoteFollowUpPanel` — overlay drawer; primary entry: quote row "AI Follow-up" overflow menu item on `/app/commerce?tab=quotes`. Also reachable from stale-quote action cards on `/app/commerce?tab=actions`. Lazy-loaded.
- `ChurnRiskPanel` — bottom of `/app/commerce?tab=overview` (CommerceOverviewTab).
- `CollectionsScoringPanel` — bottom of `/app/commerce?tab=actions` (RevenueActionsTab).
- `PlaybookPanel` — Playbooks tab on `/app/projects`.
- `BookingsInsightsTab` — `/app/bookings/insights` standalone route.
- `MerchandisingMode` — Merch tab on `/app/store` (already wired).

## When adding a new component
1. Pick a canonical home from the table above (or create one and add it here).
2. If lazy-loadable and below-the-fold, use `next/dynamic` with `ssr: false`.
3. Update this file in the same change.
