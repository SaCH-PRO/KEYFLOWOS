# KeyFlowOS Current Handoff

Last updated: 2026-09-03

## Load first

Read `docs/intelligence/00-START-HERE.md`, then the canonical files it lists.

Also read:

- `docs/intelligence/sessions/2026-09-03-exhausted-thread-recovery.md`
- `docs/intelligence/journeys/KF-JOURNEY-001-BUSINESS-BIRTH.md`
- `docs/intelligence/journeys/KF-JOURNEY-002-KEY-REQUEST-GOVERNED-ACTION.md`
- `docs/intelligence/journeys/KF-JOURNEY-025-HUMAN-AUTHORITY-LIFECYCLE.md`

## Context integrity

`PASS`

The previous long conversation's unique work has been recovered and durably persisted. Do not restart from first-pass J1 scoping.

## Active analytical mesh

```text
KF-JOURNEY-001 — Business Birth
        ↕
KF-JOURNEY-025 — Human Authority Lifecycle
        ↕
KF-JOURNEY-002 — KEY Request → Governed Action
```

## Exact continuation point

Remain inside this mesh. Do **not** fully open J15 yet.

The immediate work is convergence across three foundational problems:

### A. Tenant relationship

Resolve:

```text
Business.ownerId + Membership
  -> safe Membership-first tenancy
```

without breaking ownership semantics/data.

Trace/revalidate:

- all Business creation/bootstrap paths;
- OWNER Membership invariants;
- `listBusinesses`/workspace discovery;
- BusinessGuard vs scoped authorization;
- active workspace selection;
- invitation placeholder identity behavior;
- JobRole/OrgAssignment authority materialization.

### B. Effective human authority

Construct and challenge a candidate algebra:

```text
principal
+ business
+ Membership/base role
+ JobRole/position
+ explicit grants/overrides
+ explicit denials
+ delegations
+ approval tier
+ capability
+ resource/context
+ validity/revocation
-> effective authority
```

Determine:

- source precedence;
- expansion vs narrowing rules;
- explicit-denial semantics;
- delegation/grant bounds;
- explainability/provenance;
- revocation effects on approval/clearance.

### C. Execution claim / dispatcher

Revalidate all materially distinct execution regimes:

- KeyActionProposal execution;
- AI plan approval/execution;
- PlanExecutor/BullMQ;
- direct Flow plan execution;
- GraphActions/direct Flow action execution;
- ActionDispatcherService;
- KeyIdempotencyService;
- SafetyShell;
- provider-side idempotency/retries.

Construct candidate target:

```text
exact capability/action
  -> clearance
  -> atomic execution claim
  -> canonical post-clearance dispatcher
  -> domain/provider execution
  -> durable outcome
```

## What is already recovered

### Journey programme

Canonical programme recovered through `KF-JOURNEY-025`. See `03-ANALYSIS-MAP.md`.

### Method

Journey analyses are recursive/bidirectional. Findings in J25/J2 must feed back into J1 and vice versa.

### Macro thesis

KeyFlowOS is being modelled as a governed business-state transition system:

```text
observation
-> Business Graph
-> Genome
-> KEY
-> capability
-> authority/policy/readiness
-> clearance
-> execution claim
-> execution
-> state transition
-> evidence/outcome
```

### Critical distinctions already established

- Business Graph != database
- Blueprint != Genome
- Membership != mere relationship
- human authority != KEY autonomy
- impact tier != control requirement
- module readiness != action authorization
- approval != portable clearance
- clearance != execution claim
- idempotency key != single-executor claim
- invitation != authenticated User

## Existing seams to evaluate before inventing replacements

- `CapabilityContractService`
- `ActionDispatcherService`
- Membership
- AuthorityGrant

Do not create parallel v2 systems until these are proven insufficient.

## Recovered implementation-findings caution

Historical findings F003–F043 and C005–C021 are preserved in the recovery source. They are valuable leads but commit-sensitive code facts must be revalidated against the current repository before they become execution premises.

Do not assign historical F-numbers beyond F043 unless an original source is recovered.

## J15 admission rule

Only perform a full `KF-JOURNEY-015 — Approval / Governance Lifecycle` pass after the J1/J25/J2 convergence establishes sufficiently stable:

- tenant identity/relationship;
- human authority algebra;
- capability identity;
- approval-to-clearance binding;
- concurrency-safe execution claim;
- post-clearance execution semantics.

## Required output of next convergence pass

1. current-code revalidation table for the three convergence axes;
2. candidate Membership-first tenancy invariant/migration model;
3. candidate Effective Authority Resolver algebra with worked scenarios;
4. candidate clearance + action-fingerprint + invalidation semantics;
5. candidate execution-claim state machine and dispatcher topology;
6. explicit changes to J1/J25/J2 conclusions;
7. updated finding/contradiction/recommendation registers;
8. J15 admission verdict: `NOT_READY` or `READY_FOR_SCOPING`.

## Constraints

- No production code modifications yet.
- No premature implementation tickets from provisional recommendations.
- No legacy deletion without consumer proof.
- No assumption that a test file means a test passed.
- No assumption that UI non-navigation means code is dead.
- Preserve evidence -> interpretation -> decision.
