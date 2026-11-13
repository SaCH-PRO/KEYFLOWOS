# J17 — CommandItem Source-Family Classification & Initial Proof Architecture

Status: CANONICAL INVESTIGATION / MIGRATION + PROOF INPUT
Date: 2026-09-06
Primary journey: J17 — Command Center → Priority → Action
Primary target: KF-REC-051
Production implementation authorized: **NO**

## Purpose

Classify the currently observed direct `CommandItem` writer families by semantic role, authoritative source, admission identity, reverse-convergence ownership and likely target treatment.

This is not a mandate that all CommandItems migrate to one mechanism. It is a convergence map.

---

# 1. Current direct-writer inventory at verified head

Repository-wide indexed searches at `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76` identify the following direct production write families:

1. `CommandService` — generic/manual/API create + lifecycle mutation.
2. `CommandGeneratorService` — scanner-generated business suggestions/work.
3. `CommandBridgeService` — generic intelligence-signal bridge.
4. `ObligationListener` — `WORK_OBLIGATION_RAISED / SETTLED` contract.
5. `StorefrontConversionService` — abandoned-cart recovery attention.
6. `FinanceIntelligenceService` — FIN8 detection mirror with paired dismiss/update behavior.

Historical comments in `ObligationListener`/`work-events.ts` state that sixteen files across twelve modules directly wrote CommandItem at the time that contract was introduced. Current indexed direct-create searches surface a smaller set. Treat the historical number as provenance, **not current measured writer count**, until a complete AST/static scan is rerun.

This itself reinforces the continuity rule: comments are evidence, not current inventory truth.

---

# 2. Family classification matrix

| Writer / family | Current semantic class | Authoritative source | Admission identity | Reverse convergence | Target direction |
|---|---|---|---|---|---|
| `CommandService.create` | manual/operator-created suggestion/work | explicit user/API intent | caller-supplied source tuple / new row | manual lifecycle only | **RETAIN BOUNDED** for operator-owned work; tighten allowed semantic claims |
| `CommandGeneratorService` | mixed scanner-derived suggestions/control reminders | Invoice, Quote, Expense, AiApprovalItem, ProjectTask, Booking | five-tuple uniqueness at DB; generator catches P2002 | **WEAK / ABSENT**; create+skip, no predicate reconciliation | **MIGRATE / SPLIT BY SOURCE FAMILY** into source-owned adapters or obligations |
| `CommandBridgeService` | generic intelligence signal → command suggestion | caller/source signal | findFirst then create using source tuple | method exists but `resolveCommandsForEntity()` has no observed caller | **COMPATIBILITY / DEPRECATION CANDIDATE**; avoid generic bridge as ownership substitute |
| `ObligationListener` | durable business obligation | emitting source module + obligation contract | stable five-tuple; atomic upsert | **STRONG** via `WORK_OBLIGATION_SETTLED`; disposition not resurrected | **PRESERVE / EXPAND PATTERN** for true obligations |
| `StorefrontConversionService` abandoned cart | source-derived sales/recovery attention | PublicEvent checkout-start/completion | visitor/day heuristic + sourceId visitor | **WEAK**; completion checked at scan time, no observed post-create settlement | **SOURCE ADAPTER NEEDED** if persisted; otherwise compute/read-model |
| `FinanceIntelligenceService` FIN8 | finance detection / durable attention | FinanceActionItem/detection + authoritative finance inputs | stable source tuple via findUnique | **STRONGER** paired update + `dismissCommandItem()` | **PRESERVE AS MIGRATION SEAM**, then standardize adapter contract |

---

# 3. Detailed family notes

## 3.1 Manual / API CommandService

Current strengths:
- persistent user-visible work;
- assignment;
- snooze/dismiss/complete/reopen;
- timeline evidence.

Current danger:
- generic surface can accept semantically strong fields (`requiresApproval`, `executableByKey`, `executionTool`) even though CommandItem is not a canonical authority/effect owner;
- `approve()` / `execute()` currently false-terminalize as captured by F180/C130.

Target role:

```text
operator-owned work/disposition
or
source-adapter-backed work
```

not arbitrary authority/effect truth.

## 3.2 Legacy scanner generator

Current seeds:

```text
Invoice.status=OVERDUE         → COLLECT_RECEIVABLE
Quote.status=SENT + stale      → FOLLOW_UP_QUOTE
Expense.categoryId=null        → CATEGORIZE_EXPENSE
AiApprovalItem.status=pending  → REVIEW_APPROVAL
ProjectTask overdue            → COMPLETE_OVERDUE_TASK
Booking.status=PENDING         → CONFIRM_BOOKING
```

This one service spans finance, commerce, governance, projects and bookings.

It answers admission through polling/scanning but does not own each source lifecycle. That is why F182 appears naturally.

Target direction:
- true obligations → source-owned `WORK_OBLIGATION_*` where semantic fit is real;
- approval/control → governance source adapter, not a fake executable command;
- ephemeral suggestions → assemble on read unless persistence/disposition proves product value;
- durable follow-up work → source-specific bidirectional adapter.

Avoid making the generator a universal synchronization sweeper.

## 3.3 Generic CommandBridgeService

Current pattern:

```text
signal input
→ findFirst(active tuple)
→ create CommandItem
```

Problems already observed:
- check-then-act rather than atomic upsert;
- reverse resolver exists but has no observed caller;
- generic caller decides semantic fields.

Target direction:

> Keep only as compatibility if needed during migration; source-specific admission/convergence adapters should own lifecycle semantics.

A generic bridge may still be a helper under those adapters, but not the owner of source truth.

## 3.4 ObligationListener

This is currently the strongest CommandItem lifecycle pattern.

```text
source module learns business owes something
→ WORK_OBLIGATION_RAISED
→ stable five-tuple upsert
→ kind=OBLIGATION
→ facts may refresh
→ user disposition is not resurrected

source learns obligation was satisfied
→ WORK_OBLIGATION_SETTLED
→ corresponding obligation discharged/completed
```

Important properties to preserve:
- exact source identity;
- both admission and settlement;
- source producer need not know CommandItem persistence details;
- re-raise refreshes facts but does not silently reopen dismissed/completed work;
- discharge can carry evidence/reference.

This is a strong candidate pattern for *obligation semantics specifically*, not every recommendation or alert.

## 3.5 Storefront abandoned-cart attention

Current detection:

```text
checkout_start in last 24h
- matching checkout_complete in scanned window
→ create SALES / recover_abandoned_cart CommandItem
```

It deduplicates by visitor/day heuristic.

Open convergence risk already covered by F182:

```text
cart CommandItem created
→ checkout completes later
→ no observed source-driven CommandItem settlement
```

Target choices:
1. make abandoned-cart recovery a true source-owned work adapter with completion/supersession; or
2. compute it dynamically when the user asks for current opportunities, if persistent disposition/history is not needed.

Do not keep a durable OPEN item merely because the original scan was true once.

## 3.6 FinanceIntelligence FIN8 mirror

This is a useful counterexample to F182.

Current code:

```text
finance detection
→ mirror/update CommandItem by stable source tuple

finance detection resolves/dismisses
→ dismissCommandItem(...)
→ update corresponding OPEN/WAITING_APPROVAL projection
```

This proves a current source service can own a paired projection lifecycle without making CommandItem canonical financial truth.

Target:
- retain the bidirectional pattern;
- normalize semantic status/disposition and source adapter interface later;
- K10 remains authoritative.

---

# 4. Target source-adapter contract

A source family admitted into durable operator work should be able to answer:

```text
SOURCE OWNER
What record/event/revision is authoritative?

ADMISSION PREDICATE
Why should this condition consume operator attention now?

IDENTITY
What stable key makes this the same attention/work item across refreshes?

SEMANTIC CLASS
suggestion | obligation | durable work | control decision | recovery attention | compatibility

CURRENT FACTS
What title, due time, value, severity, actionability inputs may refresh?

DISPOSITION OWNERSHIP
Which fields are operator-owned and must not be overwritten by source refresh?

REVERSE CONVERGENCE
What source transition resolves/supersedes/reclassifies the projection?

ACTION ROUTING
If action is requested, which canonical owner handles it?

TERMINAL EVIDENCE
What proves the business/control/effect claim represented by terminal projection state?
```

Target law:

```text
NO DURABLE SOURCE-DERIVED ATTENTION FAMILY
WITHOUT AN EXPLICIT REVERSE-CONVERGENCE STORY
```

---

# 5. Persist vs assemble-on-read vs Temporal Work Projection

## Persist as CommandItem-like operator work when

- user disposition must survive sessions;
- assignment/ownership matters;
- due/overdue history matters;
- it represents a durable obligation/work commitment;
- exact source identity is stable;
- reverse convergence can be defined;
- history/audit has real product value.

## Assemble on read when

- item is ephemeral insight/opportunity;
- source can be cheaply queried;
- no durable operator disposition/assignment is required;
- persistence would create stale dual truth;
- ranking is lens-specific and changes rapidly.

Likely candidates: many recommendations/weak-section insights/derived opportunities unless product evidence shows durable attention value.

## Consume KF-REC-047 Temporal Work Projection when

- the core semantics are scheduled/waiting/running/retrying/provider-wait/outcome-unknown/cancelled/superseded/expired;
- the source is already durable long-running work;
- J17 needs visibility rather than another work row.

## Use source-native control adapter when

- item is fundamentally an approval/control decision;
- CommandItem may display/link it, but authoritative mutation stays in J15/K3 owner.

---

# 6. Initial J17 proof obligations

Local proof namespace: `PF-J17-###`.

These are specification obligations, **not executed tests**.

### PF-J17-001 — degraded source cannot improve health

Inject failure into a material snapshot source (approvals/Temporal/Genome).

Prove:

```text
source unavailable
→ projection explicitly degraded/partial
→ not converted into healthy zero
→ health/priority confidence does not improve
```

### PF-J17-002 — attention admission reachability

For each included durable source family, prove one authoritative source transition actually reaches its adapter/projection.

Negative control: a consumer-only event type with no producer path must fail the contract inventory.

### PF-J17-003 — reverse convergence

For every source-derived durable item:

```text
source predicate true  → active projection
source predicate false → resolve/supersede/reclassify within declared lag
```

### PF-J17-004 — disposition durability

Snooze/dismiss/acknowledge a source-derived item; re-emit/recompute unchanged source facts.

Prove source refresh does not silently destroy user disposition unless policy explicitly says it should.

### PF-J17-005 — disposition does not rewrite source truth

Dismiss/snooze operator projection and prove authoritative source remains unchanged unless the requested action explicitly routes to source owner.

### PF-J17-006 — terminal execution evidence

A CommandItem-like projection may not become `EXECUTED/SUCCEEDED` merely through projection mutation.

Prove terminal effect claim requires appropriate source/effect/OutcomeEvidence.

### PF-J17-007 — control-item authority

For an approval/control attention item:

```text
projection Approve intent
→ exact authoritative control record
→ current approver authority
→ source control transition
```

No projection-only approval.

### PF-J17-008 — effect-time Clearance

For any material execute affordance, revoke/change authority/policy after item creation but before click.

Prove execution revalidates current Clearance.

### PF-J17-009 — server query / UI filter agreement

For each visible status filter, create representative rows and prove server query can actually return them or that UI clearly declares active-only scope.

### PF-J17-010 — source rank preservation

Given two Genome recommendations where rich source rank says A > B but risk labels alone would invert them, prove global priority layer either preserves source rank evidence or explains an intentional lens-specific reordering.

### PF-J17-011 — explicit query lens determinism

The same fixture set under:
- `WHAT_IS_OWED`
- `WHAT_IS_DANGEROUS`
- `WHAT_SHOULD_I_DO_NEXT`
- `WHAT_CAN_KEY_HANDLE`

must produce deterministic, explainable differences attributable to declared lens rules.

### PF-J17-012 — stale attention exclusion

Create an active source-derived item, resolve source, withhold/reset projection intentionally.

Prove stale projection is identified and cannot remain silently executable/actionable.

### PF-J17-013 — recovery certainty mapping

For J18 cases:

```text
OUTCOME_UNKNOWN → reconcile priority/action, not blind retry
FAILED_FINAL → no retry affordance unless recovery contract permits
RETRYABLE_ATTEMPT_FAILURE → retry shown only if current authority/policy permits
```

### PF-J17-014 — duplicate/root-cause coalescing

Create multiple attention inputs representing one underlying root condition.

Prove operator view may coalesce them without deleting source history or confusing distinct consequences.

### PF-J17-015 — detection lag metric

Measure source transition → attention projection visibility for each materialized family. Prove metric is observable and bounded where product semantics require timeliness.

### PF-J17-016 — reset lag metric

Measure authoritative resolution → operator projection convergence. This is the empirical ratchet for F182.

### PF-J17-017 — attention precision fixture

Using a controlled corpus of known actionable/non-actionable conditions, measure share of high/interruption-class items that actually require response under declared policy.

Do not optimize automatically from this metric yet.

### PF-J17-018 — attention recall fixture

Using a controlled corpus of material source conditions, measure whether required attention families are surfaced. Missing unwired families like the F181 class must be detectable.

### PF-J17-019 — actionability is principal-relative

Two principals with different current authority inspect the same important item.

Prove:

```text
importance may be same
available actions / canActNow may differ
```

without hiding the item merely because one principal lacks authority.

### PF-J17-020 — tenant isolation

All source adapters, projections, ranking queries, dispositions and action routing remain business-scoped in HTTP, worker/listener and rebuild paths.

---

# 7. Migration shape — current best direction

Do not begin implementation yet. Current semantic migration direction:

```text
1. inventory source families
2. freeze semantic classes / adapter expectations
3. preserve strong obligation + FIN8 bidirectional seams
4. characterize legacy generator/bridge behavior
5. move source-derived durable families toward paired source adapters
6. remove/replace projection-only approve/execute semantics
7. make query scope + source health explicit
8. preserve source-specific rank evidence in PriorityAssessment
9. connect Temporal Work Projection as a source, not duplicate work
10. prove reset/admission/actionability properties
```

Physical changes are intentionally deferred until whole-system target/migration architecture converges.

---

# 8. Disposition

No new F/C/REC ID is required by this classification itself.

It strengthens:

```text
F180/C130
F181/C131
F182/C132
F183/C133
F184/C134
KF-REC-051
```

The strongest positive architecture seam is now explicit:

> `WORK_OBLIGATION_RAISED / SETTLED` is a model for bidirectional source-owned operator-work projection **where the business semantic is truly an obligation**.

Do not universalize it to every attention class.

J17 can return to the broader pool after this source-family/proof tranche is checkpointed and the next frontier is selected.
