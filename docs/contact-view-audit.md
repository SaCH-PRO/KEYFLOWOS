# Contact Detail View — Audit & Reduction Plan

_Task #412 — frontend-only refactor in `apps/web`_

## Goal

Reduce the contact detail view from 10+ collapsible cards to **4 dominant
top-level sections**, with every visible field or chip wired to a real
next action (or hidden behind a single "More details" expander).

Out of scope: backend / schema changes, list-table redesign, mobile-specific
redesign, Timeline / Notes / Tasks tabs, the legacy
`/app/crm/contacts/[contactId]` route.

## Source files inventoried

- `apps/web/src/components/contacts/contact-detail.tsx` (orchestrator)
- `apps/web/src/components/contacts/contact-detail-header.tsx`
- `apps/web/src/components/contacts/contact-detail-stats.tsx`
- `apps/web/src/components/contacts/contact-detail-info.tsx`
- `apps/web/src/components/contacts/next-best-action-card.tsx`
- `apps/web/src/components/contacts/momentum-badge.tsx`

## Target structure (4 dominant sections)

1. **Momentum + Next Action** — Header (avatar, name, channel buttons,
   status pills, quick actions) + Momentum Primary CTA driven by the top
   recommendation + NextBestActionCard fallback.
2. **Financial** — Total Revenue, Invoices, Bookings, Outstanding —
   every number drills into a filtered list.
3. **Contact & Channels** — single card containing condensed identity
   line (job · company · city/Maps · timezone w/ local time · language ·
   preferred channel), inline compliance toggles (with confirm dialog),
   Lifecycle / Segment chips that filter the pipeline, social icon row,
   alt-email / alt-phone / WhatsApp action chips, internal notes,
   Referred-By + Next Scheduled Interaction action rows, "Open address
   in Maps", and a single **More details** expander for low-leverage
   fields.
4. **Recent Activity** — last 3 events with "View all" deep-link to the
   Timeline tab.

## Per-field verdict matrix

Three verdicts: **Keep & make actionable**, **Keep as compact display**,
**Remove / Hide behind More**.

### Header (already actionable, kept as-is)

| Field | Before | Verdict | After |
|---|---|---|---|
| Avatar / display name | display | Keep as compact display | unchanged |
| Email | mailto link | Keep & make actionable | unchanged |
| Phone | tel: link | Keep & make actionable | unchanged |
| WhatsApp (header) | wa.me link | Keep & make actionable | unchanged |
| Status pill (LEAD/PROSPECT/…) | clickable | Keep & make actionable | unchanged |
| Source / lifecycle pill | display | Keep as compact display | unchanged |
| Completion % | display | Keep as compact display | unchanged |
| Last active relative time | display | Keep as compact display | unchanged |
| Edit / Delete | actions | Keep & make actionable | unchanged |
| Email / Call / WhatsApp quick action buttons | actions | Keep & make actionable | unchanged |
| Invoice / Book / Quote quick actions | actions | Keep & make actionable | unchanged |

### Momentum / Next Action

| Field | Before | Verdict | After |
|---|---|---|---|
| AI Next Best Action | render of insight | Keep & make actionable | unchanged (NextBestActionCard) |
| Momentum top recommendation | hidden inside Momentum card | Keep & make actionable | promoted to **Momentum Primary CTA** with one-click "Create task" |

### Stats — Metrics card

| Field | Before | Verdict | After |
|---|---|---|---|
| Lead score | number | Keep as compact display | unchanged |
| Outstanding balance | display only | Keep & make actionable | clickable → `/app/commerce?tab=invoices&contactId=…&status=UNPAID` |
| Last activity | relative time | Keep as compact display | unchanged |
| Next task | relative time | Keep as compact display | unchanged |

### Stats — Financial Summary

| Field | Before | Verdict | After |
|---|---|---|---|
| Total Revenue | display | Keep & make actionable | clickable → `/app/commerce?tab=invoices&contactId=…&status=PAID` |
| Invoice count | display (only "Create first" link when 0) | Keep & make actionable | clickable → `/app/commerce?tab=invoices&contactId=…` |
| Booking count | display (only "Book one?" link when 0) | Keep & make actionable | clickable → `/app/bookings?contactId=…` |

### Info — Contact & Channels (consolidated card)

| Field | Before | Verdict | After |
|---|---|---|---|
| Company + Job Title | own "Professional" collapsible | Keep as compact display | merged into condensed identity line |
| City / Country | own "Address" collapsible | Keep & make actionable | identity line, link → Google Maps |
| Timezone | "Address" collapsible | Keep & make actionable | identity line + **current local time** rendered inline |
| Language | "Contact Methods" collapsible | Keep as compact display | identity line |
| Preferred channel | "Contact Methods" collapsible | Keep as compact display | identity line |
| Secondary email | "Contact Methods" collapsible | Keep & make actionable | "Alt email" chip → mailto |
| Secondary phone | "Contact Methods" collapsible | Keep & make actionable | "Alt phone" chip → tel |
| WhatsApp number | "Contact Methods" collapsible (display) | Keep & make actionable | WhatsApp chip → `wa.me` link |
| LinkedIn / Instagram / Twitter | full-row links in "Social & Referral" | Keep & make actionable | compact icon row |
| Referred By | "Social & Referral" text | Keep & make actionable | button → opens that contact (or pipeline search) |
| Next Scheduled Interaction | "Social & Referral" text | Keep & make actionable | row with **Add task** button (creates task at that due date) |
| Marketing Opt-In | display badge in "Preferences" | Keep & make actionable | inline toggle chip with **confirmation dialog** |
| Do Not Contact | display badge in "Preferences" | Keep & make actionable | inline toggle chip with **danger-style confirmation dialog** |
| Lifecycle stage | text in "Preferences" | Keep & make actionable | chip → `/app/crm/pipeline?lifecycle=…` |
| Segment | text in "Preferences" | Keep & make actionable | chip → `/app/crm/pipeline?segment=…` |
| Internal notes | full collapsible | Keep as compact display | inline highlighted block inside the card |
| Address line 1 / 2 / state / postal code | full "Address" collapsible | Remove / Hide behind More | rendered only inside **More details** expander |
| Department / Industry | full "Professional" collapsible | Remove / Hide behind More | rendered only inside **More details** expander |
| Custom fields (non-reserved) | own "Custom Fields" collapsible | Remove / Hide behind More | inside **More details** expander |
| Related contacts | own collapsible | Remove / Hide behind More | inside **More details** expander |
| Tags | always-visible chip row | Remove / Hide behind More | inside **More details** expander |
| Empty fields rendering `—` | always rendered | Remove / Hide behind More | hidden entirely when value is missing |

### Stats — Recent Activity

| Field | Before | Verdict | After |
|---|---|---|---|
| Last 3 events | display list | Keep & make actionable | unchanged + "View all" → Timeline tab |

## Implementation summary

- `contact-detail-info.tsx` — fully rewritten as a single "Contact &
  Channels" card. All low-leverage fields collapsed under one
  "More details" expander. Compliance toggles wrapped in a confirm
  dialog. WhatsApp chip uses `wa.me`. Timezone shows current local time.
- `contact-detail-stats.tsx` — Outstanding, Total Revenue, Invoice
  count, Booking count are all clickable. Added `MomentumPrimaryCTA`
  component that surfaces the top per-contact momentum recommendation
  with a one-click "Create task" action.
- `contact-detail.tsx` — renders `MomentumPrimaryCTA` immediately under
  the header, threads `onAddTask` into the info card.

## Non-goals

- No changes to the API, schema, or `MomentumScore` shape.
- No changes to the list table, mobile drawer, or Timeline / Notes /
  Tasks tabs.
- No changes to the legacy `/app/crm/contacts/[contactId]/page.tsx`
  route.
