# KeyFlowOS Analysis Map

Status: CANONICAL WORK PROGRAMME — 25 journeys + 12 pooled architectural kernels; all content remains evidence-driven and reopenable.

## Governing recursive programme

The full operating model is defined in:

- `11-RECURSIVE-ASSURANCE-PROGRAMME.md`
- `12-KERNEL-PROGRAMME.md`

Repository rule: **MAP BEFORE MODIFYING**.

Canonical loop:

```text
RECOVER / BASELINE
-> MACRO MAP
-> MICROSCOPIC JOURNEY RECONSTRUCTION
-> CROSS-JOURNEY / CROSS-KERNEL REFERENCE
-> POOL + NORMALIZE INTELLIGENCE
-> RE-CONCEPTUALIZE + VALUE ENGINEER
-> DESIGN / REFINE TARGET STATE
-> BACKWARD RE-AUDIT IMPACTED JOURNEYS
-> EXECUTION PLANNING
-> IMPLEMENTATION
-> PROOF / ADVERSARIAL VALIDATION
-> INGRAIN INTO KEYFLOWOS
-> WHOLE-SYSTEM RE-AUDIT
-> repeat from earliest invalidated layer
```

The analysis is recursive rather than one-pass. A later journey or kernel finding may reopen any earlier conclusion.

## Four simultaneous analytical levels

```text
LEVEL 1 — JOURNEY
What does this user/business journey actually do?

LEVEL 2 — SHARED KERNEL
Which reusable system makes that journey possible?

LEVEL 3 — JOURNEY LOOP / CONSTELLATION
Which other journeys alter or consume the same state?

LEVEL 4 — WHOLE OS
Does the combined architecture still behave like one coherent operating system?
```

Journeys are the vertical end-to-end views. Kernels are the horizontal shared architecture.

## Completed macro work

- [x] Initial macroscopic system analysis
- [x] Deep macro refinement pass
- [x] Nine-plane architecture model established as a working macro model
- [x] Governed business-state-transition thesis established
- [x] Business Graph / Blueprint / Genome / Evidence distinctions refined
- [x] Decision to proceed to a computable microscopic model
- [x] Journey dossiers selected as the primary microscopic unit
- [x] Canonical 25-journey programme recovered
- [x] Durable intelligence persistence established under `docs/intelligence/`
- [x] Recursive assurance programme established
- [x] Twelve-kernel pooled architecture programme established
- [x] Multi-agent implementation handoff protocol established

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

Exactly 25 canonical journeys are currently defined. Do not create J26+ merely to hold a shared architecture concern; use a kernel when the concern is horizontal.

## Canonical working kernel programme

1. `KF-KERNEL-001 — Tenant Genesis & Identity`
2. `KF-KERNEL-002 — Human Authority & Organization`
3. `KF-KERNEL-003 — KEY Authority & Governance`
4. `KF-KERNEL-004 — Business Knowledge`
5. `KF-KERNEL-005 — Capability Fabric`
6. `KF-KERNEL-006 — State Transition`
7. `KF-KERNEL-007 — Temporal / Event / Workflow`
8. `KF-KERNEL-008 — Evidence & Outcome`
9. `KF-KERNEL-009 — Integration & External Reality`
10. `KF-KERNEL-010 — Financial Truth`
11. `KF-KERNEL-011 — Recovery & Reliability`
12. `KF-KERNEL-012 — Engineering Control Plane`

See `12-KERNEL-PROGRAMME.md` for scope, primary journeys, dossier schema and convergence rules.

## Active constellation

The active analytical unit is currently:

```text
KF-JOURNEY-001 — Business Birth
        ↕
KF-JOURNEY-025 — Human Authority Lifecycle
        ↕
KF-JOURNEY-002 — KEY Request → Governed Action
        ↕
KF-JOURNEY-015 — Approval / Governance Lifecycle
```

J15 has already passed its original admission gate and is in active forensic analysis. Its findings may reopen J1/J25/J2 foundations.

Likely next constellation member after governance convergence:

`KF-JOURNEY-006 — Proactive KEY / Autonomy`

## Why this constellation exists

- J1 establishes tenant identity, founding authority, initial knowledge/readiness and initial AI policy.
- J25 changes Membership, role, position, delegation, approval authority and revocation.
- J2 consumes principal + capability + authority + KEY autonomy + readiness + policy to govern execution.
- J15 stress-tests approval/control evidence, approver authority, exact-action binding, invalidation and clearance.
- Findings in any one may invalidate assumptions in the others.

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

## Kernel dossier schema

Each kernel should eventually receive a dossier under `docs/intelligence/kernels/` using the schema in `12-KERNEL-PROGRAMME.md`.

Kernel dossiers own shared semantics; journey dossiers reference and stress-test them.

## Journey-analysis rules

- Model explicit states and transitions, including invalid transitions, bypasses, transaction boundaries, asynchronous transitions and stale states.
- Frontend analysis must include route/component, user trigger, browser/workspace state, UX gates, hidden transitions, discarded backend results and visible activation proof.
- API analysis records endpoint, guards, principal, business binding, DTO/input, service and result.
- Backend analysis traces Controller → Guard → Service → Orchestrator → Policy → Capability → Domain Service → DB/external integration where applicable.
- Data mutation ledgers record model/table reads, creates, updates, deletes, side effects, transaction membership, async writes, cache invalidation and derived projections.
- Tenant/identity analysis records external identity, local User, Business, Membership, owner semantics, active workspace, multi-business selection, invited vs founder and principal provenance.
- Event analysis tracks payload identity, consumers, committed-state semantics, sync/async behavior and duplicate/lost-event risks.
- KEY analysis separates observation, reasoning, proposal, capability selection, governance, approval, execution and learning.
- Governance analysis asks who requested/proposed/approves/executes, which capability/risk/policy/readiness/delegation applies, what exact action is governed, and what durable evidence satisfies the control.
- Failure analysis includes validation, authorization, stale data, duplicate requests, concurrency, connector failure, partial transactions, timeout, policy changes, revocation, retries and compensation.
- Proof analysis distinguishes implementation exists, test source exists, test currently passes, runtime behavior reproduced, concurrency invariant proven and system invariant proven.
- Reachability distinguishes mounted, reachable, called, UI-linked, externally callable, orphaned, legacy and compatibility-only.

## Finding and recommendation propagation

A material cross-cutting defect should be recorded once at the best architectural level, then linked to every affected journey/kernel.

When significant new evidence appears, explicitly identify:

1. what it changes;
2. which previous conclusions survive;
3. which findings are strengthened, narrowed, unchanged, superseded or refuted;
4. which kernels and journeys are affected;
5. whether target architecture/recommendations must change;
6. what remains unresolved.

Preserve uncertainty classifications and the evidence → interpretation → decision chain.

## Layered improvement model

For each journey/kernel:

```text
L0 Correctness
L1 Mandatory production standard
L2 Strong KeyFlow architecture
L3 Advanced architecture
L4 KeyFlow-specific differentiation
```

Basic security, authorization, idempotency and audit are production standards, not innovation.

## Convergence maturity

Use the programme maturity scale where useful:

```text
L0  DISCOVERED
L1  MAPPED
L2  RECONSTRUCTED
L3  CROSS-REFERENCED
L4  SEMANTICALLY RECONCILED
L5  VALUE-ENGINEERED
L6  TARGET-CONVERGED
L7  EXECUTION-READY
L8  IMPLEMENTED
L9  PROVEN
L10 INGRAINED
```

Any layer can return to `NEEDS_REVISIT` when new evidence invalidates an assumption.

## Implementation control

No production code changes are authorized by analytical maturity alone.

Before implementation, use `13-IMPLEMENTATION-HANDOFF-PROTOCOL.md` to create bounded implementation packets with:

- objective;
- current-state evidence;
- accepted invariant;
- journey/kernel impact;
- target contract;
- existing seams to strengthen;
- prohibited shortcuts;
- migration concerns;
- characterization tests;
- proof ratchets;
- explicit non-goals;
- return evidence requirements.

## Current state

J1/J25/J2 have directionally converged around tenancy, effective authority and clearance/execution-claim semantics. J15 is actively stress-testing the Governance/Clearance model and has already produced additional findings on control evidence, approver principals, confirmation binding, approval workflows and concurrency.

Current work is **JOURNEY + KERNEL CONVERGENCE**, not sequential journey completion and not production implementation.
