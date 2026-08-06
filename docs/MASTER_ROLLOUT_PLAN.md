# KEYFLOWOS — master rollout plan

**Baseline, verified 2026-08-06:** 126 tools · 430 models · 217 screens ·
3,107 server tests + 110 web tests green · tsc clean · 126/126 tools resolve to
a real page with manual parity · 93 commits unpushed · **nothing has touched
production.**

Companion documents: `docs/business-organism-map.md` (organ checklist),
`docs/neuro-atlas-code-mapping.md` (CNS checklist),
`docs/PRODUCTION_STATE.md` (what is actually deployed).

> **This supersedes the 2026-08-05 draft, which was wrong in three places.**
> It said inventory had no screens (it has five, all writable), that the alerts
> were computed and discarded (they are on an HTTP route and rendered by a
> 2,032-line command centre), and that inventory therefore needed a UI build
> first. All three came from trusting an audit report instead of the code.
> Corrections are recorded rather than quietly overwritten.

---

## What this product actually is

Not underbuilt. **Unwired.**

The organs are largely grown — deal pipelines, reconciliation, a 507-line PO
state machine, a 792-line payments console, a 985-line SEO workspace, a
1,014-line team settings screen. Then never connected to anything: no nav entry,
a broken redirect, a filter that hid them, or no tool over them.

Two defect shapes account for nearly everything found in this audit, and both
are worth naming because they will recur:

**1. A string compared across two files.** Nav labels vs mode allowlists.
Compensation keys vs tool names. Redirect targets vs pages. A badge's route vs
the config's. Tool enums vs domain enums. Each drifted silently and deleted a
feature. None broke a test.

**2. Something claiming work it did not do.** Campaigns "sent" to nobody.
Invoices marked SENT with no email. Automations that fire and do nothing.
Posts POSTED with no connected account. Toggles that toast success and persist
nothing. Screens that fake a spinner over invented numbers.

The second is the product thesis inverted. Every instance now has a test whose
negative control names the casualties.

---

## Phase 0 — Trust and reach (DONE, 2026-08-04 → 08-06)

### Tools that lied
`commerce_send_invoice` marked SENT and emailed nobody — then, after the first
fix, discarded the send RESULT and did it again. `schedule_action` promised
future execution nothing performed (removed). `automations_create_playbook`
created playbooks with `actionData: []`, enabled. `social.publishPost` marked
POSTED with no account. `markCampaignSent` emitted `recipientCount: 0`.
Bulk invoice updates swallowed every failure.

### Tools that could never work
`commerce_mark_invoice_paid` and `commerce_update_invoice` failed 100% of calls
— `'key_ai'` resolves to no Membership. `calendar_create_event` failed 100% —
its enum had **zero** overlap with the domain enum.

### Structural
Efferent bridge made two-way. Saga compensation wired into the planner (the
only driver production uses). **Tenant isolation switched on** — a complete
Prisma extension over 47 models, applied since it was written, that had never
once fired.

### Reach
17 settings screens (5,438 lines) were 404 behind a prefix redirect. The default
nav mode showed **three** items. Three nav-linked screens fabricated metrics.
Inbox tools pointed at a different inbox over a different table. SEO and Calls
had 12 tools and no way in.

### Standing gates
`flow-tool-honesty` · `role-tool-reachability` · `tool-enum-validity` ·
`tool-honesty-sweep` · `cortex-tool-bridge` · `saga-compensation-wiring` ·
`check-tool-routes` (route exists **+ manual parity**, and self-tests that it
can still fail) · `disclosure-mode` · `middleware-redirect-targets` ·
`no-fabricated-screens`.

---

## Phase 1 — Consolidation (next, and it is mostly deletion)

217 screens for one product is a smell, and the audit found the reason: the same
capability built more than once.

**1.1 Decide the duplicate clusters.** Contact lists (`crm`, `crm/pipeline`,
`crm/dashboard`, `people`, `people-flow`, `network/contacts`). Money
(`money`, `accounting`, `finance*`, `revenue`, `payments`, `commerce/*`).
Inboxes (`inbox/unified` and `key-inbox` are two omnichannel inboxes over two
different tables). The `/app/build/*` tree versus its top-level twins. Pick one
survivor per cluster; delete or redirect the rest.

**1.2 Fix the nav labels that lie.** "Deals" points at `/app/crm/contacts`.
"Reports" points at `/app/finance`. "Storefront" pointed at `/app/commerce`.
`/app/commerce` appears three times, `/app/approvals` three times.

**1.3 Delete what nothing uses.** 21 redirect stubs, 15 `ModuleShell` pages
rendering "This module is being prepared", 9 one-line re-exports.

**Why first:** every organ added on top of an ambiguous IA doubles the ambiguity,
and deletion is the cheapest work in this plan.

---

## Phase 2 — The organs, in value order

Definition of done: **models + service + reachable manual UI + tools (read *and*
write) + compensation registered + the §27 reflex closes.**

### 2.1 Inventory & stock — a tool layer, not a UI build
Corrected from the previous draft. Everything exists for humans and KEY has
nothing.

| | |
|---|---|
| Models | `InventoryStock`, `Warehouse`, `StockMovement`, `StockCount`, `PurchaseOrder` (29 fields), `ProcurementRequest` |
| Services | 4 continental-ops services (28 methods), fulfillment-routing, catalog |
| Manual UI | stock-counts, goods-receipts (create/delete/**post**), delivery-notes (create/delete/**fulfil**/**cancel**), receipts, plus a 2,032-line inventory command centre |
| Tools | **0** |
| Nav | **absent** — the real gap for humans |

Work: tools + nav entries. Verbs: read level · below-reorder · adjust · write
off · transfer · receive · raise and advance a PO.

### 2.2 Contracts
Manual CRUD complete (895 lines, create/update/delete/parties + AI extraction),
13 service methods, 7 models, **zero tools**. Also: renewal alerts only
regenerate when a human edits — no cron.

### 2.3 Documents & Drive
`documents.service.ts` (1,011 lines) and `google-drive.service.ts` (1,417) are
complete and read-only to KEY. The substrate every other organ leans on.

### 2.4 Quote→cash completion
Highest revenue leverage per line, over an operational service. Send/chase/
convert a quote · part payment · refund · credit note · payment link.

### 2.5 Small completions — one sitting each
Bookings status (confirm/no-show/complete are all one hardcoded `'CANCELLED'`) ·
calendar edit (`patchEvent`/`cancelEvent` sit ready) · time-tracking reads ·
`people_unassign` · consent check before outbound · inbox reply threading.

### 2.6 Procurement + supplier
Shares models with inventory. **Repair first:** two GET routes are swallowed by
`:id` and 404, and approve/reject writes columns that do not exist on
`ProcurementRequest`.

### 2.7 Deep finance — last of the near set
Richest data layer, **and the manual UI is read-only for humans**. Building
tools first inverts the product rule. Manual write UI first, then tools.

**Deferred:** helpdesk threading (no message thread, no SLA — a product build) ·
retainers (the periods→hours→invoice loop exists in no service) · storefront
intelligence (fabricated end to end).

---

## Phase 3 — The learning organ

Framework §20, absent from all 430 models: assumption register · hypothesis
register · experiment registry · metric dictionary · data lineage · decision log
with dissent and review dates · review cadence · policy and pricing version
control.

Competitors ship assistants that do tasks. None ships a business that knows what
it believes, tests it, and records the answer. KEY already has memory
consolidation, salience, reflection and an evidence service with nothing to file
into.

---

## Phase 4 — Deployment

Unstarted, deliberately.

- Production has **29 tables** on a migration lineage from a branch that does
  not exist, frozen since 2025-11-30, with **19 real auth accounts that must not
  be touched**. It needs a rebuild, not a baseline-resolve.
- CI's deploy job is commented out and points at a disconnected Vercel.
- **The Supabase password shared earlier must be rotated.**
- Local: run `CLOSE_LOCAL_DRIFT.sql`; `docker compose up -d --force-recreate db`
  for pgvector.

**None of this work reaches a user until Phase 4 is done.**

---

## Open decisions for the owner

1. **Addon packs do not gate tools.** `/app/seo` and `/app/call-tasks` are
   behind `webPresencePack` and `salesPack`; their 12 tools are not gated at
   all. A business without the pack cannot open the screen while KEY works on
   it for them. Either packs gate tools, or these are not pack features.
2. **Two omnichannel inboxes** over two different tables. One should win.
3. **Disclosure modes** — startup now shows 7 Operate items. Is that the right
   floor for a solopreneur?

---

## How each change gets verified

A test, negative-controlled: revert the fix, confirm the test fails **by name**,
restore. Every defect in Phase 0 was found or confirmed that way, including two
where my own first fix was wrong and the negative control was what proved it.

And for anything sourced from an audit or agent: **verify against the code
before acting.** Five of five headline claims in the UI audit held up; three
claims I relayed from an earlier one did not.
