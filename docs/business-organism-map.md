# The Business Organism → KEYFLOWOS map

The canonical checklist for organs, limbs and tools — the counterpart to
`neuro-atlas-code-mapping.md`, which did the same job for the CNS.

**Verified 2026-08-05** against 430 Prisma models, 217 web pages, 101 server
modules and 127 tools. Every count here was re-derived; none is quoted from an
earlier pass.

---

## 0. How to read this, and why it is not a tool list

The *Universal Business Organism* framework has 28 sections and several hundred
line items. Mapping each to a tool would produce 400+ tools, and that is the
wrong shape for three measured reasons:

1. **Cost.** Every tool schema is sent on every request. 127 already ships on
   each turn; 400 would dominate the prompt.
2. **Accuracy.** Model tool-selection degrades badly past a couple of hundred
   options — a tool the model never picks correctly is worse than absent.
3. **Category error.** Much of the framework is not tool-shaped. Culture,
   informal power, risk tolerance and leadership behaviour are *business
   epigenetics* — things KEY **reads** to modulate its behaviour, not verbs it
   calls. Those already land in `key-cortex-epigenetics.service.ts`.

So: the framework is the **completeness checklist**. The ~24 business domains
are the **tool surface**. The framework's feedback loops (§24) are the **wiring
tests** — an organ is not connected until its loop closes.

---

## 1. Definition of done for an organ

An organ is finished when **all four** exist and agree. Three of four is the
state most of this codebase is in, and it is the state that looks finished.

| Layer | Requirement |
|---|---|
| **Data** | Prisma models with `businessId`, and queries that filter on it. A guard establishes who is asking; it does not constrain what a query touches. |
| **Service** | Real logic, tenant-scoped, no raw Prisma records returned across a boundary. |
| **Manual UI** | The user can perform **every verb KEY can**, without KEY. Non-negotiable: KEY is optional, never mandatory. |
| **KEY tools** | Read *and* write, correct risk tier, in at least one role, `manualEquivalentRoute` pointing at the screen that does the same job. |

Plus, for anything that touches the outside world: a **compensating action**
registered in `KeyCortexCompensationService`, or the saga honestly records
`compensation_unavailable`.

### The gates that enforce this today

- `role-tool-reachability.spec.ts` — every tool reachable by ≥1 role
- `flow-tool-honesty.spec.ts` — every tool has a handler
- `tool-enum-validity.spec.ts` — every tool enum matches its domain enum
- `check-tool-routes.ts` — every `manualEquivalentRoute` resolves to a real page
- `saga-compensation-wiring.spec.ts` — compensation keys are real tool names

**Known gap in the gates:** the route check proves a page *exists*, not that it
can perform the write. `/app/accounting` passes while offering the user no way
to do anything. Strengthening this is a prerequisite for the finance organ.

---

## 2. Current state by organ

### Operational — KEY can read and write

| Organ | Tools | Notes |
|---|---|---|
| Commerce / invoicing | 17 | Quote→invoice→paid. `mark_invoice_paid` fixed 2026-08-05. |
| CRM / contacts | 13 | Full contact record. No deals or sequences. |
| Automations / autopilot | 10 | Five delegation loops, all live. |
| Projects & tasks | 10 | Task-level only; no project-level verbs. |
| Bookings | 7 | Status transitions hardcode `CANCELLED`. |
| Marketing email | 6 | Genuinely sends via Gmail. |
| People / HR | 5 | Added 2026-08-04. No `unassign` — KEY cannot take back work it misassigned. |
| Inbox | 5 | Bridged from the cortex organ registry. Reply does not thread. |
| Social | 4 | Real API calls. False-success on zero connections fixed 2026-08-05. |
| Expenses | 3 | `create` hardcodes PAID and leaves the row uncategorised. |
| Helpdesk | 3 | Thin service beneath it. |
| Time tracking | 3 | Writes only, no reads. |

### Read-only — KEY can report, not act

Ledger & reports · Documents & Drive · Calendar · Site/SEO · Store · Consent

### Hands-off — data + service + screens, zero tools

Inventory & stock · Contracts · Procurement · Assets · Plans & goals · Portal

### Not usable by anyone yet

Retainers — the periods→hours→invoice loop exists in no service.

---

## 3. Manual-parity status

The constraint that everything must be usable by hand changes the build order.
Verified by the mutation functions each page imports:

| Domain | Human can write? |
|---|---|
| Contracts, Assets | ✅ full CRUD |
| Retainers, Procurement, Portal | ⚠️ create only |
| Reports | ⚠️ settings only |
| **Accounting, Legal, Budgeting** | ❌ **read-only for humans too** |

Deep finance has the richest data layer — `Account`, `LedgerEntry`,
`Reconciliation`, `TaxLiability`, `TaxRate`, `AccountingPeriod` — and no human
write path. Giving KEY journal-posting there would hand KEY a power the owner
does not have. **It is the most expensive organ, not the cheapest.**

---

## 4. What the framework reveals that the codebase has no concept of

This is the section that justifies keeping the framework as a checklist. A
module-by-module audit can only find gaps in things that partly exist; these do
not exist at all.

**§20 Scientific learning infrastructure** — almost entirely absent from 430
models:

| Organ | Purpose | Status |
|---|---|---|
| Assumption register | What we believe but have not proven | **absent** |
| Hypothesis register | Formal testable claims | **absent** |
| Experiment registry | What was tested, by whom, against what criteria | **absent** |
| Metric dictionary | One definition per metric, so teams do not diverge | **absent** |
| Data lineage | Where a number came from and how reliable it is | **absent** |
| Decision log | Decision + evidence + dissent + review date | partial (audit log ≠ decision record) |
| Lessons-learned repository | Reusable insight from success and failure | partial (`key-cortex-learning`) |
| Review cadence | Daily/weekly/monthly/quarterly/annual rhythm | **absent** |
| Version control over policy & pricing | What changed, when, why | **absent** |

This is the organ that makes a business *scientific* rather than merely
automated, and it is the one thing in the framework KEY is architecturally
suited to own — it already has memory consolidation, salience, reflection and an
evidence service with nothing to file into.

**Also thin or absent:** §11 excretion (offboarding, write-offs,
decommissioning, technical-debt removal — only `trash` exists), §14 skin (brand,
T&Cs, access control as a coherent boundary), §16 reproduction (succession,
franchising, licensing, M&A).

---

## 5. Build order

1. **Honesty and identity** — done 2026-08-05. Tools that lie poison everything
   built on them.
2. **Manual-parity gate** — a write tool must point at a screen that can perform
   that write. Enforces §1 automatically for every organ after this.
3. **Inventory & stock** — zero-to-one. KEY cannot perceive a stock level;
   `marketplace.service.ts` already computes `getInventoryAlerts` and throws it
   away.
4. **Contracts** — manual CRUD complete, 15 service methods, thin tool layer,
   honours manual parity on day one.
5. **Documents & Drive** — substrate every other organ leans on.
6. **Learning infrastructure (§20)** — the differentiator, and the part no
   competitor's "AI assistant" has.
7. **Deep finance** — last of the near-term set, because the manual UI must be
   built first.

Not near-term: helpdesk threading (a product build, not a tool layer),
retainers (no service exists), storefront intelligence (mocked end to end).

---

## 6. The reflex every organ must complete

From §27. This is the wiring test — an organ is connected when a real event can
traverse it end to end:

> signal detected → classified → owner assigned → evidence gathered → decision
> made → action executed → result measured → knowledge retained

KEY has all eight stages built. Before people/HR, the "owner assigned" stage
could only ever assign to KEY itself. Before the efferent bridge, "action
executed" could not reach an organ adapter. Before the compensation fix, a
failed action could not be undone.

Each new organ should be tested against this loop, not against its own tool
count.
