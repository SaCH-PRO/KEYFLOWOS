# KEYFLOWOS — Module Map, Current IA Review & Recommendations

**Date:** 2026-07-23 · **Scope:** web app (`apps/web`) navigation, typography, and information architecture
**Sources:** repo route + nav audit, plus current SaaS UX guidance (linked inline below).

---

## 1. What changed today

- **Typography:** replaced `Fredoka` (display) and `Nunito` (body) with the **Geist** family (`Geist` for UI + display, `Geist Mono` for code) via `next/font/google` in `apps/web/src/app/layout.tsx`, wired through `--font-geist` / `--font-geist-mono` into `tailwind.config.js` and `globals.css`. Geist is Vercel's purpose-built product font and tops 2025–2026 SaaS font shortlists alongside Inter, Plus Jakarta Sans, Manrope and Satoshi ([Lapaone — Best Fonts for SaaS](https://www.lapaone.com/best-fonts-for-saas-products/), [Stylokit — Top 20 Fonts 2026](https://stylokit.com/blog/top-20-fonts-for-modern-web-design-2025), [Shakuro — Best Fonts for Web Design](https://shakuro.com/blog/best-fonts-for-web-design)). Fredoka/Nunito are rounded, consumer-playful faces — the main reason the UI read as less premium.
- **Production serving:** web now runs `next build && next start` (instant page loads) instead of webpack dev cold-compiles (~27s per first-visited route).

---

## 2. Current navigation structure (as-is)

**Primary rail:** `Cockpit` (/app/command-center) · `KEY` (/app/key/chat) · `Operate` (drawer) · `Build` (drawer) · `Me` (drawer)

### Operate drawer (10 sections, 47 links)

| Section | Links (route) |
|---|---|
| Operating System | Command Center, KEY Worker (/app/key), KEY Chat, KEY Autonomy, KEY Modes, Data Inbox, Capture |
| Financial Flow | Financial Flow, Revenue (/app/commerce), Payment Gateway, Expenses, Budgeting, Reports (/app/finance) |
| Temporal Flow | Temporal Flow, Calendar, Bookings, Projects, Tasks (/app/approvals) |
| People Flow | People Flow, Contacts, Sequences, Intelligence, Service (/app/helpdesk), Payroll, Performance |
| Sales | Commerce (/app/commerce), Events & Ticketing, Deals (/app/crm/contacts) |
| Marketing | Campaigns, Content, Social |
| Operations | Projects, Tasks (duplicates of Temporal Flow) |
| Governance | Approvals, Compliance (/app/evidence), Contracts, Legal |
| Intelligence | Executive Intelligence, Growth, Storefront, Documents |
| Strategy | Market Strategy, Goals, Business Genome (/app/profile?tab=business-genome) |

### Build drawer (4 sections, 16 links)
Business (Genome, Storefront, Events, Presence, Templates) · System (Account, Workspace, Team, Structure, AI, Compliance, Developers) · Connect (Key Connect) · Automate (Flows, Workflows)

### Me drawer
Profile, Notifications

### "More" (dormant, hidden by default)
Community, Learn, Marketplace, Supplier

---

## 3. Full page inventory vs. nav coverage

~95 page routes exist. ✅ = in nav, 🔶 = in nav under a *different* label/route, ❌ = no nav entry.

### Core / KEY
| Route | Nav? | Notes |
|---|---|---|
| /app/command-center | ✅ Cockpit | Home dashboard |
| /app/key, /app/key/chat | ✅ | KEY Worker + chat |
| /app/key-autonomy, /app/key-modes | ✅ | |
| /app/key-connect | ✅ Build | |
| /app/key-inbox | ❌ | KEY triage inbox — Data Inbox points to /app/data-inbox instead |
| /app/key-flows | ❌ | |
| /app/keyflow-command | ❌ | |
| /app/data-inbox, /app/capture | ✅ | |
| /app/briefing | ❌ | Morning briefing — strong daily-use page |
| /app/notifications | ✅ Me | |

### Money
| Route | Nav? | Notes |
|---|---|---|
| /app/financial-flow | ✅ | Hub page |
| /app/commerce | ✅×2 | "Revenue" and "Commerce" both link here (duplicate) |
| /app/commerce/gateway | ✅ | |
| /app/expenses, /app/budgeting | ✅ | |
| /app/finance | ✅ "Reports" | Middleware also 308s /app/finance → /app/money |
| /app/money | ❌ | New hub the middleware prefers — nav disagrees |
| /app/accounting | ❌ | 308 → /app/money/books |
| /app/payments | ❌ | |
| /app/payroll | ✅ | New P10 page |
| /app/retainers | ❌ | |

### People / CRM / Support
| Route | Nav? | Notes |
|---|---|---|
| /app/crm/contacts | ✅ | Also "Deals" label points here (wrong — deals≠contacts) |
| /app/crm/sequences, /app/crm/intelligence | ✅ | |
| /app/people-flow | ✅ | Hub |
| /app/helpdesk | ✅ "Service" | |
| /app/performance | ✅ | New P10 page |
| /app/sales-team | ❌ | |
| /app/whatsapp | ❌ | Channel inbox |

### Time / Work
| Route | Nav? | Notes |
|---|---|---|
| /app/temporal-flow | ✅ | Hub |
| /app/calendar, /app/bookings | ✅ | |
| /app/schedule/calendar | ❌ | Duplicate calendar route |
| /app/projects | ✅×2 | Middleware 308s /app/projects → /app/work/projects |
| /app/work/projects | ❌ | The redirect target — nav should point here directly |
| /app/approvals | ✅ "Tasks" | Label/page mismatch: approvals page labeled Tasks |
| /app/call-tasks | ❌ | |
| /app/time-tracking | ❌ | |
| /app/change-orders | ❌ | |

### Marketing / Presence
| Route | Nav? | Notes |
|---|---|---|
| /app/marketing | ✅ "Campaigns" | |
| /app/marketing-flow | ❌ | Hub page not linked |
| /app/content-ops | ✅ "Content" | |
| /app/social | ✅ | |
| /app/seo | ❌ | fetch_seo_* tools reference /app/marketing/seo (doesn't exist; real page is /app/seo) |
| /app/presence (+orders/pages) | ✅ Build | |
| /app/store | ❌ | Storefront manager |
| /app/storefront-intelligence | ✅ | |
| /app/events | ✅×2 | |

### Governance / Docs
| Route | Nav? | Notes |
|---|---|---|
| /app/approvals | ✅ | |
| /app/evidence | ✅ "Compliance" | |
| /app/contracts | ✅ | CUAD clause analysis lives here (P9) |
| /app/legal | ✅ | |
| /app/documents | ❌ | |
| /app/document-intelligence | ✅ "Documents" | Two different "documents" concepts |
| /app/assets | ❌ | |
| /app/trash | ❌ | |

### Intelligence / Strategy
| Route | Nav? | Notes |
|---|---|---|
| /app/intelligence | ✅ | |
| /app/growth, /app/market, /app/goals | ✅ | |
| /app/genome, /app/blueprint | ❌ | Genome lives under /app/profile?tab=… |
| /app/reports | ❌ | |
| /app/control-tower | ❌ | |
| /app/operations, /app/operations-flow | ❌ | |
| /app/governance-flow | ❌ | |

### System / other
| Route | Nav? | Notes |
|---|---|---|
| /app/settings (+18 subpages) | ✅ Build | Middleware 308s /app/settings → /app/build/system/workspace — but /app/build/system/* pages don't all exist yet |
| /app/structure | ✅ Build | Org/roles — feeds payroll & performance |
| /app/flows, /app/workflows | ✅ Build | |
| /app/automations | ❌ | |
| /app/templates | ✅ Build | |
| /app/plans, /app/portal, /app/procurement, /app/community, /app/learn, /app/marketplace | ❌/dormant | Mostly placeholder surfaces |

---

## 4. Findings (what's wrong)

1. **Duplicates & label/page mismatches.** "Revenue" and "Commerce" both open /app/commerce; "Deals" opens the contacts list; "Tasks" opens the approvals page; Projects/Tasks appear in two sections.
2. **Nav/middleware drift.** Middleware 308s `/app/projects → /app/work/projects`, `/app/finance → /app/money`, `/app/settings → /app/build/system/workspace`, but the nav still points at the old routes — every click pays a redirect, and some targets are thinner than their sources.
3. **~40 orphan routes.** Real, working pages (briefing, money, store, seo, whatsapp, time-tracking, documents, automations…) are unreachable except by URL or chat.
4. **Frequency blindness.** Daily-use surfaces (briefing, inbox, calendar, tasks) sit at the same depth as once-a-quarter surfaces (legal, templates, dormant marketplace). Research is unambiguous: *"Place frequently used or critical features in prominent positions; use progressive disclosure for the rest"* ([Lollypop — SaaS Navigation Menu Design](https://lollypop.design/blog/2025/december/saas-navigation-menu-design/)).
5. **Hub pages without links.** marketing-flow, operations-flow, governance-flow exist as designed hubs but aren't in the nav.
6. **Search-centric navigation is missing.** No command palette; for a product this size, research recommends search-as-navigation (Microsoft Teams pattern, same source).

---

## 5. Recommendations

### 5.1 Typography (done)
Geist for UI + display, Geist Mono for code. Guidance going forward: display at −0.02em tracking, body 400/500, numbers in tabular figures (`font-feature-settings: "tnum"`) for KPI/finance tables.

### 5.2 IA regroup — by utility & frequency (recommended restructure)

Keep the 5-item primary rail but re-sort drawers by **how often each surface is used**:

```
Cockpit (command-center)          — unchanged
KEY (chat)                        — unchanged
TODAY                             — Briefing, Data Inbox, Calendar, Tasks(→call-tasks/approvals),
                                      Bookings, Notifications
MONEY                             — Financial Flow, Commerce, Payment Gateway, Invoices(/money),
                                      Expenses, Budgeting, Payroll, Reports
CUSTOMERS                         — Contacts, Deals (real deals page when it exists), Sequences,
                                      Helpdesk, Performance, WhatsApp
GROWTH                            — Campaigns, Content, Social, SEO, Storefront, Presence, Events
OPERATIONS                        — Projects(→/app/work/projects), Documents, Contracts, Approvals,
                                      Evidence, Procurement, Time Tracking
INTELLIGENCE                      — Executive Intelligence, Growth, Market, Goals, Business Genome
SYSTEM (Build)                    — Workspace, Team, Structure, AI, Key Connect, Flows, Workflows,
                                      Developers, Templates, Trash
```

Rules applied: object-oriented grouping (contacts/deals/tickets as objects — [Lollypop](https://lollypop.design/blog/2025/december/saas-navigation-menu-design/) pattern 1), progressive disclosure (dormant stays collapsed), no label/page mismatches, nav and middleware point at the same canonical routes.

### 5.3 Quick wins (cheap, high value)
1. Fix the three wrong links: Deals→contacts, Tasks→approvals labels, Projects→/app/work/projects.
2. Add **Briefing** to the primary rail area (it is the natural daily-start page next to Cockpit).
3. Align nav with middleware redirects (or drop the redirects).
4. Add a command-K palette over the route table — we already have all route metadata in `nav-config.ts`.
5. Point `fetch_seo_*` tools' `manualEquivalentRoute` at `/app/seo` (currently 404s).

### 5.4 What best-in-class does (comparison)
- **Linear:** 5-item sidebar, object-oriented (Issues/Projects/Views/Teams), command-K everywhere. Matches 5.2's shape.
- **Stripe:** top-level grouped by money objects (Payments/Balances/Customers/Products/More with progressive disclosure). Our MONEY + CUSTOMERS split mirrors this.
- **HubSpot:** horizontal nav with module dropdowns — shows our 10 Operate sections would be 6 at most ([UIUX Hero — SaaS Dashboard Best Practices](https://uiuxhero.com/blogs/saas-dashboard-design-best-practices-principles-examples-2025): lead with KPIs, keep hierarchy shallow).
- **Asana:** sidebar with Home/My Tasks/Inbox first — validates the TODAY group ([Lollypop](https://lollypop.design/blog/2025/december/saas-navigation-menu-design/), pattern 2).

---

## 6. Decision requested

1. **Nav regroup (5.2):** implement as proposed, or keep current sections with only the quick wins (5.3)?
2. **Command-K palette:** build now or defer?
