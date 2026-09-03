# KeyFlowOS Analysis Map

Status: CANONICAL WORK PROGRAMME — recovered through KF-JOURNEY-025; journey content remains subject to evidence-driven refinement.

## Governing analysis cycle

```text
MAP
  -> CROSS-REFERENCE
  -> RE-ANALYZE
  -> CONCEPTUALIZE
  -> VALUE ENGINEER
  -> DESIGN TARGET STATE
  -> BUILD EXECUTION PLAN
  -> EXECUTE
  -> PROVE
  -> INGRAIN INTO KEYFLOWOS
  -> RE-CROSS-REFERENCE
```

Repository rule: **MAP BEFORE MODIFYING**.

Journey work is recursive rather than one-pass. A journey may reopen assumptions in previously analysed journeys.

## Completed macro work

- [x] Initial macroscopic system analysis
- [x] Deep macro refinement pass
- [x] Nine-plane architecture model established as a working macro model
- [x] Governed business-state-transition thesis established
- [x] Business Graph / Blueprint / Genome / Evidence distinctions refined
- [x] Decision to proceed to a computable microscopic model
- [x] Journey dossiers selected as the primary microscopic unit
- [x] Canonical journey programme recovered
- [x] Durable intelligence persistence established under `docs/intelligence/`

## Canonical journey programme

1. `KF-JOURNEY-001 — Business Birth`
2. `KF-JOURNEY-002 — KEY Request → Governed Action`
3. `KF-JOURNEY-003 — Lead → Customer → Cash`
4. `KF-JOURNEY-004 — Booking → Service → Payment`
5. `KF-JOURNEY-005 — Conversation → Business Action`
6. `KF-JOURNEY-006 — Proactive KEY / Autonomy`
7. `KF-JOURNEY-007 — Financial Truth`
8. `KF-JOURNEY-008 — Project / Work Delivery`
9. `KF-JOURNEY-009 — Marketing → Lead Generation`
10. `KF-JOURNEY-010 — Commerce / Fulfilment`
11. `KF-JOURNEY-011 — Contract → Obligation → Renewal`
12. `KF-JOURNEY-012 — Document / Evidence Lifecycle`
13. `KF-JOURNEY-013 — Connector Lifecycle`
14. `KF-JOURNEY-014 — Webhook / External Event Ingress`
15. `KF-JOURNEY-015 — Approval / Governance Lifecycle`
16. `KF-JOURNEY-016 — Business Genome Evolution`
17. `KF-JOURNEY-017 — Command Center → Priority → Action`
18. `KF-JOURNEY-018 — Failure → Recovery`
19. `KF-JOURNEY-019 — Privacy / Deletion / Exit`
20. `KF-JOURNEY-020 — Plan / Subscription / AI Cost`
21. `KF-JOURNEY-021 — Public Customer Experience`
22. `KF-JOURNEY-022 — KEY Voice`
23. `KF-JOURNEY-023 — Temporal Flow / Long-Running Workflow`
24. `KF-JOURNEY-024 — System Change / Engineering Safety`
25. `KF-JOURNEY-025 — Human Authority Lifecycle`

`KF-JOURNEY-025` was introduced after J1/J2 analysis showed that human authority required a first-class lifecycle before the Approval / Governance journey could be safely frozen.

## Active journey mesh

The active analytical unit is not a single isolated journey. It is the convergence mesh:

```text
KF-JOURNEY-001 — Business Birth
        ↕
KF-JOURNEY-025 — Human Authority Lifecycle
        ↕
KF-JOURNEY-002 — KEY Request → Governed Action
```

### Why this mesh exists

- J1 exposes how tenant identity and founding authority are created.
- J25 exposes how human authority is derived, changed, delegated and revoked.
- J2 exposes how capability identity, human authority, KEY autonomy, policy, approval, clearance and execution interact.
- Findings in any one may invalidate assumptions in the others.

### Admission rule for J15

Do **not** fully open `KF-JOURNEY-015 — Approval / Governance Lifecycle` until these three convergence problems are sufficiently stable:

1. tenant relationship semantics: `ownerId + Membership → Membership-first tenancy` without breaking ownership/data;
2. effective authority algebra: role + JobRole/position + overrides + denials + delegations + approval tier + resource/capability context;
3. execution-claim convergence: proposal + plan + queue + direct Flow + retries + provider idempotency → one concurrency-safe claim/dispatcher model.

After convergence, re-run J1/J25/J2, then perform a J15 admission review.

## Canonical journey dossier schema

Every journey should progressively model:

A. Definition
B. Product Intent
C. Actors
D. Entry Surfaces
E. State Machine
F. Frontend Path
G. API Path
H. Backend Chain
I. Data Mutation Ledger
J. Tenant / Identity
K. Events / Coordination
L. KEY / AI
M. Capability Mapping
N. Authority / Governance
O. Blueprint / Graph / Genome
P. Invariants
Q. Failure Matrix
R. Idempotency / Transactions / Concurrency
S. Security / Privacy
T. Observability
U. Proof / Test
V. Reachability
W. Duplication
X. Architecture Alignment
Y. Contradictions
Z. Unknowns
AA. Findings
AB. Canonical Journey Graph
AC. Machine-readable record

## Journey-analysis rules

- Model explicit states and transitions, including invalid transitions, bypasses, transaction boundaries, asynchronous transitions and stale states.
- Frontend analysis must include route/component, user trigger, browser/workspace state, UX gates, hidden transitions, discarded backend results and visible activation proof.
- API analysis records endpoint, guards, principal, business binding, DTO/input, service and result.
- Backend analysis traces Controller → Guard → Service → Orchestrator → Policy → Capability → Domain Service → DB/external integration where applicable.
- Data mutation ledgers record model/table reads, creates, updates, deletes, side effects, transaction membership, async writes, cache invalidation and derived projections.
- Tenant/identity analysis records external identity, local User, Business, Membership, owner semantics, active workspace, multi-business selection, invited vs founder and principal provenance.
- Event analysis tracks payload identity, consumers, committed-state semantics, sync/async behavior and duplicate/lost-event risks.
- KEY analysis separates observation, reasoning, proposal, capability selection, governance, approval, execution and learning.
- Governance analysis asks who requested/proposed/approves/executes, which capability/risk/policy/readiness/delegation applies, and what exact action was approved.
- Failure analysis includes validation, authorization, stale data, duplicate requests, concurrency, connector failure, partial transactions, timeout, policy changes, revocation, retries and compensation.
- Proof analysis distinguishes implementation exists, test source exists, test currently passes, runtime behavior reproduced, and generated-state claims.
- Reachability distinguishes mounted, reachable, called, UI-linked, externally callable, orphaned, legacy and compatibility-only.

## Cross-cutting kernels

Working groupings, not yet frozen as official subsystem names:

- Tenant / Identity Kernel
- Knowledge Kernel
- Genome / Readiness Kernel
- Capability Kernel
- Authority Kernel
- Governance / Clearance Kernel
- Execution Claim / Idempotency Kernel
- Evidence / Outcome Kernel

## Planned domain analyses

- Business Genesis
- Blueprint
- Business Genome
- Living Business Constitution
- Business Graph
- Temporal Flow
- KEY / AI orchestration
- Autonomy and governance
- Identity and tenancy
- CRM / relationship intelligence
- Commerce / finance
- Bookings / time
- Projects / work execution
- Communications / inbound-outbound messaging
- Social/content/attention
- People / structure / delegation
- Momentum / relationship scoring
- Capabilities / module readiness
- Command Center / operating surfaces
- Integrations
- Security
- Observability / audit / business events

## Status vocabulary

- `NOT_STARTED`
- `SCOPING`
- `ANALYSING`
- `PARTIALLY_MODELLED`
- `VALIDATING`
- `CANONICAL`
- `NEEDS_REVISIT`
- `DEPRECATED`

## Current state

J1 and J2 have substantial recovered first/second-pass analysis. J25 is partially analysed. Current work is **CONVERGENCE**, not first-pass J1 scoping.
