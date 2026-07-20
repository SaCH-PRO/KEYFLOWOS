# KEY Capacity Map — Staff Replacement Readiness

**Purpose:** This is the working reference for the "replace workers with KEY" initiative. For each real staff job role a small service business would employ, it lists the concrete recurring tasks that role performs, and whether KEY (the AI agent) can currently execute that task autonomously, partially, or not at all — verified against the actual code, not aspirational docs.

This is a living document. When a gap below is closed, update its row rather than writing a new audit file — the repo already had a problem with one-off audit docs piling up and going stale (see `docs/archive/`); don't repeat that here.

**Legend**
- ✅ **COVERED** — a registered AI tool exists and executes this task end-to-end
- 🟡 **PARTIAL** — the backend logic already exists (service/endpoint), but no AI tool wraps it, or the tool exists but is missing a needed parameter/scope
- ❌ **MISSING** — no backend logic or AI tool exists for this at all

**Scope note on "role":** `RoleEngineService` currently models 7 department-level personas (`sales | finance | support | operations | marketing | general | operator`), not individual job positions. The tables below are organized by realistic job role anyway, so this document can double as the spec for the job-level role system once it's built.

---

## Cross-cutting structural finding

Before the per-department tables: **there is no `Employee`/`Staff` data model anywhere in the schema**, and `apps/web/src/app/app/people/page.tsx` literally re-exports the CRM page (`export { default } from "@/app/app/crm/page"`). The backend "people-flow" module (`people-overview.service.ts`, `relationship-health.service.ts`) operates on `Contact` records — customers/leads — not a business's own workforce.

This means HR/People-ops isn't a tooling gap like the others below; it's a **data-model gap**. KeyflowOS currently has no way to represent that a business has a bookkeeper, a receptionist, or any other employee, independent of KEY. Building HR-role coverage has to start with an `Employee`/`Staff` schema, not a tool wrapper.

---

## Summary scorecard

| Cluster | ✅ Covered | 🟡 Partial | ❌ Missing | Tasks surveyed |
|---|---|---|---|---|
| Sales & CRM | 6 | 1 | 1 | 8 |
| Marketing & Content | 5 | 2 | 1 | 8 |
| Bookings & Scheduling | 5 | 1 | 2 | 8 |
| Commerce & Store | 7 | 1 | 0 | 8 |
| Finance & Accounting | 6 | 4 | 1 | 11 |
| Operations & Projects | 4 | 4 | 0 | 8 |
| Procurement & Purchasing | 0 | 0 | 7 | 7 |
| Time & Resource Mgmt | 2 | 2 | 3 | 7 |
| Customer Support / Helpdesk | 4 | 3 | 0 | 7 |
| HR / People Ops | 0 | 0 | 5 | 5 |
| Legal & Compliance | 0 | 7 | 0 | 7 |
| Communications | 3 | 3 | 0 | 6 |
| Front Office / Reception | 4 | 3 | 0 | 7 |
| **Total** | **46** | **31** | **20** | **97** |

**Read:** ~47% of surveyed staff tasks are fully AI-executable today. ~32% have the hard part already built (backend service/endpoint exists) and just need a tool wrapper — this is the cheapest tier of work. ~21% require new backend logic or, in HR's case, a new data model, before any tool can exist.

---

## Sales & CRM (Sales Rep / Account Manager)

| Task | Status | Evidence |
|---|---|---|
| Look up/search a contact before a call | ✅ | `crm_search_contacts`, `crm_list_contacts` |
| Add a new lead to the CRM | ✅ | `crm_create_contact` |
| Follow up with leads stale >N days | ✅ | `create_followup_queue`, `draft_followup_message`, `delegation_lead_reactivation` |
| Log a call/meeting note on a contact | ✅ | `crm_add_note` |
| Move a deal to next pipeline stage / update deal value | ❌ | `crm-deals.service.ts` exists, no `crm_deal_*` tool anywhere |
| Segment/tag clients for targeted outreach | ✅ | `tag_contact`, `segment_contacts` |
| Merge duplicate contact records | 🟡 | `crm-duplicate-detection.service.ts`/`crm-duplicate.util.ts` exist, no tool exposes it |
| Delete a bad/spam contact | ✅ | `crm_delete_contact` (tier 3) |

## Marketing & Content (Marketing Manager, Social Media Manager, SEO Specialist)

| Task | Status | Evidence |
|---|---|---|
| Draft an email campaign | ✅ | `marketing_create_campaign`, `draft_campaign_bundle` |
| Send a campaign to the list | ✅ | `marketing_send_campaign` (tier 4) |
| Post a promotional update to social media | ✅ | `social_create_post` + `social_publish_post` |
| Review social post performance/engagement | 🟡 | `social-analytics.service.ts` exists, no metrics tool |
| Run/boost paid social ads | ❌ | no "ads"/"boost" tool anywhere |
| Check keyword rankings / SEO health | ✅ | `fetch_seo_dashboard`, `fetch_seo_keywords` |
| Fix a flagged SEO issue | 🟡 | `fetch_seo_issues` surfaces issues, nothing applies a fix |
| Generate a content brief | ✅ | `generate_content_brief` |

## Bookings & Scheduling (Front Desk, Staff Coordinator)

| Task | Status | Evidence |
|---|---|---|
| Book a new appointment | ✅ | `bookings_create_booking` |
| Reschedule an existing booking | ✅ | `bookings_reschedule_booking` |
| Cancel a booking | ✅ | `bookings_cancel_booking` (tier 3) |
| Handle a no-show (rebook/waive fee/notify) | 🟡 | `booking-no-show.listener.ts` only logs a passive risk event, nothing acts on it |
| Check for scheduling conflicts | ✅ | `calendar_check_conflicts` |
| Send appointment prep/follow-up reminders | ✅ | `delegation_booking_prep` |
| Reassign a booking to a different staff member | ❌ | `bookings_reschedule_booking` has no `staffId` param, no dedicated tool |
| Manage a waitlist for a full slot | ❌ | no "waitlist" concept anywhere |

## Commerce & Store (Store Manager, Billing/Invoicing Clerk)

| Task | Status | Evidence |
|---|---|---|
| Create/send an invoice | ✅ | `commerce_create_invoice`, `commerce_send_invoice` |
| Mark an invoice paid / reconcile payment | ✅ | `commerce_mark_invoice_paid` |
| Chase an overdue invoice | ✅ | `draft_payment_reminder` + `delegation_payment_recovery` |
| Issue a refund | 🟡 | only reachable via `approval_create_request(type='refund')`, no direct execution tool |
| Add/update a product listing | ✅ | `commerce_create_product`, `commerce_update_product` |
| Write storefront product copy | ✅ | `draft_storefront_copy` |
| Review recent orders / storefront readiness | ✅ | `store_list_recent_orders`, `fetch_storefront_quality` |
| Create a customer quote | ✅ | `commerce_create_quote` (no tool to convert accepted quote → invoice) |

## Finance & Accounting (Bookkeeper, AP/AR Clerk, Accountant)

| Task | Status | Evidence |
|---|---|---|
| Record a business expense | ✅ | `expenses_create` |
| List/review recent expenses | ✅ | `expenses_list` |
| Reconcile bank transactions | 🟡 | `bank-matching.service.ts`, `reconciliation.service.ts` fully built, no tool |
| Maintain chart of accounts | 🟡 | `finance-coa.service.ts` fully built, no tool |
| Pay/record a vendor bill | 🟡 | `bills.controller.ts` full lifecycle, no tool at all |
| Check AP aging / vendor balances | 🟡 | endpoints exist, no tool (AR side is covered, AP is not) |
| View receivables aging | ✅ | `finance_view_receivables` |
| Chase an overdue invoice/payable | ✅ | `listOverdueInvoices`, `createInvoiceReminderDraft`, `delegation_payment_recovery` |
| Get a customer's balance | ✅ | `finance_customer_balance` |
| Forecast cashflow / safe-to-spend | ✅ | `cashflowForecast`, `calculateSafeToSpend`, `generateMoneyMoves` |
| Post a journal entry | ❌ | `posting.service.ts`, `recurring-journal-entry.service.ts` exist, nothing wrapped |

## Operations & Project Management (Ops Manager, Project Coordinator)

| Task | Status | Evidence |
|---|---|---|
| List active projects / check health | ✅ | `projects_list` |
| List/create tasks | ✅ | `projects_list_tasks`, `projects_create_task` |
| Mark task complete / update title, due date, priority | ✅ | `projects_complete_task`, `projects_update_task` |
| **Reassign a task when someone's overloaded** | 🟡 | backend fully supports `assigneeId` reassignment with history; the AI tool schema doesn't expose that field |
| Delete a stale/duplicate task | ✅ | `projects_delete_task` |
| Check project budget vs. actuals | 🟡 | `getProjectBudget` + dedicated UI exist, no tool |
| Review project timeline/milestones | 🟡 | `getProjectTimeline`, `createMilestone`/`updateMilestone` exist, no tool |
| Generate/approve a project plan | 🟡 | `project-planner.service.ts` + approval endpoint exist, UI-only |

## Procurement & Purchasing (Procurement Clerk / Buyer)

| Task | Status | Evidence |
|---|---|---|
| Create a purchase/procurement request | ❌ | `procurement.service.ts: create()`, no tool |
| Submit request for approval | ❌ | `submitForReview()`, no tool |
| Select a vendor/supplier | ❌ | `selectVendor()`, no tool |
| Issue a purchase order | ❌ | `issuePO()`, no tool |
| Acknowledge vendor confirmation | ❌ | `acknowledgeVendor()`, no tool |
| Mark order fulfilled / invoiced | ❌ | `markFulfilled()`, `markInvoiced()`, no tool |
| Check procurement stats/spend | ❌ | `getStats()`, no tool |

Entire department: full backend (`procurement.controller.ts`, 11 endpoints), **zero** AI tool coverage. Cheapest full-department win available — the CRUD logic already exists, it just needs wrapping.

## Time & Resource Management (Scheduler / Resource Manager)

| Task | Status | Evidence |
|---|---|---|
| Start/stop a work timer | ✅ | `time_start_timer`, `time_stop_timer` |
| Log time after the fact | ✅ | `time_log_entry` |
| Edit or delete a logged time entry | 🟡 | `time-entry.service.ts` supports it, no tool |
| Mark time entries as billed | 🟡 | `markAsBilled()` exists, no tool |
| Check staff availability / set schedule | ❌ | endpoints exist (`bookings.controller.ts`), no tool touches staff availability |
| Reallocate/reassign staff for capacity balance | ❌ | no reallocation/capacity/workload logic found anywhere |
| Add/remove a staff member | ❌ | backend CRUD exists, no tool |

## Customer Support / Helpdesk (Support Agent)

| Task | Status | Evidence |
|---|---|---|
| List/triage open tickets | ✅ | `helpdesk_list_tickets` |
| Create a ticket for an inbound issue | ✅ | `helpdesk_create_ticket` |
| Change ticket status/priority/assignment | ✅ | `helpdesk_update_ticket` |
| Reply to customer on the ticket | 🟡 | no reply/comment method exists at all in `helpdesk.service.ts`; generic messaging tool isn't ticket-linked |
| Close/resolve a ticket | ✅ | via `helpdesk_update_ticket` |
| Delete a stale/spam ticket | 🟡 | `deleteTicket()` exists, no tool |
| See tickets from a specific channel (WhatsApp/email) | 🟡 | ticket `source` field exists, no cross-channel intake tool |

## HR / People Operations (no real staff-management function exists)

| Task | Status | Evidence |
|---|---|---|
| Onboard a new employee record | ❌ | no `Employee`/`Staff` model anywhere |
| View team roster / staff overview | ❌ | `people-overview.service.ts` returns contact/pipeline stats, not staff |
| Track employee performance | ❌ | `relationship-health.service.ts` operates on `contactId` (customers) |
| Segment staff by role/status | ❌ | segments contacts, not staff |
| Payroll / time-off / timesheet approval | ❌ | no payroll module exists |

**This whole department needs a data model before it needs tools.** See "Cross-cutting structural finding" above.

## Legal & Compliance (Legal/Compliance Officer)

| Task | Status | Evidence |
|---|---|---|
| Draft/review a service contract | 🟡 | `contracts.service.ts` full CRUD, no tool |
| Extract key terms from an uploaded contract | 🟡 | `extractTermsFromDocument()` (AI-backed) exists, not tool-wrapped |
| Get notified of renewal/expiry risk | 🟡 | `regenerateAlerts()`/`acknowledgeAlert()` exist server-side only |
| Look up an existing contract | 🟡 | generic `documents_list`/`documents_search` exist, not contract-specific |
| Generate a compliance checklist | 🟡 | `trinidad-compliance-rules.ts` exists as one-time onboarding logic only |
| Generate a business risk register | 🟡 | onboarding-only artifact (`business-genesis`), not chat-callable |
| Tag/organize contracts | 🟡 | `listTags`/`createTag`/`deleteTag` exist, no tool |

Every task here has *some* backend logic — this department is closer than HR, it just needs a `contract_*` tool family and a compliance-tool wrapper, no new data model required.

## Communications (phone/WhatsApp/email inbound-outbound)

| Task | Status | Evidence |
|---|---|---|
| See what inquiries are waiting across channels | ✅ | `listMessageIntake` |
| Respond to a WhatsApp/email inquiry | ✅ | `send_message_with_approval` (tier 3) |
| Draft a reply for approval before sending | 🟡 | `response-draft.service.ts` full backend, not tool-wrapped |
| Make/log an outbound confirmation call | ✅ | `call_create_task`, `call_generate_script`, `call_log_outcome` |
| Broadcast a message to a segment | 🟡 | `sendBroadcast()` exists, no tool (only single-contact messaging is covered) |
| Track/reply inside a conversation thread | 🟡 | `key-inbox` has full reply/escalate logic, not exposed as a chat-callable tool |

## Front Office / Reception (no dedicated page — inbound triage is the proxy)

| Task | Status | Evidence |
|---|---|---|
| Greet/log a new inbound inquiry | 🟡 | auto-ingest exists (`whatsapp.service.ts`, `inbound-communications.service.ts`), no manual-create tool |
| Route inquiry to the right person/queue | 🟡 | `escalate` action exists internally, not a callable tool |
| Confirm tomorrow's appointments by phone/text | ✅ | `call_create_task` + `call_generate_script` + `bookings_list_bookings` |
| Reschedule/cancel on customer request | ✅ | `bookings_reschedule_booking`, `bookings_cancel_booking` |
| Create a new booking for a walk-in/caller | ✅ | `bookings_create_booking` |
| Check calendar for conflicts before booking | ✅ | `calendar_check_conflicts` |
| Send booking/invoice reminder proactively | 🟡 | `sendBookingReminder`/`sendInvoiceReminder` exist, no direct tool (drafts-only tools exist instead) |

---

## What's categorically missing (not in any department table above)

- **Voice/telephony execution** — every "call" tool logs or schedules a task for a human to make the call; there's no outbound voice agent or IVR integration anywhere.
- **Physical-world action** — every tool is a CRUD operation against KeyflowOS's own database; nothing performs or triggers a real-world physical task.
- **A fallback executor for novel requests** — the tool catalog is closed (132 tools today). A request outside all of them (e.g. "negotiate this vendor contract") has no path to execution, autonomy-tier settings notwithstanding.
- **Job-level role personas** — see scope note above; the 7 department buckets can't scope KEY to one displaced position.

---

## Suggested build order

**Tier 1 — cheapest, wrap what already exists (no new backend logic):**
bank reconciliation, chart-of-accounts, AP/bills, journal entries, task reassignment (add `assigneeId` param to `projects_update_task`), project budget/timeline tools, contract CRUD + term-extraction, ticket reply, broadcast messaging, key-inbox thread reply/escalate, deal/pipeline-stage tools, duplicate-contact merge, social analytics, no-show handling, procurement's full 11-endpoint wrap.

**Tier 2 — needs some new logic:**
staff availability/capacity tool, refund execution tool, waitlist management, booking staff-reassignment, SEO auto-remediation, paid-social/ads integration.

**Tier 3 — greenfield, needed before tools can exist at all:**
`Employee`/`Staff` data model + real HR module, payroll module, voice/telephony integration, job-level role personas in `RoleEngineService`, a generic/novel-task executor.

*Last assembled: 2026-07-20, against commit `2840eb2`. Update in place as coverage changes — don't fork a new audit file.*
