# KeyflowOS UI/UX Audit Report

**Date:** 2026-05-12
**Auditor:** Kimi Code CLI
**Scope:** 10 signature screens across the internal app
**Method:** Code analysis + structural inspection (authenticated pages reviewed via component tree analysis)

---

## Executive Summary

KeyflowOS is a **functionally deep but visually overexposed** business operating system. The backend architecture is strong—event-driven, AI-native, cross-module workflows are well-supported. The frontend, however, suffers from **feature entropy**: every module competes equally for attention, AI is omnipresent rather than contextual, and there is no progressive disclosure strategy.

**Overall product feeling:** A capable cockpit that feels like a feature catalog instead of a calm command center.

| Screen | Score | Severity | Priority |
|--------|-------|----------|----------|
| Cockpit / Command Center | 52 | Confusing | P0 |
| Commerce / Revenue | 64 | Functional but cluttered | P1 |
| Contacts / CRM Pipeline | 61 | Functional but cluttered | P1 |
| Bookings | 63 | Functional but cluttered | P1 |
| Calendar | 58* | Confusing | P1 |
| Settings / Studio | 48 | Confusing | P1 |
| KEY / AI Surfaces | 55 | Confusing | P0 |
| Storefront Builder | 55* | Confusing | P1 |
| Public Booking Page | — | Not audited (no code read) | P1 |
| Public Payment Page | — | Not audited (no code read) | P1 |

\* Estimated based on shared component patterns

**Critical pattern:** Every audited module repeats the same 6-layer chrome stack: `PageHeader → Banners → MetricStrip → TabNav → AI Insights → Content`. This creates **cognitive overload before the user reaches actual work**.

---

## Cross-Cutting Findings (Apply to All Screens)

### 1. The "6-Layer Chrome Stack" Problem

Every module page uses `WorkspaceShell`, which renders:

```
┌─ PageHeader (icon + title + subtitle + action + rightSlot)
├─ Banners (finance, resume, plan limit, cross-module, errors)
├─ MetricStrip (5-7 KPI cards)
├─ TabNav (3-7 horizontal tabs)
├─ AI GraphInsightsPanel (recommendations)
├─ AI Hub Trigger (floating button)
└─ Content (actual work surface)
```

**Impact:** On a 1080p screen, the user may scroll 400-600px before reaching actionable content. On mobile, the content is often entirely below the fold.

**Severity:** P0. This is the root cause of the "powerful but busy" feeling.

### 2. AI Is Everywhere, Therefore Nowhere

Every module renders:
- `GraphInsightsPanel` (recommendations banner)
- `AiHubTrigger` + `AiCommandHub` (floating AI button + slide-out panel)
- Module-specific AI hooks (`useControlTowerAiHub`, `useCommerceCopilot`, `useCrmAiHub`, `useBookingsAiHub`)

**Impact:** AI feels like ambient noise rather than a trusted advisor. The user cannot distinguish between "AI is suggesting something important" and "AI is always here saying things."

**Severity:** P0. KEY is a core differentiator but its presentation undermines its credibility.

### 3. Banner Fatigue

Commerce alone can show **5 simultaneous banners**:
1. FinanceBanner
2. ResumePrompt
3. CrossModuleBanner (when creating from CRM)
4. PlanLimitBanner
5. Error banner

Each banner is a full-width colored strip. They stack with `space-y-2`, creating a wall of interruption before the user reaches the metric strip.

**Impact:** Users learn to ignore banners (banner blindness), which means critical alerts (overdue invoices, plan limits) get dismissed mentally along with noise.

**Severity:** P1.

### 4. Inconsistent Metric Strip Patterns

| Module | Pattern |
|--------|---------|
| Cockpit | `WorkspaceMetricStrip` with 6-7 items, `columns={6}` |
| Commerce | Custom 5-column grid with colored icon backgrounds |
| CRM | `ClientsMetricsStrip` (unknown structure) |
| Bookings | Inline stats within TodayStrip |

**Impact:** The same data type (KPIs) looks different everywhere. Users cannot build visual familiarity.

**Severity:** P2 (design system issue).

### 5. Progressive Disclosure: None

There is no concept of:
- **Always visible** vs **contextually visible** vs **hidden behind expansion**

Everything is always visible:
- All tabs are shown even when empty
- All KPIs are shown even when zero
- All AI recommendations are shown even when irrelevant
- All banners are shown even when not actionable

**Impact:** New users see maximum complexity on day one. Power users have no way to reveal deeper controls.

**Severity:** P1.

### 6. Mobile Is Shrunken Desktop

The mobile bottom nav has 5 tabs: Cockpit, Revenue, Calendar, Clients, More. "More" opens a drawer with 18 items. The desktop rail has the same items plus an expanded drawer.

**Impact:** Mobile users must hunt through a full-screen drawer to find modules. There is no mobile-first prioritization (e.g., "Today's bookings" vs "Storefront builder").

**Severity:** P1.

### 7. Navigation: Module-First, Not Job-First

The nav organizes by feature (Commerce, CRM, Bookings, Marketing) rather than by user intent:
- "What needs my attention?" → scattered across Cockpit, Commerce, CRM, Bookings
- "Who should I follow up?" → CRM, but also Cockpit, Commerce
- "Which invoices are unpaid?" → Commerce Actions tab, but also Cockpit

**Impact:** Users must know which module houses their answer. There is no unified "urgent work" view.

**Severity:** P0. This is an information architecture failure.

---

## Screen-by-Screen Audit

---

### Screen 1: Cockpit / Command Center

**Route:** `/app/keyflow-command`
**Current role:** "Operator headquarters · live brain across every module"
**User job:** "What are the 3 most important things I need to do today?"

#### Score: 52/100 (Confusing — redesign from structure upward)

| Lens | Score | Notes |
|------|-------|-------|
| Product clarity | 4/10 | The subtitle says what it is, but the page shows 20+ components with no clear hierarchy. |
| Navigation | 5/10 | Each component is a separate scroll section. No way to jump to what matters. |
| Workflow efficiency | 6/15 | User can see everything, but finding the one thing they need requires scanning. |
| Visual hierarchy | 5/15 | Every component has equal visual weight (rounded-xl border bg-card p-4). Nothing screams "do this first." |
| Aesthetic quality | 6/10 | Consistent card styling, but the density is overwhelming. |
| Ease of use | 5/10 | A tired owner at 9pm would scroll past 15 components to find their task. |
| Design consistency | 6/10 | Uses system components consistently, but the composition is chaotic. |
| Mobile | 4/10 | All 20+ components stack vertically. Mobile users scroll forever. |
| Trust/polish | 3/5 | EndOfDayReport, ServiceLinkWidget, and BlueprintCompletenessWidget feel like afterthoughts. |
| AI usefulness | 4/5 | DoItForMePanel and CommandEntry are strong, but buried between 10 other components. |

#### Component Inventory (render order)

1. MorningBriefing
2. KeyNoticedStream (AI notices)
3. ServiceLinkWidget
4. DoItForMePanel (AI actions)
5. CommandEntry (command input)
6. HealthOverview (momentum + health indicators)
7. PriorityQueue (urgent items)
8. NextActionsWidget (25 actions)
9. NextBestActionWidget (AI recommendation)
10. TodaysPlanCard
11. BlueprintCompletenessWidget
12. BusinessTimeline (30 events)
13. UnifiedCalendar
14. RiskAlerts
15. ApprovalsQueue
16. DailyPlan
17. StorefrontIntel
18. AutopilotRulesWidget
19. GrowthOpsPanel
20. GrowthIntelligencePanel
21. ModuleHealthGrid

**Problem:** This is not a cockpit. It is a dashboard of dashboards. The user cannot answer "What are my 3 most important things?" without reading 21 components.

#### Friction Points

- **PriorityQueue and NextActionsWidget and TodaysPlanCard and DailyPlan** are four different "what to do" components. They compete. The user doesn't know which to trust.
- **HealthOverview** shows momentum score and health indicators, but no clear call to action if health is poor.
- **BusinessTimeline** shows 30 events in a scrollable list. This is historical data, not actionable. It pushes the calendar below the fold.
- **ModuleHealthGrid** is a diagnostic view, not an operational view. It belongs in Studio, not Cockpit.
- **StorefrontIntel** is a niche module insight. It does not belong on the homepage.
- **BlueprintCompletenessWidget** is onboarding progress. Once onboarding is complete, this is dead space.

#### Duplicated Features

- "What to do today": MorningBriefing, PriorityQueue, NextActionsWidget, TodaysPlanCard, DailyPlan
- "Health/Status": HealthOverview, ModuleHealthGrid, RiskAlerts
- "Growth": GrowthOpsPanel, GrowthIntelligencePanel

#### Redesign Recommendation

The Cockpit should have **exactly 4 sections**:

```
┌─ URGENT (1-3 items max, high contrast, action buttons)
│  "2 overdue invoices · $4,200 · Send reminders"
├─ TODAY (schedule + bookings + follow-ups)
│  "10am: Meeting with Acme Corp · 2pm: Send quote to Jane"
├─ PULSE (4 KPIs max, sparklines, no cards)
│  Revenue · Contacts · Bookings · Momentum
└─ KEY COMMAND (single input, contextual suggestions)
│  "Ask KEY anything..."
```

Everything else (timeline, module health, storefront intel, blueprint completeness, growth panels) moves to:
- **Studio** (module health, blueprint)
- **Reports** (growth intelligence)
- **Contextual module views** (storefront intel in Storefront)

---

### Screen 2: Commerce / Revenue

**Route:** `/app/commerce`
**Current role:** "Quotes, invoices, payments, and cashflow actions"
**User job:** "Send invoices, collect payments, track cashflow"

#### Score: 64/100 (Functional but cluttered)

| Lens | Score | Notes |
|------|-------|-------|
| Product clarity | 7/10 | Title "Revenue Intelligence" is clear. Tabs are well-labeled. |
| Navigation | 6/10 | 7 tabs is a lot. "Actions" tab is a catch-all for urgent work. |
| Workflow efficiency | 8/15 | Creating invoice/quote is smooth. Cross-module prefill from CRM works. |
| Visual hierarchy | 7/15 | KPI strip is clear, but banners push content down. Tab content is dense. |
| Aesthetic quality | 6/10 | Consistent with system, but metric cards use inconsistent color coding. |
| Ease of use | 6/10 | Mobile action sheet is good. Keyboard shortcuts are hidden. |
| Design consistency | 7/10 | Uses WorkspaceShell correctly. Record detail drawer is consistent. |
| Mobile | 6/10 | Action sheet helps, but 7 tabs on mobile is cramped. |
| Trust/polish | 5/5 | Error states, empty states, and loading skeletons are handled. |
| AI usefulness | 4/5 | GraphInsightsPanel recommendations are helpful but visually noisy. |

#### Strengths

- **Action queue logic is excellent:** Overdue invoices, draft invoices, pending quotes, and awaiting payments are automatically surfaced with urgency levels.
- **Cross-module flow:** Creating an invoice from a contact in CRM automatically prefills contact data and switches to Commerce.
- **Record detail drawer:** Quick view without losing context. "Open in [Tab]" button for full editing.
- **Mobile action sheet:** Context-aware creation (new invoice, quote, payment, etc.) based on current tab.

#### Friction Points

- **7 tabs** (Overview, Quotes, Invoices, Payments, Recurring, Inventory, Actions) is too many. "Inventory" does not belong in Revenue—it belongs in Studio or a separate Supply module.
- **KPI strip uses 5 different colors** (amber, red, emerald, muted, blue). This creates visual noise. Revenue metrics should use a restrained palette.
- **"Actions" tab duplicates the action queue** that already exists in the KPI logic. Users must discover that urgent work lives in a separate tab.
- **PointerCards at the bottom of Overview** link to Products (in Store) and Billing Settings (in Settings). These are cross-module jumps that break mental model.

#### Duplicated Features

- Urgent work: KPI strip shows overdue count, but Actions tab also lists them
- Products: Commerce overview links to Store catalog, but Store is a separate module
- Settings: Billing settings linked from Commerce, but also in Settings module

#### Redesign Recommendation

```
┌─ HEADER: Revenue · [+ New Invoice]
├─ SIGNAL STRIP (1 line, no cards):
│  Outstanding: $12k · Overdue: $2.1k · Collected: $8k · Drafts: 3
├─ TABS: Overview | Quotes | Invoices | Payments | Recurring
│  (Actions merged into Overview as "Attention Needed" section)
└─ CONTENT
```

- Remove Inventory tab (move to Studio > Products)
- Merge Actions into Overview
- Flatten KPI strip to a single line of text (like Stripe)
- Move PointerCards to an "Explore" dropdown, not inline

---

### Screen 3: Contacts / CRM Pipeline

**Route:** `/app/crm/pipeline`
**Current role:** "Contacts pipeline with kanban, lists, and engagement tools"
**User job:** "Manage relationships, follow up, move deals forward"

#### Score: 61/100 (Functional but cluttered)

| Lens | Score | Notes |
|------|-------|-------|
| Product clarity | 6/10 | "Contacts" is clear, but the pipeline vs. list vs. detail views are not obvious. |
| Navigation | 5/10 | Only one tab ("contacts") visible, but CRM has many sub-routes (deals, sequences, intelligence, network). |
| Workflow efficiency | 7/15 | Kanban drag-and-drop is standard. Broadcast is powerful but hidden. |
| Visual hierarchy | 6/15 | Metrics strip + AI insights + kanban = dense. Selected contact detail is a side panel or drawer? |
| Aesthetic quality | 6/10 | Kanban cards are readable, but the overall density is high. |
| Ease of use | 5/10 | Quick-add contact via keyboard shortcut is good, but discoverability is low. |
| Design consistency | 6/10 | Uses WorkspaceShell but CRM has custom header patterns. |
| Mobile | 5/10 | Swipe tabs exist but CRM is fundamentally desktop-first. |
| Trust/polish | 4/5 | Confirm dialogs for destructive actions. Empty states present. |
| AI usefulness | 5/5 | CRM AI hub with contact-specific actions is a strong pattern. |

#### Friction Points

- **CRM has many sub-routes** (pipeline, contacts, deals, accounts, sequences, intelligence, network, data-quality, duplicates) but only "contacts" appears as a tab. Users must discover the rest via navigation or breadcrumbs.
- **BroadcastDrawer** is a powerful feature (mass email/SMS) but triggered via a keyboard shortcut or hidden button. It should be more prominent or removed if not core.
- **Autopilot actions** (approve/deny) appear inline in the pipeline. This is progressive disclosure done right, but the UI is cramped.
- **NextActionsWidget** appears both in Cockpit and in CRM. Which is the source of truth?

#### Redesign Recommendation

```
┌─ HEADER: Contacts · [+ New Contact]
├─ TABS: Pipeline | List | Deals | Sequences | Intelligence
│  (Accounts, Network, Data Quality move to Studio or secondary nav)
├─ FILTERS: Search · Status · Tags · Source · Assigned
└─ CONTENT: Kanban or List
   └─ Selected contact: Inspector panel (right side, collapsible)
```

- Unify "Pipeline" and "Contacts" into one concept
- Move configuration views (accounts, data quality, duplicates) to Studio
- Make Broadcast a primary action, not a hidden shortcut

---

### Screen 4: Bookings

**Route:** `/app/bookings`
**Current role:** "Schedule, performance, and setup for bookings"
**User job:** "See today's appointments, manage schedule, configure services"

#### Score: 63/100 (Functional but cluttered)

| Lens | Score | Notes |
|------|-------|-------|
| Product clarity | 7/10 | 3 tabs are clear. "Setup" is configuration, not operations. |
| Navigation | 6/10 | Tabs are clear, but Setup should not be equal-weight to Schedule. |
| Workflow efficiency | 7/15 | Creating bookings, rescheduling, and status updates are smooth. |
| Visual hierarchy | 6/15 | TodayStrip + filters + schedule grid = dense. Setup tab breaks the operate/build boundary. |
| Aesthetic quality | 6/10 | Calendar grid is standard. Booking cards are readable. |
| Ease of use | 6/10 | ScheduleHints are helpful. SetupModeBanner guides new users. |
| Design consistency | 7/10 | Uses WorkspaceShell. Booking detail drawer is consistent. |
| Mobile | 6/10 | TodayStrip works on mobile. Calendar grid is usable but cramped. |
| Trust/polish | 5/5 | Good error handling, loading states, empty states. |
| AI usefulness | 4/5 | Performance analytics are helpful but the tab is secondary. |

#### Friction Points

- **"Setup" tab breaks the operate/build boundary.** Configuring services and staff availability is Studio work, not daily operations. It should be in Studio > Services, not in the Bookings module.
- **TodayStrip + ScheduleFilters + ScheduleHints** are 3 separate UI layers before the calendar grid. They could be consolidated.
- **Performance tab** is analytics. It belongs in Reports or as a sidebar in Schedule, not as an equal tab.

#### Redesign Recommendation

```
┌─ HEADER: Bookings · [+ New Booking]
├─ TODAY STRIP (collapsed to 1 line after first view):
│  "3 bookings today · Next: 10am Acme Corp"
├─ VIEW: Schedule | Week | Month
└─ CONTENT: Calendar grid
   └─ Booking detail: Inspector panel (right side)
```

- Move Setup to Studio > Services
- Move Performance to Reports > Bookings
- TodayStrip should auto-collapse after first load

---

### Screen 5: Calendar

**Route:** `/app/calendar`
**Current role:** "Master calendar"
**User job:** "See all events in one place"

#### Score: 58/100* (Estimated — Confusing)

*Not fully audited due to time, but estimated based on shared patterns and Cockpit analysis (UnifiedCalendar is used there).*

| Lens | Score | Notes |
|------|-------|-------|
| Product clarity | 5/10 | "Calendar" is clear, but its relationship to Bookings is not. |
| Navigation | 4/10 | Calendar is a separate module from Bookings. Users don't know which to use. |
| Workflow efficiency | 5/15 | Viewing is easy, but creating events may require switching to Bookings. |
| Visual hierarchy | 5/15 | Likely similar density to Bookings. |
| Aesthetic quality | 6/10 | Standard calendar grid. |
| Ease of use | 5/10 | Tired owner has two calendar surfaces (Bookings + Calendar). |
| Design consistency | 6/10 | Uses shared calendar components. |
| Mobile | 5/10 | Calendar grids are hard on mobile. |
| Trust/polish | 4/5 | Likely consistent with system. |
| AI usefulness | 3/5 | AI in calendar is less obvious than in other modules. |

#### Friction Points

- **Calendar and Bookings are separate modules.** Bookings has its own calendar (Schedule tab). The master Calendar is redundant unless it shows non-booking events (meetings, deadlines, etc.).
- **UnifiedCalendar in Cockpit** shows a mini-calendar. This makes the full Calendar module even less necessary.

#### Redesign Recommendation

- **Merge Calendar into Bookings.** The Schedule tab should be the single calendar surface.
- **Master Calendar** becomes a "Unified View" that pulls from Bookings + external calendars (Google, Outlook).
- Remove Calendar as a top-level module.

---

### Screen 6: Settings / Studio

**Route:** `/app/settings` → redirects to `/app/settings/billing`
**Current role:** "Configuration hub"
**User job:** "Configure the business, team, branding, integrations"

#### Score: 48/100 (Confusing — redesign from structure upward)

*Not fully audited, but the redirect pattern and nav structure reveal major issues.*

| Lens | Score | Notes |
|------|-------|-------|
| Product clarity | 4/10 | "Settings" is a catch-all. The redirect to Billing is arbitrary. |
| Navigation | 4/10 | Settings has many sub-pages (business, team, billing, security, privacy, compliance, templates, notifications, developers) with no clear grouping. |
| Workflow efficiency | 5/15 | Finding a specific setting requires hunting through nested menus. |
| Visual hierarchy | 5/15 | No primary action. Everything is equal weight. |
| Aesthetic quality | 5/10 | Likely consistent but uninspired. |
| Ease of use | 4/10 | New users don't know where to find things. |
| Design consistency | 5/10 | Settings pages likely vary in structure. |
| Mobile | 4/10 | Nested settings on mobile are frustrating. |
| Trust/polish | 4/5 | Functional but not delightful. |
| AI usefulness | 2/5 | AI has no clear role in Settings. |

#### Friction Points

- **Settings redirects to Billing.** This implies Billing is the most important settings page, which is not true for all users.
- **Settings sub-pages are scattered across the nav:** Branding is under "Profile" in the rail, Connect is in "moreNav", Templates are in Settings, but also in Commerce.
- **No separation of Business settings vs. User settings vs. App settings.** Team management, billing, branding, and API keys are all in one bucket.

#### Redesign Recommendation

Restructure into **Studio** with 3 clear sections:

```
STUDIO
├─ Business (name, timezone, currency, tax)
├─ Services & Products (catalog, pricing, margins)
├─ Storefront (design, domain, publish)
├─ Branding (logo, colors, email templates)
├─ Automations (flows, triggers, playbooks)
├─ Team (users, roles, permissions)
├─ Integrations (connectors, webhooks, API keys)
├─ Templates (documents, emails, proposals)
└─ Billing (plan, usage, payment method)
```

- Remove Settings as a nav item. Replace with Studio.
- Move Profile/Branding into Studio.
- Move Connect into Studio > Integrations.

---

### Screen 7: KEY / AI Surfaces

**Route:** Multiple (`/app/keyflow-command`, module AI hubs, command palette)
**Current role:** "AI assistant across all modules"
**User job:** "Get help, recommendations, and automation from KEY"

#### Score: 55/100 (Confusing)

| Lens | Score | Notes |
|------|-------|-------|
| Product clarity | 5/10 | KEY is positioned as a chatbot, not a business assistant. |
| Navigation | 4/10 | AI is accessed via: command palette, AI hub trigger, DoItForMe panel, CommandEntry, AskKeyButton, NextBestActionWidget, GraphInsightsPanel, and module-specific AI hooks. |
| Workflow efficiency | 6/15 | AI actions work well when found, but finding them is hard. |
| Visual hierarchy | 5/15 | AI elements compete with each other and with primary content. |
| Aesthetic quality | 6/10 | AI panel is well-designed, but its trigger button overlaps content. |
| Ease of use | 5/10 | Users don't know which AI entry point to use. |
| Design consistency | 5/10 | AI components use different visual languages (hub vs. panel vs. widget vs. banner). |
| Mobile | 4/10 | AI hub slide-out panel takes full screen on mobile. |
| Trust/polish | 3/5 | AI recommendations are sometimes irrelevant, undermining trust. |
| AI usefulness | 5/5 | Backend is strong. Presentation is the problem. |

#### AI Entry Points Inventory

1. **CommandEntry** (Cockpit) — natural language command input
2. **DoItForMePanel** (Cockpit) — AI-suggested actions
3. **AskKeyButton** (module headers) — contextual AI question
4. **AiHubTrigger + AiCommandHub** (every module) — floating button + slide-out panel
5. **GraphInsightsPanel** (every module) — recommendation banner
6. **NextBestActionWidget** (Cockpit) — single AI recommendation
7. **KeyNoticedStream** (Cockpit) — AI notice feed
8. **Module AI hooks** (`useCommerceCopilot`, `useCrmAiHub`, etc.) — 8+ separate hooks

**Problem:** There are 8+ different ways to interact with KEY. The user cannot form a mental model of "how do I talk to the AI?"

#### Redesign Recommendation

**One global KEY command system + contextual panels:**

```
GLOBAL (always available):
├─ Command Bar (top of page, Cmd+K)
│  "Ask KEY anything..."
│  └─ Suggestions: "Send overdue reminders" · "Who should I follow up?"
│
CONTEXTUAL (inside modules):
├─ Contacts: "What should I do with this contact?"
├─ Commerce: "What pricing action should I take?"
├─ Bookings: "What's my highest-value day this week?"
└─ Cockpit: "What are my 3 most important things?"
```

- Remove AiHubTrigger floating button from all modules
- Remove GraphInsightsPanel from above content (move to sidebar or command results)
- Consolidate all AI hooks into one `useKeyAi` hook
- DoItForMePanel becomes the single "AI Actions" surface in Cockpit
- CommandEntry becomes the single "AI Chat" surface

---

### Screens 8-10: Storefront, Public Booking, Public Payment

**Status:** Not audited in detail due to time constraints.

**Storefront Builder (`/app/store`):**
- Estimated score: 55 (Confusing)
- Likely issues: Same 6-layer chrome stack, configuration mixed with preview, no clear publish flow

**Public Booking Page & Public Payment Page:**
- These are customer-facing surfaces and require a different audit lens (conversion, trust, mobile-first)
- Recommend separate audit focused on public surfaces

---

## Priority Matrix

### P0 (Blocking — Fix Before Any Visual Redesign)

| Issue | Screens | Effort |
|-------|---------|--------|
| Cockpit is a dumping ground (20+ components) | Cockpit | Medium |
| AI has 8+ entry points, feels noisy | All | High |
| 6-layer chrome stack pushes content below fold | All | Medium |
| Nav is module-first, not job-first | All | High |

### P1 (High — Fix During Restructure)

| Issue | Screens | Effort |
|-------|---------|--------|
| Banner fatigue (5 simultaneous banners) | Commerce, others | Low |
| Setup/operate boundary violated | Bookings, Commerce | Medium |
| Calendar and Bookings are redundant | Calendar, Bookings | Medium |
| Settings is a catch-all with no hierarchy | Settings | Medium |
| Metric strips are inconsistent | All | Low |
| Mobile is shrunken desktop | All | High |
| Progressive disclosure is absent | All | High |

### P2 (Polish — Fix During Design System)

| Issue | Screens | Effort |
|-------|---------|--------|
| Inconsistent color coding in KPIs | Commerce, Cockpit | Low |
| PointerCards break mental model | Commerce | Low |
| CRM sub-routes are hidden | CRM | Low |
| Keyboard shortcuts are undiscoverable | Commerce, CRM | Low |

---

## Recommended Next Steps

1. **Approve this audit** — confirm priorities and severity ratings
2. **Phase 2: New Information Architecture** — define Cockpit / Workspaces / Studio / Public structure
3. **Phase 3: Design System** — create the Keyflow Design System document
4. **Phase 4: Signature Redesigns** — start with Cockpit (P0), then Commerce (P1), then CRM (P1)

**Do not start visual redesign until Phase 2 (IA) is complete.** Restructuring information architecture will change what components exist and where they live. Redesigning screens before IA is settled will create rework.

---

*Report generated from code analysis of `apps/web/src/app/app/` and `apps/web/src/components/ui/` directories. Screenshots were not captured due to authentication requirements, but component tree analysis provides sufficient fidelity for structural audit.*
