# KEYFLOWOS — master rollout plan

**Baseline, verified 2026-08-05:** 126 tools · 430 models · 335 spec files ·
3,080 tests green · tsc clean · 126/126 tools resolve to a real page ·
76 commits unpushed · **nothing has touched production.**

Companion documents:
- `docs/business-organism-map.md` — the organ checklist and definition of done
- `docs/neuro-atlas-code-mapping.md` — the CNS checklist
- `docs/PRODUCTION_STATE.md` — what is actually deployed

---

## Where this stands

The mind is built and audited. The nervous system senses, decides, acts and can
now undo. The first organ (people/HR) is in, the inbox is readable, and the
tools that lied have been found and fixed.

What remains is **reach** — organs over services that already exist — plus one
thing the framework revealed that does not exist at all (§20 learning
infrastructure), and one hard prerequisite the product thesis demands (manual
parity).

Three phases. Each is independently shippable and none depends on the next.

---

## Phase 0 — Trust (DONE)

Completed 2026-08-04/05. Recorded because everything after it stands on it.

| Fix | Was |
|---|---|
| Identity | `'key_ai'` at 25 sites, no `User`/`Membership`. `commerce_mark_invoice_paid` failed 100% of calls. |
| Calendar enum | Tool offered 5 values, **none** valid. Failed 100% of calls. |
| Invoice send | Marked SENT, logged "sent to Ada", emailed nobody. |
| Scheduled actions | Promised future execution; nothing read the row. **Removed.** |
| Automations | `actionData: []` hardcoded, enabled — fired forever, did nothing. |
| Social publish | Marked POSTED with no connected account. |
| Campaign send | `recipientCount: 0`, emailed nobody. |
| Saga rollback | No compensation ever recorded; table keyed on names that did not exist. |
| Efferent bridge | Cortex organ tools invisible to the chat model. |
| Tenant leaks | 3 (recommender, assignee tasks, org-assignment privilege escalation). |

**Standing gates** — these now fail the build rather than the customer:

`flow-tool-honesty` (every tool has a handler) · `role-tool-reachability` (every
tool reachable by ≥1 role) · `tool-enum-validity` (tool enums match domain
enums) · `tool-honesty-sweep` (a tool that says it sends must reach a send path)
· `cortex-tool-bridge` · `saga-compensation-wiring` · `check-tool-routes`
(every manual route resolves).

---

## Phase 1 — Manual parity (next, small)

**The product rule:** every organ must be usable by hand. KEY is optional, never
mandatory.

The route gate proves a page *exists*. It does not prove the page can perform
the write. `/app/accounting` passes today while offering the user no way to do
anything.

**1.1** Extend `check-tool-routes.ts`: a tool of family `execute`/`crud` must
point at a page that imports at least one mutation function. Measured baseline
for the affected domains — contracts and assets have full manual CRUD; retainers,
procurement and portal are create-only; accounting, legal and budgeting are
**read-only for humans too**.

**1.2** Record the exemptions explicitly. A tool whose manual equivalent is
genuinely absent should be listed with a reason, not silently pass.

**Why first:** it is one file, and it makes every organ after it correct by
construction rather than by discipline.

---

## Phase 2 — The organs, in value order

Definition of done for each: **models + service + manual UI + tools (read *and*
write) + compensation registered + the §27 reflex closes.**

### 2.1 Inventory & stock — first, and zero-to-one
KEY cannot currently perceive a stock level. `marketplace.service.ts` already
computes `getInventoryAlerts` and `getInventorySummary` and throws them away.
Models: `InventoryStock`, `Warehouse`, `StockMovement`, `StockCount`.
Verbs: read level · below-reorder alert · adjust · write off · transfer ·
receive goods.
**Manual UI must be built** — there are no inventory pages today.

### 2.2 Contracts — the cheapest real organ
Manual CRUD already complete (create, update, delete, parties), 15 service
methods, 7 models, zero tools. Honours manual parity on day one.
Verbs: list · expiring this quarter · acknowledge alert · create · amend ·
extract terms. Also: renewal alerts only regenerate on human edit — no cron.

### 2.3 Documents & Drive — the substrate
`documents.service.ts` (1,011 lines) and `google-drive.service.ts` (1,417) are
complete and read-only to KEY. Every other organ leans on this: proposals,
contracts, NDAs, attachments.
Verbs: generate · read body · edit clause · move to review/approve/sign · email ·
list/open/upload/share.

### 2.4 Quote→cash completion
Highest revenue leverage per line of code, over a service that is already
operational. Send/chase/convert a quote · record part or cash payment · refund ·
credit note · payment link · recurring invoice.

### 2.5 Small completions — one sitting each
- **Bookings status** — confirm / no-show / complete are all one hardcoded
  `'CANCELLED'` at `flow-orchestrator.service.ts`.
- **Calendar edit** — `patchEvent`/`cancelEvent` sit ready in
  `calendar-query.service.ts`.
- **Time-tracking reads** — three reads turn the clock into an invoice.
- **`people_unassign`** — KEY cannot take back work it misassigned.
- **Inbox reply threading** — `key_inbox.send_reply` exists on the organ and is
  not bridged.
- **Consent check before outbound** — KEY can send against a recorded opt-out
  the database already holds. *Do this one early; it is a compliance exposure,
  not a feature gap.*

### 2.6 Procurement + supplier
Shares models with inventory, so it follows it naturally. **Repair first:** two
shipped GET routes are swallowed by `:id` and 404, and approve/reject writes
columns that do not exist on `ProcurementRequest`.

### 2.7 Deep finance — last of the near set
Richest data layer in the system (`Account`, `LedgerEntry`, `Reconciliation`,
`TaxLiability`, `TaxRate`, `AccountingPeriod`) and **no human write path**.
Giving KEY journal-posting before the manual UI exists inverts the product rule.
Manual UI first, then tools.

**Deliberately deferred:** helpdesk threading (no message thread, no SLA, no KB —
a product build, not a tool layer) · retainers (the periods→hours→invoice loop
exists in no service) · storefront intelligence (mocked end to end).

---

## Phase 3 — The learning organ (the differentiator)

Framework §20. Absent from all 430 models — a module-organised audit could not
have found it, because it does not partly exist.

| Organ | Purpose |
|---|---|
| Assumption register | What the business believes but has not proven |
| Hypothesis register | Formal testable claims with a failure threshold |
| Experiment registry | What was tested, by whom, against what criteria |
| Metric dictionary | One definition per metric so teams cannot diverge |
| Data lineage | Where a number came from and how much to trust it |
| Decision log | Decision + evidence + dissent + review date |
| Review cadence | Daily / weekly / monthly / quarterly / annual |
| Policy & pricing version control | What changed, when, why |

**Why this is the differentiator:** every competitor ships an assistant that
does tasks. None ships a business that knows what it believes, tests it, and
records the answer. KEY is already built to own this — memory consolidation,
salience, reflection and an evidence service, all with nothing to file into.

This turns the §19 lifecycle (observe → hypothesise → test → measure → decide →
standardise → scale) from a document into a system.

---

## Phase 4 — Deployment

Not started, deliberately. Recorded so it is not lost.

- Production has **29 tables** on a migration lineage from a branch that does not
  exist, frozen since 2025-11-30, with **19 real auth accounts that must not be
  touched**. It needs a rebuild, not a baseline-resolve — `prepare-production-db.ps1`
  will correctly refuse.
- CI's deploy job is commented out and points at a disconnected Vercel.
- The Supabase password shared earlier in this work **must be rotated**.
- Local: run `CLOSE_LOCAL_DRIFT.sql`, and
  `docker compose up -d --force-recreate db` to pick up pgvector.

**None of this work reaches a user until Phase 4 is done.** It should be planned
against the server, not the repo.

---

## How each organ gets verified

Not by tool count. By the §27 reflex closing end to end:

> signal detected → classified → owner assigned → evidence gathered → decision
> made → action executed → result measured → knowledge retained

And per change: a test, negative-controlled — revert the fix, confirm the test
fails **by name**, restore. This repo has produced tests that passed against
broken code more than once, and every one of those was caught by that step.
