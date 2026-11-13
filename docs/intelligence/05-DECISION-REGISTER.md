# KeyFlowOS Decision Register

Status: CANONICAL REGISTER

Material architectural/product/methodological decisions belong here. Rejected alternatives and superseded assumptions should be preserved when known.

---

## KF-DEC-001 — Externalize analytical intelligence from chat

**Status:** ACCEPTED

**Decision:** Conversations are temporary working memory. Durable KeyFlowOS understanding must be written into version-controlled repository files.

**Rationale:** Chat length and retrieval limits must not cause loss of accepted work or force future agents to reconstruct architectural history from memory.

**Consequence:** A substantial analytical cycle is incomplete until canonical files, current state, handoff, and session journal are updated.

---

## KF-DEC-002 — Use GitHub repository as canonical intelligence store

**Status:** ACCEPTED

**Decision:** `docs/intelligence/` in the KeyFlowOS repository is the canonical shared memory for ChatGPT, Claude Code, Kimi Code, other agents, and human collaborators.

**Rationale:** Version control provides explicit files, history, diffability, reversibility, and cross-agent access.

---

## KF-DEC-003 — Analyse KeyFlowOS macroscopically before microscopic modelling

**Status:** ACCEPTED / COMPLETED PHASE

**Decision:** Build and refine the system-level model first, then proceed into microscopic causal journeys.

---

## KF-DEC-004 — Microscopic modelling is journey-based and computable

**Status:** ACCEPTED

**Decision:** The microscopic model traces causal end-to-end business journeys rather than merely documenting modules in isolation.

**Rationale:** Journeys expose UX, authorization, state transitions, mutations, events, AI behavior, failures, concurrency, and cross-module contradictions that module inventories hide.

---

## KF-DEC-005 — First microscopic journey is Business Birth

**Status:** ACCEPTED

**Decision:** Begin the microscopic programme with `KF-JOURNEY-001 — Business Birth`.

---

## KF-DEC-006 — Business Genome is living operating understanding

**Status:** ACCEPTED DIRECTION

**Decision:** The Business Genome is not a one-time onboarding profile. It is a living, evidence-backed interpretation of the business used for confidence, readiness, gaps, stage, risk and actionability.

---

## KF-DEC-007 — Blueprint and Genome are not synonyms

**Status:** ACCEPTED

**Decision:** Treat the Blueprint primarily as structured founder/operator declaration/configuration and the Genome as evidence-aware resolved/interpreted business understanding.

---

## KF-DEC-008 — KEY creates intelligence, not unchecked authority

**Status:** ACCEPTED

**Decision:** KEY's execution authority must be bounded by business context, evidence, readiness, human authority, KEY autonomy/delegation, governance, policy and risk.

---

## KF-DEC-009 — Isolation is build strategy; integration is product outcome

**Status:** ACCEPTED

**Decision:** Modular isolation remains valuable for implementation and testing, but controlled cross-domain coupling is permitted where a critical user journey requires it.

---

## KF-DEC-010 — Preserve evidence, interpretation, and decision separately

**Status:** ACCEPTED

**Decision:** Repository/source/runtime evidence must remain distinguishable from analyst interpretation and accepted architecture.

---

## KF-DEC-011 — Do not fabricate continuity gaps

**Status:** ACCEPTED

**Decision:** If prior-thread details cannot be reliably recovered, record the gap and proceed only through explicit re-acceptance or later recovery.

**Update:** the previous `KF-JOURNEY-002+` recovery gap was subsequently resolved through an explicit recovery packet. The recovered programme through J25 is now recorded in `03-ANALYSIS-MAP.md` and the source packet is preserved under `sessions/`.

---

## KF-DEC-012 — Journey analysis is recursive and bidirectional

**Status:** ACCEPTED

**Decision:** A journey is not considered permanently closed after one pass. Findings in later journeys may reopen assumptions in earlier journeys.

**Recovered progression:** `J1 -> J2 -> J1 -> J2`, later `J1 <-> J25 <-> J2`.

**Rejected alternative:** analyze each journey independently once and freeze it.

---

## KF-DEC-013 — No production changes before architectural convergence

**Status:** ACCEPTED

**Decision:** The current forensic analysis remains read-only until relevant journey architecture converges sufficiently to define coherent target-state execution packets.

**Rationale:** Premature fixes can harden contradictions or optimize the wrong abstraction.

**Consequence:** Recommendations remain provisional until cross-journey validation and explicit acceptance.

---

## KF-DEC-014 — J1/J25/J2 convergence precedes full J15 analysis

**Status:** ACCEPTED

**Decision:** Do not fully open `KF-JOURNEY-015 — Approval / Governance Lifecycle` yet.

First converge:

```text
KF-JOURNEY-001 — Business Birth
        ↕
KF-JOURNEY-025 — Human Authority Lifecycle
        ↕
KF-JOURNEY-002 — KEY Request → Governed Action
```

Required stabilization topics:

1. Membership-first tenant relationship and owner semantics;
2. effective human-authority algebra;
3. stable capability identity and exact-action clearance;
4. concurrency-safe execution claim / post-clearance execution semantics.

Then re-run the mesh and perform a J15 admission review.

---

## KF-DEC-015 — Distinguish human authority from KEY autonomy

**Status:** ACCEPTED

**Decision:** Human permission and KEY autonomy/delegation are separate authority axes and must not substitute for each other.

**Consequence:** A governed action must evaluate both where relevant.

---

## KF-DEC-016 — Capability identity must survive governance and execution

**Status:** ACCEPTED DIRECTION

**Decision:** The underlying business capability must remain identifiable from proposal through policy evaluation, approval/confirmation, clearance, execution and outcome.

**Invariant direction:** **THE THING APPROVED = THE THING EXECUTED.**

**Consequence:** generic wrappers such as `EXECUTE_TOOL` must not erase the underlying capability's material risk/permission identity.

---

## KF-DEC-017 — Clearance and execution claim are distinct concepts

**Status:** ACCEPTED DIRECTION

**Decision:** Permission to execute an exact action is distinct from which execution process has exclusive right to consume that permission.

- Clearance: this exact action may execute.
- Execution claim: this execution process is the permitted claimant/consumer.

This distinction exists to address concurrency, duplicate proposal/plan execution, queue/direct races, retries and crash recovery.

---

## KF-DEC-018 — Prefer strengthening existing architectural seams before inventing replacements

**Status:** ACCEPTED METHODOLOGICAL RULE

**Decision:** Before creating parallel v2 registries/services, determine whether existing seams can be made canonical/load-bearing.

Recovered examples requiring evaluation rather than automatic replacement:

- `CapabilityContractService`
- `ActionDispatcherService`
- Membership
- AuthorityGrant

---

## KF-DEC-019 — Legacy residue requires consumer proof before retirement

**Status:** ACCEPTED

**Decision:** A legacy/duplicate model is not deleted merely because a newer architecture exists. Active consumers, reachability and compatibility requirements must be proven first.

Recovered examples: `BusinessGenome`, `BusinessGuidanceProfile`, older approval/governance paths.

---

## KF-DEC-020 — Tests and verification claims must be evidence-specific

**Status:** ACCEPTED METHODOLOGICAL RULE

**Decision:** Distinguish at least:

- implementation exists;
- test source exists;
- test currently passes;
- runtime behavior was reproduced;
- generated state reports a condition.

Never state “verified” when only test source or narrative documentation was inspected.
