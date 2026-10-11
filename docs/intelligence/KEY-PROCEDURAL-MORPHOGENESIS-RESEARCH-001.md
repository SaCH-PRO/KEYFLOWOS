# KEY Procedural Morphogenesis — Research and Architecture Synthesis 001

Status: ADDITIVE / ZERO APPLICATION-PROGRAMME CREDIT / NO RUNTIME CUTOVER  
Parent: Issue #135; Context Genome parent #106.  
Canon event: PR #120 late evidence + exact-head proof + branch-cap contradiction.

## 1. Purpose

Convert recurring human-agent work into governed procedural intelligence, while extending KEY toward a differentiated, multi-scale cognitive organism rather than a monolithic mega-agent.

The target loop is:

```
observe -> preserve episode -> detect repeated structure -> abstract invariants
-> specify procedure -> shadow/replay -> evaluate -> bounded promotion
-> execute -> observe outcome -> consolidate -> version or retire
```

This document is an architectural target, not permission for production effects.

## 2. Canon-event dissection

PR #120 exposed a general class of failure:

1. semantic work stabilized at an immutable semantic head;
2. independent semantic review was required;
3. the preferred reviewer returned NOT_RUN because of quota;
4. a control artifact was created before fallback review existed;
5. fallback PASS arrived later;
6. the artifact then lacked evidence it was required to record;
7. a new correction commit would exceed the branch budget;
8. the worker stopped on contradiction rather than weakening invariants;
9. authority selected the minimum legal recovery: replace only the control artifact with force-with-lease;
10. all exact-head proof had to run again.

The lesson is structural, not Git-specific: action correctness depends on state, timing, ordering, authority, evidence identity and resource constraints.

## 3. Planes

Keep these planes distinct:

- semantic: what the product/runtime means;
- control: orchestration, holds, phases, admission;
- evidence: tests, measurements, reviews, attestations;
- authority: who may permit which transition;
- execution: what action actually runs;
- outcome: what occurred in reality;
- learning: what procedure/model should change.

Cross-plane collapse is a recurrent source of failure. In particular:
- evidence != authority;
- procedure != permission;
- projection != source of truth;
- review availability != review result;
- path frequency != truth;
- successful procedure knowledge != authorization to execute it.

## 4. Procedural intelligence

A Procedure is a governed cognitive program, not a prompt template.

Minimum semantics:
- initiation/applicability conditions;
- required context and freshness;
- deterministic and reasoning operators;
- allowed capabilities;
- authority/risk/approval contract;
- invariants and evidence obligations;
- ordering/concurrency/idempotency;
- retry/timeout semantics;
- stop and contradiction conditions;
- compensation/recovery;
- terminal outcome vocabulary;
- evaluator and negative controls;
- version/lineage/outcome history.

Promotion ladder:

EPISODE
-> CANDIDATE_PATTERN
-> PROTOCOL
-> PROCEDURE_SPEC
-> EXECUTABLE
-> SHADOW
-> EVALUATED
-> BOUNDED_AUTONOMY
-> PROMOTED | QUARANTINED | RETIRED

No repeated sequence gains autonomy merely by recurrence.

## 5. Differentiation / morphogenesis

KEY agents should share one governed capability substrate but express only a context-appropriate phenotype.

Generic substrate
+ goal
+ scope
+ risk
+ authority
+ resources
+ local context
-> specialist phenotype

A phenotype binds only the needed:
- procedures;
- tools/capabilities;
- memory views;
- policies;
- budgets;
- evaluators.

Repeatedly useful specialist cooperation may be promoted:
agent -> specialist class -> tissue/team -> domain organ -> larger system.

Promotion must be evidence-backed; permanent agent proliferation is rejected.

## 6. Biological mechanisms used as design inspiration

These are analogies to extract mechanisms from, not claims that software should literally behave like biology.

### Morphogen / developmental signaling
Graded context signals can bias specialization without centrally specifying every local action. Candidate KEY gradients include urgency, uncertainty, risk, resource scarcity, novelty, dependency pressure and failure density.

### Multicellular specialization
Shared genome + differentiated expression suggests one canonical capability substrate with scoped expression, not separate incompatible agent stacks.

### Homeostasis
Evaluators and invariant monitors maintain viable operating ranges. A system that stops on abnormality may be healthier than one that keeps moving.

### Apoptosis / pruning
Procedures and specialists need explicit retirement, quarantine and replacement states so capability accumulation does not become permanent complexity.

### Mycelial/adaptive transport
Verified useful paths may receive routing preference; poor paths may weaken. Routing strength must never increase epistemic authority.

### Immune analogy
Untrusted procedures, external knowledge and anomalous agent behavior require quarantine, corroboration and defensive memory.

## 7. Scale-recursive cognition

A lower-order system may become a modular unit at the next scale only when it exposes a trustworthy contract.

Each promoted unit must expose:
- stable identity and boundary;
- macro-state;
- internal drill-down link;
- observable signals;
- bounded actuation interface;
- authority boundary;
- invariants;
- resource budget;
- health/readiness;
- failure modes;
- provenance;
- composition interface.

Recursive pattern:

```
events/actions
-> procedures/agents
-> teams/tissues
-> domains/organs
-> business/system
-> organization
-> ecosystem/federation
-> larger world model
```

At every level:
- bottom-up evidence aggregates into macro-state;
- top-down goals become bounded constraints;
- peers coordinate laterally;
- drill-down provenance remains possible.

The target is sufficient governability, not imaginary omnipotent control.

## 8. Subject / attestation separation

Evidence about an immutable subject should preferentially reference the subject by stable identity/digest instead of mutating that subject just to store proof.

Candidate pattern:

```
immutable subject digest
  |- build attestation
  |- test attestation
  |- semantic-review attestation
  |- security attestation
  |- admission attestation
  |- runtime/outcome attestation
```

This is a research target for the successor control architecture. It does not change PR #120.

## 9. Cross-domain research mechanisms

The architecture intentionally borrows mechanisms from established fields:

- Soar chunking: successful deliberative subproblem solving can be compiled into reusable procedural rules; learning can be selectively enabled/disabled.
- Hierarchical reinforcement learning options: reusable behavior has initiation, policy and termination semantics.
- Process mining: actual event traces can be mined for repeated processes and checked for conformance.
- W3C PROV: distinguish entities, activities and agents; retain provenance and derivation.
- SLSA-style attestations: bind claims to immutable artifact identities.
- Distributed systems / logical ordering: ordering and causality are part of correctness.
- SRE: repetitive predictable toil is an automation target; unknown state is not green.
- Canarying: skill autonomy should be promoted in stages with comparison to control.
- Toyota jidoka: abnormality detection should stop propagation rather than normalize defects.
- Developmental biology: shared genetic substrate plus contextual signaling can yield differentiated roles.
- Cybernetics: a regulator needs an adequate model of the system it regulates.
- Organizational routines: a procedure specification and an actual performance are different objects.

## 10. Canonical laws

1. Episode != procedure.
2. Procedure != permission.
3. Spec != performance.
4. Evidence != authority.
5. Projection != source of truth.
6. Association/repetition != verification.
7. Subject != attestation.
8. Timing and ordering are part of action correctness.
9. Contradiction is a legitimate system state.
10. Stop-on-abnormality is a capability.
11. Recovery repairs the minimum violated relationship rather than weakening the invariant.
12. Shared genome, differentiated expression.
13. Complex intelligence should emerge from governed specialization and interaction, not a universal mega-agent.
14. Higher-order composition requires trustworthy encapsulation plus drill-down provenance.
15. Learned routing preference may alter routing, never truth or authority.
16. Autonomy is staged, bounded and revocable.
17. No procedure may depend on hidden conversational context.
18. Structure should persist only when verified function justifies its resource/complexity cost.

## 11. First procedure families

- Context Integrity Loader
- Directive Compiler
- Research & Convergence Loop
- Map-Before-Modify
- Implementation Packet Runner
- Independent Review / Provider Failover
- Contradiction Resolver
- No-Fake-Green Verifier
- Handoff / RETURN Compiler
- Procedure Miner / Skill Distiller
- Exact-Head Finalizer

## 12. Integration target

Context Genome stores episodes, procedures, evidence, outcomes and lineage.
Capability registry declares what can execute.
Policy/authority declares what may execute.
Differentiation selects the smallest specialist phenotype.
Procedure composition creates plans.
Executor performs bounded effects.
Assurance evaluates proof and runtime outcomes.
Consolidation proposes new versions.
Mission Control exposes state, confidence, blockers and exact evidence.

## 13. Research references

Primary examples used for mechanism extraction:
- Soar Procedural Knowledge Learning: https://soar.eecs.umich.edu/soar_manual/04_ProceduralKnowledgeLearning/
- W3C PROV-O: https://www.w3.org/TR/prov-o/
- Google SRE, Eliminating Toil: https://sre.google/workbook/eliminating-toil/
- SLSA Attestation Model: https://slsa.dev/spec/v1.2/attestation-model
- Toyota Production System / jidoka: https://global.toyota/en/company/vision-and-philosophy/production-system/
- Morphogen gradients review: https://pmc.ncbi.nlm.nih.gov/articles/PMC3957335/
- Process Mining overview: https://www.processmining.org/

## 14. Non-goals

- no unbounded self-modification;
- no new third-party runtime;
- no production/provider effects;
- no opaque self-organizing swarm;
- no authority inferred from learned competence;
- no replacement of Context Genome, capability registry or current control-plane truth.
