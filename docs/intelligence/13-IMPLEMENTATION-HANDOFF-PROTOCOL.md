# KeyFlowOS Implementation Handoff Protocol

Status: CANONICAL PRE-IMPLEMENTATION CONTROL PROTOCOL

Purpose: ensure Claude Code, Kimi Code, Gemini Code or any other coding/review agent receives the same accepted architecture state, cannot silently reinterpret KeyFlowOS, and returns implementation evidence in a form the Journey Mesh + Kernel Mesh can re-ingest.

## Operating division of labour

```text
ARCHITECTURE / RESEARCH COMMAND CENTER
  = journey + kernel digital twin
  = forensic analysis
  = product reasoning
  = standards / research
  = target-state design
  = implementation sequencing
  = independent post-change validation

CLAUDE CODE
  = primary bounded repository implementer

KIMI / GEMINI CODE
  = adversarial reviewer
  = alternative implementation analysis
  = edge-case / large-context repository review

GITHUB
  = implementation source of truth

VS CODE
  = execution environment
```

The architecture command center must not devolve into a stream of isolated file-fix requests.

---

# Implementation authorization gate

No coding packet should be issued merely because a defect is verified.

A cluster should be close to:

```text
mapped
-> cross-referenced
-> semantically reconciled
-> value-engineered
-> target-converged
-> migration understood
-> proof/ratchets designed
-> EXECUTION-READY
```

Production implementation remains read-only/unauthorized until explicitly promoted.

---

# Implementation packet format

Every authorized implementation unit receives a stable ID, for example:

`KF-EXEC-AUTH-003`

Each packet must contain:

## 1. Objective

The exact behavior/system property to change.

Do not use vague objectives such as "fix authorization" or "clean up approvals".

## 2. Current-state evidence

Include:

- implementation baseline branch + commit;
- verified source paths;
- relevant findings/contradictions;
- reachability/consumer evidence;
- evidence classification;
- important unknowns that remain.

## 3. Accepted target invariant(s)

State the exact architectural law the implementation must satisfy.

Example form:

```text
No principal may grant authority beyond its effective grantable authority.
```

or:

```text
A material mutation of an approved action invalidates prior control evidence and clearance.
```

## 4. Journey impact

List every journey known to consume or mutate the affected semantics.

## 5. Kernel impact

List every affected kernel.

## 6. Target-state contract

Include relevant:

- state machine;
- API/domain contract;
- authority semantics;
- capability identity;
- persistence behavior;
- concurrency/idempotency semantics;
- evidence/observability requirements;
- failure behavior.

## 7. Existing seams to strengthen

Explicitly identify existing machinery that must be evaluated/used before creating replacements.

Examples:

- Membership
- CapabilityContractService
- ActionDispatcherService
- AuthorityGrant
- KeyCortexApprovalOrchestrator
- ApprovalRequest

## 8. Prohibited shortcuts

Examples:

- no route-local authorization if the accepted target requires central authority resolution;
- no second capability registry;
- no client-supplied grantor identity;
- no boolean confirmation detached from immutable server-side action identity;
- no check-then-update concurrency transition where an atomic claim is required;
- no migration that deletes legacy state before consumer proof;
- no silently weakening invariant to fit current schema.

## 9. Exact affected systems/files

Provide known likely files/services/models, but do not imply that the packet author has enumerated every consumer unless proven.

The implementer must report additional discovered consumers.

## 10. Migration/data-repair concerns

State:

- existing data invariants;
- backfill/repair requirements;
- compatibility window;
- dual-read/write if justified;
- rollback considerations;
- how to detect incomplete migration.

## 11. Characterization tests

Before changing behavior, preserve/prove relevant current behavior where necessary so migration does not erase evidence.

## 12. Acceptance tests / proof ratchets

Tests must prove the invariant, not merely the code path.

Include relevant:

- unit/contract;
- integration;
- end-to-end journey;
- concurrency/race;
- tenant isolation;
- stale/revoked authority;
- retry/idempotency;
- migration compatibility;
- security/adversarial;
- observability/evidence.

## 13. Explicit non-goals

Prevent adjacent architecture from being silently redesigned inside the packet.

## 14. Rollback / failure strategy

Specify what happens if:

- migration fails;
- a consumer was missed;
- new path cannot reconcile legacy state;
- provider outcome becomes unknown;
- proof fails.

---

# Implementer rules

The primary implementation agent must:

1. load repository agent instructions and the architecture packet before editing;
2. revalidate the stated implementation baseline if main advanced;
3. preserve current-vs-target distinction;
4. avoid inventing new architectural sources of truth without explicit approval;
5. report evidence that contradicts the packet instead of coding around it;
6. stop and escalate if a foundational target assumption is false;
7. keep changes bounded to the packet unless an unavoidable dependency is reported;
8. add/update tests that prove the accepted invariant;
9. never report "all green" without identifying what actually ran;
10. return a structured evidence packet after implementation.

---

# Mandatory implementation return packet

Every coding agent must return:

## A. Commit / diff identity

- branch;
- commit SHA(s);
- PR if applicable.

## B. Changed files

Complete list grouped by purpose.

## C. Invariant mapping

For every accepted invariant:

```text
invariant
-> implementation location
-> proof/test location
-> result
```

## D. Additional discoveries

Any unexpected consumer, legacy path, contradiction or architecture mismatch discovered while coding.

## E. Tests actually executed

For each command/check:

- exact command or CI job;
- outcome;
- failures/skips;
- environment limitations.

Distinguish:

```text
test source added
!= test executed
!= runtime behavior reproduced
!= system invariant proven
```

## F. Migration evidence

What was migrated/repaired, what remains compatible, and how rollback works.

## G. Known residual risks

Do not hide incomplete proof.

## H. Journey/kernel impact updates

Which dossiers and kernels now need re-audit.

---

# Architecture command-center post-implementation review

After implementation, the architecture session independently inspects the actual GitHub commit/diff and asks:

```text
Did the change satisfy the accepted invariant?
Did it introduce another source of truth?
Did it preserve exact capability/authority/evidence semantics?
Did it alter adjacent journey state machines?
Did migration preserve required compatibility?
Did tests actually prove the behavior claimed?
Did new reachability or legacy consumers appear?
Does the Journey Mesh change?
Does the Kernel Mesh change?
Does the target architecture need reopening?
```

The implementation agent's self-assessment is evidence, not final architectural acceptance.

---

# Adversarial reviewer protocol

Kimi/Gemini or another independent reviewer should receive:

- the implementation packet;
- accepted invariant(s);
- implementation commit/diff;
- test evidence;
- known residual risks.

The reviewer should search specifically for:

- bypass paths;
- alternate writers;
- alternate readers;
- state-transition races;
- stale authorization;
- tenant-crossing behavior;
- duplicated source of truth;
- compatibility regressions;
- missing resource/value/time constraints;
- partial provider outcomes;
- tests that prove only mocks/local branches;
- architecture drift from the target contract.

The reviewer should not redesign the entire subsystem unless the evidence disproves the accepted target.

---

# Re-ingestion into the Journey Mesh

Implementation is not complete when code merges.

The return packet must be re-ingested:

```text
implementation diff
-> evidence review
-> affected kernel re-audit
-> affected journey replay
-> findings updated
-> contradictions updated
-> decisions/recommendations updated
-> proof status updated
-> current-state/handoff updated
```

If implementation evidence invalidates the architecture, return to the earliest invalidated analytical layer.

---

# Multi-agent consistency rule

Do not ask several implementation agents to independently invent target architecture for the same unresolved subsystem.

Preferred sequence:

```text
architecture converges target
-> one bounded implementation packet
-> primary implementation agent
-> GitHub commit/diff
-> architecture command-center review
-> independent adversarial review
-> corrections if needed
-> proof
-> ingrain
```

Alternative implementation suggestions are useful only when compared against the same accepted invariant set.

---

# Minimal prompt header for coding agents

Every implementation packet should begin with a control header similar to:

```text
KEYFLOWOS IMPLEMENTATION PACKET

Remain within this packet's accepted architecture.
Repository implementation truth is GitHub at the stated baseline.
If repository evidence contradicts the packet, stop and report the contradiction.
Do not create a parallel source of truth when an existing seam can be strengthened.
Do not weaken an invariant to make implementation easier.
Do not claim tests passed unless actually executed.
Return commit/diff identity, invariant mapping, executed tests, residual risks and all additional discovered consumers.
```

---

# Session-control rule

The architecture/research session remains the durable reasoning command center.

Use it for:

- forensic mapping;
- journey/kernel convergence;
- standards/research;
- product philosophy;
- target-state architecture;
- execution sequencing;
- implementation validation;
- architecture knowledge compaction.

Use coding agents for bounded implementation and bounded adversarial review.

Convergence, not file count or finding count, is progress.
