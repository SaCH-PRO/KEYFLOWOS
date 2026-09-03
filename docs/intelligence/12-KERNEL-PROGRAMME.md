# KeyFlowOS Architectural Kernel Programme

Status: CANONICAL WORKING PROGRAMME

Purpose: define the horizontal architectural systems that the 25 vertical journey dossiers repeatedly consume, mutate, stress-test and refine.

## Governing model

KeyFlowOS analysis operates at four simultaneous levels:

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

Journey-only analysis produces duplication and local fixes.
Architecture-only analysis produces abstractions that may miss actual UX, state, reachability and failure behavior.

KeyFlowOS requires both.

---

## Prime rule

> Journeys are the vertical end-to-end views. Kernels are the horizontal shared architecture. A journey may discover a kernel law, but it does not own a private copy of that law.

A material cross-cutting finding should be recorded once at the best architectural level and referenced by every affected journey.

---

# Canonical working kernel catalogue

The following twelve pooled kernels are the current working architecture programme. Names and boundaries may refine through evidence, but agents must not silently invent parallel kernels.

## K1 — Tenant Genesis & Identity Kernel

**Working ID:** `KF-KERNEL-001`

Owns:

- external authenticated identity;
- local User;
- Business;
- Membership;
- distinguished ownership relationship;
- invitation/claim lifecycle;
- workspace discovery/selection;
- tenant initialization;
- multi-business relationships;
- tenant isolation;
- principal identity/provenance at tenant boundary.

Primary journeys:

- J1 Business Birth
- J25 Human Authority Lifecycle
- J19 Privacy / Deletion / Exit
- J20 Plan / Subscription / AI Cost
- J2 KEY Request → Governed Action

Current high-leverage questions:

- Membership-first tenancy versus `Business.ownerId` access semantics;
- founding OWNER Membership invariant;
- invitation as claim awaiting identity rather than placeholder User;
- safe owner/member migration;
- workspace discovery for non-owner members;
- ownership transfer and exit semantics.

---

## K2 — Human Authority & Organization Kernel

**Working ID:** `KF-KERNEL-002`

Owns:

- Membership base role;
- permission/capability authority;
- JobRole;
- OrgAssignment;
- explicit user overrides;
- explicit denials;
- DelegationRule / human delegation;
- approval authority/tier;
- grantability;
- position-bound external approvers;
- authority provenance/version/revocation;
- Effective Authority Resolver.

Primary journeys:

- J25 Human Authority Lifecycle
- J15 Approval / Governance Lifecycle
- J2 Governed Action
- J8 Project / Work Delivery
- J11 Contract → Obligation → Renewal
- J12 Document / Evidence Lifecycle
- J23 Temporal Flow

Current core law:

```text
granted authority <= grantor grantable authority
```

Target direction:

```text
Membership relationship/base role
+ active OrgAssignment/JobRole
+ explicit overrides/grants
+ valid bounded delegation
- explicit denials
∩ capability/resource/time/context constraints
-> EffectiveAuthorityResult
```

Authority should be resolved at decision boundaries rather than silently copied between authority sources.

---

## K3 — KEY Authority & Governance Kernel

**Working ID:** `KF-KERNEL-003`

Owns:

- KEY autonomy/delegation;
- BusinessAutonomyProfile;
- AutopilotSettings;
- AuthorityGrant where used for KEY/standing authority;
- kill switch;
- spend/action/tier ceilings;
- risk/impact inputs;
- Control Requirement;
- approval/confirmation evidence;
- clearance;
- clearance invalidation;
- human vs KEY authority separation.

Primary journeys:

- J2 Governed Action
- J6 Proactive KEY / Autonomy
- J15 Approval / Governance Lifecycle
- J16 Business Genome Evolution
- J17 Command Center → Priority → Action
- J18 Failure → Recovery
- J23 Temporal Flow

Core distinction:

```text
human authority != KEY autonomy
impact/risk tier != control requirement
approval != clearance
```

Control-plane policy mutation must require authority at least as strong as the behavior it can enable.

---

## K4 — Business Knowledge Kernel

**Working ID:** `KF-KERNEL-004`

Owns:

- BusinessBlueprint as operator declaration/configuration source;
- observations/signals;
- assertion normalization;
- ontology/FactDefinition;
- GenomeFact;
- GenomeEvidence;
- confidence;
- freshness;
- verification;
- conflict/precedence resolution;
- canonical/resolved business facts;
- Business Genome interpretation;
- BusinessGraph knowledge projection;
- compatibility migration from older parallel knowledge models.

Primary journeys:

- J1 Business Birth
- J2 Governed Action
- J6 Proactive KEY
- J16 Genome Evolution
- J17 Command Center

Eventually almost every operational journey feeds this kernel.

Core invariant:

> A weaker assertion must never silently overwrite a stronger verified assertion.

---

## K5 — Capability Fabric Kernel

**Working ID:** `KF-KERNEL-005`

Owns stable business-action definitions:

- exact capability identity;
- version;
- owner/module;
- input/output schema;
- permission identity;
- impact/risk classification;
- readiness prerequisites;
- control-policy metadata;
- execution mode;
- idempotency classification;
- changed entities;
- compensability/undo semantics where applicable.

Primary implementation seam:

`CapabilityContractService`

Working rule:

> Strengthen the existing Capability Contract seam before inventing an `ActionRegistry2` or parallel capability fabric.

A capability identity must survive:

```text
proposal
-> governance
-> approval/control evidence
-> clearance
-> execution
-> outcome
```

---

## K6 — State Transition Kernel

**Working ID:** `KF-KERNEL-006`

Owns valid lifecycle transitions across domains.

Canonical transition form:

```text
current state
+ requested transition
+ principal
+ capability
+ preconditions
+ authority/governance
-> mutation
-> postconditions
-> evidence/event/audit
```

Examples:

- Business → ONBOARDING_COMPLETE
- Invoice → PAID
- Booking → CONFIRMED
- Connector → CONNECTED
- Proposal → APPROVED
- Contract → ACTIVE
- Task → COMPLETED

Core law:

> Lifecycle states are produced by valid transitions, not generic property mutation.

This kernel is intentionally distinct from Temporal Flow: K6 owns state-transition legitimacy; K7 owns coordination through time.

---

## K7 — Temporal / Event / Workflow Kernel

**Working ID:** `KF-KERNEL-007`

Owns:

- BusinessEvent;
- Temporal Flow;
- Flow/workflow coordination;
- scheduled work;
- plan orchestration;
- wait states;
- timers;
- retries;
- long-running processes;
- correlation/causation;
- event publication/consumption;
- committed-state event semantics;
- workflow resumption.

Major journeys:

- J3 Lead → Customer → Cash
- J4 Booking → Service → Payment
- J6 Proactive KEY
- J8 Project / Work Delivery
- J9 Marketing
- J10 Commerce
- J11 Contracts
- J13 Connectors
- J14 External Event Ingress
- J18 Failure / Recovery
- J23 Temporal Flow

---

## K8 — Evidence & Outcome Kernel

**Working ID:** `KF-KERNEL-008`

Owns the closing half of the intelligence loop:

```text
action
-> execution result
-> business consequence
-> evidence/outcome
-> confidence/reliability update
-> Business Graph update
-> Genome evolution
-> recommendation/policy learning inputs
```

Primary concern:

KEY must not merely perform actions. The system must know what actually happened, with enough provenance to distinguish attempted, accepted, completed, externally reconciled and uncertain outcomes.

Primary journeys:

- J2 Governed Action
- J6 Proactive KEY
- J12 Document / Evidence
- J14 External Events
- J16 Genome Evolution
- J18 Failure / Recovery
- most side-effecting operational journeys.

---

## K9 — Integration & External Reality Kernel

**Working ID:** `KF-KERNEL-009`

Owns:

- connectors;
- OAuth/credentials;
- provider identity;
- webhooks;
- external IDs;
- synchronization;
- reconciliation;
- provider-side idempotency;
- provider truth versus local projection;
- stale/failed/degraded connection state;
- external evidence.

Major journeys:

- J13 Connector Lifecycle
- J14 Webhook / External Event Ingress
- J4 Booking / Payment
- J9 Marketing
- J10 Commerce
- J21 Public Customer Experience
- J18 Failure / Recovery

Target state must distinguish concepts such as:

```text
configured
connected
authenticated
verified
operational
synchronized
stale
failed
```

rather than collapsing them into one boolean.

---

## K10 — Financial Truth Kernel

**Working ID:** `KF-KERNEL-010`

Owns business money truth and its reconciliation:

- invoice;
- payment;
- ledger/posting;
- receivables/payables where applicable;
- settlement;
- refund;
- reconciliation;
- currency;
- financial evidence;
- real versus synthetic financial classification;
- provider/local financial state convergence.

Major journeys:

- J3 Lead → Customer → Cash
- J4 Booking → Service → Payment
- J7 Financial Truth
- J10 Commerce / Fulfilment
- J11 Contract → Obligation → Renewal
- J20 Plan / Subscription / AI Cost

---

## K11 — Recovery & Reliability Kernel

**Working ID:** `KF-KERNEL-011`

Owns:

- atomic execution claim;
- idempotency;
- transaction boundaries;
- retries;
- leases;
- crash recovery;
- saga/compensation;
- dead-letter handling;
- duplicate/lost event safety;
- partial failure;
- reconciliation;
- outcome-unknown state;
- recovery UX.

J18 is the obvious anchor journey, but K11 must be tested against every side-effecting journey.

Core distinctions:

```text
clearance != execution claim
execution claim != idempotency replay
queue dedupe != system-wide execution ownership
```

Preferred existing execution seam to evolve:

`ActionDispatcherService`

---

## K12 — Engineering Control Plane Kernel

**Working ID:** `KF-KERNEL-012`

Owns the system that safely changes KeyFlowOS itself:

- architecture state;
- generated registries/maps;
- tests;
- CI/CD evidence;
- migrations;
- deployment/drift;
- architecture ratchets;
- documentation provenance;
- agent continuity/instructions;
- implementation packets;
- independent review;
- architecture knowledge ingestion;
- eventual Architecture Atlas.

J24 System Change / Engineering Safety anchors this kernel.

It governs every future implementation.

---

# Constellation model

Journeys should often be analysed as overlapping constellations rather than sequential isolated files.

## Constellation A — Birth → Authority → Governance → Action

Current active constellation:

```text
J1 Business Birth
  ↕
J25 Human Authority Lifecycle
  ↕
J15 Approval / Governance Lifecycle
  ↕
J2 KEY Request → Governed Action
  ↕
J6 Proactive KEY / Autonomy
```

J15 has already been admitted for active forensics after the original J1/J25/J2 three-axis convergence. It remains capable of reopening those foundations.

## Constellation B — Knowledge → Intelligence → Action

```text
J1 Business Birth
-> J16 Genome Evolution
-> J17 Command Center
-> J2 Governed Action
-> J6 Proactive KEY
-> J16 Genome Evolution
```

Feedback loop:

```text
know -> reason -> act -> observe -> know better
```

## Constellation C — Customer → Revenue

```text
J9 Marketing
-> J3 Lead → Customer → Cash
-> J4 Booking → Service → Payment
-> J10 Commerce / Fulfilment
-> J21 Public Customer Experience
-> retention / further revenue
```

J7 Financial Truth continuously validates monetary reality.

## Constellation D — Commitment → Delivery

```text
J11 Contract
-> J8 Project / Work Delivery
-> J12 Document / Evidence
-> J23 Temporal Flow
-> J7 Financial Truth
```

Product interpretation:

```text
promise -> obligation -> work -> proof -> cash
```

## Constellation E — External Reality

```text
J13 Connector Lifecycle
-> J14 Webhook / External Event
-> operational journeys
-> J18 Failure / Recovery
-> J13 reconciliation
```

## Constellation F — Platform Survival

```text
J18 Failure / Recovery
J19 Privacy / Deletion / Exit
J20 Plan / Subscription / AI Cost
J24 System Change / Engineering Safety
```

These journeys test what happens when the ideal path breaks.

---

# Kernel dossier requirement

Each kernel should eventually receive a dedicated dossier under `docs/intelligence/kernels/`.

Canonical working kernel dossier schema:

```text
A. Definition / Scope
B. Product Intent
C. Truth Ownership
D. Current Implementation Sources
E. Inputs
F. Outputs / Consumers
G. State / Transition Semantics
H. Journey Impact Matrix
I. Canonical Vocabulary / Contracts
J. Authority / Governance
K. Transactions / Concurrency / Idempotency
L. Failure / Recovery
M. Security / Privacy
N. Evidence / Observability
O. Reachability / Consumers
P. Duplication / Legacy / Compatibility
Q. Invariants
R. Findings
S. Contradictions
T. Open Questions
U. Target-State Candidate
V. Migration / Compatibility
W. Proof / Test Ratchets
X. Layered Improvement
Y. Machine-readable Record
```

A kernel dossier is an evolving architectural object, not an implementation specification by default.

---

# Finding discipline

Do not intentionally create multiple findings for the same architectural defect merely because it appears in multiple journeys.

Preferred model:

```text
KF-FIND-<KERNEL>-###
canonical permission vocabulary is fragmented

affects:
  - J2
  - J8
  - J15
  - J23
  - J25
```

The current historical/global finding register remains valid. Kernel-scoped identifiers may be introduced deliberately in a future Atlas/schema migration; do not silently renumber existing F001–F075-style findings.

A finding lifecycle should support:

```text
PROVISIONAL
-> VERIFIED
-> RE-ANALYZED
   -> STRENGTHENED
   -> NARROWED
   -> UNCHANGED
   -> SUPERSEDED
   -> REFUTED
```

The goal is truth, not preservation of previous conclusions.

---

# Recommendation discipline

Shared recommendations should be expressed at kernel level when the problem is kernel-level.

Examples:

```text
canonical permission vocabulary
Effective Authority Resolver
routing separated from authority proof
bounded delegation
load-bearing Capability Contract
atomic execution claim
single post-clearance dispatcher
immutable action/control binding
```

A kernel recommendation is not automatically an implementation ticket.

---

# Cross-Journey Impact Matrix

Every major kernel recommendation/decision must record which journeys it affects.

High-leverage changes deserve more architectural scrutiny precisely because they affect more journeys.

The impact matrix should eventually cover all 25 journeys and all 12 kernels.

When a kernel law changes:

```text
new evidence
-> kernel changed
-> invariant changed
-> identify consuming journeys
-> mark stale conclusions
-> rescore recommendations
-> replay target architecture
-> update current state
```

---

# Layered improvement model

Every kernel and journey should be assessed using the same layered model.

## Layer 0 — Correctness

Does it actually work?

- correct state;
- correct tenant;
- correct side effects;
- correct error behavior.

## Layer 1 — Mandatory production standard

The floor:

- security;
- authorization;
- validation;
- transactions;
- idempotency;
- audit;
- observability;
- privacy;
- accessibility where relevant;
- performance;
- testability.

Basic security/RBAC/idempotency are standards, not innovation.

## Layer 2 — Strong KeyFlow architecture

- canonical semantics;
- capability contracts;
- state transition model;
- evidence provenance;
- adaptive readiness;
- causal history;
- unified governance;
- shared kernels rather than route-local rules.

## Layer 3 — Advanced architecture

Examples:

- authority/policy version invalidation;
- clearance expiry;
- resource-state fingerprints;
- execution leases;
- bounded hierarchical clearance;
- continuous revocation;
- reconciliation-driven truth.

## Layer 4 — KeyFlow-specific differentiation

Examples:

- confidence-sensitive autonomy;
- adaptive onboarding;
- causal Business Graph;
- self-improving playbooks;
- business-state simulation;
- explainable Authority Graph;
- dynamic authority recommendations;
- automated process discovery;
- evidence-aware KEY explanations;
- predictive bottleneck detection;
- business digital twin behavior.

Innovation must be loop-tested through affected journeys before being considered mature.

---

# Convergence maturity model

Use this model for journeys and, where useful, kernels:

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

This is not a linear permanence guarantee.

At any level:

```text
new evidence
-> NEEDS_REVISIT
-> return to earliest invalidated layer
```

---

# Current convergence position

The J1/J25/J2 mesh directionally converged around:

- Membership-first tenant relationship;
- Effective Authority;
- load-bearing Capability Contract direction;
- exact-action clearance;
- atomic execution claim;
- ActionDispatcher as preferred post-clearance execution seam.

That convergence admitted J15 for active forensic stress-testing.

J15 has already begun reopening/refining:

- approval/control evidence semantics;
- position-bound approver principal classes;
- quick-confirm action binding;
- plan approval semantics;
- ApprovalRequest versus KeyActionProposal roles;
- execution/clearance relationships.

The correct current constellation is therefore:

```text
J1 ↔ J25 ↔ J2 ↔ J15
```

with J6 as the next natural stress-test member when the current governance kernel is sufficiently reconciled.

Production implementation remains unauthorized until relevant clusters reach target convergence and execution-readiness gates.
